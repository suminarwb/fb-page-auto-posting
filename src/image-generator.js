// src/image-generator.js
const fs = require('fs');
const path = require('path');
const llmClient = require('./llm-client');
const config = require('./config');
const {
  ImageGenerationError,
  TransientImageGenerationError,
  isTransientCause,
} = require('./errors');

const IMAGE_STYLE_GUIDE = fs.readFileSync(path.join(__dirname, '../prompts/image-style-guide.md'), 'utf-8');

const PROMPT_BUILDER_SYSTEM = `Kamu menerjemahkan topik storytelling gaming Bahasa Indonesia menjadi SATU prompt image-generation dalam Bahasa Inggris, mengikuti panduan visual berikut secara ketat:

---
${IMAGE_STYLE_GUIDE}
---

Balas HANYA dengan prompt image-gen-nya (Bahasa Inggris, satu paragraf singkat), tanpa penjelasan, tanpa label, tanpa tanda kutip, tanpa markdown fence.`;

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-+|-+$)/g, '')
    .slice(0, 60);
}

/**
 * Generate gambar untuk satu topik — dipakai fallback kalau assets/branding/ kosong
 * (lihat pipeline.js). Dua tahap: (1) LLM teks menerjemahkan topik + panduan visual
 * jadi satu prompt image-gen Bahasa Inggris, (2) provider image-gen generate gambarnya.
 * Kegagalan di tahap manapun melempar error typed — pipeline.js yang memutuskan
 * fallback ke teks-only, bukan modul ini.
 * @param {{topicId: string, topicSummary: string, category: string|null}} topic
 * @returns {Promise<{imageBuffer: Buffer, mimeType: string, fileName: string}>}
 */
async function generateImageForTopic(topic) {
  let promptResult;
  try {
    // Pakai provider/model verifier (bukan generator) — tugas "terjemahkan topik jadi
    // prompt image-gen" itu ringan/klasifikasi-ish, bukan creative writing, jadi cukup
    // pakai model yang sama dengan verifier (biasanya lebih ringan/murah).
    promptResult = await llmClient.complete({
      provider: config.llm.verifierProvider,
      model: config.llm.verifierModel,
      maxTokens: 300,
      system: PROMPT_BUILDER_SYSTEM,
      prompt: `Topik: ${topic.topicSummary}`,
    });
  } catch (err) {
    const message = 'Gagal membuat prompt image-gen dari topik';
    throw isTransientCause(err)
      ? new TransientImageGenerationError(message, err)
      : new ImageGenerationError(message, err);
  }

  const imagePrompt = promptResult.text.trim();
  if (!imagePrompt) {
    throw new ImageGenerationError('Prompt image-gen kosong dihasilkan');
  }

  let image;
  try {
    image = await llmClient.generateImage({
      provider: config.imageGeneration.provider,
      model: config.imageGeneration.model,
      prompt: imagePrompt,
    });
  } catch (err) {
    const message = 'Gagal generate gambar';
    throw isTransientCause(err)
      ? new TransientImageGenerationError(message, err)
      : new ImageGenerationError(message, err);
  }

  const ext = image.mimeType === 'image/png' ? 'png' : 'jpg';
  const fileName = `generated-${slugify(topic.topicId)}.${ext}`;

  return { ...image, fileName };
}

module.exports = { generateImageForTopic };
