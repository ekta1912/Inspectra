import React from 'react';
import { ShieldCheck, Code, FolderGit2, LayoutDashboard, Terminal } from 'lucide-react';

export default function Navbar({ activeTab, setActiveTab, isEngineOnline }) {
  return (
    <header className="navbar">
      <div className="navbar-container">
        <div className="navbar-brand" onClick={() => setActiveTab('dashboard')}>
          <div className="brand-logo">
            <Terminal size={20} />
          </div>
          <div className="brand-info">
            <span className="brand-title">Inspectra</span>
          </div>
        </div>

        <nav className="nav-tabs">
          <button
            className={`nav-tab-btn ${activeTab === 'dashboard' ? 'active' : ''}`}
            onClick={() => setActiveTab('dashboard')}
          >
            <LayoutDashboard size={16} />
            <span>Dashboard</span>
          </button>

          <button
            className={`nav-tab-btn ${activeTab === 'quick' ? 'active' : ''}`}
            onClick={() => setActiveTab('quick')}
          >
            <Code size={16} />
            <span>Quick Review</span>
          </button>

          <button
            className={`nav-tab-btn ${activeTab === 'repo_input' || activeTab === 'repo_progress' || activeTab === 'repo_results' ? 'active' : ''}`}
            onClick={() => setActiveTab('repo_input')}
          >
            <FolderGit2 size={16} />
            <span>Repository Review</span>
          </button>
        </nav>

        <div className="navbar-actions">
          <div className={`status-pill ${isEngineOnline ? 'online' : 'checking'}`}>
            <span className="status-indicator-dot"></span>
            <span>{isEngineOnline ? 'Ready' : 'Connecting...'}</span>
          </div>
        </div>
      </div>
    </header>
  );
}

