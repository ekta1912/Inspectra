const fs = require('fs');
const path = require('path');
const os = require('os');
const { execFile } = require('child_process');
const util = require('util');
const AdmZip = require('adm-zip');
const { validateGitHubUrl, isSafeRelativePath, redactSecrets } = require('../../utils/security');

const execFileAsync = util.promisify(execFile);

// File and repository limits
const MAX_REPO_SIZE_BYTES = 50 * 1024 * 1024; // 50MB
const MAX_FILE_SIZE_BYTES = 250 * 1024;       // 250KB
const MAX_ANALYZED_FILES = 250;

// Directories to ignore
const IGNORED_DIRECTORIES = new Set([
  'node_modules',
  '.git',
  '.github',
  '.vscode',
  'dist',
  'build',
  'coverage',
  'vendor',
  'venv',
  '__pycache__',
  '.next',
  '.nuxt',
  'target',
  'bin',
  'obj',
  'tmp',
  'temp',
  'logs',
  '.devpilot_storage'
]);

// Ignored files and extensions
const IGNORED_EXTENSIONS = new Set([
  '.exe', '.dll', '.so', '.dylib', '.bin', '.iso', '.zip', '.tar', '.gz',
  '.png', '.jpg', '.jpeg', '.gif', '.svg', '.ico', '.webp', '.pdf',
  '.mp4', '.mp3', '.wav', '.mov', '.avi',
  '.woff', '.woff2', '.ttf', '.eot',
  '.map', '.min.js', '.min.css',
  '.lock', '.pyc', '.pyd', '.pyo'
]);

const IGNORED_FILENAMES = new Set([
  'package-lock.json',
  'yarn.lock',
  'pnpm-lock.yaml',
  '.ds_store',
  'thumbs.db',
  '.env',
  '.env.local',
  '.env.production',
  '.env.development'
]);

// Supported code and doc extensions
const EXTENSION_LANGUAGE_MAP = {
  '.js': 'javascript',
  '.jsx': 'javascript',
  '.ts': 'typescript',
  '.tsx': 'typescript',
  '.py': 'python',
  '.java': 'java',
  '.cpp': 'cpp',
  '.cc': 'cpp',
  '.cxx': 'cpp',
  '.c': 'c',
  '.h': 'c',
  '.hpp': 'cpp',
  '.go': 'go',
  '.rs': 'rust',
  '.php': 'php',
  '.rb': 'ruby',
  '.cs': 'csharp',
  '.html': 'html',
  '.css': 'css',
  '.scss': 'scss',
  '.json': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.md': 'markdown',
  '.sh': 'shell'
};

/**
 * Creates an isolated temp workspace for a review
 */
