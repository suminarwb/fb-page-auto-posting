// src/content-generator.js
const fs = require('fs');
const path = require('path');
const llmClient = require('./llm-client');
const config = require('./config');
const { GenerationError, TransientGenerationError, isTransientCause } = require('./errors');

const STYLE_GUIDE = fs.readFileSync(path.join(__dirname, '../prompts/style-guide.md'), 'utf-8');
const SYSTEM_PROMPT = fs
  .readFileSync(path.join(__dirname, '../prompts/generator-system.md'), 'utf-8')
  .replace('{{STYLE_GUIDE}}', STYLE_GUIDE);

/**
 * Buang artefak markdown emphasis (**bold**, *italic*, __bold__, _italic_) yang
 * kadang lolos dari instruksi prompt — Facebook tidak render markdown, jadi tanda
 * ini cuma muncul sebagai karakter aneh di caption asli.
 * @param {string} text
 * @returns {string}
 */
function stripMarkdownEmphasis(text) {
  return text
    .replace(/\*\*(.+?)\*\*/g, '$1')
    .replace(/\*(.+?)\*/g, '$1')
    .replace(/__(.+?)__/g, '$1')
    .replace(/_(.+?)_/g, '$1');
}

/**
 * Generate draft caption storytelling untuk satu topik.
 * @param {{topicId: string, topicSummary: string, category: string, sourceUrl?: string}} topic
 * @returns {Promise<{text: string, topicId: string, category: string, characterCount: number, link: string|null}>}
 */
async function generateCaption(topic) {
  let result;
  try {
    result = await llmClient.complete({
      provider: config.llm.generatorProvider,
      model: config.llm.generatorModel,
      maxTokens: config.llm.maxTokens,
      system: SYSTEM_PROMPT,
      prompt: `Topik: ${topic.topicSummary}`,
    });
  } catch (err) {
    const message = `Gagal generate caption untuk topik "${topic.topicId}"`;
    throw isTransientCause(err)
      ? new TransientGenerationError(message, err)
      : new GenerationError(message, err);
  }

  const text = stripMarkdownEmphasis(result.text.trim());
  if (!text) {
    throw new GenerationError(`Caption kosong dihasilkan untuk topik "${topic.topicId}"`);
  }

  return {
    text,
    topicId: topic.topicId,
    category: topic.category,
    characterCount: text.length,
    // URL sumber berita dikirim terpisah (bukan ditempel ke teks) supaya Facebook men-scrape
    // dan menghasilkan kartu preview link — URL di dalam `message` cuma jadi teks biasa
    // yang dihyperlink, tidak pernah memicu kartu.
    link: topic.sourceUrl || null,
  };
}

module.exports = { generateCaption };
