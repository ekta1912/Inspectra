const { v4: uuidv4 } = require('uuid');
const multer = require('multer');
const { Review } = require('../models/review.model');
const { buildReviewGraph } = require('../services/agent/graph');
const eventBus = require('../services/agent/eventBus');
const { validateGitHubUrl } = require('../utils/security');

// Multer memory storage for ZIP uploads
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB
});

// Cache of compiled graph
let graphInstance = null;
function getGraph() {
  if (!graphInstance) {
    graphInstance = buildReviewGraph();
  }
  return graphInstance;
}

/**
 * Runs review workflow asynchronously in the background
 */
async function executeReviewWorkflow(initialState) {
  const graph = getGraph();
  try {
    await graph.invoke(initialState);
  } catch (err) {
    console.error(`Workflow failure for review ${initialState.reviewId}:`, err);
    try {
      await Review.updateOne(
        { reviewId: initialState.reviewId },
        {
          $set: {
            status: 'failed',
            error: err.message,
            currentStep: 'failed'
          },
          $push: {
            logs: {
              timestamp: new Date(),
              step: 'workflow_error',
              message: err.message,
              level: 'error'
            }
          }
        }
      );
    } catch (dbErr) {}

    eventBus.emitProgress(initialState.reviewId, 'failed', 0, `Review failed: ${err.message}`, { error: err.message });
  }
}

/**
 * POST /ai/repo-review/start
 */
async function startRepoReview(req, res) {
  try {
    const { repoUrl, branch = 'main', reviewFocus = 'comprehensive', generateFixes = true, consent } = req.body;

    if (!repoUrl) {
      return res.status(400).json({ error: 'GitHub repository URL is required.' });
    }

    const validation = validateGitHubUrl(repoUrl);
    if (!validation.valid) {
      return res.status(400).json({ error: validation.error });
    }

    const reviewId = `REV-${uuidv4()}`;

    // Create database review record
    await Review.create({
      reviewId,
      type: 'repository',
      repoUrl: validation.cleanUrl,
      repoName: validation.fullName,
      branch: branch || 'main',
      reviewFocus,
      generateFixes: Boolean(generateFixes),
      status: 'queued',
      currentStep: 'initialized',
      progressPercent: 0
    });

    // Start graph in background
    executeReviewWorkflow({
      reviewId,
      repoUrl: validation.cleanUrl,
      branch: branch || 'main',
      reviewFocus,
      generateFixes: Boolean(generateFixes)
    });

    res.status(202).json({
      success: true,
      reviewId,
      status: 'queued',
      message: 'Repository review initiated successfully.'
    });
  } catch (err) {
    console.error('startRepoReview error:', err);
    res.status(500).json({ error: 'Failed to initiate repository review.' });
  }
}

/**
 * POST /ai/repo-review/upload (ZIP file)
 */
async function uploadRepoZip(req, res) {
  try {
    if (!req.file || !req.file.buffer) {
      return res.status(400).json({ error: 'ZIP file upload is required.' });
    }

    const { reviewFocus = 'comprehensive', generateFixes = true } = req.body;
    const reviewId = `REV-${uuidv4()}`;
    const zipName = req.file.originalname || 'uploaded-archive.zip';

    await Review.create({
      reviewId,
      type: 'repository',
      repoUrl: '',
      repoName: zipName,
      branch: 'archive',
      reviewFocus,
      generateFixes: generateFixes === 'true' || generateFixes === true,
      status: 'queued',
      currentStep: 'initialized',
      progressPercent: 0
    });

    // Start graph in background with zipBuffer
    executeReviewWorkflow({
      reviewId,
      zipBuffer: req.file.buffer,
      branch: 'archive',
      reviewFocus,
      generateFixes: generateFixes === 'true' || generateFixes === true
    });

    res.status(202).json({
      success: true,
      reviewId,
      status: 'queued',
      message: 'Archive review initiated successfully.'
    });
  } catch (err) {
    console.error('uploadRepoZip error:', err);
    res.status(500).json({ error: 'Failed to process uploaded repository archive.' });
  }
}

/**
 * GET /ai/repo-review/:id/status
 */
