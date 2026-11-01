const { describe, it } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { createRepoTools } = require('../src/services/agent/tools');
const { getVectorStore } = require('../src/services/rag/vectorStore.service');

describe('LangChain Structured Tools Suite', () => {
  it('should create and execute all 7 repository inspection tools', async () => {
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'tool_test_'));
    const testFile = path.join(tempDir, 'sample.js');
    fs.writeFileSync(testFile, 'function hello() { return "world"; }\n', 'utf-8');

    const inventory = [
      {
        filePath: 'sample.js',
        fullPath: testFile,
        language: 'javascript',
        lineCount: 1,
        size: 38,
        content: 'function hello() { return "world"; }\n'
      }
    ];

    const vectorStore = getVectorStore('tool-test-vs');
    const tools = createRepoTools({
      repoDir: tempDir,
      inventory,
      vectorStore,
      reviewId: 'test-review-tools'
    });

    assert.strictEqual(tools.length, 7);

    // Test list_repository_files
    const listTool = tools.find(t => t.name === 'list_repository_files');
    const listRes = await listTool.invoke({});
    assert.ok(listRes.includes('sample.js'));

    // Test read_repository_file
    const readTool = tools.find(t => t.name === 'read_repository_file');
    const readRes = await readTool.invoke({ filePath: 'sample.js' });
    assert.ok(readRes.includes('function hello()'));

    // Test search_repository_code
    const searchTool = tools.find(t => t.name === 'search_repository_code');
    const searchRes = await searchTool.invoke({ query: 'hello' });
    assert.ok(searchRes.includes('sample.js'));

    // Test inspect_dependencies
    const inspectTool = tools.find(t => t.name === 'inspect_dependencies');
    const inspectRes = await inspectTool.invoke({});
    assert.ok(inspectRes.includes('manifestsFound'));

    // Cleanup
    fs.rmSync(tempDir, { recursive: true, force: true });
    vectorStore.clear();
  });
});

