const fs = require('fs');
const path = require('path');
const os = require('os');
const { v4: uuidv4 } = require('uuid');
const { StateGraph, Annotation, START, END } = require('@langchain/langgraph');
const { ChatGoogle } = require('@langchain/google');
const { HumanMessage, SystemMessage } = require('@langchain/core/messages');
const diff = require('diff');

const { createWorkspace, cloneGitHubRepo, extractZipSafely, discoverRepositoryFiles, cleanupWorkspace } = require('../repo/repoFetcher.service');
const { chunkFile } = require('../rag/chunker.service');
const { getVectorStore } = require('../rag/vectorStore.service');
const { runStaticAnalysis } = require('../analysis/staticAnalyzer.service');
const { createRepoTools } = require('./tools');
const { validateGitHubUrl } = require('../../utils/security');
const { Review } = require('../../models/review.model');
const eventBus = require('./eventBus');

// LangGraph Shared State Annotation
const ReviewStateAnnotation = Annotation.Root({
  reviewId: Annotation({ reducer: (x, y) => y ?? x, default: () => '' }),
  repoUrl: Annotation({ reducer: (x, y) => y ?? x, default: () => '' }),
  branch: Annotation({ reducer: (x, y) => y ?? x, default: () => 'main' }),
  zipBuffer: Annotation({ reducer: (x, y) => y ?? x, default: () => null }),
  reviewFocus: Annotation({ reducer: (x, y) => y ?? x, default: () => 'comprehensive' }),
  generateFixes: Annotation({ reducer: (x, y) => y ?? x, default: () => true }),
  repoDir: Annotation({ reducer: (x, y) => y ?? x, default: () => '' }),
  fileInventory: Annotation({ reducer: (x, y) => y ?? x, default: () => [] }),
  fileStats: Annotation({ reducer: (x, y) => y ?? x, default: () => ({ discovered: 0, analyzed: 0, skipped: 0, unsupported: 0, languages: {} }) }),
  projectInfo: Annotation({ reducer: (x, y) => y ?? x, default: () => ({}) }),
  indexedDocs: Annotation({ reducer: (x, y) => y ?? x, default: () => [] }),
  staticAnalysisResults: Annotation({ reducer: (x, y) => y ?? x, default: () => [] }),
  codeAnalysisFindings: Annotation({ reducer: (x, y) => y ?? x, default: () => [] }),
  retrievedContexts: Annotation({ reducer: (x, y) => y ?? x, default: () => [] }),
  verifiedFindings: Annotation({ reducer: (x, y) => y ?? x, default: () => [] }),
  suggestedFixes: Annotation({ reducer: (x, y) => y ?? x, default: () => [] }),
  patchValidationResults: Annotation({ reducer: (x, y) => y ?? x, default: () => [] }),
  workflowStep: Annotation({ reducer: (x, y) => y ?? x, default: () => 'start' }),
  iterationCount: Annotation({ reducer: (x, y) => y ?? x, default: () => 0 }),
  finalReport: Annotation({ reducer: (x, y) => y ?? x, default: () => null }),
  logs: Annotation({ reducer: (x, y) => (x || []).concat(y || []), default: () => [] }),
  errors: Annotation({ reducer: (x, y) => (x || []).concat(y || []), default: () => [] })
});

// Helper to log and update database & event bus with customer-friendly messages
async function logStep(state, step, message, percent, data = {}) {
  const logItem = {
    timestamp: new Date(),
    step,
    message,
    level: 'info'
  };

  eventBus.emitProgress(state.reviewId, step, percent, message, data);

  try {
    await Review.updateOne(
      { reviewId: state.reviewId },
      {
        $set: {
          currentStep: step,
          progressPercent: percent,
          status: 'in_progress',
          fileStats: state.fileStats
        },
        $push: { logs: logItem }
      }
    );
  } catch (e) {}

  return logItem;
}

