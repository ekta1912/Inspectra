const { describe, it } = require('node:test');
const assert = require('node:assert');
const AdmZip = require('adm-zip');
const { buildReviewGraph } = require('../src/services/agent/graph');

describe('LangGraph StateGraph End-to-End Workflow', () => {
  it('should execute 13-node graph and produce validated report from zip buffer', async () => {
    // Create zip fixture with sample project
    const zip = new AdmZip();
    zip.addFile(
      'package.json',
      Buffer.from(JSON.stringify({ name: 'sample-project', version: '1.0.0' }, null, 2))
    );
    zip.addFile(
      'src/math.js',
      Buffer.from(`
function calculate(input) {
  // Intentional critical issue
  return eval(input);
}

module.exports = calculate;
      `.trim())
    );

    const zipBuffer = zip.toBuffer();
    const graph = buildReviewGraph();

    const result = await graph.invoke({
      reviewId: 'test-graph-run-1',
      zipBuffer,
      branch: 'main',
      reviewFocus: 'comprehensive',
      generateFixes: true
    });

    assert.ok(result.finalReport, 'Graph should produce finalReport');
    assert.strictEqual(result.finalReport.summary.totalIssues >= 1, true);
    assert.strictEqual(result.finalReport.summary.critical >= 1, true);
    assert.ok(result.finalReport.reportMarkdown.includes('Inspectra Code Review Report'));

    // Check patch validation in sandbox copy
    assert.ok(result.suggestedFixes.length > 0, 'Should generate fix proposals');
    const evalPatch = result.suggestedFixes[0];
    assert.ok(evalPatch.diff.includes('suggested_fix'));
  });
});

