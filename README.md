# 🛡️ Inspectra – Intelligent Code Review Platform

> **Find bugs. Understand code. Ship with confidence.**

Inspectra is an enterprise-grade **Intelligent Code Review Platform** that elevates code reviews beyond generic chatbots into an authentic, context-aware repository intelligence system. Built on the **MERN** stack and powered by **Google Gemini API** (`@langchain/google`), **LangChain.js**, **LangGraph StateGraph**, **RAG (Retrieval-Augmented Generation)**, **Structured Tool Calling**, **Static Code Analysis (ESLint & AST security rules)**, and **Sandboxed Patch Validation**.

---

## 🌟 Key Capabilities & Review Modes

### Mode 1: Quick Code Review (Preserved & Enhanced)
* Fast, focused code snippet analysis for JavaScript, Python, C++, and Java.
* Real-time detection of bugs, time & space complexity evaluation, security risks, test case generation, and clean refactored output.
* Powered by Google Gemini (`gemini-2.5-flash`) via the official `@langchain/google` integration.
* Preserves 100% backward compatibility with existing API endpoints (`POST /ai/get-review`).

### Mode 2: Repository Review
* **Dual Ingestion**: Analyze any public GitHub repository via URL (`--depth 1` shallow clone) or upload repository ZIP archives (up to 50MB).
* **Review Focus Profiles**: Customizable review modes:
  - *Comprehensive*: Full-spectrum logic, security, performance, and architecture audit.
  - *Bugs & Logic*: Runtime edge cases, boundary conditions, unhandled exceptions.
  - *Security & OWASP*: Command injection, dangerous evaluation, hardcoded credentials, path traversal, deserialization flaws.
  - *Performance*: Event loop blocking sync I/O, algorithmic complexity, async bottlenecks.
  - *Code Quality*: ESLint standards, dead code, maintainability.
* **LangGraph 13-Node Workflow**: Managed StateGraph with conditional branching, telemetry broadcasting, and bounded refinement loops.
* **Authentic Tool Calling**: Gemini executes real structured tools with Zod input/output schemas.
* **Sandboxed Patch Validation**: Proposed diffs are validated in isolated temporary workspaces with syntax verification and zero risk to the original repository.
* **Human-Centered Progress Stages**: 9 natural review stages:
  1. Preparing your review
  2. Opening project files
  3. Understanding project structure
  4. Checking source code
  5. Reviewing dependencies
  6. Looking for potential issues
  7. Checking identified findings
  8. Reviewing suggested changes
  9. Preparing your report
* **Data-Driven Code Health Scoring**:
  - Baseline 100 points with severity deductions: Critical (-25), High (-15), Medium (-7), Low (-3).
  - Displays `N/A` if no completed reviews exist. Never defaults to an unearned 100/100.
* **Truthful Statuses**:
  - Fixes labeled "Suggested Fix", showing "Checks Passed" only when verified in the sandbox.
  - Actionable "Apply Changes" button requiring explicit user confirmation before applying.

---

## 🏛️ System Architecture

```
                               +------------------------------------------+
                               |         Inspectra Modern Web UI          |
                               |  (Vite + React 19 + Prism + Lucide SaaS) |
                               +--------------------+---------------------+
                                                    |
                             +----------------------+----------------------+
                             |                                             |
                      [Quick Review]                             [Repository Audit]
                      - Snippet Input                            - GitHub URL / ZIP
                      - Instant Analysis                         - Live SSE Stream
                      - Markdown Output                          - Findings & Diffs
                             |                                             |
                             +----------------------+----------------------+
                                                    |
                                           +--------v---------+
                                           |  Express Backend |
                                           |  (Node.js v22)   |
                                           +--------+---------+
                                                    |
             +--------------------------------------+--------------------------------------+
             |                                                                             |
+------------v-------------------+                           +-----------------------------v---------------------+
|      LangGraph StateGraph      |                           |          Persistent Storage & RAG DB              |
|  1. validateInputNode          |                           | - MongoDB Mongoose Review & Chunk Models          |
|  2. fetchRepositoryNode        |                           | - Resilient File Storage (.devpilot_storage/)     |
|  3. discoverFilesNode          |                           | - Language-Aware Chunker (RecursiveSplitter)      |
|  4. analyzeRepositoryNode      |                           | - Deterministic 384-dim Dense Embeddings / Gemini |
|  5. indexRepositoryNode        |                           +---------------------------------------------------+
|  6. analyzeCodeNode            |                                                     |
|  7. staticAnalysisNode         |                           +-------------------------v-------------------------+
|  8. retrieveContextNode        | <------------------------ |            7 LangChain Structured Tools           |
|  9. verifyFindingsNode         |                           | 1. list_repository_files                          |
| 10. generateFixNode            |                           | 2. read_repository_file                           |
| 11. validateFixNode            |                           | 3. search_repository_code                         |
| 12. reverifyFindingsNode       |                           | 4. retrieve_repository_context                    |
| 13. generateFinalReportNode    |                           | 5. run_static_analysis                            |
+--------------------------------+                           | 6. validate_suggested_patch                       |
                                                             | 7. inspect_dependencies                          |
                                                             +---------------------------------------------------+
```

