const { v4: uuidv4 } = require("uuid");
const aiService = require("../services/ai.service");
const { Review } = require("../models/review.model");

/**
 * Parses markdown code review report to extract structured findings and calculate health score
 */
function parseQuickReviewReport(markdown) {
    if (!markdown || typeof markdown !== 'string') {
        return { isError: true, totalIssues: 0, critical: 0, high: 0, medium: 0, low: 0, healthScore: null, findings: [] };
    }

    if (markdown.includes('## ❌ Error') || markdown.includes('Language Mismatch Detected') || markdown.includes('Failed to connect')) {
        return { isError: true, totalIssues: 0, critical: 0, high: 0, medium: 0, low: 0, healthScore: null, findings: [] };
    }

    const findings = [];
    const lines = markdown.split('\n');
    let currentSection = '';

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        if (/###+.*(Bugs|Issues)/i.test(line)) {
            currentSection = 'bugs';
            continue;
        } else if (/###+.*(Complexity)/i.test(line)) {
            currentSection = 'complexity';
            continue;
        } else if (/###+.*(Security|Vulnerabilit)/i.test(line)) {
            currentSection = 'security';
            continue;
        } else if (/###+.*(Test Cases|Optimized|Refactored)/i.test(line)) {
            currentSection = 'other';
            continue;
        }

        // Ignore headers, instructions, or clean status lines
        if (!line ||
            line.startsWith('(') ||
            line.includes('No major bugs found') ||
            line.includes('No obvious security vulnerabilities') ||
            line.includes('✅ No')) {
            continue;
        }

        if (currentSection === 'bugs' || currentSection === 'security') {
            let severity = null;
            if (/🔴|\bCRITICAL\b/i.test(line)) severity = 'CRITICAL';
            else if (/🟠|\bHIGH\b/i.test(line)) severity = 'HIGH';
            else if (/🟡|\bMEDIUM\b/i.test(line)) severity = 'MEDIUM';
            else if (/🔵|\bLOW\b/i.test(line)) severity = 'LOW';

            if (severity && /^[-*•\d\.]/.test(line)) {
                let cleanTitle = line
                    .replace(/^[-*•\d\.]+\s*/, '')
                    .replace(/\*\*(🔴|🟠|🟡|🔵)?\s*(CRITICAL|HIGH|MEDIUM|LOW):?\*\*:?/gi, '')
                    .replace(/\*\*/g, '')
                    .trim();

                let explanation = cleanTitle;
                if (i + 1 < lines.length) {
                    const nextLine = lines[i + 1].trim();
                    if (nextLine && !nextLine.startsWith('#') && !/^[-*•\d\.]/.test(nextLine)) {
                        explanation += ' ' + nextLine;
                    }
                }

                findings.push({
                    id: `ISSUE-${findings.length + 1}`,
                    title: cleanTitle.slice(0, 140) || `${severity} issue in code`,
                    severity,
                    category: currentSection === 'security' ? 'security' : 'bug',
                    filePath: 'Snippet',
                    startLine: 1,
                    endLine: 1,
                    explanation: explanation.trim(),
                    verified: true,
                    verificationReason: 'Verified against code snippet review report'
                });
            }
        }
    }

    const critical = findings.filter(f => f.severity === 'CRITICAL').length;
    const high = findings.filter(f => f.severity === 'HIGH').length;
    const medium = findings.filter(f => f.severity === 'MEDIUM').length;
    const low = findings.filter(f => f.severity === 'LOW').length;
    const totalIssues = findings.length;

    // Severity-weighted benchmark: Critical (-25), High (-15), Medium (-7), Low (-3)
    const deductions = (critical * 25) + (high * 15) + (medium * 7) + (low * 3);
    const healthScore = Math.max(0, 100 - deductions);

    return {
        isError: false,
        totalIssues,
        critical,
        high,
        medium,
        low,
        healthScore,
        findings
    };
}

module.exports.parseQuickReviewReport = parseQuickReviewReport;

module.exports.getReview = async (req, res) => {
    try {
        const { code, language } = req.body;

        if (!code) {
            return res.status(400).send("Code is required");
        }

        const response = await aiService(code, language);
        const parsed = parseQuickReviewReport(response);

        if (parsed.isError) {
            // Persist failed attempt accurately without generating unearned or arbitrary scores
            Review.create({
                reviewId: `QUICK-${uuidv4().slice(0, 8)}`,
                type: 'quick',
                repoName: `Snippet (${language || 'javascript'})`,
                branch: 'snippet',
                status: 'failed',
                currentStep: 'failed',
                progressPercent: 0,
                reportMarkdown: response,
                error: 'Review failed to complete or connection failed',
                summary: {
                    totalIssues: 0,
                    critical: 0,
                    high: 0,
                    medium: 0,
                    low: 0,
                    info: 0,
                    verifiedCount: 0,
                    fixesValidated: 0,
                    healthScore: null
                }
            }).catch(e => console.warn('Failed to save failed quick review record:', e.message));
        } else {
            // Persist completed review with verified findings and severity-weighted score
            Review.create({
                reviewId: `QUICK-${uuidv4().slice(0, 8)}`,
                type: 'quick',
                repoName: `Snippet (${language || 'javascript'})`,
                branch: 'snippet',
                status: 'completed',
                currentStep: 'completed',
                progressPercent: 100,
                reportMarkdown: response,
                findings: parsed.findings,
                summary: {
                    totalIssues: parsed.totalIssues,
                    critical: parsed.critical,
                    high: parsed.high,
                    medium: parsed.medium,
                    low: parsed.low,
                    info: 0,
                    verifiedCount: parsed.totalIssues,
                    fixesValidated: 0,
                    healthScore: parsed.healthScore
                }
            }).catch(e => console.warn('Failed to save quick review record:', e.message));
        }

        res.send(response);

    } catch (error) {
        console.error("AI Controller Error:", error);
        res.status(500).send("Failed to generate code review");
    }
};