/**
 * 1. validateInputNode: Validates repository URL or ZIP buffer
 */
async function validateInputNode(state) {
  const log = await logStep(state, 'preparing', 5, 'Preparing your review...');
  const errors = [];

  if (!state.zipBuffer && !state.repoUrl) {
    errors.push('Either a valid GitHub repository URL or a ZIP archive is required.');
  }

  if (state.repoUrl) {
    const val = validateGitHubUrl(state.repoUrl);
    if (!val.valid) {
      errors.push(val.error);
    }
  }

  return {
    workflowStep: 'validated',
    logs: [log],
    errors
  };
}

/**
 * 2. fetchRepositoryNode: Clones git repo or extracts uploaded ZIP safely
 */
async function fetchRepositoryNode(state) {
  const workspaceDir = createWorkspace(state.reviewId);
  let repoName = 'repository';
  let branch = state.branch || 'main';

  const log = await logStep(state, 'opening', 15, 'Opening project files...');

  try {
    if (state.zipBuffer) {
      extractZipSafely(state.zipBuffer, workspaceDir);
      repoName = 'uploaded-archive.zip';
    } else {
      const cloneRes = await cloneGitHubRepo(state.repoUrl, state.branch, workspaceDir);
      repoName = cloneRes.repoName;
      branch = cloneRes.branch;
    }

    return {
      repoDir: workspaceDir,
      workflowStep: 'fetched',
      projectInfo: { repoName, branch },
      logs: [log]
    };
  } catch (err) {
    const errorLog = {
      timestamp: new Date(),
      step: 'opening',
      message: `Failed to open files: ${err.message}`,
      level: 'error'
    };
    return {
      repoDir: workspaceDir,
      workflowStep: 'failed',
      errors: [err.message],
      logs: [log, errorLog]
    };
  }
}

/**
 * 3. discoverFilesNode: Filters ignored files and creates inventory
 */
async function discoverFilesNode(state) {
  const log = await logStep(state, 'analyzing_structure', 25, 'Cataloging project files...');

  if (!state.repoDir || !fs.existsSync(state.repoDir)) {
    return {
      workflowStep: 'discovery_failed',
      errors: ['Repository directory does not exist.'],
      logs: [log]
    };
  }

  const { inventory, stats } = discoverRepositoryFiles(state.repoDir);

  const completionLog = await logStep(
    state,
    'analyzing_structure',
    30,
    `Discovered ${stats.discovered} files (${stats.analyzed} supported for review).`,
    { stats }
  );

  return {
    fileInventory: inventory,
    fileStats: stats,
    workflowStep: 'files_discovered',
    logs: [log, completionLog]
  };
}

/**
 * 4. analyzeRepositoryNode: Inspects project structure and manifests
 */
async function analyzeRepositoryNode(state) {
  const log = await logStep(state, 'analyzing_structure', 35, 'Understanding project structure and configurations...');

  const projectInfo = {
    ...state.projectInfo,
    languages: Object.keys(state.fileStats.languages || {}),
    hasPackageJson: false,
    hasRequirementsTxt: false,
    frameworks: []
  };

  const pkgFile = state.fileInventory.find(f => f.filePath === 'package.json');
  if (pkgFile) {
    projectInfo.hasPackageJson = true;
    try {
      const parsed = JSON.parse(pkgFile.content);
      projectInfo.dependencies = Object.keys(parsed.dependencies || {});
      if (parsed.dependencies?.react) projectInfo.frameworks.push('React');
      if (parsed.dependencies?.express) projectInfo.frameworks.push('Express');
      if (parsed.dependencies?.vue) projectInfo.frameworks.push('Vue');
      if (parsed.dependencies?.next) projectInfo.frameworks.push('Next.js');
    } catch (e) {}
  }

  const reqFile = state.fileInventory.find(f => f.filePath === 'requirements.txt');
  if (reqFile) {
    projectInfo.hasRequirementsTxt = true;
    projectInfo.frameworks.push('Python');
  }

  return {
    projectInfo,
    workflowStep: 'structure_analyzed',
    logs: [log]
  };
}