---

## 🔄 LangGraph StateGraph Workflow (13 Nodes)

The repository workflow executes as a compiled `StateGraph` with bounded verification loops:

```
START
  |
  v
validateInputNode ───────> Validates GitHub URL, SSRF checks, ZIP safety
  |
  v
fetchRepositoryNode ────> Clones shallow repo or extracts ZIP with Zip Slip prevention
  |
  v
discoverFilesNode ──────> Filters node_modules/.git/binaries, redacts secrets
  |
  v
analyzeRepositoryNode ──> Parses package manifests, dependencies & frameworks
  |
  v
indexRepositoryNode ────> Language-aware chunking & vector store indexing
  |
  v
analyzeCodeNode ────────> Code exploration using bound LangChain tools
  |
  v
staticAnalysisNode ─────> Runs real ESLint & AST security rules
  |
  v
retrieveContextNode ────> Semantic RAG similarity search for detected issues
  |
  v
verifyFindingsNode ─────> Cross-references AST evidence to eliminate false positives
  |
  +─────────── Decision: Verified findings exist & Fix generation enabled?
  |            ├── No  ──────────────────────────────────────────┐
  |            └── Yes                                           │
  v                                                              │
generateFixNode ────────> Generates unified diff patch proposals │
  |                                                              │
  v                                                              │
validateFixNode ────────> Tests patch syntax in isolated sandbox │
  |                                                              │
  v                                                              │
reverifyFindingsNode ───> Re-evaluates resolution status         │
  |                                                              │
  +─────────── Decision: Failed patches & Iteration < 2?         │
  |            ├── Yes ──> Route back to generateFixNode         │
  |            └── No  ──> Route to Final Report                 │
  |                                                              │
  v <────────────────────────────────────────────────────────────┘
generateFinalReportNode ─> Computes health score, Markdown report & cleanup
  |
  v
 END
```

---

## 🛠️ LangChain Structured Tools

The agent invokes 7 validated tools defined with `@langchain/core/tools` and `zod`:

1. `list_repository_files`: Catalogs supported repository files with line counts, language, and file size.
2. `read_repository_file`: Safely reads a target file with line range coordinates while blocking path traversal.
3. `search_repository_code`: Identifier, function, and keyword search across all indexed repository files.
4. `retrieve_repository_context`: Vector database semantic similarity search for cross-file context.
5. `run_static_analysis`: Executes ESLint and security AST pattern rules on a file or entire repository.
6. `validate_suggested_patch`: Tests proposed patches in an isolated sandbox copy without touching the original codebase.
7. `inspect_dependencies`: Scans `package.json` and `requirements.txt` for known outdated or vulnerable dependencies.

---

## 🔍 Static Code Analysis Engine

Inspectra integrates a dual-tier static analysis engine:
1. **ESLint Integration**: Programmatic JavaScript/TypeScript linting for syntax errors, debugger statements, and unused symbols.
2. **AST & Security Rule Registry**: Predefined, zero-shell pattern analyzers matching:
   - `SEC-001`: Dangerous `eval()` and `new Function()` code execution.
   - `SEC-002`: Command injection in `child_process.exec()`.
   - `SEC-003`: Python subprocess execution with `shell=True`.
   - `SEC-004`: Unsafe deserialization via `pickle` or `yaml.load()`.
   - `SEC-005`: Unvalidated file path traversal in I/O operations.
   - `SEC-006`: Overly permissive CORS with credentials (`origin: "*"`).
   - `SEC-007`: Hardcoded credentials, private keys, and API tokens.
   - `QUAL-001`: Async functions lacking error handling.
   - `PERF-001`: Event-loop blocking synchronous I/O in server paths.

All static findings are normalized into a unified schema and verified by the verification node against the actual source code.

---

## 🔒 Security Safeguards & Reliability

* **Zero Arbitrary Execution**: Inspectra never executes submitted code on the server.
* **Zip Slip Protection**: Sanitizes all archive entries against `..`, absolute paths, drive letters, and symlinks.
* **SSRF Prevention**: Strict allowlist for `https://github.com/` URLs; private IPs and localhost are blocked.
* **Automatic Secret Redaction**: Masks AWS keys, GitHub tokens, Google API keys, private keys, and API secrets before indexing or sending to the LLM.
* **Isolated Patch Sandboxing**: Patch validation operates on ephemeral copies in `os.tmpdir()` and automatically cleans up upon completion.
* **Resilient Storage Fallback**: Connects to MongoDB if configured, with automatic fallback to persistent local JSON storage in `.devpilot_storage/` for offline and standalone operation.

