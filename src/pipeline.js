// src/pipeline.js
const topicSource = require('./topic-source');
const generator = require('./content-generator');
const verifier = require('./verifier');
const publisher = require('./fb-publisher');
const store = require('./store');
const logger = require('./logger');
const mediaAsset = require('./media-asset');

// Backoff sederhana untuk error transient — maksimum 2x retry (02-TECH-DESIGN.md §6).
const RETRY_BACKOFF_MS = [5000, 15000];

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Jalankan satu tahap pipeline dengan retry+backoff untuk error transient.
 * Error non-retryable (auth, parameter salah) langsung gagal tanpa retry.
 * Orchestrator (bukan modul individual) yang memutuskan retry — 03-CODE-PATTERNS.md §3.
 */
async function withRetry(stage, fn) {
  for (let attempt = 0; ; attempt++) {
    const startedAt = Date.now();
    try {
      const result = await fn();
      logger.info({ stage, status: 'ok', durationMs: Date.now() - startedAt }, `${stage} selesai`);
      return result;
    } catch (err) {
      const durationMs = Date.now() - startedAt;
      const canRetry = err.retryable && attempt < RETRY_BACKOFF_MS.length;
      if (canRetry) {
        const backoffMs = RETRY_BACKOFF_MS[attempt];
        logger.warn(
          { stage, status: 'retry', attempt: attempt + 1, durationMs, backoffMs, err: err.message },
          `${stage} gagal (transient), retry ke-${attempt + 1} setelah ${backoffMs}ms`
        );
        await sleep(backoffMs);
        continue;
      }
      logger.error(
        { stage, status: 'failed', durationMs, retryable: !!err.retryable, err: err.message },
        `${stage} gagal`
      );
      throw err;
    }
  }
}

/**
 * Jalankan satu siklus penuh: pilih topik -> generate -> verify -> publish -> log.
 * Satu-satunya tempat yang tahu urutan penuh pipeline (lihat 03-CODE-PATTERNS.md §4).
 * @returns {Promise<object>}
 */
async function runPipeline() {
  let topic = null;
  let draft = null;

  try {
    topic = await withRetry('topic-source', () => topicSource.pickTopic());
    if (!topic) {
      // Tidak ada topik baru yang tersedia — log dan keluar, bukan error.
      return { status: 'skipped', reason: 'no-topic-available' };
    }

    draft = await withRetry('generator', () => generator.generateCaption(topic));
    const verdict = await withRetry('verifier', () => verifier.verify(draft));

    if (!verdict.pass) {
      // mediaAsset.peek() cuma "mengintip" (read-only, tidak menghapus apa pun) — dipakai
      // di sini murni buat catatan audit, bukan indikasi file sudah dipakai.
      const previewAsset = mediaAsset.peek();
      await store.saveForReview(topic, draft, verdict.reasons, previewAsset.mode, previewAsset.fileName ?? null);
      return { status: 'held-for-review', reasons: verdict.reasons, topic, draft };
    }

    const result = await withRetry('publisher', () => publisher.publish(draft));
    await store.logPublished(topic, draft, result.fbPostId, result.mediaMode, result.mediaFile);
    return { status: 'published', fbPostId: result.fbPostId, mediaMode: result.mediaMode, topic, draft };
  } catch (err) {
    // Setiap kegagalan dicatat untuk audit — proses tidak boleh mati diam-diam (02-TECH-DESIGN.md §6).
    await store.logFailed(topic, draft, err);
    throw err;
  }
}

module.exports = { runPipeline };
