// src/llm-client.js
// Satu-satunya modul yang boleh import SDK/panggil endpoint provider AI.
// Modul lain (content-generator.js, verifier.js) hanya boleh panggil complete().
const Anthropic = require('@anthropic-ai/sdk');
const OpenAI = require('openai');
const { GoogleGenAI } = require('@google/genai');
const config = require('./config');

// Client per provider dibuat lazy (bukan di top-level module load) supaya user yang
// cuma pakai satu provider tidak dipaksa isi secret provider lain yang tidak dipakai.
let anthropicClient;
let openaiClient;
let geminiClient;

function getAnthropicClient() {
  if (!anthropicClient) {
    anthropicClient = new Anthropic({ apiKey: config.getSecret('ANTHROPIC_API_KEY') });
  }
  return anthropicClient;
}

function getOpenAIClient() {
  if (!openaiClient) {
    openaiClient = new OpenAI({ apiKey: config.getSecret('OPENAI_API_KEY') });
  }
  return openaiClient;
}

function getGeminiClient() {
  if (!geminiClient) {
    geminiClient = new GoogleGenAI({ apiKey: config.getSecret('GEMINI_API_KEY') });
  }
  return geminiClient;
}

function extractAnthropicText(response) {
  return response.content
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('')
    .trim();
}

function extractGeminiText(interaction) {
  if (typeof interaction.output_text === 'string') {
    return interaction.output_text.trim();
  }
  // status "incomplete" berarti token budget habis (sering kepakai duluan oleh adaptive
  // thinking) sebelum sempat hasilkan output_text — jangan return string kosong diam-diam.
  throw new Error(
    `Gemini interaction tidak menghasilkan output_text (status: ${interaction.status}, ` +
      `thought_tokens: ${interaction.usage?.total_thought_tokens})`
  );
}

/**
 * Interface generik dipakai seluruh pipeline — bentuk ini tidak berubah
 * walau provider di baliknya berganti.
 * @param {object} input
 * @param {string} input.provider
 * @param {string} input.model
 * @param {string} input.system
 * @param {string} input.prompt
 * @param {number} input.maxTokens
 * @param {boolean} [input.jsonMode]
 * @returns {Promise<{ text: string }>}
 */
async function complete({ provider, model, system, prompt, maxTokens, jsonMode }) {
  if (provider === 'anthropic') {
    const response = await getAnthropicClient().messages.create({
      model,
      max_tokens: maxTokens,
      system,
      // jsonMode untuk Anthropic tidak diimplementasikan lewat parameter API khusus —
      // instruksi format JSON murni ada di system prompt (lihat prompts/verifier-system.md).
      // Caller (verifier.js) tetap wajib parse dengan try/catch, jangan andalkan provider 100% patuh.
      messages: [{ role: 'user', content: prompt }],
    });
    return { text: extractAnthropicText(response) };
  }

  if (provider === 'openai') {
    // Responses API — API utama openai-node saat ini (Chat Completions tetap didukung
    // tapi didokumentasikan sebagai API lama). https://github.com/openai/openai-node
    const response = await getOpenAIClient().responses.create({
      model,
      instructions: system,
      input: prompt,
      max_output_tokens: maxTokens,
      ...(jsonMode ? { text: { format: { type: 'json_object' } } } : {}),
    });
    return { text: response.output_text.trim() };
  }

  if (provider === 'gemini') {
    // Interactions API — API yang saat ini direkomendasikan Google, menggantikan
    // models.generateContent lama. https://ai.google.dev/gemini-api/docs/migrate-to-interactions
    // Catatan: model dengan adaptive thinking (mis. gemini-3.6-flash) memakai sebagian besar
    // token budget untuk "thinking" sebelum menghasilkan output_text — maxTokens perlu
    // cukup longgar (dites: ~1500 aman untuk caption 400-900 karakter), tidak bisa dimatikan
    // lewat parameter yang tersedia saat ini.
    const interaction = await getGeminiClient().interactions.create({
      model,
      system_instruction: system,
      input: prompt,
      generation_config: { max_output_tokens: maxTokens },
      ...(jsonMode ? { response_format: [{ type: 'text', mime_type: 'application/json' }] } : {}),
    });
    return { text: extractGeminiText(interaction) };
  }

  throw new Error(`Unknown LLM provider: ${provider}`);
}

/**
 * Interface generik untuk image generation — dipakai src/image-generator.js.
 * Terpisah dari complete() karena bentuk input/output beda (prompt teks -> gambar
 * biner, bukan teks -> teks), tapi tetap satu-satunya modul yang boleh panggil
 * SDK/endpoint provider AI, sesuai aturan keras project ini.
 * @param {object} input
 * @param {string} input.provider
 * @param {string} input.model
 * @param {string} input.prompt
 * @returns {Promise<{ imageBuffer: Buffer, mimeType: string }>}
 */
async function generateImage({ provider, model, prompt }) {
  if (provider === 'cloudflare') {
    const accountId = config.getSecret('CLOUDFLARE_ACCOUNT_ID');
    const apiToken = config.getSecret('CLOUDFLARE_API_TOKEN');

    const response = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/ai/run/${model}`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ prompt }),
      }
    );

    const body = await response.json().catch(() => null);
    if (!response.ok || body?.success === false) {
      const errMsg = body?.errors?.map((e) => e.message).join('; ') || `HTTP ${response.status}`;
      const err = new Error(`Cloudflare Workers AI error: ${errMsg}`);
      err.status = response.status; // dipakai isTransientCause() di errors.js untuk klasifikasi retry
      throw err;
    }

    const base64Image = body?.result?.image;
    if (!base64Image) {
      throw new Error('Cloudflare Workers AI tidak mengembalikan field result.image');
    }
    return { imageBuffer: Buffer.from(base64Image, 'base64'), mimeType: 'image/png' };
  }

  throw new Error(`Unknown image provider: ${provider}`);
}

module.exports = { complete, generateImage };
