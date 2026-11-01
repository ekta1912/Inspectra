const path = require('path');

const ASSIGNMENT_PATTERNS = [
  /(api[_-]?key\s*[:=]\s*['"])([\w\-]{16,})(['"])/gi,
  /(token\s*[:=]\s*['"])([\w\-\.]{16,})(['"])/gi,
  /(secret\s*[:=]\s*['"])([\w\-]{16,})(['"])/gi,
  /(password\s*[:=]\s*['"])([^'"\s]{6,})(['"])/gi
];

const DIRECT_SECRET_PATTERNS = [
  // AWS Keys
  /\bAKIA[0-9A-Z]{16}\b/g,
  // GitHub Tokens
  /\bghp_[a-zA-Z0-9]{36}\b/g,
  /\bgithub_pat_[a-zA-Z0-9]{22}_[a-zA-Z0-9]{59}\b/g,
  // Google API keys
  /\bAIza[0-9A-Za-z\-_]{35}\b/g,
  // Standard API keys
  /\bsk-[a-zA-Z0-9]{20,}\b/g,
  // Private keys
  /-----BEGIN [A-Z ]+PRIVATE KEY-----[\s\S]*?-----END [A-Z ]+PRIVATE KEY-----/g
];

/**
 * Redacts secrets from code content before indexing or sending to LLMs
 */
function redactSecrets(content) {
  if (!content || typeof content !== 'string') return content;

  let redacted = content;

  // 1. Redact assignment patterns: variable = "secret" -> variable = "[REDACTED_SECRET]"
  for (const pattern of ASSIGNMENT_PATTERNS) {
    redacted = redacted.replace(pattern, (match, prefix, secret, suffix) => {
      return `${prefix}[REDACTED_SECRET]${suffix}`;
    });
  }

  // 2. Redact standalone token formats
  for (const pattern of DIRECT_SECRET_PATTERNS) {
    redacted = redacted.replace(pattern, (match) => {
      if (match.includes('BEGIN')) {
        return '[REDACTED_PRIVATE_KEY]';
      }
      return '[REDACTED_KEY]';
    });
  }

  return redacted;
}

/**
 * Validates a GitHub URL to prevent SSRF and injection
 */
function validateGitHubUrl(url) {
  if (!url || typeof url !== 'string') {
    return { valid: false, error: 'Repository URL is required.' };
  }

  const trimmed = url.trim().replace(/\.git$/, '');
  const match = trimmed.match(/^https?:\/\/github\.com\/([a-zA-Z0-9_.-]+)\/([a-zA-Z0-9_.-]+)$/i);
  if (!match) {
    return {
      valid: false,
      error: 'Invalid GitHub URL. Must be in the format: https://github.com/owner/repository'
    };
  }

  const owner = match[1];
  const repo = match[2];

  // Disallow localhost, private IPs, or suspicious paths
  if (['localhost', '127.0.0.1', '0.0.0.0'].includes(owner.toLowerCase())) {
    return { valid: false, error: 'Suspicious repository owner.' };
  }

  return {
    valid: true,
    owner,
    repo,
    cleanUrl: `https://github.com/${owner}/${repo}.git`,
    fullName: `${owner}/${repo}`
  };
}

/**
 * Sanitizes zip file entries to prevent Zip Slip / path traversal
 */
function isSafeRelativePath(targetPath, baseDir) {
  const resolved = path.resolve(baseDir, targetPath);
  const normalizedBase = path.resolve(baseDir);
  return resolved.startsWith(normalizedBase + path.sep) || resolved === normalizedBase;
}

module.exports = {
  redactSecrets,
  validateGitHubUrl,
  isSafeRelativePath
};
