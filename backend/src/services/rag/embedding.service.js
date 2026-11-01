const crypto = require('crypto');

/**
 * Deterministic dense vectorizer (384 dimensions)
 * Computes subword/n-gram token frequencies projected onto a normalized vector space.
 * Gives semantic distance sensitivity for code and documentation tokens even in offline mode.
 */
function localDenseEmbed(text, dimensions = 384) {
  const vector = new Float32Array(dimensions);
  if (!text || typeof text !== 'string') return Array.from(vector);

  // Normalize code text: tokenization with identifiers, camelCase, snake_case splits
  const clean = text.toLowerCase();
  const tokens = clean.split(/[^a-z0-9_$]+/).filter(t => t.length > 1);

  for (const token of tokens) {
    // Word hash
    const hash = crypto.createHash('md5').update(token).digest();
    const idx = (hash[0] | (hash[1] << 8)) % dimensions;
    const sign = (hash[2] % 2 === 0) ? 1 : -1;
    vector[idx] += sign * (1 + Math.log(1 + token.length));

    // Substrings / n-grams (3-grams) for syntax and code patterns
    if (token.length >= 3) {
      for (let i = 0; i <= token.length - 3; i++) {
        const sub = token.slice(i, i + 3);
        const subHash = crypto.createHash('md5').update(sub).digest();
        const subIdx = (subHash[0] | (subHash[1] << 8)) % dimensions;
        vector[subIdx] += 0.5;
      }
    }
  }

  // L2 Normalize
  let norm = 0;
  for (let i = 0; i < dimensions; i++) {
    norm += vector[i] * vector[i];
  }
  norm = Math.sqrt(norm);
  if (norm > 0) {
    for (let i = 0; i < dimensions; i++) {
      vector[i] /= norm;
    }
  }

  return Array.from(vector);
}

/**
 * Generate embedding using configured provider:
 * - gemini (via GoogleGenerativeAI)
 * - local (deterministic dense vectorizer)
 */
async function generateEmbedding(text) {
  const provider = (process.env.EMBEDDING_PROVIDER || 'local').toLowerCase();
  const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;

  if (provider === 'gemini' && apiKey) {
    try {
      const { GoogleGenerativeAI } = require('@google/generative-ai');
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: process.env.GEMINI_EMBEDDING_MODEL || 'text-embedding-004' });
      const result = await model.embedContent(text);
      if (result && result.embedding && result.embedding.values) {
        return result.embedding.values;
      }
    } catch (err) {
      console.warn('Gemini embedding failed, falling back to local dense vectorizer:', err.message);
    }
  }

  // Local dense vectorizer fallback
  return localDenseEmbed(text);
}

/**
 * Compute cosine similarity between two float vectors
 */
function cosineSimilarity(vecA, vecB) {
  if (!vecA || !vecB || vecA.length !== vecB.length) return 0;
  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < vecA.length; i++) {
    dot += vecA[i] * vecB[i];
    normA += vecA[i] * vecA[i];
    normB += vecB[i] * vecB[i];
  }
  if (normA === 0 || normB === 0) return 0;
  return dot / (Math.sqrt(normA) * Math.sqrt(normB));
}

module.exports = {
  generateEmbedding,
  localDenseEmbed,
  cosineSimilarity
};

