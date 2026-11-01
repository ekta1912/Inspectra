const { describe, it } = require('node:test');
const assert = require('node:assert');
const { runPatternAnalysis } = require('../src/services/analysis/staticAnalyzer.service');

describe('Static Code Analysis Suite', () => {
  it('should detect critical dangerous eval, command injection, and hardcoded secrets', () => {
    const mockInventory = [
      {
        filePath: 'src/calculator.js',
        language: 'javascript',
        content: `
function runCalculation(userInput) {
  return eval(userInput);
}
        `
      },
      {
        filePath: 'src/deploy.js',
        language: 'javascript',
        content: `
const cp = require('child_process');
function run(branch) {
  cp.exec(\`git checkout \${branch}\`);
}
        `
      },
      {
        filePath: 'src/config.js',
        language: 'javascript',
        content: `
const apiKey = "a1b2c3d4e5f6g7h8i9j0";
        `
      }
    ];

    const findings = runPatternAnalysis(mockInventory);
    assert.ok(findings.length >= 3, `Expected at least 3 findings, got ${findings.length}`);

    const evalFinding = findings.find(f => f.ruleId === 'dangerous-eval-execution');
    assert.ok(evalFinding, 'Should detect dangerous eval');
    assert.strictEqual(evalFinding.severity, 'CRITICAL');
    assert.strictEqual(evalFinding.filePath, 'src/calculator.js');

    const cmdFinding = findings.find(f => f.ruleId === 'command-injection-exec');
    assert.ok(cmdFinding, 'Should detect command injection');
    assert.strictEqual(cmdFinding.severity, 'CRITICAL');

    const secretFinding = findings.find(f => f.ruleId === 'hardcoded-credentials-leak');
    assert.ok(secretFinding, 'Should detect hardcoded credentials');
  });
});

