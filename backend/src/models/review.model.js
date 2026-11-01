const mongoose = require('mongoose');
const fs = require('fs');
const path = require('path');
const { getIsConnected } = require('../config/db');

// Anchor storage to project root .devpilot_storage/reviews for consistent persistence
const storageDir = path.resolve(__dirname, '../../../.devpilot_storage/reviews');
if (!fs.existsSync(storageDir)) {
  fs.mkdirSync(storageDir, { recursive: true });
}

// Fallback search directory inside backend if created during local execution
const secondaryStorageDir = path.resolve(__dirname, '../../.devpilot_storage/reviews');
if (!fs.existsSync(secondaryStorageDir)) {
  fs.mkdirSync(secondaryStorageDir, { recursive: true });
}

const FindingSchema = new mongoose.Schema({
  id: { type: String, required: true },
  title: { type: String, required: true },
  severity: { 
    type: String, 
    enum: ['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO'],
    default: 'MEDIUM' 
  },
  category: { 
    type: String, 
    enum: ['security', 'bug', 'performance', 'quality'],
    default: 'bug' 
  },
  filePath: { type: String, required: true },
  startLine: { type: Number, default: 1 },
  endLine: { type: Number, default: 1 },
  codeSnippet: { type: String, default: '' },
  explanation: { type: String, default: '' },
  impact: { type: String, default: '' },
  recommendation: { type: String, default: '' },
  suggestedCode: { type: String, default: '' },
  tool: { type: String, default: 'verifier' },
  ruleId: { type: String, default: '' },
  verified: { type: Boolean, default: true },
  verificationReason: { type: String, default: '' },
  patchStatus: { 
    type: String, 
    enum: ['none', 'proposed', 'validated', 'failed'],
    default: 'none' 
  }
}, { _id: false });

const PatchSchema = new mongoose.Schema({
  patchId: { type: String, required: true },
  findingId: { type: String, required: true },
  filePath: { type: String, required: true },
  diff: { type: String, required: true },
  originalCode: { type: String, default: '' },
  patchedCode: { type: String, default: '' },
  isValidated: { type: Boolean, default: false },
  validationDetails: { type: String, default: '' },
  status: { 
    type: String, 
    enum: ['pending', 'validated', 'applied', 'rejected'],
    default: 'pending' 
  }
}, { _id: false });

const ReviewSchema = new mongoose.Schema({
  reviewId: { type: String, required: true, unique: true, index: true },
  userId: { type: String, default: 'anonymous' },
  type: { type: String, enum: ['quick', 'repository'], default: 'repository' },
  repoUrl: { type: String, default: '' },
  branch: { type: String, default: 'main' },
  repoName: { type: String, default: 'repository' },
  reviewFocus: { 
    type: String, 
    enum: ['comprehensive', 'bugs', 'security', 'performance', 'quality'],
    default: 'comprehensive' 
  },
  generateFixes: { type: Boolean, default: true },
  status: { 
    type: String, 
    enum: ['queued', 'in_progress', 'completed', 'failed'],
    default: 'queued' 
  },
  currentStep: { type: String, default: 'initialized' },
  progressPercent: { type: Number, default: 0 },
  fileStats: {
    discovered: { type: Number, default: 0 },
    analyzed: { type: Number, default: 0 },
    skipped: { type: Number, default: 0 },
    unsupported: { type: Number, default: 0 },
    languages: { type: Map, of: Number, default: {} }
  },
  findings: [FindingSchema],
  summary: {
    totalIssues: { type: Number, default: 0 },
    critical: { type: Number, default: 0 },
    high: { type: Number, default: 0 },
    medium: { type: Number, default: 0 },
    low: { type: Number, default: 0 },
    info: { type: Number, default: 0 },
    verifiedCount: { type: Number, default: 0 },
    fixesValidated: { type: Number, default: 0 },
    healthScore: { type: Number, default: null } // null when in-progress or no review
  },
  suggestedPatches: [PatchSchema],
  ragSources: [{
    filePath: String,
    startLine: Number,
    endLine: Number,
    relevanceScore: Number,
    snippet: String
  }],
  logs: [{
    timestamp: { type: Date, default: Date.now },
    step: String,
    message: String,
    level: { type: String, default: 'info' }
  }],
  reportMarkdown: { type: String, default: '' },
  error: { type: String, default: null },
  durationMs: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now },
  completedAt: { type: Date, default: null }
});

const MongoReview = mongoose.models.Review || mongoose.model('Review', ReviewSchema);

// File-based persistent fallback repository ensuring zero data loss
class FileReviewRepository {
  static _filePath(id) {
    return path.join(storageDir, `${id}.json`);
  }

