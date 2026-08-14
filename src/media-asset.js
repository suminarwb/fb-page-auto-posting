// src/media-asset.js
// Satu-satunya modul yang tahu detail isi folder assets/branding/ — dipakai
// topic-source.js (menentukan topik dari nama file) dan fb-publisher.js (menentukan
// mode publish + menghapus file setelah sukses). Modul lain jangan baca folder ini sendiri.
const fs = require('fs');
const path = require('path');

const IMAGE_EXTENSIONS = new Set(['.jpg', '.jpeg', '.png', '.gif', '.bmp', '.tiff']);
const VIDEO_EXTENSIONS = new Set(['.mp4', '.mov']);
const BRANDING_DIR = path.join(__dirname, '../assets/branding');

/**
 * Intip file gambar/video yang sedang menunggu di assets/branding/ (read-only,
 * tidak menghapus apa pun). Prioritas: gambar duluan (lebih ringan/cepat) kalau ada
 * gambar dan video sekaligus; video menunggu giliran run berikutnya. Kalau ada
 * beberapa file per jenis, dipilih yang lebih dulu secara alfabetis.
 * @returns {{mode: 'none'} | {mode: 'image'|'video', fileName: string, absolutePath: string}}
 */
function peek() {
  let entries;
  try {
    entries = fs.readdirSync(BRANDING_DIR, { withFileTypes: true });
  } catch {
    return { mode: 'none' };
  }

  const fileNames = entries
    .filter((e) => e.isFile())
    .map((e) => e.name)
    .sort();

  const imageFile = fileNames.find((name) => IMAGE_EXTENSIONS.has(path.extname(name).toLowerCase()));
  if (imageFile) {
    return { mode: 'image', fileName: imageFile, absolutePath: path.join(BRANDING_DIR, imageFile) };
  }

  const videoFile = fileNames.find((name) => VIDEO_EXTENSIONS.has(path.extname(name).toLowerCase()));
  if (videoFile) {
    return { mode: 'video', fileName: videoFile, absolutePath: path.join(BRANDING_DIR, videoFile) };
  }

  return { mode: 'none' };
}

/**
 * Hapus file dari assets/branding/ — dipanggil fb-publisher.js setelah berhasil publish.
 * @param {string} absolutePath
 */
function remove(absolutePath) {
  fs.unlinkSync(absolutePath);
}

module.exports = { peek, remove };
