import React, { useState } from 'react';
import "prismjs/themes/prism-tomorrow.css";
import EditorDefault from "react-simple-code-editor";
import prism from "prismjs";
import MarkdownDefault from "react-markdown";
import rehypeHighlight from "rehype-highlight";
import "highlight.js/styles/github-dark.css";
import { Sparkles, Trash2, Check, Copy } from 'lucide-react';
import api from '../services/api';

const Editor = EditorDefault.default || EditorDefault;
const Markdown = MarkdownDefault.default || MarkdownDefault;

const extractText = (node) => {
  if (typeof node === "string" || typeof node === "number") return String(node);
  if (Array.isArray(node)) return node.map(extractText).join("");
  if (node != null && node.props && node.props.children) return extractText(node.props.children);
  return "";
};

const CodeBlock = ({ inline, className, children, ...props }) => {
  const match = /language-(\w+)/.exec(className || "");
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    const rawCode = extractText(children);
    navigator.clipboard.writeText(rawCode.replace(/\n$/, ""));
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (!inline && match) {
    return (
      <div style={{ position: "relative", marginTop: "1rem", marginBottom: "1rem", borderRadius: "6px", overflow: "hidden", border: "1px solid #333" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", backgroundColor: "#20232a", padding: "6px 12px", fontSize: "12px", color: "#aaa" }}>
          <span>{match[1].toUpperCase()}</span>
          <button 
            onClick={handleCopy} 
            style={{ background: "transparent", border: "none", color: copied ? "#4ade80" : "#ccc", cursor: "pointer", fontSize: "12px", display: "flex", alignItems: "center", gap: "4px" }}
          >
            {copied ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy Code</>}
          </button>
        </div>
        <code className={className} {...props} style={{ display: "block", padding: "12px", backgroundColor: "#14161b", overflowX: "auto", fontSize: "14px", whiteSpace: "pre" }}>
          {children}
        </code>
      </div>
    );
  }
  return <code className={className} {...props}>{children}</code>;
};

export default function QuickReview() {
  const [code, setCode] = useState(`function calculateDiscount(price, isMember) {
  if (isMember) {
    return price * 0.8;
  }
  return price;
}`);

  const [review, setReview] = useState("");
  const [loading, setLoading] = useState(false);
  const [language, setLanguage] = useState("javascript");

  async function handleReview() {
    if (!code.trim()) {
      setReview("Please enter some code before requesting a review.");
      return;
    }

    try {
      setLoading(true);
      const data = await api.getQuickReview(code, language);
      setReview(data);
    } catch (error) {
      console.error("Backend error:", error);
      setReview("## ❌ Unable to generate review\n\nPlease verify that the backend server is running on port 3000.");
    } finally {
      setLoading(false);
    }
  }

  function clearCode() {
    setCode("");
    setReview("");
  }

  return (
    <div className="quick-review-workspace">
      {/* Left Code Editor Panel */}
      <section className="panel editor-panel">
        <div className="panel-header">
          <div>
            <span className="panel-title">Source Code</span>
            <span className="panel-subtitle">Write or paste your code for an automated quality and security review</span>
          </div>

          <div className="language-selector">
            <select 
              value={language} 
              onChange={(e) => setLanguage(e.target.value)}
              className="lang-select"
            >
              <option value="javascript">JavaScript</option>
              <option value="python">Python</option>
              <option value="cpp">C++</option>
              <option value="java">Java</option>
            </select>
          </div>
        </div>

        <div className="editor-container">
          <Editor
            value={code}
            onValueChange={val => setCode(val)}
            highlight={val =>
              prism.highlight(
                val,
                prism.languages[language] || prism.languages.javascript,
                language
              )
            }
            padding={20}
            style={{
              fontFamily: '"Fira Code", "Courier New", monospace',
              fontSize: 14,
              minHeight: "100%",
              width: "100%",
            }}
          />
        </div>

        <div className="editor-footer">
          <span className="char-count">{code.length} characters • {code.split('\n').length} lines</span>

          <div className="actions">
            <button className="clear-btn" onClick={clearCode}>
              <Trash2 size={14} />
              <span>Clear</span>
            </button>

            <button className="review-btn" onClick={handleReview} disabled={loading}>
              {loading ? (
                <>
                  <span className="spinner"></span>
                  <span>Reviewing...</span>
                </>
              ) : (
                <>
                  <Sparkles size={15} />
                  <span>Review Code</span>
                </>
              )}
            </button>
          </div>
        </div>
      </section>

      {/* Right AI Review Results Panel */}
      <section className="panel review-panel">
        <div className="panel-header">
          <div>
            <span className="panel-title">Review Report & Recommendations</span>
            <span className="panel-subtitle">Bugs, complexity, security, and optimized code</span>
          </div>

          {review && !loading && (
            <div className="review-status-badge">
              <Check size={13} /> Complete
            </div>
          )}
        </div>

        <div className="review-content">
          {!review && !loading && (
            <div className="empty-state">
              <div className="empty-icon">
                <Sparkles size={28} />
              </div>
              <h2>Ready to review your code</h2>
              <p>
                Submit code above to analyze it for logic bugs, performance bottlenecks, security risks, and clean coding best practices.
              </p>
              <div className="features-list">
                <span>✓ Bug Detection</span>
                <span>✓ Time & Space Complexity</span>
                <span>✓ Security Analysis</span>
                <span>✓ Optimized Code Refactoring</span>
              </div>
            </div>
          )}

          {loading && (
            <div className="loading-state">
              <div className="large-spinner"></div>
              <h2>Analyzing your code...</h2>
              <p>Analyzing syntax, security implications, and generating test cases...</p>
            </div>
          )}

          {review && !loading && (
            <div className="markdown-container">
              <Markdown
                rehypePlugins={[rehypeHighlight]}
                components={{ code: CodeBlock }}
              >
                {review}
              </Markdown>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