async function getReviewStatus(req, res) {
  try {
    const { id } = req.params;
    const review = await Review.findOne({ reviewId: id });

    if (!review) {
      return res.status(404).json({ error: 'Review not found.' });
    }

    res.json({
      reviewId: review.reviewId,
      status: review.status,
      currentStep: review.currentStep,
      progressPercent: review.progressPercent,
      fileStats: review.fileStats,
      summary: review.summary,
      error: review.error,
      createdAt: review.createdAt,
      completedAt: review.completedAt
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch review status.' });
  }
}

/**
 * GET /ai/repo-review/:id/stream (Server-Sent Events)
 */
async function streamReviewProgress(req, res) {
  const { id } = req.params;

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders?.();

  // Send current review status initially
  const review = await Review.findOne({ reviewId: id });
  if (review) {
    res.write(`data: ${JSON.stringify({
      reviewId: id,
      stage: review.currentStep,
      percent: review.progressPercent,
      message: `Current status: ${review.status}`,
      status: review.status
    })}\n\n`);

    if (['completed', 'failed'].includes(review.status)) {
      res.write(`data: ${JSON.stringify({ type: 'done', status: review.status })}\n\n`);
      return res.end();
    }
  }

  // Subscribe to live events
  const onProgress = (payload) => {
    res.write(`data: ${JSON.stringify(payload)}\n\n`);
    if (payload.stage === 'completed' || payload.stage === 'failed') {
      res.write(`data: ${JSON.stringify({ type: 'done', status: payload.stage })}\n\n`);
      cleanup();
    }
  };

  const channel = `progress:${id}`;
  eventBus.on(channel, onProgress);

  // Heartbeat every 15 seconds to prevent client timeout
  const heartbeat = setInterval(() => {
    res.write(': heartbeat\n\n');
  }, 15000);

  const cleanup = () => {
    clearInterval(heartbeat);
    eventBus.off(channel, onProgress);
    res.end();
  };

  req.on('close', cleanup);
}

/**
 * GET /ai/repo-review/:id/report
 */
async function getReviewReport(req, res) {
  try {
    const { id } = req.params;
    const review = await Review.findOne({ reviewId: id });

    if (!review) {
      return res.status(404).json({ error: 'Review not found.' });
    }

    res.json(review);
  } catch (err) {
    res.status(500).json({ error: 'Failed to fetch review report.' });
  }
}

/**
 * GET /ai/repo-review/:id/download-report
 */
async function downloadReportMarkdown(req, res) {
  try {
    const { id } = req.params;
    const review = await Review.findOne({ reviewId: id });

    if (!review || !review.reportMarkdown) {
      return res.status(404).json({ error: 'Report not ready or review not found.' });
    }

    res.setHeader('Content-Type', 'text/markdown; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="inspectra-report-${id}.md"`);
    res.send(review.reportMarkdown);
  } catch (err) {
    res.status(500).json({ error: 'Failed to download report.' });
  }
}

/**
 * GET /ai/repo-review/:id/patch/:patchId
 */
async function getPatchDetails(req, res) {
  try {
    const { id, patchId } = req.params;
    const review = await Review.findOne({ reviewId: id });

    if (!review) {
      return res.status(404).json({ error: 'Review not found.' });
    }

    const patch = (review.suggestedPatches || []).find(p => p.patchId === patchId);
    if (!patch) {
      return res.status(404).json({ error: 'Patch not found.' });
    }

    if (req.query.download === 'true') {
      res.setHeader('Content-Type', 'text/x-diff');
      res.setHeader('Content-Disposition', `attachment; filename="${patch.patchId}.patch"`);
      return res.send(patch.diff);
    }

    res.json(patch);
  } catch (err) {
    res.status(500).json({ error: 'Failed to get patch details.' });
  }
}

/**
 * POST /ai/repo-review/:id/patch/:patchId/apply
 * Marks user approval for applying the patch
 */
async function applyPatchApproval(req, res) {
  try {
    const { id, patchId } = req.params;
    const { approved } = req.body;

    const review = await Review.findOne({ reviewId: id });
    if (!review) {
      return res.status(404).json({ error: 'Review not found.' });
    }

    const patch = (review.suggestedPatches || []).find(p => p.patchId === patchId);
    if (!patch) {
      return res.status(404).json({ error: 'Patch not found.' });
    }

    const newStatus = approved ? 'applied' : 'rejected';
    patch.status = newStatus;

    await Review.updateOne(
      { reviewId: id, 'suggestedPatches.patchId': patchId },
      { $set: { 'suggestedPatches.$.status': newStatus } }
    );

    res.json({
      success: true,
      patchId,
      status: newStatus,
      message: approved ? 'Patch approved and marked as applied.' : 'Patch rejected.'
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to update patch approval.' });
  }
}

/**
 * GET /ai/repo-reviews (List recent reviews)
 */
async function listRecentReviews(req, res) {
  try {
    const { type } = req.query;
    const query = {};
    if (type && type !== 'all') {
      query.type = type;
    }
    const reviews = await Review.find(query, { createdAt: -1 }, 50);
    res.json(reviews);
  } catch (err) {
    console.error('listRecentReviews error:', err);
    res.status(500).json({ error: 'Failed to list reviews.' });
  }
}

/**
 * DELETE /ai/repo-review/:id
 */
async function deleteReview(req, res) {
  try {
    const { id } = req.params;
    await Review.deleteOne({ reviewId: id });

    // Clean vector store
    const { getVectorStore } = require('../services/rag/vectorStore.service');
    const vs = getVectorStore(id);
    vs.clear();

    res.json({ success: true, message: `Review ${id} deleted successfully.` });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete review.' });
  }
}

module.exports = {
  upload,
  startRepoReview,
  uploadRepoZip,
  getReviewStatus,
  streamReviewProgress,
  getReviewReport,
  downloadReportMarkdown,
  getPatchDetails,
  applyPatchApproval,
  listRecentReviews,
  deleteReview
};

