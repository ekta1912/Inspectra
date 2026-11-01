import React, { useState, useEffect } from 'react';
import Navbar from './components/Navbar';
import Dashboard from './components/Dashboard';
import QuickReview from './components/QuickReview';
import RepoInput from './components/RepoInput';
import LiveProgress from './components/LiveProgress';
import ReviewResults from './components/ReviewResults';
import api from './services/api';
import './App.css';

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard'); // 'dashboard', 'quick', 'repo_input', 'repo_progress', 'repo_results'
  const [activeReviewId, setActiveReviewId] = useState(null);
  const [isEngineOnline, setIsEngineOnline] = useState(false);

  useEffect(() => {
    checkEngine();
    const interval = setInterval(checkEngine, 10000);
    return () => clearInterval(interval);
  }, []);

  async function checkEngine() {
    const online = await api.checkHealth();
    setIsEngineOnline(online);
  }

  function handleStartQuick() {
    setActiveTab('quick');
  }

  function handleStartRepo() {
    setActiveTab('repo_input');
  }

  function handleReviewStarted(reviewId) {
    setActiveReviewId(reviewId);
    setActiveTab('repo_progress');
  }

  function handleReviewCompleted(reviewId) {
    setActiveReviewId(reviewId);
    setActiveTab('repo_results');
  }

  function handleViewExistingReport(reviewId) {
    setActiveReviewId(reviewId);
    setActiveTab('repo_results');
  }

  return (
    <div className="inspectra-app devpilot-app">
      {/* Top Professional SaaS Navbar */}
      <Navbar
        activeTab={activeTab}
        setActiveTab={setActiveTab}
        isEngineOnline={isEngineOnline}
      />

      {/* Main Content View Switcher */}
      <main className="main-viewport">
        {activeTab === 'dashboard' && (
          <Dashboard
            onStartQuick={handleStartQuick}
            onStartRepo={handleStartRepo}
            onViewReport={handleViewExistingReport}
          />
        )}

        {activeTab === 'quick' && (
          <QuickReview />
        )}

        {activeTab === 'repo_input' && (
          <RepoInput
            onReviewStarted={handleReviewStarted}
          />
        )}

        {activeTab === 'repo_progress' && (
          <LiveProgress
            reviewId={activeReviewId}
            onComplete={handleReviewCompleted}
            onCancel={() => setActiveTab('dashboard')}
          />
        )}

        {activeTab === 'repo_results' && (
          <ReviewResults
            reviewId={activeReviewId}
            onBack={() => setActiveTab('dashboard')}
          />
        )}
      </main>

      {/* Footer */}
      <footer className="inspectra-footer devpilot-footer">
        <div className="footer-content">
          <span>Inspectra – Intelligent Code Review Platform</span>
        </div>
      </footer>
    </div>
  );
}
