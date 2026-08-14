// src/store.js
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

const DB_PATH = path.join(__dirname, '../data/stik-satu.db');
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true });

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS posts_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    topicId TEXT,
    category TEXT,
    caption TEXT,
    status TEXT NOT NULL, -- published | failed | review
    fbPostId TEXT,
    reasons TEXT,          -- JSON array, diisi kalau status = review
    errorMessage TEXT,     -- diisi kalau status = failed
    createdAt TEXT NOT NULL
  );
`);

// Migrasi ringan: tambah kolom baru kalau db lama (Fase 1/2) belum punya —
// SQLite tidak punya "ADD COLUMN IF NOT EXISTS", jadi dicek manual dulu.
const existingColumns = db.prepare(`PRAGMA table_info(posts_history)`).all().map((c) => c.name);
if (!existingColumns.includes('mediaMode')) {
  db.exec(`ALTER TABLE posts_history ADD COLUMN mediaMode TEXT`); // none | image | video
}
if (!existingColumns.includes('mediaFile')) {
  // Nama file asli yang dipakai (dari assets/branding/) — dicatat karena filenya
  // dihapus setelah dipost, jadi ini satu-satunya jejak lokal soal file apa yang dipakai.
  db.exec(`ALTER TABLE posts_history ADD COLUMN mediaFile TEXT`);
}

/**
 * Ambil topicId yang dipakai dalam N hari terakhir (untuk dedupe).
 * @param {number} windowDays
 * @returns {Promise<string[]>}
 */
async function getRecentTopicIds(windowDays) {
  const cutoff = new Date(Date.now() - windowDays * 24 * 60 * 60 * 1000).toISOString();
  const rows = db
    .prepare(`SELECT DISTINCT topicId FROM posts_history WHERE createdAt >= ? AND status != 'failed'`)
    .all(cutoff);
  return rows.map((r) => r.topicId);
}

/**
 * Simpan draft yang gagal self-verify untuk direview manual.
 * @param {object} topic
 * @param {object} draft
 * @param {string[]} reasons
 * @param {string} [mediaMode] mode yang akan dipakai kalau lolos verify (informational,
 *   belum benar-benar dipakai — publish tidak pernah dipanggil di jalur ini)
 * @param {string|null} [mediaFile]
 * @returns {Promise<object>}
 */
async function saveForReview(topic, draft, reasons, mediaMode = 'none', mediaFile = null) {
  const info = db
    .prepare(
      `INSERT INTO posts_history (topicId, category, caption, status, reasons, mediaMode, mediaFile, createdAt)
       VALUES (?, ?, ?, 'review', ?, ?, ?, ?)`
    )
    .run(
      topic.topicId,
      topic.category ?? null,
      draft.text,
      JSON.stringify(reasons ?? []),
      mediaMode,
      mediaFile,
      new Date().toISOString()
    );
  return { id: info.lastInsertRowid };
}

/**
 * Catat post yang berhasil dipublish.
 * @param {object} topic
 * @param {object} draft
 * @param {string} fbPostId
 * @param {string} [mediaMode] "none" | "image" | "video" — mode yang benar-benar dipakai
 * @param {string|null} [mediaFile] nama file asli dari assets/branding/ yang dipakai (sudah dihapus)
 * @returns {Promise<object>}
 */
async function logPublished(topic, draft, fbPostId, mediaMode = 'none', mediaFile = null) {
  const info = db
    .prepare(
      `INSERT INTO posts_history (topicId, category, caption, status, fbPostId, mediaMode, mediaFile, createdAt)
       VALUES (?, ?, ?, 'published', ?, ?, ?, ?)`
    )
    .run(topic.topicId, topic.category ?? null, draft.text, fbPostId, mediaMode, mediaFile, new Date().toISOString());
  return { id: info.lastInsertRowid };
}

/**
 * Catat run yang gagal (error di stage manapun) untuk audit.
 * @param {object} topic
 * @param {object|null} draft
 * @param {Error} error
 * @returns {Promise<object>}
 */
async function logFailed(topic, draft, error) {
  const info = db
    .prepare(
      `INSERT INTO posts_history (topicId, category, caption, status, errorMessage, createdAt)
       VALUES (?, ?, ?, 'failed', ?, ?)`
    )
    .run(
      topic?.topicId ?? null,
      topic?.category ?? null,
      draft?.text ?? null,
      error?.message ?? String(error),
      new Date().toISOString()
    );
  return { id: info.lastInsertRowid };
}

module.exports = { getRecentTopicIds, saveForReview, logPublished, logFailed };