  static async create(data) {
    const doc = {
      ...data,
      createdAt: data.createdAt || new Date(),
      findings: data.findings || [],
      suggestedPatches: data.suggestedPatches || [],
      logs: data.logs || [],
      fileStats: data.fileStats || { discovered: 0, analyzed: 0, skipped: 0, unsupported: 0, languages: {} },
      summary: data.summary || { totalIssues: 0, critical: 0, high: 0, medium: 0, low: 0, info: 0, verifiedCount: 0, fixesValidated: 0, healthScore: null }
    };
    const jsonStr = JSON.stringify(doc, null, 2);
    fs.writeFileSync(this._filePath(doc.reviewId), jsonStr, 'utf-8');
    // Also save in secondary storage directory for redundancy
    try {
      fs.writeFileSync(path.join(secondaryStorageDir, `${doc.reviewId}.json`), jsonStr, 'utf-8');
    } catch (e) {}
    return doc;
  }

  static async findOne(query) {
    if (query.reviewId) {
      const dirs = [storageDir, secondaryStorageDir];
      for (const d of dirs) {
        const p = path.join(d, `${query.reviewId}.json`);
        if (fs.existsSync(p)) {
          try {
            return JSON.parse(fs.readFileSync(p, 'utf-8'));
          } catch (e) {}
        }
      }
    }
    const all = await this.find(query);
    return all[0] || null;
  }

  static async find(query = {}) {
    const dirs = [storageDir, secondaryStorageDir];
    const results = [];
    const seen = new Set();

    for (const d of dirs) {
      if (!fs.existsSync(d)) continue;
      const files = fs.readdirSync(d).filter(f => f.endsWith('.json'));
      for (const f of files) {
        if (seen.has(f)) continue;
        seen.add(f);
        try {
          const raw = JSON.parse(fs.readFileSync(path.join(d, f), 'utf-8'));
          let match = true;
          if (query.type && raw.type !== query.type) match = false;
          if (query.status && raw.status !== query.status) match = false;
          if (match) results.push(raw);
        } catch (e) {}
      }
    }
    return results.sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  }

  static async updateOne(query, update) {
    const doc = await this.findOne(query);
    if (!doc) return null;
    const merged = { ...doc, ...(update.$set || update) };
    if (update.$push) {
      for (const [key, val] of Object.entries(update.$push)) {
        if (!merged[key]) merged[key] = [];
        merged[key].push(val);
      }
    }
    const jsonStr = JSON.stringify(merged, null, 2);
    fs.writeFileSync(this._filePath(doc.reviewId), jsonStr, 'utf-8');
    try {
      fs.writeFileSync(path.join(secondaryStorageDir, `${doc.reviewId}.json`), jsonStr, 'utf-8');
    } catch (e) {}
    return merged;
  }

  static async deleteOne(query) {
    if (query.reviewId) {
      const dirs = [storageDir, secondaryStorageDir];
      for (const d of dirs) {
        const p = path.join(d, `${query.reviewId}.json`);
        if (fs.existsSync(p)) {
          try { fs.unlinkSync(p); } catch (e) {}
        }
      }
      return true;
    }
    return false;
  }
}

// Unified Review Service Adapter
const Review = {
  async create(data) {
    let mongoDoc = null;
    if (getIsConnected()) {
      try {
        mongoDoc = await MongoReview.create(data);
      } catch (err) {
        console.warn('MongoReview create warning:', err.message);
      }
    }
    const fileDoc = await FileReviewRepository.create(data);
    return mongoDoc || fileDoc;
  },

  async findOne(query) {
    if (getIsConnected()) {
      try {
        const doc = await MongoReview.findOne(query).lean();
        if (doc) return doc;
      } catch (err) {}
    }
    return await FileReviewRepository.findOne(query);
  },

  async find(query = {}, sort = { createdAt: -1 }, limit = 50) {
    let cleanSort = { createdAt: -1 };
    if (sort && typeof sort === 'object' && !sort.reportMarkdown && !sort.logs && Object.keys(sort).length > 0) {
      cleanSort = sort;
    }

    if (getIsConnected()) {
      try {
        const docs = await MongoReview.find(query).sort(cleanSort).limit(limit).lean();
        if (docs && docs.length > 0) return docs;
      } catch (err) {
        console.warn('MongoReview find warning:', err.message);
      }
    }
    const results = await FileReviewRepository.find(query);
    return results.slice(0, limit);
  },

  async updateOne(query, update) {
    if (getIsConnected()) {
      try {
        await MongoReview.updateOne(query, update);
      } catch (err) {}
    }
    return await FileReviewRepository.updateOne(query, update);
  },

  async deleteOne(query) {
    if (getIsConnected()) {
      try {
        await MongoReview.deleteOne(query);
      } catch (err) {}
    }
    return await FileReviewRepository.deleteOne(query);
  }
};

module.exports = { Review, MongoReview, ReviewSchema, FileReviewRepository };
