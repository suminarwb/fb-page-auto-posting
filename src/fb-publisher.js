// src/fb-publisher.js
// Satu-satunya modul yang boleh panggil Facebook Graph API.
const fs = require('fs');
const path = require('path');
const config = require('./config');
const logger = require('./logger');
const mediaAsset = require('./media-asset');
const { PublishError, TransientPublishError } = require('./errors');

// Kode error Graph API — lihat 04-API-INTEGRATION.md §2.3
const RETRYABLE_FB_ERROR_CODES = new Set([4, 17]); // rate limit
const NON_RETRYABLE_FB_ERROR_CODES = new Set([190, 100]); // token invalid, parameter invalid
// code 6000 (video upload generic) dengan subcode ini eksplisit disarankan Facebook
// sendiri untuk di-retry ("Please wait a few minutes and try again") — dikonfirmasi
// nyata: request yang identik gagal lalu berhasil tanpa perubahan apa pun di kode kita.
const RETRYABLE_VIDEO_SUBCODES = new Set([1363019, 1363021]);

const MIME_TYPES = { '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png', '.gif': 'image/gif', '.bmp': 'image/bmp', '.tiff': 'image/tiff', '.mp4': 'video/mp4', '.mov': 'video/quicktime' };
const MAX_IMAGE_BYTES = 4 * 1024 * 1024; // batas 4MB — Graph API reference untuk /photos

function guessMimeType(fileName) {
  return MIME_TYPES[path.extname(fileName).toLowerCase()] || 'application/octet-stream';
}

function deleteAssetAfterPublish(absolutePath, fileName) {
  try {
    mediaAsset.remove(absolutePath);
    logger.info({ stage: 'publisher', status: 'asset-deleted', fileName }, `File "${fileName}" dihapus dari assets/branding setelah berhasil dipost`);
  } catch (err) {
    // Post-nya sendiri sudah berhasil di FB — kegagalan hapus file tidak boleh
    // dianggap kegagalan publish, cukup di-warn supaya kelihatan di log.
    logger.warn({ stage: 'publisher', status: 'asset-delete-failed', fileName, err: err.message }, `Gagal menghapus file "${fileName}" setelah publish`);
  }
}

function classifyAndThrow(status, body) {
  const fbError = body && body.error;
  const message = fbError?.message || `Facebook Graph API error (HTTP ${status})`;
  const code = fbError?.code;
  const subcode = fbError?.error_subcode;

  if (NON_RETRYABLE_FB_ERROR_CODES.has(code)) {
    throw new PublishError(message, fbError);
  }
  if (RETRYABLE_FB_ERROR_CODES.has(code) || status >= 500 || (code === 6000 && RETRYABLE_VIDEO_SUBCODES.has(subcode))) {
    throw new TransientPublishError(message, fbError);
  }
  // Kode tidak dikenal: default non-retryable (fail-safe, jangan asumsikan aman diulang).
  throw new PublishError(message, fbError);
}

/**
 * Panggil Graph API dan kembalikan body JSON-nya. Melempar error terklasifikasi
 * (retryable/non-retryable) kalau gagal — dipakai semua mode publish di bawah.
 */
async function callGraphApi(url, options) {
  let response;
  try {
    response = await fetch(url, options);
  } catch (err) {
    // Kegagalan level-jaringan (timeout, DNS, dll) — transient.
    throw new TransientPublishError('Gagal menghubungi Facebook Graph API', err);
  }

  const body = await response.json().catch(() => null);
  if (!response.ok) {
    classifyAndThrow(response.status, body);
  }
  return body;
}

