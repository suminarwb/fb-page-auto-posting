// src/verifier.js
const fs = require('fs');
const path = require('path');
const llmClient = require('./llm-client');
const config = require('./config');
const { VerificationFailed, TransientVerificationError, isTransientCause } = require('./errors');

const STYLE_GUIDE = fs.readFileSync(path.join(__dirname, '../prompts/style-guide.md'), 'utf-8');
const SYSTEM_PROMPT = fs
  .readFileSync(path.join(__dirname, '../prompts/verifier-system.md'), 'utf-8')
  .replace('{{STYLE_GUIDE}}', STYLE_GUIDE);

function safeJsonParse(text) {
  try {
    return JSON.parse(text);
  } catch {
    return null;
  }
}

/**
 * Self-verify draft caption sebelum boleh dipublish.
 * Guardrail: kalau output tidak bisa di-parse atau bentuknya tidak sesuai, default pass: false
 * (fail-safe, bukan fail-open) — lihat 03-CODE-PATTERNS.md §7.
 * @param {{text: string}} draft
 * @returns {Promise<{pass: boolean, reasons: string[]}>}
 */
async function verify(draft) {
  let result;
  try {
    result = await llmClient.complete({
      provider: config.llm.verifierProvider,
      model: config.llm.verifierModel,
      maxTokens: 300,
      system: SYSTEM_PROMPT,
      prompt: draft.text,
      jsonMode: true,
    });
  } catch (err) {
    throw isTransientCause(err)
      ? new TransientVerificationError('Gagal memanggil verifier LLM', err)
      : new VerificationFailed('Gagal memanggil verifier LLM', err);
  }

  const parsed = safeJsonParse(result.text);
  if (!parsed || typeof parsed.pass !== 'boolean') {
    return { pass: false, reasons: ['verifier-output-unparseable'] };
  }

  return {
    pass: parsed.pass,
    reasons: Array.isArray(parsed.reasons) ? parsed.reasons : [],
  };
}

module.exports = { verify };
