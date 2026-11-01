import axios from 'axios';

// Resolve API base URL: custom env var -> localhost:3000 in dev -> fallback hosted backend
const API_BASE_URL = 
  import.meta.env.VITE_API_URL || 
  (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1' 
    ? 'http://localhost:3000' 
    : 'https://ai-code-reviewer-backend-9pqk.onrender.com');

const client = axios.create({
  baseURL: API_BASE_URL,
  timeout: 120000 // 2 minutes
});

export const api = {
  baseUrl: API_BASE_URL,

  async checkHealth() {
    try {
      const res = await client.get('/api/health', { timeout: 3000 });
      return res.data?.status === 'ok';
    } catch {
      return false;
    }
  },

  // Mode 1: Quick Code Review (Preserved)
  async getQuickReview(code, language) {
    const res = await client.post('/ai/get-review', { code, language });
    return res.data;
  },

  // Mode 2: Repository Review
  async startRepoReview({ repoUrl, branch, reviewFocus, generateFixes }) {
    const res = await client.post('/ai/repo-review/start', {
      repoUrl,
      branch: branch || 'main',
      reviewFocus: reviewFocus || 'comprehensive',
      generateFixes: Boolean(generateFixes)
    });
    return res.data;
  },

  async uploadRepoZip(formData) {
    const res = await client.post('/ai/repo-review/upload', formData, {
      headers: { 'Content-Type': 'multipart/form-data' }
    });
    return res.data;
  },

  async getReviewStatus(reviewId) {
    const res = await client.get(`/ai/repo-review/${reviewId}/status`);
    return res.data;
  },

  async getReviewReport(reviewId) {
    const res = await client.get(`/ai/repo-review/${reviewId}/report`);
    return res.data;
  },

  async downloadReport(reviewId) {
    const res = await client.get(`/ai/repo-review/${reviewId}/download-report`, {
      responseType: 'blob'
    });
    const url = window.URL.createObjectURL(new Blob([res.data]));
    const link = document.createElement('a');
    link.href = url;
    link.setAttribute('download', `inspectra-report-${reviewId}.md`);
    document.body.appendChild(link);
    link.click();
    link.remove();
  },

  async getPatch(reviewId, patchId) {
    const res = await client.get(`/ai/repo-review/${reviewId}/patch/${patchId}`);
    return res.data;
  },

  async applyPatchApproval(reviewId, patchId, approved) {
    const res = await client.post(`/ai/repo-review/${reviewId}/patch/${patchId}/apply`, {
      approved: Boolean(approved)
    });
    return res.data;
  },

  async getRecentReviews(type = 'all') {
    const params = type && type !== 'all' ? { type } : {};
    const res = await client.get('/ai/repo-reviews', { params });
    return res.data;
  },

  async deleteReview(reviewId) {
    const res = await client.delete(`/ai/repo-review/${reviewId}`);
    return res.data;
  },

  getStreamUrl(reviewId) {
    return `${API_BASE_URL}/ai/repo-review/${reviewId}/stream`;
  }
};

export default api;

