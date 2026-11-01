const fs = require('fs');
const path = require('path');
const os = require('os');
const { tool } = require('@langchain/core/tools');
const { z } = require('zod');
const diff = require('diff');
const { runStaticAnalysis } = require('../analysis/staticAnalyzer.service');
const { isSafeRelativePath } = require('../../utils/security');

/**
 * Creates contextual LangChain tools bound to an active repository review session.
 * 
 * @param {Object} session
 * @param {string} session.repoDir - Path to active extracted repository
 * @param {Array} session.inventory - Discovered files inventory
 * @param {Object} session.vectorStore - PersistentVectorStore instance
 * @param {string} session.reviewId - Unique review identifier
 */
function createRepoTools({ repoDir, inventory, vectorStore, reviewId }) {
  // 1. list_repository_files
  const listFilesTool = tool(
    async ({ directory = '', language = '' }) => {
      let filtered = inventory;
      if (directory) {
        const cleanDir = directory.replace(/^[\\\/]/, '').replace(/[\\\/]$/, '');
        filtered = filtered.filter(f => f.filePath.startsWith(cleanDir));
      }
      if (language) {
        filtered = filtered.filter(f => f.language.toLowerCase() === language.toLowerCase());
      }
      return JSON.stringify(
        filtered.map(f => ({
          filePath: f.filePath,
          language: f.language,
          lines: f.lineCount,
          sizeBytes: f.size
        })),
        null,
        2
      );
    },
    {
      name: 'list_repository_files',
      description: 'Lists all supported files in the repository with language, line count, and file size.',
      schema: z.object({
        directory: z.string().optional().describe('Subdirectory path to filter by, e.g. "src" or "lib"'),
        language: z.string().optional().describe('Language to filter by, e.g. "javascript" or "python"')
      })
    }
  );

  // 2. read_repository_file
  const readFileTool = tool(
    async ({ filePath, startLine = 1, endLine = 200 }) => {
      const sanitized = filePath.replace(/^[\\\/]/, '');
      const fullPath = path.resolve(repoDir, sanitized);

      if (!isSafeRelativePath(fullPath, repoDir)) {
        return JSON.stringify({ error: 'Access denied: Path traversal detected' });
      }

      if (!fs.existsSync(fullPath)) {
        return JSON.stringify({ error: `File not found: ${filePath}` });
      }

      try {
        const content = fs.readFileSync(fullPath, 'utf-8');
        const lines = content.split('\n');
        const s = Math.max(1, startLine);
        const e = Math.min(lines.length, endLine);

        const sliced = lines.slice(s - 1, e).map((line, idx) => `${s + idx}: ${line}`);
        return JSON.stringify({
          filePath,
          totalLines: lines.length,
          returnedRange: `${s}-${e}`,
          content: sliced.join('\n')
        });
      } catch (err) {
        return JSON.stringify({ error: `Failed to read file: ${err.message}` });
      }
    },
    {
      name: 'read_repository_file',
      description: 'Reads the content of a specific file in the repository with line numbers.',
      schema: z.object({
        filePath: z.string().describe('Relative path of the file to read, e.g. "src/index.js"'),
        startLine: z.number().optional().default(1).describe('Start line number (1-indexed)'),
        endLine: z.number().optional().default(200).describe('End line number (1-indexed)')
      })
    }
  );

  // 3. search_repository_code
  const searchCodeTool = tool(
    async ({ query, maxResults = 15 }) => {
      const results = [];
      const lowerQuery = query.toLowerCase();

      for (const file of inventory) {
        if (!file.content) continue;
        const lines = file.content.split('\n');

        for (let i = 0; i < lines.length; i++) {
          const line = lines[i];
          if (line.toLowerCase().includes(lowerQuery)) {
            results.push({
              filePath: file.filePath,
              line: i + 1,
              content: line.trim()
            });

            if (results.length >= maxResults) break;
          }
        }
        if (results.length >= maxResults) break;
      }

      return JSON.stringify({
        query,
        matchCount: results.length,
        results
      }, null, 2);
    },
    {
      name: 'search_repository_code',
      description: 'Searches for functions, variables, classes, or code strings across repository files.',
      schema: z.object({
        query: z.string().describe('Search term or identifier name to find across files'),
        maxResults: z.number().optional().default(15).describe('Maximum number of matching lines to return')
      })
    }
  );

  // 4. retrieve_repository_context
  const retrieveContextTool = tool(
    async ({ query, k = 5, filePath = '' }) => {
      if (!vectorStore) {
        return JSON.stringify({ error: 'Vector store not initialized' });
      }

      const filter = filePath ? { filePath } : null;
      const chunks = await vectorStore.similaritySearch(query, k, filter);

      return JSON.stringify(
        chunks.map(c => ({
          filePath: c.filePath,
          startLine: c.startLine,
          endLine: c.endLine,
          similarityScore: c.score,
          content: c.content
        })),
        null,
        2
      );
    },
    {
      name: 'retrieve_repository_context',
      description: 'Performs semantic similarity search over indexed code chunks using the RAG vector store.',
      schema: z.object({
        query: z.string().describe('Natural language or code query to find semantically relevant code chunks'),
        k: z.number().optional().default(5).describe('Number of top relevant chunks to retrieve'),
        filePath: z.string().optional().describe('Optional file path filter')
      })
    }
  );

  // 5. run_static_analysis
  const runStaticAnalysisTool = tool(
    async ({ filePath = '' }) => {
      let targetInventory = inventory;
      if (filePath) {
        targetInventory = inventory.filter(f => f.filePath === filePath);
      }
      const findings = await runStaticAnalysis(targetInventory, repoDir);
      return JSON.stringify(findings, null, 2);
    },
    {
      name: 'run_static_analysis',
      description: 'Executes static analysis checks (ESLint, pattern scanner) on repository files.',
      schema: z.object({
        filePath: z.string().optional().describe('Optional specific file path to analyze')
      })
    }
  );

  // 6. validate_suggested_patch
  const validatePatchTool = tool(
    async ({ filePath, originalSnippet, replacementSnippet }) => {
      const fullPath = path.resolve(repoDir, filePath);
      if (!isSafeRelativePath(fullPath, repoDir) || !fs.existsSync(fullPath)) {
        return JSON.stringify({ valid: false, error: 'Target file does not exist or invalid path.' });
      }

      // Create isolated temporary workspace copy
      const tempSandbox = path.join(os.tmpdir(), `patch_val_${reviewId}_${Date.now()}`);
      fs.mkdirSync(tempSandbox, { recursive: true });

      try {
        const fileContent = fs.readFileSync(fullPath, 'utf-8');
        if (!fileContent.includes(originalSnippet.trim())) {
          return JSON.stringify({
            valid: false,
            error: 'Original code snippet not found in file. Patch cannot be applied cleanly.'
          });
        }

        const patched = fileContent.replace(originalSnippet.trim(), replacementSnippet.trim());
        const tempFilePath = path.join(tempSandbox, path.basename(filePath));
        fs.writeFileSync(tempFilePath, patched, 'utf-8');

        // Check syntax if JS/TS
        const ext = path.extname(filePath).toLowerCase();
        let syntaxValid = true;
        let syntaxError = null;

        if (['.js', '.mjs', '.cjs'].includes(ext)) {
          try {
            // Node syntax check using Function constructor in isolation or vm.compileFunction
            const vm = require('vm');
            new vm.Script(patched);
          } catch (e) {
            syntaxValid = false;
            syntaxError = e.message;
          }
        }

        // Generate unified diff
        const patchDiff = diff.createTwoFilesPatch(
          filePath,
          filePath,
          fileContent,
          patched,
          'original',
          'suggested_fix'
        );

        return JSON.stringify({
          valid: syntaxValid,
          syntaxError,
          diff: patchDiff,
          details: syntaxValid ? 'Patch applied cleanly with valid syntax.' : `Syntax error: ${syntaxError}`
        });
      } finally {
        try {
          fs.rmSync(tempSandbox, { recursive: true, force: true });
        } catch (e) {}
      }
    },
    {
      name: 'validate_suggested_patch',
      description: 'Validates a proposed code patch in an isolated temporary copy without modifying the repository.',
      schema: z.object({
        filePath: z.string().describe('File path of the file being patched'),
        originalSnippet: z.string().describe('Exact original code block to be replaced'),
        replacementSnippet: z.string().describe('New replacement code block')
      })
    }
  );

  // 7. inspect_dependencies
  const inspectDependenciesTool = tool(
    async ({ manifestType = 'all' }) => {
      const results = {
        manifestsFound: [],
        dependencies: {},
        potentialIssues: []
      };

      // Check package.json
      const pkgPath = path.join(repoDir, 'package.json');
      if (fs.existsSync(pkgPath)) {
        try {
          const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
          results.manifestsFound.push('package.json');
          const deps = { ...(pkg.dependencies || {}), ...(pkg.devDependencies || {}) };
          results.dependencies['npm'] = deps;

          // Check known risky or outdated packages
          for (const [dep, ver] of Object.entries(deps)) {
            if (dep === 'jsonwebtoken' && ver.includes('8.')) {
              results.potentialIssues.push({
                package: dep,
                version: ver,
                severity: 'MEDIUM',
                recommendation: 'Upgrade to latest jsonwebtoken to address security advisories.'
              });
            }
            if (dep === 'lodash' && (ver.includes('4.17.1') || ver.includes('4.17.20'))) {
              results.potentialIssues.push({
                package: dep,
                version: ver,
                severity: 'HIGH',
                recommendation: 'Ensure lodash is at least >= 4.17.21 to prevent prototype pollution.'
              });
            }
          }
        } catch (e) {}
      }

      // Check requirements.txt
      const reqPath = path.join(repoDir, 'requirements.txt');
      if (fs.existsSync(reqPath)) {
        try {
          const content = fs.readFileSync(reqPath, 'utf-8');
          results.manifestsFound.push('requirements.txt');
          const lines = content.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('#'));
          results.dependencies['python'] = lines;
        } catch (e) {}
      }

      return JSON.stringify(results, null, 2);
    },
    {
      name: 'inspect_dependencies',
      description: 'Examines project package manifests (package.json, requirements.txt) and identifies dependencies.',
      schema: z.object({
        manifestType: z.string().optional().default('all').describe('Manifest to inspect: "npm", "pip", or "all"')
      })
    }
  );

  return [
    listFilesTool,
    readFileTool,
    searchCodeTool,
    retrieveContextTool,
    runStaticAnalysisTool,
    validatePatchTool,
    inspectDependenciesTool
  ];
}

module.exports = {
  createRepoTools
};