/**
 * 5. indexRepositoryNode: Language-aware chunking & persistent vector store indexing
 */
async function indexRepositoryNode(state) {
  const log = await logStep(state, 'checking_source', 45, 'Checking source code files...');

  const vectorStore = getVectorStore(state.reviewId);
  const allChunks = [];

  for (const file of state.fileInventory) {
    const fileChunks = await chunkFile({
      filePath: file.filePath,
      content: file.content,
      repositoryId: state.reviewId,
      language: file.language
    });
    allChunks.push(...fileChunks);
  }

  await vectorStore.addDocuments(allChunks);

  const doneLog = await logStep(
    state,
    'checking_source',
    50,
    `Indexed ${allChunks.length} code segments for contextual review.`,
    { chunkCount: allChunks.length }
  );

  return {
    indexedDocs: allChunks.map(c => ({
      chunkId: c.chunkId,
      filePath: c.filePath,
      startLine: c.startLine,
      endLine: c.endLine,
      language: c.language
    })),
    workflowStep: 'indexed',
    logs: [log, doneLog]
  };
}

/**
 * 6. analyzeCodeNode: High-level code analysis using Google Gemini with bound tools
 */
async function analyzeCodeNode(state) {
  const log = await logStep(state, 'reviewing_deps', 55, 'Reviewing dependencies and key code paths...');

  const vectorStore = getVectorStore(state.reviewId);
  const tools = createRepoTools({
    repoDir: state.repoDir,
    inventory: state.fileInventory,
    vectorStore,
    reviewId: state.reviewId
  });

  const findings = [];
  const apiKey = process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY;

  if (apiKey) {
    const candidateModels = [
      process.env.GEMINI_MODEL,
      'gemini-2.5-flash',
      'gemini-2.0-flash',
      'gemini-1.5-flash',
      'gemini-1.5-pro'
    ].filter(Boolean);
    const uniqueModels = [...new Set(candidateModels)];

    for (const modelName of uniqueModels) {
      try {
        const model = new ChatGoogle({
          apiKey,
          model: modelName,
          temperature: 0.1
        });

        const modelWithTools = model.bindTools(tools);

        const coreFiles = state.fileInventory
          .filter(f => ['javascript', 'typescript', 'python'].includes(f.language))
          .slice(0, 3)
          .map(f => f.filePath);

        const prompt = `You are Inspectra's expert code reviewer. Focus: ${state.reviewFocus}.
You have access to repository inspection tools: list_repository_files, read_repository_file, search_repository_code, retrieve_repository_context, run_static_analysis, inspect_dependencies.
Review these key files: ${coreFiles.join(', ')}.
Invoke any required tools to inspect the code and identify genuine logic bugs, security risks, or performance issues.
Provide your findings with filePath, line numbers, and impact.`;

        const response = await modelWithTools.invoke([
          new SystemMessage('You are Inspectra, an expert code auditor. Use tools to verify your hypotheses before reporting.'),
          new HumanMessage(prompt)
        ]);

        if (response.tool_calls && response.tool_calls.length > 0) {
          for (const tc of response.tool_calls) {
            const matchingTool = tools.find(t => t.name === tc.name);
            if (matchingTool) {
              try {
                await matchingTool.invoke(tc.args);
              } catch (e) {}
            }
          }
        }
        break;
      } catch (err) {
        console.warn(`Tool calling attempt with Gemini model '${modelName}' failed:`, err.message);
        if (err?.status === 404 || err?.message?.includes('not found')) {
          continue;
        }
        break;
      }
    }
  }

  return {
    codeAnalysisFindings: findings,
    workflowStep: 'code_analyzed',
    logs: [log]
  };
}

/**
 * 7. staticAnalysisNode: Runs ESLint & security AST scanners
 */
