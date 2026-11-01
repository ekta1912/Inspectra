const { describe, it } = require('node:test');
const assert = require('node:assert');
const { redactSecrets, validateGitHubUrl, isSafeRelativePath } = require('../src/utils/security');

describe('Security & Sanitization Suite', () => {
  it('should redact hardcoded API keys, tokens, and AWS credentials', () => {
    const raw = `
      const apiKey = "sk-1234567890abcdef1234567890abcdef";
      const aws = "AKIAIOSFODNN7EXAMPLE";
      const ghp = "ghp_123456789012345678901234567890123456";
    `;
    const redacted = redactSecrets(raw);
    assert.strictEqual(redacted.includes('sk-1234567890abcdef'), false);
    assert.strictEqual(redacted.includes('AKIAIOSFODNN7EXAMPLE'), false);
    assert.strictEqual(redacted.includes('ghp_1234567890'), false);
    assert.strictEqual(redacted.includes('[REDACTED'), true);
  });

  it('should validate legitimate GitHub URLs and reject SSRF/local hosts', () => {
    const valid = validateGitHubUrl('https://github.com/expressjs/express');
    assert.strictEqual(valid.valid, true);
    assert.strictEqual(valid.fullName, 'expressjs/express');

    const invalidProto = validateGitHubUrl('http://127.0.0.1/evil/repo');
    assert.strictEqual(invalidProto.valid, false);

    const malicious = validateGitHubUrl('https://github.com/localhost/pwn');
    assert.strictEqual(malicious.valid, false);
  });

  it('should prevent path traversal outside workspace root', () => {
    const base = 'C:\\workspace\\repo';
    assert.strictEqual(isSafeRelativePath('C:\\workspace\\repo\\src\\index.js', base), true);
    assert.strictEqual(isSafeRelativePath('C:\\workspace\\repo\\..\\..\\windows\\system32', base), false);
  });
});