---

## 🚀 Quickstart & Installation

### Prerequisites
* Node.js v18+ (tested on Node.js v22.16)
* Git installed and on PATH
* A Google Gemini API key from [Google AI Studio](https://aistudio.google.com/)

### 1. Clone & Setup Backend
```bash
cd backend
npm install
```

Configure your environment:
```bash
cp .env.example .env
```
Edit `backend/.env` with your Google Gemini API key:
```env
PORT=3000
GOOGLE_API_KEY=your_gemini_api_key_here
GEMINI_MODEL=gemini-2.5-flash
MONGODB_URI=mongodb://127.0.0.1:27017/inspectra
EMBEDDING_PROVIDER=local
```

### 2. Setup Frontend
```bash
cd ../Frontend
npm install
```

### 3. Run the Platform

Start Backend:
```bash
cd backend
npm start
# Server runs on http://localhost:3000
```

Start Frontend (in a separate terminal):
```bash
cd Frontend
npm run dev
# Frontend runs on http://localhost:5173
```

---

## 🧪 Testing & Verification

Inspectra includes an automated test suite verifying all operational requirements:

```bash
cd backend
npm test
```

### Verified Test Suites (14 Tests, 7 Suites):
* `Express API Integration Suite`: Preserved Quick Review `POST /ai/get-review`, Health check, and Repo Review endpoints.
* `Sample Repository Fixture E2E Verification`: Real end-to-end audit on `fixtures/sample-repo`.
* `LangGraph StateGraph End-to-End Workflow`: 13-node pipeline execution, patch validation, and report compilation.
* `LangChain RAG & Vector Store Suite`: Language-aware chunking with line numbers, embeddings, and similarity search.
* `Security & Sanitization Suite`: Secret redaction, GitHub URL validation, and Zip Slip prevention.
* `Static Code Analysis Suite`: Detection of dangerous eval, command injection, and credentials.
* `LangChain Structured Tools Suite`: Execution of all 7 repository inspection tools.

---

## 📦 Project Structure

```
├── backend/
│   ├── src/
│   │   ├── app.js                          # Express application & route mounts
│   │   ├── config/db.js                    # MongoDB connection with persistent fallback
│   │   ├── controllers/
│   │   │   ├── ai.controller.js            # Preserved Quick Review controller
│   │   │   └── repoReview.controller.js    # Repository Review controller & SSE stream
│   │   ├── models/
│   │   │   └── review.model.js             # Mongoose & persistent file review storage
│   │   ├── routes/
│   │   │   ├── ai.routes.js                # /ai/get-review
│   │   │   └── repoReview.routes.js        # /ai/repo-review/*
│   │   ├── services/
│   │   │   ├── agent/
│   │   │   │   ├── eventBus.js             # SSE progress telemetry bus
│   │   │   │   ├── graph.js                # LangGraph 13-node StateGraph
│   │   │   │   └── tools.js                # 7 LangChain structured tools
│   │   │   ├── analysis/
│   │   │   │   └── staticAnalyzer.service.js # ESLint & security AST rules
│   │   │   ├── rag/
│   │   │   │   ├── chunker.service.js      # Language-aware splitter with lines
│   │   │   │   ├── embedding.service.js    # 384-dim dense vectorizer / Gemini
│   │   │   │   └── vectorStore.service.js  # Persistent vector database
│   │   │   ├── repo/
│   │   │   │   └── repoFetcher.service.js  # Git clone, safe zip extraction & cataloging
│   │   │   └── ai.service.js               # Google Gemini quick review service
│   │   └── utils/
│   │       └── security.js                 # Secret redaction, SSRF, Zip Slip filters
│   ├── test/                               # 7 comprehensive test suites
│   ├── .env.example
│   ├── package.json
│   └── server.js
├── Frontend/
│   ├── src/
│   │   ├── components/
│   │   │   ├── Navbar.jsx                  # Header with engine health status
│   │   │   ├── Dashboard.jsx               # SaaS dashboard with recent reviews
│   │   │   ├── QuickReview.jsx             # Preserved code snippet editor & review
│   │   │   ├── RepoInput.jsx               # GitHub URL / ZIP submission form
│   │   │   ├── LiveProgress.jsx            # 9-stage human review timeline & activity log
│   │   │   ├── ReviewResults.jsx           # Findings explorer, filters & details
│   │   │   └── DiffViewer.jsx              # Colorized additions/deletions diff viewer
│   │   ├── services/api.js                 # API client with auto host resolution
│   │   ├── App.jsx                         # Main view router
│   │   ├── App.css                         # Professional SaaS dark theme
│   │   └── main.jsx
│   ├── package.json
│   └── vite.config.js
├── fixtures/
│   └── sample-repo/                        # Test repository fixture with logic/security flaws
├── .env.example
└── README.md
```

---

## 📄 License
ISC License. Built for modern software engineering teams.
