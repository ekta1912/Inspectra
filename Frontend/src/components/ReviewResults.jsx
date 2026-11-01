import React, { useEffect, useState } from 'react';
import { 
  ShieldAlert, ShieldCheck, CheckCircle2, AlertTriangle, 
  Download, ArrowLeft, Search, Filter, FileText, 
  Layers, GitPullRequest, Database, Copy, Check, ExternalLink
} from 'lucide-react';
import DiffViewer from './DiffViewer';
import MarkdownDefault from 'react-markdown';
import rehypeHighlight from 'rehype-highlight';
import 'highlight.js/styles/github-dark.css';
import api from '../services/api';

const Markdown = MarkdownDefault.default || MarkdownDefault;

export default function ReviewResults({ reviewId, onBack }) {
  const [reportData, setReportData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState('findings'); // 'findings', 'patches', 'rag', 'files', 'report'
  const [severityFilter, setSeverityFilter] = useState('ALL');
  const [categoryFilter, setCategoryFilter] = useState('ALL');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedFinding, setSelectedFinding] = useState(null);
  const [applyingPatch, setApplyingPatch] = useState({});

  useEffect(() => {
    loadReport();
  }, [reviewId]);

  async function loadReport() {
    try {
      setLoading(true);
      const data = await api.getReviewReport(reviewId);
      setReportData(data);
      if (data?.findings && data.findings.length > 0) {
        setSelectedFinding(data.findings[0]);
      }
    } catch (err) {
      console.error('Failed to load review report:', err);
    } finally {
      setLoading(false);
    }
  }

  async function handleDownloadReport() {
    try {
      await api.downloadReport(reviewId);
    } catch (err) {
      alert('Failed to download markdown report.');
    }
  }

  async function handleApplyPatch(patchId) {
    if (!confirm('Apply this suggested change to the workspace? Original source files are never silently overwritten.')) return;
    try {
      setApplyingPatch(prev => ({ ...prev, [patchId]: true }));
      const res = await api.applyPatchApproval(reviewId, patchId, true);
      alert(res.message || 'Change applied successfully.');
      loadReport();
    } catch (err) {
      alert('Failed to apply change: ' + (err.response?.data?.error || err.message));
    } finally {
      setApplyingPatch(prev => ({ ...prev, [patchId]: false }));
    }
  }

  if (loading) {
    return (
      <div className="results-loading-page">
        <div className="large-spinner"></div>
        <h2>Loading Review Report...</h2>
        <p>Retrieving findings, code analysis, and suggested changes.</p>
      </div>
    );
  }

  if (!reportData) {
    return (
      <div className="results-error-page">
        <h2>Report Not Found</h2>
        <button onClick={onBack} className="back-btn">
          <ArrowLeft size={16} /> Return to Dashboard
        </button>
      </div>
    );
  }

  const findings = reportData.findings || [];
  const patches = reportData.suggestedPatches || [];
  const ragSources = reportData.ragSources || [];
  const fileStats = reportData.fileStats || {};
  const summary = reportData.summary || {};

  // Filter findings
  const filteredFindings = findings.filter(f => {
    const matchSev = severityFilter === 'ALL' || f.severity === severityFilter;
    const matchCat = categoryFilter === 'ALL' || f.category === categoryFilter;
    const matchQuery = !searchQuery || 
      f.title.toLowerCase().includes(searchQuery.toLowerCase()) || 
      f.filePath.toLowerCase().includes(searchQuery.toLowerCase());
    return matchSev && matchCat && matchQuery;
  });

  return (
    <div className="review-results-page">
      {/* Top Header & Actions */}
      <div className="results-header">
        <div className="header-left">
          <button className="back-link-btn" onClick={onBack}>
            <ArrowLeft size={16} />
            <span>Dashboard</span>
          </button>
          <div className="repo-title-wrapper">
            <h1>{reportData.repoName || reportData.repoUrl || 'Repository Audit'}</h1>
            <span className="branch-tag">branch: {reportData.branch || 'main'}</span>
            <span className="review-id-tag">#{reportData.reviewId}</span>
          </div>
        </div>

        <div className="header-right">
          <button className="download-report-btn" onClick={handleDownloadReport}>
            <Download size={15} />
            <span>Export Markdown Report</span>
          </button>
        </div>
      </div>

      {/* Overview Stat Cards */}
      <div className="overview-cards-grid">
        <div className="overview-card health-card">
          <div className="health-circle">
            <span className="score-val">{typeof summary.healthScore === 'number' ? summary.healthScore : 'N/A'}</span>
            <span className="score-max">{typeof summary.healthScore === 'number' ? '/100' : ''}</span>
          </div>
          <div className="health-details">
            <span className="card-label">Health Score</span>
            <span className="health-verdict">
              {typeof summary.healthScore === 'number'
                ? (summary.healthScore >= 80 ? 'Good Code Health' : summary.healthScore >= 50 ? 'Moderate Risks Detected' : 'Action Required')
                : 'Score Not Available'}
            </span>
            <span
              className="score-deduction-sub"
              style={{ fontSize: '11px', color: 'var(--text-muted)', marginTop: '2px' }}
              title="Formula: 100 - [Critical(25) + High(15) + Medium(7) + Low(3)]"
            >
              {typeof summary.healthScore === 'number'
                ? `100 - (${(summary.critical || 0) * 25} Crit + ${(summary.high || 0) * 15} High + ${(summary.medium || 0) * 7} Med + ${(summary.low || 0) * 3} Low)`
                : 'Incomplete or failed analysis'}
            </span>
          </div>
        </div>

        <div className="overview-card">
          <span className="card-label">Files Analyzed</span>
          <div className="card-value">{fileStats.analyzed || 0}</div>
          <span className="card-sub">{fileStats.discovered || 0} total discovered</span>
        </div>

        <div className="overview-card">
          <span className="card-label">Identified Issues</span>
          <div className="card-value">{summary.totalIssues || 0}</div>
          <div className="severity-pills-row">
            {summary.critical > 0 && <span className="sev-pill crit">{summary.critical} Crit</span>}
            {summary.high > 0 && <span className="sev-pill high">{summary.high} High</span>}
            {summary.medium > 0 && <span className="sev-pill med">{summary.medium} Med</span>}
            {summary.low > 0 && <span className="sev-pill low">{summary.low} Low</span>}
          </div>
        </div>

        <div className="overview-card">
          <span className="card-label">Suggested Fixes</span>
          <div className="card-value">{summary.fixesValidated || 0}</div>
          <span className="card-sub">{patches.length} proposals generated</span>
        </div>
      </div>

      {/* Main Tabs Navigation */}
      <div className="results-tab-bar">
        <button
          className={`tab-btn ${activeTab === 'findings' ? 'active' : ''}`}
          onClick={() => setActiveTab('findings')}
        >
          <ShieldAlert size={16} />
          <span>Identified Issues ({findings.length})</span>
        </button>

        <button
          className={`tab-btn ${activeTab === 'patches' ? 'active' : ''}`}
          onClick={() => setActiveTab('patches')}
        >
          <GitPullRequest size={16} />
          <span>Suggested Changes ({patches.length})</span>
        </button>

        <button
          className={`tab-btn ${activeTab === 'rag' ? 'active' : ''}`}
          onClick={() => setActiveTab('rag')}
        >
          <Database size={16} />
          <span>Referenced Sources ({ragSources.length})</span>
        </button>

        <button
          className={`tab-btn ${activeTab === 'files' ? 'active' : ''}`}
          onClick={() => setActiveTab('files')}
        >
          <Layers size={16} />
          <span>File Inventory</span>
        </button>

        <button
          className={`tab-btn ${activeTab === 'report' ? 'active' : ''}`}
          onClick={() => setActiveTab('report')}
        >
          <FileText size={16} />
          <span>Full Report</span>
        </button>
      </div>

      {/* Tab 1: Findings Master-Detail View */}
      {activeTab === 'findings' && (
        <div className="findings-view">
          {/* Filters Bar */}
          <div className="findings-filters-bar">
            <div className="search-box">
              <Search size={15} />
              <input
                type="text"
                placeholder="Search by file or issue..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
            </div>

            <div className="filter-group">
              <span className="filter-label">Severity:</span>
              {['ALL', 'CRITICAL', 'HIGH', 'MEDIUM', 'LOW'].map(sev => (
                <button
                  key={sev}
                  className={`filter-pill ${severityFilter === sev ? 'active' : ''} ${sev.toLowerCase()}`}
                  onClick={() => setSeverityFilter(sev)}
                >
                  {sev}
                </button>
              ))}
            </div>

            <div className="filter-group">
              <span className="filter-label">Category:</span>
              {['ALL', 'security', 'bug', 'performance', 'quality'].map(cat => (
                <button
                  key={cat}
                  className={`filter-pill ${categoryFilter === cat ? 'active' : ''}`}
                  onClick={() => setCategoryFilter(cat)}
                >
                  {cat.toUpperCase()}
                </button>
              ))}
            </div>
          </div>

          {/* Master Detail Split */}
          <div className="master-detail-container">
            {/* Left Findings List */}
            <div className="findings-list-panel">
              {filteredFindings.length === 0 ? (
                <div className="empty-findings-msg">
                  <CheckCircle2 size={32} />
                  <p>No findings matching current filters.</p>
                </div>
              ) : (
                filteredFindings.map(finding => {
                  const isSelected = selectedFinding?.id === finding.id;
                  return (
                    <div
                      key={finding.id}
                      className={`finding-card ${isSelected ? 'selected' : ''} ${finding.severity.toLowerCase()}`}
                      onClick={() => setSelectedFinding(finding)}
                    >
                      <div className="finding-card-top">
                        <span className={`sev-badge ${finding.severity.toLowerCase()}`}>
                          {finding.severity}
                        </span>
                        <span className="cat-badge">{finding.category}</span>
                      </div>
                      <h4 className="finding-title">{finding.title}</h4>
                      <div className="finding-file-meta">
                        <span>{finding.filePath}</span>
                        <span>L{finding.startLine}</span>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            {/* Right Finding Inspector Panel */}
            <div className="finding-inspector-panel">
              {selectedFinding ? (
                <div className="inspector-content">
                  <div className="inspector-header">
                    <div className="inspector-title-row">
                      <span className={`sev-badge ${selectedFinding.severity.toLowerCase()}`}>
                        {selectedFinding.severity}
                      </span>
                      <h2>{selectedFinding.title}</h2>
                    </div>
                    <div className="inspector-location">
                      <span><strong>File:</strong> {selectedFinding.filePath}</span>
                      <span><strong>Lines:</strong> {selectedFinding.startLine} - {selectedFinding.endLine}</span>
                      <span><strong>Rule:</strong> {selectedFinding.ruleId} ({selectedFinding.tool})</span>
                    </div>
                  </div>

                  {/* Verification Badge */}
                  <div className="verification-notice">
                    <ShieldCheck size={18} />
                    <div>
                      <strong>Verification Status: Confirmed</strong>
                      <p>{selectedFinding.verificationReason || 'Verified against code AST and repository context.'}</p>
                    </div>
                  </div>

                  {/* Source Code Snippet */}
                  <div className="inspector-section">
                    <h3>Source Code Evidence</h3>
                    <pre className="code-evidence-block">
                      <code>{selectedFinding.codeSnippet}</code>
                    </pre>
                  </div>

                  {/* Explanation & Impact */}
                  <div className="inspector-section">
                    <h3>Analysis & Potential Impact</h3>
                    <p className="explanation-text">{selectedFinding.explanation}</p>
                    <div className="impact-box">
                      <strong>Potential Impact:</strong> {selectedFinding.impact}
                    </div>
                  </div>

                  {/* Recommendation */}
                  <div className="inspector-section">
                    <h3>Recommended Resolution</h3>
                    <p className="recommendation-text">{selectedFinding.recommendation}</p>
                  </div>

                  {/* Associated Fix Patch if available */}
                  {(() => {
                    const patch = patches.find(p => p.findingId === selectedFinding.id);
                    if (!patch) return null;
                    return (
                      <div className="inspector-section">
                        <div className="patch-section-header">
                          <h3>Suggested Fix</h3>
                          <span className={`patch-status-badge ${patch.isValidated ? 'valid' : 'unvalidated'}`}>
                            {patch.isValidated ? '✓ Checks Passed' : 'Not Validated'}
                          </span>
                        </div>
                        <DiffViewer diffText={patch.diff} fileName={patch.filePath} />
                        <div className="patch-actions-row">
                          <button
                            className="apply-patch-btn"
                            disabled={applyingPatch[patch.patchId] || patch.status === 'applied'}
                            onClick={() => handleApplyPatch(patch.patchId)}
                          >
                            {patch.status === 'applied' ? '✓ Applied' : 'Apply Changes'}
                          </button>
                        </div>
                      </div>
                    );
                  })()}
                </div>
              ) : (
                <div className="select-prompt">
                  <p>Select a finding from the left to view detailed analysis and verified patches.</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Tab 2: Suggested Changes */}
      {activeTab === 'patches' && (
        <div className="patches-tab-content">
          {patches.length === 0 ? (
            <div className="empty-tab-state">
              <GitPullRequest size={36} />
              <p>No automatic patches were generated for this review.</p>
            </div>
          ) : (
            <div className="patches-grid">
              {patches.map((patch, idx) => (
                <div key={patch.patchId} className="patch-card">
                  <div className="patch-card-header">
                    <div>
                      <span className="patch-index">Change #{idx + 1}</span>
                      <h3>{patch.filePath}</h3>
                    </div>
                    <span className={`patch-validation-tag ${patch.isValidated ? 'valid' : 'invalid'}`}>
                      {patch.isValidated ? '✓ Checks Passed' : 'Not Validated'}
                    </span>
                  </div>

                  <p className="patch-details-sub">{patch.validationDetails}</p>

                  <DiffViewer diffText={patch.diff} fileName={patch.filePath} />

                  <div className="patch-footer">
                    <span className="patch-status-text">Status: <strong>{patch.status === 'applied' ? 'Applied' : patch.status}</strong></span>
                    <button
                      className="apply-patch-btn"
                      disabled={patch.status === 'applied'}
                      onClick={() => handleApplyPatch(patch.patchId)}
                    >
                      {patch.status === 'applied' ? '✓ Applied' : 'Apply Changes'}
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tab 3: Referenced Sources */}
      {activeTab === 'rag' && (
        <div className="rag-tab-content">
          <div className="rag-header-info">
            <h2>Referenced Project Context</h2>
            <p>Code sections retrieved to inform cross-file analysis and security checks.</p>
          </div>

          <div className="rag-sources-grid">
            {ragSources.map((source, i) => (
              <div key={i} className="rag-source-card">
                <div className="rag-card-top">
                  <span className="rag-file-name">{source.filePath} (L{source.startLine}-{source.endLine})</span>
                  <span className="rag-score">Relevance: {(source.relevanceScore * 100).toFixed(1)}%</span>
                </div>
                <pre className="rag-snippet">
                  <code>{source.snippet}</code>
                </pre>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab 4: File Inventory */}
      {activeTab === 'files' && (
        <div className="files-tab-content">
          <h2>Discovered Repository Inventory</h2>
          <div className="files-stats-summary">
            <span>Discovered: <strong>{fileStats.discovered || 0}</strong></span>
            <span>Analyzed: <strong>{fileStats.analyzed || 0}</strong></span>
            <span>Skipped: <strong>{fileStats.skipped || 0}</strong></span>
          </div>

          <div className="languages-breakdown">
            {Object.entries(fileStats.languages || {}).map(([lang, count]) => (
              <div key={lang} className="lang-chip">
                <span>{lang}: <strong>{count} files</strong></span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Tab 5: Full Markdown Report */}
      {activeTab === 'report' && (
        <div className="markdown-report-view">
          <div className="report-action-header">
            <h2>Inspectra Complete Report</h2>
            <button className="download-report-btn" onClick={handleDownloadReport}>
              <Download size={14} /> Download .md
            </button>
          </div>
          <div className="markdown-rendered-container">
            <Markdown rehypePlugins={[rehypeHighlight]}>
              {reportData.reportMarkdown}
            </Markdown>
          </div>
        </div>
      )}
    </div>
  );
}

