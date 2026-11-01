const { RecursiveCharacterTextSplitter } = require('@langchain/textsplitters');
const { v4: uuidv4 } = require('uuid');

const SUPPORTED_LANGUAGES = {
  '.js': 'js',
  '.jsx': 'js',
  '.ts': 'js',
  '.tsx': 'js',
  '.py': 'python',
  '.java': 'java',
  '.cpp': 'cpp',
  '.c': 'cpp',
  '.h': 'cpp',
  '.go': 'go',
  '.md': 'markdown',
  '.html': 'html'
};

/**
 * Calculates 1-based start and end line numbers for a chunk within original file text
 */
function calculateLineNumbers(fullContent, chunkContent, searchStartIndex = 0) {
  const index = fullContent.indexOf(chunkContent.trim(), searchStartIndex);
  if (index === -1) {
    return { startLine: 1, endLine: 1, nextIndex: searchStartIndex };
  }
  const before = fullContent.slice(0, index);
  const startLine = before.split('\n').length;
  const chunkLines = chunkContent.split('\n').length;
  const endLine = startLine + chunkLines - 1;
  return { startLine, endLine, nextIndex: index + chunkContent.length };
}

/**
 * Splits source file into language-aware chunks with metadata
 */
async function chunkFile({ filePath, content, repositoryId, language }) {
  if (!content || typeof content !== 'string') return [];

  const ext = Object.keys(SUPPORTED_LANGUAGES).find(e => filePath.toLowerCase().endsWith(e));
  const langKey = ext ? SUPPORTED_LANGUAGES[ext] : null;

  let splitter;
  if (langKey) {
    try {
      splitter = RecursiveCharacterTextSplitter.fromLanguage(langKey, {
        chunkSize: 1200,
        chunkOverlap: 200,
      });
    } catch (e) {
      splitter = new RecursiveCharacterTextSplitter({
        chunkSize: 1200,
        chunkOverlap: 200,
      });
    }
  } else {
    splitter = new RecursiveCharacterTextSplitter({
      chunkSize: 1200,
      chunkOverlap: 200,
    });
  }

  const rawDocs = await splitter.createDocuments([content]);
  let searchIdx = 0;

  const chunks = rawDocs.map((doc, idx) => {
    const chunkText = doc.pageContent;
    const { startLine, endLine, nextIndex } = calculateLineNumbers(content, chunkText, searchIdx);
    searchIdx = nextIndex;

    return {
      chunkId: `${repositoryId}_${Buffer.from(filePath).toString('base64').slice(0, 16)}_${idx}_${uuidv4().slice(0, 6)}`,
      repositoryId,
      filePath,
      language: language || (ext ? ext.replace('.', '') : 'unknown'),
      startLine,
      endLine,
      content: chunkText,
      charLength: chunkText.length
    };
  });

  return chunks;
}

module.exports = {
  chunkFile,
  SUPPORTED_LANGUAGES
};

