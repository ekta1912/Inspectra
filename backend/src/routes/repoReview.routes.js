const express = require('express');
const router = express.Router();
const repoController = require('../controllers/repoReview.controller');

// Start review via GitHub URL
router.post('/start', repoController.startRepoReview);

// Start review via ZIP upload
router.post('/upload', repoController.upload.single('zipFile'), repoController.uploadRepoZip);

// List recent reviews
router.get('/', repoController.listRecentReviews);

// Review status & SSE stream
router.get('/:id/status', repoController.getReviewStatus);
router.get('/:id/stream', repoController.streamReviewProgress);

// Final report & download
router.get('/:id/report', repoController.getReviewReport);
router.get('/:id/download-report', repoController.downloadReportMarkdown);

// Patch operations
router.get('/:id/patch/:patchId', repoController.getPatchDetails);
router.post('/:id/patch/:patchId/apply', repoController.applyPatchApproval);

// Delete review
router.delete('/:id', repoController.deleteReview);

module.exports = router;