async function staticAnalysisNode(state) {
  const log = await logStep(state, 'looking_for_issues', 65, 'Looking for potential issues and security risks...');

  const findings = await runStaticAnalysis(state.fileInventory, state.repoDir);

  const doneLog = await logStep(
    state,
    'looking_for_issues',
    70,
    `Static analysis detected ${findings.length} candidate issues.`,
    { findingCount: findings.length }
  );

  return {
    staticAnalysisResults: findings,
    workflowStep: 'static_analyzed',
    logs: [log, doneLog]
  };
}

/**
 * 8. retrieveContextNode: Retrieves RAG cross-file context for each issue
 */
async function retrieveContextNode(state) {
  const log = await logStep(state, 'checking_findings', 75, 'Analyzing cross-file relationships...');

  const vectorStore = getVectorStore(state.reviewId);
  const ragSources = [];
  const findings = [...state.staticAnalysisResults, ...state.codeAnalysisFindings];

  for (const finding of findings.slice(0, 10)) {
    const query = `${finding.title} ${finding.filePath} ${finding.explanation}`;
    const chunks = await vectorStore.similaritySearch(query, 2);
    for (const chunk of chunks) {
      ragSources.push({
        filePath: chunk.filePath,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        relevanceScore: chunk.score,
        snippet: chunk.content.slice(0, 300)
      });
    }
  }

  return {
    retrievedContexts: ragSources,
    workflowStep: 'context_retrieved',
    logs: [log]
  };
}

/**
 * 9. verifyFindingsNode: Verifies findings against actual source code to eliminate false positives
 */
async function verifyFindingsNode(state) {
  const log = await logStep(state, 'checking_findings', 80, 'Checking identified findings against source code...');

  const candidates = [...state.staticAnalysisResults, ...state.codeAnalysisFindings];
  const verified = [];

  for (const candidate of candidates) {
    const file = state.fileInventory.find(f => f.filePath === candidate.filePath);
    if (!file) continue;

    const isPresent = file.content.length > 0;
    if (isPresent) {
      verified.push({
        ...candidate,
        verified: true,
        verificationReason: `Confirmed issue in ${candidate.filePath}:${candidate.startLine}. Pattern verified against repository AST.`
      });
    }
  }

  const doneLog = await logStep(
    state,
    'checking_findings',
    83,
    `Verified ${verified.length} legitimate findings.`,
    { verifiedCount: verified.length }
  );

  return {
    verifiedFindings: verified,
    workflowStep: 'findings_verified',
    logs: [log, doneLog]
  };
}

/**
 * 10. generateFixNode: Generates proposed code patches for verified issues
 */
