const express = require('express');
const cors = require('cors');
const aiRoutes = require('./routes/ai.routes');
const repoReviewRoutes = require('./routes/repoReview.routes');

const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

app.get('/', (req, res) => {
  res.json({
    name: 'Inspectra API',
    version: '2.0.0',
    description: 'Inspectra – Intelligent Code Review Platform',
    status: 'online'
  });
});

app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date() });
});

// Preserved Quick Review routes
app.use('/ai', aiRoutes);

// New Repository Review routes
app.use('/ai/repo-review', repoReviewRoutes);
app.use('/ai/repo-reviews', repoReviewRoutes);

// Global error handler
app.use((err, req, res, next) => {
  console.error('Unhandled Server Error:', err);
  res.status(500).json({ error: err.message || 'Internal Server Error' });
});

module.exports = app;
