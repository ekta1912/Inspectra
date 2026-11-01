const { describe, it } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const AdmZip = require('adm-zip');
const { buildReviewGraph } = require('../src/services/agent/graph');

describe('Sample Repository Fixture E2E Verification', () => {
  it('should analyze fixture repository, detect security flaws, validate patches, and produce report', async () => {
    const fixtureDir = path.resolve(__dirname, '../../fixtures/sample-repo');
    assert.ok(fs.existsSync(fixtureDir), 'Fixture directory must exist');

    // Create zip from fixture
    const zip = new AdmZip();
    zip.addLocalFolder(fixtureDir);
    const zipBuffer = zip.toBuffer();

    const graph = buildReviewGraph();
    const reviewId = 'fixture-verification-run';

    const result = await graph.invoke({
      reviewId,
      zipBuffer,
      branch: 'main',
      reviewFocus: 'comprehensive',
      generateFixes: true
    });

    // 1. Verify file discovery
    assert.ok(result.fileStats.discovered >= 4, 'Should discover all fixture files');
    assert.ok(result.fileStats.analyzed >= 4, 'Should analyze supported JS and MD files');

    // 2. Verify static analysis & AI verification detected the critical flaws
    assert.ok(result.verifiedFindings.length >= 2, 'Should verify at least 2 findings');
    const evalFinding = result.verifiedFindings.find(f => f.ruleId === 'dangerous-eval-execution');
    assert.ok(evalFinding, 'Must detect dangerous eval in src/auth.js');
    assert.strictEqual(evalFinding.filePath.includes('auth.js'), true);
    assert.strictEqual(evalFinding.severity, 'CRITICAL');

    // 3. Verify RAG retrieval
    assert.ok(result.retrievedContexts.length > 0, 'RAG should retrieve context chunks');

    // 4. Verify patch proposal & isolated sandbox validation
    assert.ok(result.suggestedFixes.length > 0, 'Should propose patches for verified findings');
    const validPatch = result.suggestedFixes.find(p => p.isValidated);
    assert.ok(validPatch, 'At least one proposed patch must pass sandbox syntax validation');

    // 5. Verify original fixture repository was NOT modified
    const originalAuth = fs.readFileSync(path.join(fixtureDir, 'src/auth.js'), 'utf-8');
    assert.ok(originalAuth.includes('eval(rawCredentials)'), 'Original fixture must never be overwritten');

    // 6. Verify final report metrics
    assert.ok(result.finalReport, 'Must compile final report');
    assert.ok(result.finalReport.summary.healthScore < 100, 'Health score must reflect penalties for critical issues');
    assert.ok(result.finalReport.reportMarkdown.includes('Inspectra Code Review Report'));
  });
});

