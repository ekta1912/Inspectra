import React, { useEffect, useState } from 'react';
import { Code, FolderGit2, ArrowRight, ShieldAlert, CheckCircle2, FileCode, Trash2, Clock, Info } from 'lucide-react';
import api from '../services/api';

export default function Dashboard({ onStartQuick, onStartRepo, onViewReport }) {
  const [reviews, setReviews] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeFilter, setActiveFilter] = useState('all');

  useEffect(() => {
    loadRecentReviews(activeFilter);
  }, [activeFilter]);

  async function loadRecentReviews(filterType = activeFilter) {
    try {
      setLoading(true);
      const data = await api.getRecentReviews(filterType);
      setReviews(data || []);
    } catch (err) {
      console.warn('Failed to load recent reviews:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleDelete(e, reviewId) {
    e.stopPropagation();
    if (!confirm('Are you sure you want to delete this review?')) return;
    try {
      await api.deleteReview(reviewId);
      setReviews(prev => prev.filter(r => r.reviewId !== reviewId));
    } catch (err) {
      alert('Failed to delete review');
    }
  }

  // Calculate high-level stats from completed reviews
  const completedReviews = reviews.filter(r => r.status === 'completed');
  const totalReviews = reviews.length;
  const totalIssues = completedReviews.reduce((acc, r) => acc + (r.summary?.totalIssues || 0), 0);
  const validatedFixes = completedReviews.reduce((acc, r) => acc + (r.summary?.fixesValidated || 0), 0);

  const reviewsWithScore = completedReviews.filter(
    r => typeof r.summary?.healthScore === 'number' && !isNaN(r.summary.healthScore)
  );
  const avgHealth = reviewsWithScore.length > 0
    ? Math.round(reviewsWithScore.reduce((acc, r) => acc + r.summary.healthScore, 0) / reviewsWithScore.length)
    : null;

  return (
    <div className="dashboard-page">
      {/* Hero Welcome */}
      <div className="dashboard-hero">
        <div className="hero-content">
          <h1>Inspectra</h1>
          <p className="hero-tagline" style={{ fontSize: '18px', fontWeight: '600', color: 'var(--text-primary)', marginBottom: '8px' }}>
            Intelligent Code Review Platform
          </p>
          <p>
            Find bugs. Understand code. Ship with confidence. Select a review mode below to analyze single code snippets or audit full repositories for quality, security, and performance.
          </p>
        </div>
      </div>

      {/* Mode Selection Cards */}
      <div className="mode-cards-grid">
        <div className="mode-card" onClick={onStartQuick}>
          <div className="mode-card-header">
            <div className="mode-icon-wrapper quick-icon">
              <Code size={24} />
            </div>
            <span className="mode-badge">Fast Feedback</span>
          </div>
          <h3>Quick Code Review</h3>
          <p>
            Paste or write a single code snippet. Get immediate detection of syntax issues, logic bugs, complexity analysis, and optimized refactoring.
          </p>
          <div className="mode-features">
            <span>✓ Multi-language support</span>
            <span>✓ Time/Space complexity</span>
            <span>✓ Refactored output</span>
          </div>
          <button className="mode-action-btn">
            <span>Start Quick Review</span>
            <ArrowRight size={16} />
          </button>
        </div>

        <div className="mode-card highlight" onClick={onStartRepo}>
          <div className="mode-card-header">
            <div className="mode-icon-wrapper repo-icon">
              <FolderGit2 size={24} />
            </div>
            <span className="mode-badge repo-badge">
              <FolderGit2 size={12} /> Full Project Audit
            </span>
          </div>
          <h3>Repository Review</h3>
          <p>
            Submit a GitHub repository or upload a ZIP archive. Inspectra analyzes your codebase, identifies bugs and security risks, and generates verified fixes.
          </p>
          <div className="mode-features">
            <span>✓ GitHub URL & ZIP upload</span>
            <span>✓ Multi-file context analysis</span>
            <span>✓ Tested code fixes</span>
          </div>
          <button className="mode-action-btn primary">
            <span>Start Repository Review</span>
            <ArrowRight size={16} />
          </button>
        </div>
      </div>

      {/* Analytics Overview */}
      <div className="stats-row">
        <div className="stat-card">
          <div className="stat-label">Total Reviews Run</div>
          <div className="stat-value">{totalReviews}</div>
          <div className="stat-sub">Across snippets & repositories</div>
        </div>

        <div className="stat-card">
          <div className="stat-label-row" style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <span className="stat-label">Average Health Score</span>
            <span
              className="stat-tooltip-icon"
              title="Scored out of 100 based on verified findings: Critical (-25), High (-15), Medium (-7), Low (-3). Shows average across completed reviews."
              style={{ cursor: 'help', color: 'var(--text-muted)' }}
            >
              <Info size={14} />
            </span>
          </div>
          <div className="stat-value">{avgHealth !== null ? `${avgHealth}/100` : 'N/A'}</div>
          <div className="stat-sub">Severity-weighted benchmark</div>
        </div>

        <div className="stat-card">
          <div className="stat-label">Issues Detected</div>
          <div className="stat-value">{totalIssues}</div>
          <div className="stat-sub">Confirmed from completed reviews</div>
        </div>

        <div className="stat-card">
          <div className="stat-label">Patches Validated</div>
          <div className="stat-value">{validatedFixes}</div>
          <div className="stat-sub">Passed sandbox verification</div>
        </div>
      </div>

      {/* Recent Reviews List */}
      <div className="recent-reviews-section">
        <div className="section-header">
          <div>
            <h2>Recent Activity</h2>
            <p>History of code snippets and repository audits</p>
          </div>
          <div className="section-header-actions" style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <div className="filter-pill-group" style={{ display: 'flex', gap: '6px' }}>
              <button
                className={`filter-btn ${activeFilter === 'all' ? 'active' : ''}`}
                onClick={() => setActiveFilter('all')}
              >
                All Reviews
              </button>
              <button
                className={`filter-btn ${activeFilter === 'quick' ? 'active' : ''}`}
                onClick={() => setActiveFilter('quick')}
              >
                Quick Reviews
              </button>
              <button
                className={`filter-btn ${activeFilter === 'repository' ? 'active' : ''}`}
                onClick={() => setActiveFilter('repository')}
              >
                Repository Reviews
              </button>
            </div>
            <button className="refresh-btn" onClick={() => loadRecentReviews(activeFilter)}>
              Refresh
            </button>
          </div>
        </div>

        {loading ? (
          <div className="loading-state-card">
            <div className="spinner"></div>
            <span>Loading recent reviews...</span>
          </div>
        ) : reviews.length === 0 ? (
          <div className="empty-reviews-card">
            <FileCode size={36} />
            <p>No reviews yet. Start your first Quick Review or Repository Audit above.</p>
          </div>
        ) : (
          <div className="reviews-table-container">
            <table className="reviews-table">
              <thead>
                <tr>
                  <th>Target</th>
                  <th>Type</th>
                  <th>Issues</th>
                  <th>Health</th>
                  <th>Status</th>
                  <th>Created</th>
                  <th>Action</th>
                </tr>
              </thead>
              <tbody>
                {reviews.map(r => (
                  <tr
                    key={r.reviewId}
                    className="review-row"
                    onClick={() => onViewReport(r.reviewId)}
                  >
                    <td className="repo-col">
                      <div className="repo-name-wrapper">
                        {r.type === 'repository' ? <FolderGit2 size={16} /> : <Code size={16} />}
                        <span className="repo-title">{r.repoName || 'Code Snippet'}</span>
                      </div>
                      <span className="review-id-sub">{r.reviewId}</span>
                    </td>
                    <td>
                      <span className={`pill-badge ${r.type}`}>
                        {r.type === 'repository' ? 'Repository' : 'Quick'}
                      </span>
                    </td>
                    <td>
                      <span
                        className="issue-count"
                        title={`Breakdown: ${r.summary?.critical || 0} Critical, ${r.summary?.high || 0} High, ${r.summary?.medium || 0} Medium, ${r.summary?.low || 0} Low`}
                      >
                        {r.summary?.totalIssues || 0} issues
                      </span>
                    </td>
                    <td>
                      <span
                        className="health-score"
                        title={
                          typeof r.summary?.healthScore === 'number'
                            ? `Formula: 100 - [(${r.summary?.critical || 0}×25) + (${r.summary?.high || 0}×15) + (${r.summary?.medium || 0}×7) + (${r.summary?.low || 0}×3)] = ${r.summary.healthScore}/100`
                            : (r.status === 'failed' ? 'Review failed - no score generated' : 'Pending analysis')
                        }
                      >
                        {typeof r.summary?.healthScore === 'number' ? `${r.summary.healthScore}/100` : 'N/A'}
                      </span>
                    </td>
                    <td>
                      <span className={`status-pill-table ${r.status}`}>
                        {r.status === 'completed' && <CheckCircle2 size={12} />}
                        {r.status === 'in_progress' && <Clock size={12} />}
                        {r.status}
                      </span>
                    </td>
                    <td className="date-col">
                      {new Date(r.createdAt).toLocaleDateString()} {new Date(r.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                    </td>
                    <td className="actions-col">
                      <button
                        className="delete-icon-btn"
                        title="Delete review"
                        onClick={(e) => handleDelete(e, r.reviewId)}
                      >
                        <Trash2 size={15} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

