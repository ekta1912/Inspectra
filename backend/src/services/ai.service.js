const path = require("path");
require("dotenv").config({ path: path.resolve(__dirname, "../../.env") });
require("dotenv").config();

const { ChatGoogle } = require("@langchain/google");
const { HumanMessage, SystemMessage } = require("@langchain/core/messages");

function getApiKey() {
    return process.env.GOOGLE_API_KEY || process.env.GEMINI_API_KEY || "";
}

function getCandidateGeminiModels() {
    return [
        process.env.GEMINI_MODEL,
        "gemini-2.5-flash",
        "gemini-2.0-flash",
        "gemini-1.5-flash",
        "gemini-1.5-pro"
    ].filter(Boolean);
}

async function generateContent(code, language) {
    const apiKey = getApiKey();
    if (!apiKey) {
        return "## ❌ Error\nBackend is running, but `GOOGLE_API_KEY` is not configured in `.env`. Please add your Google Gemini API key to proceed.";
    }

    // System instruction: Role and language verification
    const systemInstruction = `
You are an expert ${language} code reviewer. 
First, verify if the code is actually ${language}. If it is not, reply ONLY with this exact message and stop:
## ❌ Language Mismatch Detected
You selected **${language}**, but the provided code appears to be in a different language.
    `;

    // User Prompt: Template for code quality report
    const userPrompt = `
Here is the ${language} code to review:
\`\`\`${language}
${code}
\`\`\`

If the code is valid ${language}, you MUST output your review EXACTLY using the Markdown template below. 
DO NOT add any conversational text like "Alternatively..." or "Here is the review". 
DO NOT skip any headings. You MUST include Security and Test Cases even if the code is simple.

### 📊 Code Quality Report

#### 🐛 Bugs & Issues
(List bugs with 🔴 CRITICAL, 🟠 HIGH, 🟡 MEDIUM, 🔵 LOW. If none, write "✅ No major bugs found.")

#### ⚡ Complexity Analysis
* **Time Complexity:** 
* **Space Complexity:** 
* **Explanation:** 

#### 🔐 Security & Vulnerabilities
(Identify any security risks. If none, write "✅ No obvious security vulnerabilities detected.")

#### 🧪 Suggested Test Cases
* **Test Case 1 (Normal):** Input: [...], Expected: [...]
* **Test Case 2 (Edge Case):** Input: [...], Expected: [...]
* **Test Case 3 (Negative/Invalid):** Input: [...], Expected: [...]

#### ✨ Optimized & Refactored Code
\`\`\`${language}
(Provide the fully optimized code here)
\`\`\`
    `;

    let lastError = null;
    const candidateModels = [...new Set(getCandidateGeminiModels())];

    for (const modelName of candidateModels) {
        try {
            const chatGoogle = new ChatGoogle({
                apiKey,
                model: modelName,
                temperature: 0.1,
            });

            const response = await chatGoogle.invoke([
                new SystemMessage(systemInstruction),
                new HumanMessage(userPrompt)
            ]);

            const content = response.content;
            if (content) {
                // Return string representation
                return typeof content === 'string' ? content : JSON.stringify(content);
            }
        } catch (error) {
            lastError = error;
            console.warn(`Gemini model '${modelName}' attempt failed:`, error.message);
            // If model is not found, try fallback
            if (error?.status === 404 || error?.message?.includes("not found")) {
                continue;
            }
            break;
        }
    }

    console.error("Gemini API Error:", lastError?.message || lastError);
    return `## ❌ Error\nFailed to connect to Google Gemini API: ${lastError?.message || 'Connection failed'}\n\n*Please verify your \`GOOGLE_API_KEY\` in \`backend/.env\`.*`;
}

module.exports = generateContent;
