const fs = require('fs');
const path = require('path');
const mongoose = require('mongoose');
const { generateEmbedding, cosineSimilarity } = require('./embedding.service');
const { getIsConnected } = require('../../config/db');

const vectorStoreDir = path.join(process.cwd(), '.devpilot_storage', 'vectors');
if (!fs.existsSync(vectorStoreDir)) {
  fs.mkdirSync(vectorStoreDir, { recursive: true });
}

// Optional Mongo Schema for Atlas Vector Search / Mongo persistence
const ChunkSchema = new mongoose.Schema({
  chunkId: { type: String, required: true, index: true },
  repositoryId: { type: String, required: true, index: true },
  filePath: { type: String, required: true },
  language: { type: String },
  startLine: { type: Number },
  endLine: { type: Number },
  content: { type: String, required: true },
  embedding: { type: [Number], required: true },
  createdAt: { type: Date, default: Date.now }
});

const MongoChunk = mongoose.models.RepoChunk || mongoose.model('RepoChunk', ChunkSchema);

class PersistentVectorStore {
  constructor(repositoryId) {
    this.repositoryId = repositoryId;
    this.filePath = path.join(vectorStoreDir, `${repositoryId}.json`);
    this.chunks = [];
    this._load();
  }

  _load() {
    if (fs.existsSync(this.filePath)) {
      try {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        this.chunks = JSON.parse(raw);
      } catch (e) {
        this.chunks = [];
      }
    } else {
      this.chunks = [];
    }
  }

  _save() {
    fs.writeFileSync(this.filePath, JSON.stringify(this.chunks, null, 2), 'utf-8');
  }

  async addDocuments(chunkList) {
    if (!chunkList || chunkList.length === 0) return 0;

    const embeddedList = [];
    for (const chunk of chunkList) {
      const embedding = await generateEmbedding(chunk.content);
      const record = {
        ...chunk,
        embedding
      };
      embeddedList.push(record);
      this.chunks.push(record);

      // Persist to MongoDB if connected
      if (getIsConnected()) {
        try {
          await MongoChunk.findOneAndUpdate(
            { chunkId: chunk.chunkId },
            record,
            { upsert: true }
          );
        } catch (e) {}
      }
    }

    this._save();
    return embeddedList.length;
  }

  async similaritySearch(query, k = 5, filter = null) {
    if (!this.chunks.length) return [];

    const queryEmbedding = await generateEmbedding(query);
    const scored = [];

    for (const chunk of this.chunks) {
      if (filter && typeof filter === 'object') {
        let match = true;
        if (filter.filePath && chunk.filePath !== filter.filePath) match = false;
        if (filter.language && chunk.language !== filter.language) match = false;
        if (!match) continue;
      }

      const score = cosineSimilarity(queryEmbedding, chunk.embedding);
      scored.push({
        ...chunk,
        score: Math.round(score * 1000) / 1000
      });
    }

    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, k);
  }

  getAllChunks() {
    return this.chunks.map(c => ({
      chunkId: c.chunkId,
      filePath: c.filePath,
      language: c.language,
      startLine: c.startLine,
      endLine: c.endLine,
      contentSnippet: c.content.slice(0, 200)
    }));
  }

  clear() {
    this.chunks = [];
    if (fs.existsSync(this.filePath)) {
      fs.unlinkSync(this.filePath);
    }
    if (getIsConnected()) {
      MongoChunk.deleteMany({ repositoryId: this.repositoryId }).catch(() => {});
    }
  }
}

function getVectorStore(repositoryId) {
  return new PersistentVectorStore(repositoryId);
}

module.exports = {
  PersistentVectorStore,
  getVectorStore,
  MongoChunk
};