function createWorkspace(reviewId) {
  const dir = path.join(os.tmpdir(), `devpilot_${reviewId}_${Date.now()}`);
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

/**
 * Clones a public GitHub repository into target directory
 */
async function cloneGitHubRepo(repoUrl, branch, targetDir) {
  const validation = validateGitHubUrl(repoUrl);
  if (!validation.valid) {
    throw new Error(validation.error);
  }

  const args = ['clone', '--depth', '1'];
  if (branch && branch.trim()) {
    args.push('--branch', branch.trim());
  }
  args.push(validation.cleanUrl, targetDir);

  try {
    await execFileAsync('git', args, {
      timeout: 60000, // 60s timeout
      maxBuffer: 10 * 1024 * 1024
    });
    return {
      repoName: validation.fullName,
      branch: branch || 'default'
    };
  } catch (error) {
    // If specific branch failed, try without branch option
    if (branch && branch !== 'main' && branch !== 'master') {
      try {
        const fallbackArgs = ['clone', '--depth', '1', validation.cleanUrl, targetDir];
        await execFileAsync('git', fallbackArgs, { timeout: 60000 });
        return {
          repoName: validation.fullName,
          branch: 'default'
        };
      } catch (fallbackError) {
        throw new Error(`Failed to clone repository: ${fallbackError.message}`);
      }
    }
    throw new Error(`Failed to clone repository: ${error.message}`);
  }
}

/**
 * Safely extracts uploaded ZIP archive with Zip-Slip protection
 */
function extractZipSafely(zipBufferOrPath, targetDir) {
  const zip = new AdmZip(zipBufferOrPath);
  const zipEntries = zip.getEntries();

  let totalSize = 0;
  for (const entry of zipEntries) {
    totalSize += entry.header.size;
    if (totalSize > MAX_REPO_SIZE_BYTES) {
      throw new Error(`Archive exceeds maximum allowable size of 50MB.`);
    }

    const entryName = entry.entryName;
    // Reject absolute paths, drive letters, and parent traversal
    if (path.isAbsolute(entryName) || entryName.includes('..') || /^[a-zA-Z]:/.test(entryName)) {
      throw new Error(`Malicious zip entry detected (path traversal): ${entryName}`);
    }

    if (!isSafeRelativePath(entryName, targetDir)) {
      throw new Error(`Unsafe zip extraction path: ${entryName}`);
    }
  }

  zip.extractAllTo(targetDir, true);

  // If the zip contained a single root directory, adjust root if necessary
  const extractedItems = fs.readdirSync(targetDir);
  if (extractedItems.length === 1) {
    const singleChild = path.join(targetDir, extractedItems[0]);
    if (fs.statSync(singleChild).isDirectory() && !IGNORED_DIRECTORIES.has(extractedItems[0])) {
      return singleChild;
    }
  }

  return targetDir;
}

/**
 * Discovers and inventories files in the repository
 */
function discoverRepositoryFiles(repoDir) {
  const inventory = [];
  const stats = {
    discovered: 0,
    analyzed: 0,
    skipped: 0,
    unsupported: 0,
    languages: {}
  };

  function scan(currentDir, relativePath = '') {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });

    for (const entry of entries) {
      const entryName = entry.name;
      const fullPath = path.join(currentDir, entryName);
      const relPath = path.join(relativePath, entryName).replace(/\\/g, '/');

      // Check ignored directories
      if (entry.isDirectory()) {
        if (IGNORED_DIRECTORIES.has(entryName.toLowerCase()) || entryName.startsWith('.')) {
          stats.skipped++;
          continue;
        }
        scan(fullPath, relPath);
        continue;
      }

      stats.discovered++;

      // Check ignored files
      const ext = path.extname(entryName).toLowerCase();
      if (IGNORED_FILENAMES.has(entryName.toLowerCase()) || entryName.startsWith('.env') || IGNORED_EXTENSIONS.has(ext)) {
        stats.skipped++;
        continue;
      }

      const language = EXTENSION_LANGUAGE_MAP[ext];
      if (!language) {
        stats.unsupported++;
        continue;
      }

      // Check file size
      try {
        const fileStat = fs.statSync(fullPath);
        if (fileStat.size > MAX_FILE_SIZE_BYTES) {
          stats.skipped++;
          continue;
        }

        // Read and redact secrets
        const rawContent = fs.readFileSync(fullPath, 'utf-8');
        const sanitizedContent = redactSecrets(rawContent);

        inventory.push({
          filePath: relPath,
          fullPath,
          language,
          size: fileStat.size,
          lineCount: sanitizedContent.split('\n').length,
          content: sanitizedContent
        });

        stats.analyzed++;
        stats.languages[language] = (stats.languages[language] || 0) + 1;

        if (inventory.length >= MAX_ANALYZED_FILES) {
          break;
        }
      } catch (err) {
        stats.unsupported++;
      }
    }
  }

  scan(repoDir);
  return { inventory, stats };
}

/**
 * Cleans up temporary workspace directory
 */
function cleanupWorkspace(dir) {
  if (!dir) return;
  try {
    if (fs.existsSync(dir)) {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  } catch (err) {
    console.warn(`Failed to cleanup workspace ${dir}:`, err.message);
  }
}

module.exports = {
  createWorkspace,
  cloneGitHubRepo,
  extractZipSafely,
  discoverRepositoryFiles,
  cleanupWorkspace,
  MAX_REPO_SIZE_BYTES,
  MAX_FILE_SIZE_BYTES,
  EXTENSION_LANGUAGE_MAP
};

