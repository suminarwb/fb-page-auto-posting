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
  const body = await callGraphApi(`https://graph.facebook.com/${ctx.graphApiVersion}/${ctx.pageId}/feed`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ message: draft.text, access_token: ctx.accessToken }),
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
  formData.append('caption', draft.text);
  formData.append('access_token', ctx.accessToken);

  const body = await callGraphApi(`https://graph.facebook.com/${ctx.graphApiVersion}/${ctx.pageId}/photos`, {
    method: 'POST',
    body: formData,
  });
  if (!body?.id) throw new PublishError('Response Facebook tidak berisi id foto');

  deleteAssetAfterPublish(asset.absolutePath, asset.fileName);
  return { fbPostId: body.post_id || body.id, mediaMode: 'image', mediaFile: asset.fileName };
}

async function uploadVideoChunks(ctx, uploadSessionId, absolutePath, fileLength) {
  // Kirim file per-chunk (bukan sekaligus dalam satu request) — video nyata ~17MB
  // pernah gagal dengan error Facebook "problem uploading your video file" (code
  // 6000/subcode 1363019) saat dikirim dalam satu request penuh. Dokumentasi resmi
  // menyebut mekanisme resume pakai file_offset per bagian, jadi kemungkinan besar
  // memang didesain untuk chunking, bukan satu request raksasa.
  const CHUNK_SIZE = 4 * 1024 * 1024; // 4MB — belum ada angka resmi dari dokumentasi Meta
  const fd = fs.openSync(absolutePath, 'r');
  try {
    let offset = 0;
    while (offset < fileLength) {
      const chunkLength = Math.min(CHUNK_SIZE, fileLength - offset);
      const chunkBuffer = Buffer.alloc(chunkLength);
      fs.readSync(fd, chunkBuffer, 0, chunkLength, offset);

      const result = await callGraphApi(`https://graph.facebook.com/${ctx.graphApiVersion}/${uploadSessionId}`, {
        method: 'POST',
        headers: {
          Authorization: `OAuth ${ctx.accessToken}`,
          file_offset: String(offset),
        },
        body: chunkBuffer,
      });

      if (result?.h) return result.h; // file handle — chunk terakhir sudah melengkapi file
      // Kalau API balas offset baru, pakai itu; kalau tidak, hitung manual dari ukuran chunk.
      offset = typeof result?.offset === 'number' ? result.offset : offset + chunkLength;
    }
  } finally {
    fs.closeSync(fd);
  }
  return null;
}

async function publishVideo(draft, ctx, asset) {
  const fileLength = fs.statSync(asset.absolutePath).size;
  const mimeType = guessMimeType(asset.fileName);
  const appId = config.getSecret('FB_APP_ID');

  // Resumable Upload API, 3 tahap — lihat 04-API-INTEGRATION.md §2 / Graph API upload guide.
  // 1. Buat upload session.
  const sessionParams = new URLSearchParams({
    file_name: asset.fileName,
    file_length: String(fileLength),
    file_type: mimeType,
    access_token: ctx.accessToken,
  });
  const session = await callGraphApi(
    `https://graph.facebook.com/${ctx.graphApiVersion}/${appId}/uploads?${sessionParams.toString()}`,
    { method: 'POST' }
  );
  const uploadSessionId = session?.id; // bentuk: "upload:<id>"
  if (!uploadSessionId) throw new PublishError('Gagal membuat upload session video (tidak ada session id)');

  // 2. Upload isi file per-chunk, dapat file handle.
  const fileHandle = await uploadVideoChunks(ctx, uploadSessionId, asset.absolutePath, fileLength);
  if (!fileHandle) throw new PublishError('Gagal upload file video (tidak ada file handle setelah semua chunk terkirim)');

  // 3. Publish video ke Page pakai file handle.
  const publishResult = await callGraphApi(`https://graph.facebook.com/${ctx.graphApiVersion}/${ctx.pageId}/videos`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      fbuploader_video_file_chunk: fileHandle,
      description: draft.text,
      access_token: ctx.accessToken,
    }),
  });
  if (!publishResult?.id) throw new PublishError('Response Facebook tidak berisi id video');

  deleteAssetAfterPublish(asset.absolutePath, asset.fileName);
  return { fbPostId: publishResult.id, mediaMode: 'video', mediaFile: asset.fileName };
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