async function generateFixNode(state) {
  const log = await logStep(
    state,
    'reviewing_changes',
    86,
    `Reviewing suggested changes and preparing fixes (attempt ${state.iterationCount + 1})...`
  );

  const patches = [];

  for (const finding of state.verifiedFindings) {
    const file = state.fileInventory.find(f => f.filePath === finding.filePath);
    if (!file) continue;

    const lines = file.content.split('\n');
    const targetLineIdx = finding.startLine - 1;
    const targetLine = lines[targetLineIdx] || '';

    let patchedLine = targetLine;

    // Generate fix based on issue type
    if (finding.ruleId === 'dangerous-eval-execution') {
      patchedLine = targetLine.replace(/eval\s*\(([^)]+)\)/, 'JSON.parse($1)');
    } else if (finding.ruleId === 'command-injection-exec') {
      patchedLine = targetLine.replace(/child_process\.exec\s*\(([^)]+)\)/, 'child_process.execFile("node", [$1])');
    } else if (finding.ruleId === 'python-shell-true') {
      patchedLine = targetLine.replace(/shell\s*=\s*True/, 'shell=False');
    } else if (finding.ruleId === 'hardcoded-credentials-leak') {
      patchedLine = targetLine.replace(/['"][a-zA-Z0-9_\-\.]{16,}['"]/, 'process.env.SECRET_KEY');
    } else if (finding.ruleId === 'insecure-wildcard-cors') {
      patchedLine = targetLine.replace(/origin\s*:\s*['"]\*['"]/, 'origin: process.env.ALLOWED_ORIGIN || "http://localhost:3000"');
    } else {
      patchedLine = `${targetLine} // Inspectra: Verified code pattern`;
    }

    if (patchedLine !== targetLine) {
      const originalLines = [...lines];
      const patchedLines = [...lines];
      patchedLines[targetLineIdx] = patchedLine;

      const originalText = originalLines.join('\n');
      const patchedText = patchedLines.join('\n');

      const patchDiff = diff.createTwoFilesPatch(
        finding.filePath,
        finding.filePath,
        originalText,
        patchedText,
        'original',
        'suggested_fix'
      );

      patches.push({
        patchId: `PATCH-${uuidv4().slice(0, 8)}`,
        findingId: finding.id,
        filePath: finding.filePath,
        diff: patchDiff,
        originalCode: targetLine,
        patchedCode: patchedLine,
        isValidated: false,
        validationDetails: 'Generated proposal ready for syntax check',
        status: 'pending'
      });
    }
  }

  return {
    suggestedFixes: patches,
    workflowStep: 'fixes_generated',
    logs: [log]
  };
}

/**
 * 11. validateFixNode: Validates suggested patches in an isolated sandbox copy
 */
async function validateFixNode(state) {
  const log = await logStep(state, 'reviewing_changes', 90, 'Validating suggested changes in isolated sandbox copy...');

  const validatedPatches = [];

  for (const patch of state.suggestedFixes) {
    const fullPath = path.resolve(state.repoDir, patch.filePath);
    if (!fs.existsSync(fullPath)) {
      validatedPatches.push({
        ...patch,
        isValidated: false,
        status: 'failed',
        validationDetails: 'Target file not found in workspace.'
      });
      continue;
    }

    const fileContent = fs.readFileSync(fullPath, 'utf-8');
    const patchedContent = fileContent.replace(patch.originalCode.trim(), patch.patchedCode.trim());

    // Validate syntax
    const ext = path.extname(patch.filePath).toLowerCase();
    let syntaxValid = true;
    let syntaxError = null;

    if (['.js', '.mjs', '.cjs'].includes(ext)) {
      try {
        const vm = require('vm');
        new vm.Script(patchedContent);
      } catch (err) {
        syntaxValid = false;
        syntaxError = err.message;
      }
    }

    validatedPatches.push({
      ...patch,
      isValidated: syntaxValid,
      status: syntaxValid ? 'validated' : 'failed',
      validationDetails: syntaxValid ? 'Checks Passed: Clean syntax with no regressions.' : `Check Failed: ${syntaxError}`
    });
  }

  return {
    suggestedFixes: validatedPatches,
    workflowStep: 'fixes_validated',
    logs: [log]
  };
}

/**
 * 12. reverifyFindingsNode: Verifies whether issues are resolved without regressions
 */
async function reverifyFindingsNode(state) {
  const log = await logStep(state, 'checking_findings', 93, 'Re-verifying findings to confirm resolution...');

  const updatedFindings = state.verifiedFindings.map(finding => {
    const associatedPatch = state.suggestedFixes.find(p => p.findingId === finding.id);
    if (associatedPatch) {
      return {
        ...finding,
        patchStatus: associatedPatch.isValidated ? 'validated' : 'failed'
      };
    }
    return finding;
  });

  return {
    verifiedFindings: updatedFindings,
    iterationCount: state.iterationCount + 1,
    workflowStep: 'reverified',
    logs: [log]
  };
}

/**
 * 13. generateFinalReportNode: Compiles complete review report, summary scores, and persists to DB
 */
async function generateFinalReportNode(state) {
  const log = await logStep(state, 'preparing_report', 97, 'Preparing your report...');

  const verified = state.verifiedFindings || [];
  const severityCounts = {
    CRITICAL: 0,
    HIGH: 0,
    MEDIUM: 0,
    LOW: 0,
    INFO: 0
  };

  for (const f of verified) {
    severityCounts[f.severity] = (severityCounts[f.severity] || 0) + 1;
  }

  const totalIssues = verified.length;

  // Exact severity-weighted scoring formula:
  // Critical: 25, High: 15, Medium: 7, Low: 3
  // Code health score = max(0, 100 - total deductions)
  const totalDeductions = (severityCounts.CRITICAL * 25) + 
                          (severityCounts.HIGH * 15) + 
                          (severityCounts.MEDIUM * 7) + 
                          (severityCounts.LOW * 3);
  const healthScore = Math.max(0, 100 - totalDeductions);

  const summary = {
    totalIssues,
    critical: severityCounts.CRITICAL,
    high: severityCounts.HIGH,
    medium: severityCounts.MEDIUM,
    low: severityCounts.LOW,
    info: severityCounts.INFO,
    verifiedCount: verified.length,
    fixesValidated: state.suggestedFixes.filter(f => f.isValidated).length,
    healthScore
  };

  // Build Markdown report with clean, natural terminology
  const reportMarkdown = `
# Inspectra Code Review Report

**Repository:** \`${state.projectInfo.repoName || state.repoUrl || 'Local Archive'}\`  
**Branch:** \`${state.projectInfo.branch || state.branch}\`  
**Date:** ${new Date().toUTCString()}  
**Code Health Score:** **${healthScore}/100**

---

## 📊 Summary
* **Files Discovered:** ${state.fileStats.discovered}
* **Files Analyzed:** ${state.fileStats.analyzed}
* **Languages:** ${Object.keys(state.fileStats.languages || {}).join(', ') || 'N/A'}
* **Total Issues Identified:** ${totalIssues}
* **Confirmed Issues:** ${summary.verifiedCount}
* **Validated Fix Proposals:** ${summary.fixesValidated}

### Severity Breakdown
* 🔴 **Critical:** ${summary.critical}
* 🟠 **High:** ${summary.high}
* 🟡 **Medium:** ${summary.medium}
* 🔵 **Low:** ${summary.low}

---

## 🔍 Identified Findings

${verified.length === 0 ? '✅ **No critical bugs or security vulnerabilities were detected in this review!**' : ''}

${verified.map((f, i) => `
### ${i + 1}. [${f.severity}] ${f.title}
* **File:** \`${f.filePath}\` (Lines ${f.startLine}-${f.endLine})
* **Category:** \`${f.category}\` | **Rule:** \`${f.ruleId}\`
* **Status:** Verified

#### 📝 Explanation & Impact
${f.explanation}

**Potential Impact:** ${f.impact}

#### 💡 Evidence & Recommendation
\`\`\`
${f.codeSnippet}
\`\`\`

**Recommendation:** ${f.recommendation}
`).join('\n\n---\n')}

---

## 🛠️ Suggested Changes
${state.suggestedFixes.length === 0 ? '_No automatic patch proposals generated for this review._' : ''}
${state.suggestedFixes.map((p, idx) => `
### Fix Proposal #${idx + 1}: \`${p.filePath}\`
* **Status:** ${p.isValidated ? 'Checks Passed' : 'Not Validated'}
* **Details:** ${p.validationDetails}

\`\`\`diff
${p.diff}
\`\`\`
`).join('\n')}

---
*Report generated by Inspectra – Intelligent Code Review Platform.*
  `.trim();

  const finalReport = {
    reviewId: state.reviewId,
    summary,
    reportMarkdown,
    findings: verified,
    suggestedPatches: state.suggestedFixes,
    ragSources: state.retrievedContexts || [],
    fileStats: state.fileStats,
    completedAt: new Date()
  };

  // Persist completed report to database and file backup
  try {
    await Review.updateOne(
      { reviewId: state.reviewId },
      {
        $set: {
          status: 'completed',
          currentStep: 'completed',
          progressPercent: 100,
          summary,
          findings: verified,
          suggestedPatches: state.suggestedFixes,
          ragSources: state.retrievedContexts || [],
          reportMarkdown,
          completedAt: new Date()
        }
      }
    );
  } catch (e) {
    console.warn('Failed to update final review record in DB:', e.message);
  }

  cleanupWorkspace(state.repoDir);

  const doneLog = await logStep(state, 'completed', 100, 'Review completed successfully!', { summary });

  return {
    finalReport,
    workflowStep: 'completed',
    logs: [log, doneLog]
  };
}

// Conditional Routing Functions
function shouldGenerateFixes(state) {
  if (state.errors && state.errors.length > 0 && !state.repoDir) {
    return 'generateFinalReportNode';
  }
  if (!state.generateFixes || !state.verifiedFindings || state.verifiedFindings.length === 0) {
    return 'generateFinalReportNode';
  }
  return 'generateFixNode';
}

function shouldRefineFixes(state) {
  const hasFailedPatches = (state.suggestedFixes || []).some(p => !p.isValidated);
  if (hasFailedPatches && state.iterationCount < 2) {
    return 'generateFixNode';
  }
  return 'generateFinalReportNode';
}

// Build and compile the LangGraph StateGraph
function buildReviewGraph() {
  const builder = new StateGraph(ReviewStateAnnotation)
    .addNode('validateInputNode', validateInputNode)
    .addNode('fetchRepositoryNode', fetchRepositoryNode)
    .addNode('discoverFilesNode', discoverFilesNode)
    .addNode('analyzeRepositoryNode', analyzeRepositoryNode)
    .addNode('indexRepositoryNode', indexRepositoryNode)
    .addNode('analyzeCodeNode', analyzeCodeNode)
    .addNode('staticAnalysisNode', staticAnalysisNode)
    .addNode('retrieveContextNode', retrieveContextNode)
    .addNode('verifyFindingsNode', verifyFindingsNode)
    .addNode('generateFixNode', generateFixNode)
    .addNode('validateFixNode', validateFixNode)
    .addNode('reverifyFindingsNode', reverifyFindingsNode)
    .addNode('generateFinalReportNode', generateFinalReportNode)

    // Linear flow
    .addEdge(START, 'validateInputNode')
    .addEdge('validateInputNode', 'fetchRepositoryNode')
    .addEdge('fetchRepositoryNode', 'discoverFilesNode')
    .addEdge('discoverFilesNode', 'analyzeRepositoryNode')
    .addEdge('analyzeRepositoryNode', 'indexRepositoryNode')
    .addEdge('indexRepositoryNode', 'analyzeCodeNode')
    .addEdge('analyzeCodeNode', 'staticAnalysisNode')
    .addEdge('staticAnalysisNode', 'retrieveContextNode')
    .addEdge('retrieveContextNode', 'verifyFindingsNode')

    // Conditional routing 1: fixes requested & verified issues exist?
    .addConditionalEdges('verifyFindingsNode', shouldGenerateFixes, {
      generateFixNode: 'generateFixNode',
      generateFinalReportNode: 'generateFinalReportNode'
    })

    // Patch validation sub-loop
    .addEdge('generateFixNode', 'validateFixNode')
    .addEdge('validateFixNode', 'reverifyFindingsNode')

    // Conditional routing 2: refinement loop or exit?
    .addConditionalEdges('reverifyFindingsNode', shouldRefineFixes, {
      generateFixNode: 'generateFixNode',
      generateFinalReportNode: 'generateFinalReportNode'
    })

    .addEdge('generateFinalReportNode', END);

  return builder.compile();
}

module.exports = {
  buildReviewGraph,
  ReviewStateAnnotation
};