async function publishText(draft, ctx) {
  const params = { message: draft.text, access_token: ctx.accessToken };
  // `link` sebagai field terpisah (bukan ditempel ke `message`) supaya Facebook men-scrape
  // URL-nya dan menampilkan kartu preview (gambar+judul+deskripsi dari OG tags sumbernya).
  if (draft.link) params.link = draft.link;

  const body = await callGraphApi(`https://graph.facebook.com/${ctx.graphApiVersion}/${ctx.pageId}/feed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });
  if (!body?.id) throw new PublishError('Response Facebook tidak berisi id post');
  return { fbPostId: body.id, mediaMode: 'none', mediaFile: null };
}

async function publishImage(draft, ctx, asset) {
  const stat = fs.statSync(asset.absolutePath);
  if (stat.size > MAX_IMAGE_BYTES) {
    throw new PublishError(`File gambar "${asset.fileName}" melebihi batas 4MB Facebook (${stat.size} bytes)`);
  }

  const fileBuffer = fs.readFileSync(asset.absolutePath);
  const formData = new FormData();
  formData.append('source', new Blob([fileBuffer], { type: guessMimeType(asset.fileName) }), asset.fileName);
  // /photos tidak punya mekanisme kartu link seperti /feed — kalau ada draft.link,
  // tempel sebagai teks biasa di caption supaya URL sumbernya tidak hilang.
  formData.append('caption', draft.link ? `${draft.text}\n\n${draft.link}` : draft.text);
  formData.append('access_token', ctx.accessToken);

  const body = await callGraphApi(`https://graph.facebook.com/${ctx.graphApiVersion}/${ctx.pageId}/photos`, {
    method: 'POST',
    body: formData,
  });
  if (!body?.id) throw new PublishError('Response Facebook tidak berisi id foto');

  deleteAssetAfterPublish(asset.absolutePath, asset.fileName);
  return { fbPostId: body.post_id || body.id, mediaMode: 'image', mediaFile: asset.fileName };
}

async function publishVideo(draft, ctx, asset) {
  // Upload langsung (multipart, satu request) ke /{page-id}/videos — SAMA seperti /photos.
  // Sebelumnya pakai 3-step Resumable Upload API (/uploads -> /upload:<session> -> /videos),
  // tapi step finalize-nya SELALU gagal (code 6000/subcode 1363019, "problem uploading
  // your video file") di setiap video nyata yang dicoba, walau step 1+2 sukses dapat file
  // handle valid. Dikonfirmasi 2026-08-20: file yang sama persis yang gagal lewat resumable
  // API berhasil PUBLISH langsung (published:false, diagnostic) lewat upload langsung ini —
  // jadi bukan masalah konten/hak cipta, murni resumable API kita yang bermasalah di step
  // finalize (root cause presisnya tidak pernah ketemu meski sudah beberapa kali dicoba
  // diagnosis). Upload langsung terbukti jalan untuk file post media sosial biasa (klip
  // pendek, puluhan MB) — kalau nanti butuh video jauh lebih besar/koneksi tidak stabil,
  // baru worth revisit resumable API dari awal.
  const fileBuffer = fs.readFileSync(asset.absolutePath);
  const formData = new FormData();
  formData.append('source', new Blob([fileBuffer], { type: guessMimeType(asset.fileName) }), asset.fileName);
  // /videos tidak punya mekanisme kartu link seperti /feed — sama seperti /photos, tempel
  // draft.link (kalau ada) sebagai teks biasa di description.
  formData.append('description', draft.link ? `${draft.text}\n\n${draft.link}` : draft.text);
  formData.append('access_token', ctx.accessToken);

  const body = await callGraphApi(`https://graph.facebook.com/${ctx.graphApiVersion}/${ctx.pageId}/videos`, {
    method: 'POST',
    body: formData,
  });
  if (!body?.id) throw new PublishError('Response Facebook tidak berisi id video');

  deleteAssetAfterPublish(asset.absolutePath, asset.fileName);
  return { fbPostId: body.id, mediaMode: 'video', mediaFile: asset.fileName };
}

/**
 * Publish caption final ke Facebook Page. Mode ditentukan OTOMATIS dari isi
 * assets/branding/ (bukan config): ada gambar -> /photos, ada video -> /videos,
 * kosong -> /feed teks saja. File yang dipakai dihapus setelah berhasil dipost.
 * @param {{text: string}} draft
 * @returns {Promise<{fbPostId: string, mediaMode: string, mediaFile: string|null}>}
 */
async function publish(draft) {
  const { graphApiVersion } = config.facebook;
  const ctx = {
    graphApiVersion,
    pageId: config.getSecret('FB_PAGE_ID'),
    accessToken: config.getSecret('FB_PAGE_ACCESS_TOKEN'),
  };

  const asset = mediaAsset.peek();
  if (asset.mode === 'image') return publishImage(draft, ctx, asset);
  if (asset.mode === 'video') return publishVideo(draft, ctx, asset);
  return publishText(draft, ctx);
}

module.exports = { publish };
