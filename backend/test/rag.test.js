const { describe, it } = require('node:test');
const assert = require('node:assert');
const { chunkFile } = require('../src/services/rag/chunker.service');
const { getVectorStore } = require('../src/services/rag/vectorStore.service');
const { localDenseEmbed, cosineSimilarity } = require('../src/services/rag/embedding.service');

describe('LangChain RAG & Vector Store Suite', () => {
  it('should chunk source code using language-aware splitter with line coordinates', async () => {
    const code = `
function calculateTotal(items) {
  let sum = 0;
  for (let i = 0; i < items.length; i++) {
    sum += items[i].price;
  }
  return sum;
}

module.exports = calculateTotal;
    `.trim();

    const chunks = await chunkFile({
      filePath: 'src/billing.js',
      content: code,
      repositoryId: 'test-repo',
      language: 'javascript'
    });

    assert.ok(chunks.length > 0);
    const first = chunks[0];
    assert.strictEqual(first.filePath, 'src/billing.js');
    assert.strictEqual(first.language, 'javascript');
    assert.strictEqual(typeof first.startLine, 'number');
    assert.strictEqual(typeof first.endLine, 'number');
    assert.ok(first.content.includes('calculateTotal'));
  });

  it('should generate deterministic dense embeddings and compute cosine similarity', () => {
    const vec1 = localDenseEmbed('function evaluateExpression(expr) { return eval(expr); }');
    const vec2 = localDenseEmbed('function runEval(code) { return eval(code); }');
    const vec3 = localDenseEmbed('class DatabaseConnectionPool { connect() {} }');

    assert.strictEqual(vec1.length, 384);
    assert.strictEqual(vec2.length, 384);

    const sim12 = cosineSimilarity(vec1, vec2);
    const sim13 = cosineSimilarity(vec1, vec3);

    assert.ok(sim12 > sim13, 'Similar code should have higher cosine similarity score');
  });

  it('should index and perform similarity search on PersistentVectorStore', async () => {
    const store = getVectorStore('test-search-repo');
    store.clear();

    const chunks = [
      {
        chunkId: 'c1',
        repositoryId: 'test-search-repo',
        filePath: 'auth/login.js',
        language: 'javascript',
        startLine: 1,
        endLine: 10,
        content: 'async function login(username, password) { const token = jwt.sign({ user: username }); return token; }'
      },
      {
        chunkId: 'c2',
        repositoryId: 'test-search-repo',
        filePath: 'utils/math.js',
        language: 'javascript',
        startLine: 1,
        endLine: 5,
        content: 'function add(a, b) { return a + b; }'
      }
    ];

    await store.addDocuments(chunks);
    const results = await store.similaritySearch('authenticate user and return jwt token', 1);

    assert.strictEqual(results.length, 1);
    assert.strictEqual(results[0].filePath, 'auth/login.js');

    store.clear();
  });
});

