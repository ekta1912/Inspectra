import React, { useEffect, useState, useRef } from 'react';
import { CheckCircle2, Clock, AlertTriangle, ShieldCheck, Terminal, FileCode, Bug, ArrowRight } from 'lucide-react';
import api from '../services/api';

const STAGES = [
  { id: 'preparing', name: 'Preparing your review' },
  { id: 'opening', name: 'Opening project files' },
  { id: 'analyzing_structure', name: 'Understanding project structure' },
  { id: 'checking_source', name: 'Checking source code' },
  { id: 'reviewing_deps', name: 'Reviewing dependencies' },
  { id: 'looking_for_issues', name: 'Looking for potential issues' },
  { id: 'checking_findings', name: 'Checking identified findings' },
  { id: 'reviewing_changes', name: 'Reviewing suggested changes' },
  { id: 'preparing_report', name: 'Preparing your report' }
];

export default function LiveProgress({ reviewId, onComplete, onCancel }) {
  const [currentStageId, setCurrentStageId] = useState('preparing');
  const [percent, setPercent] = useState(5);
  const [statusMessage, setStatusMessage] = useState('Preparing your review...');
  const [logs, setLogs] = useState([]);
  const [stats, setStats] = useState({ discovered: 0, analyzed: 0, issues: 0 });
  const [elapsedSeconds, setElapsedSeconds] = useState(0);
  const [isCompleted, setIsCompleted] = useState(false);
  const [hasError, setHasError] = useState(false);
  const [showLogs, setShowLogs] = useState(true);

  const logsEndRef = useRef(null);

  // Timer
  useEffect(() => {
    const timer = setInterval(() => {
      setElapsedSeconds(prev => prev + 1);
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  // Scroll logs to bottom
  useEffect(() => {
    logsEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [logs]);

  // Connect to SSE stream
  useEffect(() => {
    let eventSource = null;
    let pollInterval = null;

    function connectSSE() {
      const streamUrl = api.getStreamUrl(reviewId);
      eventSource = new EventSource(streamUrl);

      eventSource.onmessage = (event) => {
        try {
          const payload = JSON.parse(event.data);

          if (payload.type === 'done') {
            if (payload.status === 'completed') {
              setIsCompleted(true);
              setPercent(100);
              setTimeout(() => {
                onComplete(reviewId);
              }, 1200);
            } else if (payload.status === 'failed') {
              setHasError(true);
            }
            return;
          }

          if (payload.stage) {
            setCurrentStageId(payload.stage);
          }
          if (payload.percent) {
            setPercent(payload.percent);
          }
          if (payload.message) {
            setStatusMessage(payload.message);
            setLogs(prev => [...prev, {
              timestamp: new Date().toLocaleTimeString(),
              message: payload.message,
              stage: payload.stage
            }]);
          }

          if (payload.data?.stats) {
            setStats(prev => ({
              ...prev,
              discovered: payload.data.stats.discovered || prev.discovered,
              analyzed: payload.data.stats.analyzed || prev.analyzed
            }));
          }

          if (payload.data?.findingCount !== undefined) {
            setStats(prev => ({ ...prev, issues: payload.data.findingCount }));
          }

          if (payload.stage === 'completed') {
            setIsCompleted(true);
            setPercent(100);
            setTimeout(() => {
              onComplete(reviewId);
            }, 1200);
          }
        } catch (e) {}
      };

      eventSource.onerror = () => {
        // Fallback polling if SSE disconnects
        eventSource.close();
        pollInterval = setInterval(async () => {
          try {
            const status = await api.getReviewStatus(reviewId);
            if (status.status === 'completed') {
              clearInterval(pollInterval);
              setIsCompleted(true);
              setPercent(100);
              onComplete(reviewId);
            } else if (status.status === 'failed') {
              clearInterval(pollInterval);
              setHasError(true);
              setStatusMessage(status.error || 'Review failed.');
            } else {
              setPercent(status.progressPercent || 50);
              setCurrentStageId(status.currentStep || 'analyzing_code');
            }
          } catch (e) {}
        }, 2000);
      };
    }

    connectSSE();

    return () => {
      if (eventSource) eventSource.close();
      if (pollInterval) clearInterval(pollInterval);
    };
  }, [reviewId]);

  const STAGE_ALIAS_MAP = {
    validating: 0,
    preparing: 0,
    fetching: 1,
    opening: 1,
    discovering: 2,
    analyzing_structure: 2,
    indexing: 3,
    checking_source: 3,
    reviewing_deps: 4,
    static_analysis: 5,
    looking_for_issues: 5,
    analyzing_code: 5,
    retrieving_context: 6,
    checking_findings: 6,
    verifying: 6,
    reviewing_changes: 7,
    generating_fixes: 7,
    preparing_report: 8,
    completed: 9
  };

  function getStageStatus(stageIndex) {
    if (isCompleted || currentStageId === 'completed') return 'completed';
    const activeIndex = STAGE_ALIAS_MAP[currentStageId] !== undefined
      ? STAGE_ALIAS_MAP[currentStageId]
      : STAGES.findIndex(s => s.id === currentStageId);

    if (hasError && stageIndex === activeIndex) return 'error';
    if (stageIndex < activeIndex) return 'completed';
    if (stageIndex === activeIndex) return 'in_progress';
    return 'pending';
  }

  const formatTime = (secs) => {
    const mins = Math.floor(secs / 60);
    const rem = secs % 60;
    return `${mins}:${rem < 10 ? '0' : ''}${rem}`;
  };

  return (
    <div className="live-progress-page">
      <div className="progress-container">
        {/* Header */}
        <div className="progress-header">
          <div className="progress-meta">
            <span className="review-id-pill">Review #{reviewId}</span>
            <h1>Review in Progress</h1>
            <p className="status-live-message">{statusMessage}</p>
          </div>

          <div className="elapsed-timer">
            <Clock size={16} />
            <span>Elapsed: {formatTime(elapsedSeconds)}</span>
          </div>
        </div>

        {/* Global Progress Bar */}
        <div className="main-progress-bar-wrapper">
          <div className="progress-bar-fill" style={{ width: `${percent}%` }}></div>
        </div>
        <div className="progress-percentage-label">
          <span>{percent}% Completed</span>
          {isCompleted && <span className="ready-text">✓ Report Ready! Redirecting...</span>}
        </div>

        {/* Live Metrics Row */}
        <div className="live-metrics-row">
          <div className="metric-chip">
            <FileCode size={16} />
            <span>Files Discovered: <strong>{stats.discovered}</strong></span>
          </div>
          <div className="metric-chip">
            <ShieldCheck size={16} />
            <span>Files Analyzed: <strong>{stats.analyzed}</strong></span>
          </div>
          <div className="metric-chip">
            <Bug size={16} />
            <span>Potential Issues: <strong>{stats.issues}</strong></span>
          </div>
        </div>

        {/* Natural 9-Stage Pipeline Flow */}
        <div className="stages-timeline-card">
          <h2>Review Progress</h2>
          <div className="stages-list">
            {STAGES.map((stage, idx) => {
              const status = getStageStatus(idx);
              return (
                <div key={stage.id} className={`stage-item ${status}`}>
                  <div className="stage-marker">
                    {status === 'completed' && <CheckCircle2 size={16} className="check-icon" />}
                    {status === 'in_progress' && <span className="pulse-dot"></span>}
                    {status === 'pending' && <span className="pending-circle">{idx + 1}</span>}
                    {status === 'error' && <AlertTriangle size={16} className="error-icon" />}
                  </div>
                  <div className="stage-content">
                    <span className="stage-name">{stage.name}</span>
                    {status === 'in_progress' && <span className="stage-active-tag">Active</span>}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Live Execution Logs Drawer */}
        <div className="logs-drawer-card">
          <div className="logs-drawer-header" onClick={() => setShowLogs(!showLogs)}>
            <div className="logs-drawer-title">
              <Terminal size={16} />
              <span>Review Activity Log ({logs.length} events)</span>
            </div>
            <button type="button" className="toggle-logs-btn">
              {showLogs ? 'Hide' : 'Show'}
            </button>
          </div>

          {showLogs && (
            <div className="logs-console">
              {logs.map((log, i) => (
                <div key={i} className="log-line">
                  <span className="log-time">[{log.timestamp}]</span>
                  <span className="log-stage">[{log.stage}]</span>
                  <span className="log-msg">{log.message}</span>
                </div>
              ))}
              <div ref={logsEndRef} />
            </div>
          )}
        </div>

        {/* Completion Action */}
        {isCompleted && (
          <div className="completion-cta">
            <button className="view-results-btn" onClick={() => onComplete(reviewId)}>
              <span>View Review Results</span>
              <ArrowRight size={16} />
            </button>
          </div>
        )}

        {hasError && (
          <div className="error-cta">
            <p>An error occurred during workflow execution.</p>
            <button className="cancel-btn" onClick={onCancel}>
              Return to Dashboard
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

