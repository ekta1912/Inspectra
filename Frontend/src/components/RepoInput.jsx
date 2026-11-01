import React, { useState } from 'react';
import { FolderGit2, UploadCloud, Shield, Check, AlertCircle, ArrowRight, Sparkles, FileArchive } from 'lucide-react';
import api from '../services/api';

export default function RepoInput({ onReviewStarted }) {
  const [inputMode, setInputMode] = useState('url'); // 'url' or 'zip'
  const [repoUrl, setRepoUrl] = useState('');
  const [branch, setBranch] = useState('main');
  const [selectedFile, setSelectedFile] = useState(null);
  const [reviewFocus, setReviewFocus] = useState('comprehensive');
  const [generateFixes, setGenerateFixes] = useState(true);
  const [consent, setConsent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [errorMessage, setErrorMessage] = useState('');

  const focusOptions = [
    { id: 'comprehensive', label: 'Comprehensive', desc: 'Bugs, security, performance & standards' },
    { id: 'bugs', label: 'Bugs & Logic', desc: 'Runtime flaws, boundary issues, logic errors' },
    { id: 'security', label: 'Security & OWASP', desc: 'Injection, insecure deps, secrets & access' },
    { id: 'performance', label: 'Performance', desc: 'Complexity, async bottlenecks & memory' },
    { id: 'quality', label: 'Code Quality', desc: 'Maintainability, dead code & best practices' }
  ];

  function validateUrl(url) {
    if (!url) return false;
    return /^https?:\/\/github\.com\/[a-zA-Z0-9_.-]+\/[a-zA-Z0-9_.-]+/i.test(url.trim());
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setErrorMessage('');

    if (!consent) {
      setErrorMessage('Please accept the security & privacy consent before continuing.');
      return;
    }

    if (inputMode === 'url') {
      if (!validateUrl(repoUrl)) {
        setErrorMessage('Please enter a valid GitHub URL, e.g. https://github.com/owner/repo');
        return;
      }

      try {
        setLoading(true);
        const res = await api.startRepoReview({
          repoUrl: repoUrl.trim(),
          branch: branch.trim() || 'main',
          reviewFocus,
          generateFixes
        });
        if (res.reviewId) {
          onReviewStarted(res.reviewId);
        }
      } catch (err) {
        setErrorMessage(err.response?.data?.error || err.message || 'Failed to initiate review.');
      } finally {
        setLoading(false);
      }
    } else {
      // ZIP Mode
      if (!selectedFile) {
        setErrorMessage('Please select a repository ZIP archive to upload.');
        return;
      }

      if (selectedFile.size > 50 * 1024 * 1024) {
        setErrorMessage('ZIP archive exceeds the 50MB limit.');
        return;
      }

      try {
        setLoading(true);
        const formData = new FormData();
        formData.append('zipFile', selectedFile);
        formData.append('reviewFocus', reviewFocus);
        formData.append('generateFixes', generateFixes);

        const res = await api.uploadRepoZip(formData);
        if (res.reviewId) {
          onReviewStarted(res.reviewId);
        }
      } catch (err) {
        setErrorMessage(err.response?.data?.error || err.message || 'Failed to upload archive.');
      } finally {
        setLoading(false);
      }
    }
  }

  return (
    <div className="repo-input-page">
      <div className="repo-input-container">
        <div className="input-header">
          <div className="input-title-row">
            <div className="input-badge">
              <FolderGit2 size={14} /> Repository Review
            </div>
            <h1>Repository Code Review</h1>
          </div>
          <p>
            Inspectra analyzes your codebase, identifies bugs and security risks, and generates verified fixes.
          </p>
        </div>

        {errorMessage && (
          <div className="error-alert">
            <AlertCircle size={18} />
            <span>{errorMessage}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="repo-form">
          {/* Input Method Toggle */}
          <div className="method-toggle-container">
            <button
              type="button"
              className={`method-toggle-btn ${inputMode === 'url' ? 'active' : ''}`}
              onClick={() => { setInputMode('url'); setErrorMessage(''); }}
            >
              <FolderGit2 size={16} />
              <span>Public GitHub URL</span>
            </button>

            <button
              type="button"
              className={`method-toggle-btn ${inputMode === 'zip' ? 'active' : ''}`}
              onClick={() => { setInputMode('zip'); setErrorMessage(''); }}
            >
              <UploadCloud size={16} />
              <span>Upload ZIP Archive</span>
            </button>
          </div>

          {/* URL Input Form */}
          {inputMode === 'url' ? (
            <div className="form-group-card">
              <label className="field-label">GitHub Repository URL</label>
              <div className="input-field-wrapper">
                <input
                  type="text"
                  placeholder="https://github.com/owner/repository"
                  value={repoUrl}
                  onChange={(e) => setRepoUrl(e.target.value)}
                  className="text-input"
                  required
                />
              </div>

              <div className="branch-row">
                <label className="field-label">Branch (optional)</label>
                <input
                  type="text"
                  placeholder="main"
                  value={branch}
                  onChange={(e) => setBranch(e.target.value)}
                  className="text-input branch-input"
                />
              </div>
              <span className="field-hint">Supports any public GitHub repository. Shallow clone (--depth 1) is used for speed.</span>
            </div>
          ) : (
            /* ZIP Upload Form */
            <div className="form-group-card">
              <label className="field-label">Repository ZIP Archive (Max 50MB)</label>
              <div className="file-dropzone">
                <input
                  type="file"
                  id="zip-upload"
                  accept=".zip"
                  onChange={(e) => setSelectedFile(e.target.files[0] || null)}
                  className="file-input-hidden"
                />
                <label htmlFor="zip-upload" className="dropzone-label">
                  <FileArchive size={36} />
                  {selectedFile ? (
                    <div className="selected-file-info">
                      <span className="file-name">{selectedFile.name}</span>
                      <span className="file-size">{(selectedFile.size / (1024 * 1024)).toFixed(2)} MB</span>
                    </div>
                  ) : (
                    <>
                      <span className="dropzone-text">Click to choose or drag & drop a ZIP archive</span>
                      <span className="dropzone-sub">node_modules, .git, and binaries are automatically ignored</span>
                    </>
                  )}
                </label>
              </div>
            </div>
          )}

          {/* Review Focus Selector */}
          <div className="form-group-card">
            <label className="field-label">Review Focus</label>
            <div className="focus-options-grid">
              {focusOptions.map(opt => (
                <div
                  key={opt.id}
                  className={`focus-option-card ${reviewFocus === opt.id ? 'selected' : ''}`}
                  onClick={() => setReviewFocus(opt.id)}
                >
                  <div className="focus-option-header">
                    <span className="focus-title">{opt.label}</span>
                    {reviewFocus === opt.id && <Check size={14} className="check-icon" />}
                  </div>
                  <span className="focus-desc">{opt.desc}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Fix Suggestion Toggle */}
          <div className="form-group-card toggle-card">
            <div className="toggle-info">
              <span className="toggle-title">Generate and Validate Fix Suggestions</span>
              <span className="toggle-desc">
                When enabled, Inspectra generates proposed diffs and validates their syntax in an isolated sandbox.
              </span>
            </div>
            <label className="switch">
              <input
                type="checkbox"
                checked={generateFixes}
                onChange={(e) => setGenerateFixes(e.target.checked)}
              />
              <span className="slider"></span>
            </label>
          </div>

          {/* Privacy & Consent */}
          <div className="consent-card">
            <label className="checkbox-container">
              <input
                type="checkbox"
                checked={consent}
                onChange={(e) => setConsent(e.target.checked)}
              />
              <span className="checkmark"></span>
              <span className="consent-text">
                I authorize Inspectra to inspect this codebase. Files and detected credentials are automatically redacted, and temporary workspaces are securely purged upon review completion.
              </span>
            </label>
          </div>

          {/* Start Action */}
          <button
            type="submit"
            className="submit-review-btn"
            disabled={loading || !consent || (inputMode === 'url' && !repoUrl) || (inputMode === 'zip' && !selectedFile)}
          >
            {loading ? (
              <>
                <span className="spinner"></span>
                <span>Starting Review...</span>
              </>
            ) : (
              <>
                <span>Start Repository Review</span>
                <ArrowRight size={18} />
              </>
            )}
          </button>
        </form>
      </div>
    </div>
  );
}

