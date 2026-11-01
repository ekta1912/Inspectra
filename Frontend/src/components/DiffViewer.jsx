import React, { useState } from 'react';
import { Copy, Check } from 'lucide-react';

export default function DiffViewer({ diffText, fileName }) {
  const [copied, setCopied] = useState(false);

  if (!diffText) return null;

  const handleCopy = () => {
    navigator.clipboard.writeText(diffText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const lines = diffText.split('\n');

  return (
    <div className="diff-viewer">
      <div className="diff-header">
        <span className="diff-filename">{fileName || 'Patch Diff'}</span>
        <button className="copy-diff-btn" onClick={handleCopy}>
          {copied ? <><Check size={13} /> Copied</> : <><Copy size={13} /> Copy Patch</>}
        </button>
      </div>

      <div className="diff-body">
        {lines.map((line, idx) => {
          let lineType = 'context';
          if (line.startsWith('+++') || line.startsWith('---')) {
            lineType = 'meta';
          } else if (line.startsWith('+')) {
            lineType = 'addition';
          } else if (line.startsWith('-')) {
            lineType = 'deletion';
          } else if (line.startsWith('@@')) {
            lineType = 'hunk';
          }

          return (
            <div key={idx} className={`diff-line ${lineType}`}>
              <span className="line-prefix">{line.charAt(0)}</span>
              <span className="line-text">{line.slice(1)}</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

