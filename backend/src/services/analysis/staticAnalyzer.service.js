const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');

/**
 * Security and quality rule definitions for code scanning
 */
const SECURITY_RULES = [
  {
    id: 'SEC-001',
    ruleName: 'dangerous-eval-execution',
    title: 'Arbitrary Code Execution via eval() or Function()',
    severity: 'CRITICAL',
    category: 'security',
    regex: /\b(eval\s*\(|new\s+Function\s*\()/g,
    explanation: 'The code invokes eval() or new Function(), which evaluates string inputs as code. If user input reaches this call, attackers can execute arbitrary code.',
    impact: 'Full remote code execution (RCE) on the host environment.',
    recommendation: 'Replace eval() with structured parsing (such as JSON.parse) or well-defined mapping functions.',
    languages: ['javascript', 'typescript', 'python']
  },
  {
    id: 'SEC-002',
    ruleName: 'command-injection-exec',
    title: 'Potential Command Injection in Process Execution',
    severity: 'CRITICAL',
    category: 'security',
    regex: /\b(child_process|cp)\.(exec|execSync)\s*\(\s*[`'"][^`'"]*\$\{[^}]+\}/g,
    explanation: 'Command line execution uses variable string interpolation instead of parameterized argument arrays, which can allow command injection.',
    impact: 'Attackers could execute arbitrary operating system commands with server privileges.',
    recommendation: 'Use execFile or spawn with explicit argument arrays, and never pass raw strings to shell execution.',
    languages: ['javascript', 'typescript']
  },
  {
    id: 'SEC-003',
    ruleName: 'python-shell-true',
    title: 'Insecure Subprocess Execution with shell=True',
    severity: 'HIGH',
    category: 'security',
    regex: /subprocess\.(Popen|run|call|check_output)\([^)]*shell\s*=\s*True/g,
    explanation: 'Subprocess called with shell=True interprets commands through the system shell, exposing the process to command injection if arguments are untrusted.',
    impact: 'Host OS command injection.',
    recommendation: 'Set shell=False and pass arguments as a list of strings.',
    languages: ['python']
  },
  {
    id: 'SEC-004',
    ruleName: 'python-unsafe-deserialization',
    title: 'Unsafe Deserialization via pickle or yaml',
    severity: 'CRITICAL',
    category: 'security',
    regex: /\b(pickle\.loads?|yaml\.load\([^)]*Loader\s*!=\s*yaml\.SafeLoader)/g,
    explanation: 'Untrusted data deserialized using pickle or yaml.load without SafeLoader can instantiate arbitrary classes and trigger remote code execution.',
    impact: 'Arbitrary code execution upon parsing malicious payloads.',
    recommendation: 'Use yaml.safe_load() or JSON for data transfer instead of pickle.',
    languages: ['python']
  },
  {
    id: 'SEC-005',
    ruleName: 'path-traversal-risk',
    title: 'Unvalidated Path Traversal in File Operations',
    severity: 'HIGH',
    category: 'security',
    regex: /(fs\.(readFile|readFileSync|createReadStream|unlink|writeFile)\s*\([^)]*(req\.(query|params|body)|urlParams))/g,
    explanation: 'File path directly constructed from user request parameters without path validation (Zip Slip or dot-dot-slash traversal).',
    impact: 'Unauthorized access or deletion of sensitive server files.',
    recommendation: 'Sanitize file paths with path.resolve() and verify they remain within the intended base directory.',
    languages: ['javascript', 'typescript']
  },
  {
    id: 'SEC-006',
    ruleName: 'insecure-wildcard-cors',
    title: 'Overly Permissive CORS Policy with Credentials',
    severity: 'MEDIUM',
    category: 'security',
    regex: /cors\(\s*\{\s*origin\s*:\s*['"]\*['"]\s*,\s*credentials\s*:\s*true/g,
    explanation: 'Configuring Access-Control-Allow-Origin to "*" together with credentials allows any third-party domain to make credentialed requests.',
    impact: 'Cross-origin data leakage and unauthorized authenticated API invocation.',
    recommendation: 'Explicitly specify approved origin domains rather than wildcard "*".',
    languages: ['javascript', 'typescript']
  },
  {
    id: 'SEC-007',
    ruleName: 'hardcoded-credentials-leak',
    title: 'Potential Hardcoded Secret or Private Key',
    severity: 'CRITICAL',
    category: 'security',
    regex: /(const|let|var)\s+(apiKey|secretKey|privateKey|password)\s*=\s*['"][a-zA-Z0-9_\-\.]{16,}['"]/gi,
    explanation: 'Authentication secrets appear hardcoded directly in source code rather than loaded from environment variables.',
    impact: 'Exposes sensitive API accounts or infrastructure to anyone with repository access.',
    recommendation: 'Store credentials in secure environment variables or a secrets manager.',
    languages: ['javascript', 'typescript', 'python']
  },
  {
    id: 'QUAL-001',
    ruleName: 'unhandled-promise-rejection',
    title: 'Async Operation Without Error Handling',
    severity: 'MEDIUM',
    category: 'bug',
    regex: /async\s+function[^{]*\{(?![^}]*try\s*\{)[^}]*await\s+/g,
    explanation: 'Async function contains await calls without a try/catch block or promise error handling.',
    impact: 'Uncaught exceptions can cause process crashes or hang requests.',
    recommendation: 'Wrap await calls in try/catch or ensure errors propagate to a global error handler.',
    languages: ['javascript', 'typescript']
  },
  {
    id: 'PERF-001',
    ruleName: 'sync-blocking-io',
    title: 'Synchronous Blocking I/O in Server Handler',
    severity: 'LOW',
    category: 'performance',
    regex: /\b(readFileSync|writeFileSync|execSync)\b/g,
    explanation: 'Synchronous file or process calls block the Node.js single-threaded event loop, degrading concurrency and response latency.',
    impact: 'Server latency spikes and potential denial of service under high concurrency.',
    recommendation: 'Switch to asynchronous equivalents (fs.promises or callback-based APIs).',
    languages: ['javascript', 'typescript']
  }
];

/**
 * Extracts line number and evidence from file content based on regex match
 */
function findLineInfo(content, matchIndex, matchLength) {
  const lines = content.split('\n');
  let currentOffset = 0;
  let startLine = 1;

  for (let i = 0; i < lines.length; i++) {
    const lineLen = lines[i].length + 1; // including newline
    if (currentOffset + lineLen > matchIndex) {
      startLine = i + 1;
      break;
    }
    currentOffset += lineLen;
  }

  // Snippet: 2 lines before, the matching line, 2 lines after
  const lineIdx = startLine - 1;
  const startIdx = Math.max(0, lineIdx - 2);
  const endIdx = Math.min(lines.length - 1, lineIdx + 2);
  const snippet = lines.slice(startIdx, endIdx + 1).map((l, i) => `${startIdx + i + 1}: ${l}`).join('\n');

  return {
    startLine,
    endLine: startLine,
    snippet
  };
}

/**
 * Runs programmatic ESLint on JavaScript/TypeScript files if available
 */
async function runESLintAnalysis(inventory, repoDir) {
  const findings = [];
  try {
    const { ESLint } = require('eslint');
    const eslint = new ESLint({
      cwd: repoDir,
      overrideConfigFile: true,
      overrideConfig: {
        languageOptions: {
          ecmaVersion: 'latest',
          sourceType: 'module'
        },
        rules: {
          'no-undef': 'warn',
          'no-unused-vars': 'warn',
          'no-eval': 'error',
          'no-implied-eval': 'error',
          'no-debugger': 'error'
        }
      }
    });

    const jsFiles = inventory
      .filter(f => ['javascript', 'typescript'].includes(f.language))
      .map(f => f.fullPath);

    if (jsFiles.length > 0) {
      const results = await eslint.lintFiles(jsFiles.slice(0, 50));
      for (const res of results) {
        const relativePath = path.relative(repoDir, res.filePath).replace(/\\/g, '/');
        for (const msg of res.messages) {
          findings.push({
            id: `ESL-${uuidv4().slice(0, 8)}`,
            title: `ESLint: ${msg.ruleId || 'syntax-issue'}`,
            severity: msg.severity === 2 ? 'HIGH' : 'LOW',
            category: msg.ruleId && msg.ruleId.includes('eval') ? 'security' : 'quality',
            filePath: relativePath,
            startLine: msg.line || 1,
            endLine: msg.endLine || msg.line || 1,
            codeSnippet: `Line ${msg.line}: ${msg.message}`,
            explanation: msg.message,
            impact: 'Code maintainability, potential runtime error or syntax issue.',
            recommendation: `Fix violation for rule ${msg.ruleId || 'syntax'}.`,
            tool: 'eslint',
            ruleId: msg.ruleId || 'eslint',
            verified: true,
            patchStatus: 'none'
          });
        }
      }
    }
  } catch (err) {
    // ESLint unavailable or failed on certain custom configs; continue with rule scanner
    console.log('ESLint analyzer note:', err.message);
  }
  return findings;
}

/**
 * Runs rule-based security and quality analysis
 */
function runPatternAnalysis(inventory) {
  const findings = [];

  for (const file of inventory) {
    const content = file.content;
    const lang = file.language;

    for (const rule of SECURITY_RULES) {
      if (!rule.languages.includes(lang)) continue;

      rule.regex.lastIndex = 0;
      let match;
      while ((match = rule.regex.exec(content)) !== null) {
        const { startLine, endLine, snippet } = findLineInfo(content, match.index, match[0].length);

        findings.push({
          id: `${rule.id}-${uuidv4().slice(0, 6)}`,
          title: rule.title,
          severity: rule.severity,
          category: rule.category,
          filePath: file.filePath,
          startLine,
          endLine,
          codeSnippet: snippet,
          explanation: rule.explanation,
          impact: rule.impact,
          recommendation: rule.recommendation,
          tool: 'security-analyzer',
          ruleId: rule.ruleName,
          verified: false, // will be verified by LangGraph AI verification node
          patchStatus: 'none'
        });

        // Don't infinite loop on zero-length matches
        if (rule.regex.lastIndex === match.index) {
          rule.regex.lastIndex++;
        }
      }
    }
  }

  return findings;
}

/**
 * Master static analysis runner
 */
async function runStaticAnalysis(inventory, repoDir) {
  const patternFindings = runPatternAnalysis(inventory);
  const eslintFindings = await runESLintAnalysis(inventory, repoDir);

  const combined = [...patternFindings, ...eslintFindings];

  // Deduplicate findings on same file and line
  const uniqueMap = new Map();
  for (const f of combined) {
    const key = `${f.filePath}:${f.startLine}:${f.category}`;
    if (!uniqueMap.has(key)) {
      uniqueMap.set(key, f);
    }
  }

  return Array.from(uniqueMap.values());
}

module.exports = {
  runStaticAnalysis,
  runPatternAnalysis,
  runESLintAnalysis,
  SECURITY_RULES
};

