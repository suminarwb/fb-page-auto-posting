// src/topic-source.js
// TODO (draft): pool topik awal ini tebakan berdasarkan brand guideline PRD, belum dikurasi
// oleh Suminar. Tambah/ganti/hapus ide sesuai game & momen yang relevan saat ini.
const store = require('./store');
const config = require('./config');
const mediaAsset = require('./media-asset');
const { TopicSourceError } = require('./errors');

const TOPIC_POOL = [
  { topicId: 'first-platinum-trophy', category: 'console', topicSummary: 'Cerita soal pertama kali dapet platinum trophy di sebuah game PlayStation — perjuangan grinding-nya.' },
  { topicId: 'childhood-console-memory', category: 'console', topicSummary: 'Kenangan masa kecil main konsol lama (PS1/PS2/Xbox generasi awal) di rumah atau rental PS.' },
  { topicId: 'late-night-boss-fight', category: 'console', topicSummary: 'Momen begadang demi ngalahin final boss yang susah banget, rasanya pas menang.' },
  { topicId: 'backlog-guilt', category: 'console', topicSummary: 'Cerita soal backlog game yang numpuk padahal pengen banget mainin, rasa bersalah gamer.' },
  { topicId: 'couch-coop-friendship', category: 'console', topicSummary: 'Momen main split-screen/couch co-op bareng temen atau saudara di konsol, kedekatan yang tercipta.' },
  { topicId: 'nintendo-nostalgia', category: 'console', topicSummary: 'Kenangan main game Nintendo (NES/SNES/Wii/Switch) yang punya tempat spesial di hati.' },
  { topicId: 'first-console-purchase', category: 'console', topicSummary: 'Cerita soal pertama kali beli/dapet konsol sendiri hasil nabung atau hadiah.' },
  { topicId: 'game-that-made-me-cry', category: 'console', topicSummary: 'Momen emosional di sebuah game console yang bikin baper/nangis, kenapa bisa segitu ngena.' },
  { topicId: 'multiplayer-rivalry-fun', category: 'console', topicSummary: 'Cerita rivalitas seru (bukan toxic) sama temen waktu main game kompetitif di konsol.' },
  { topicId: 'exclusive-title-hype', category: 'console', topicSummary: 'Momen excited nunggu rilis exclusive title console favorit dan gimana rasanya pas akhirnya main.' },
  { topicId: 'handheld-on-the-go', category: 'console', topicSummary: 'Cerita main handheld/Switch di perjalanan (mudik, macet, nunggu antrian) buat ngisi waktu.' },
  { topicId: 'game-collection-pride', category: 'console', topicSummary: 'Perasaan bangga/puas liat koleksi fisik game console yang udah terkumpul dari waktu ke waktu.' },
  { topicId: 'controller-breaking-rage', category: 'console', topicSummary: 'Cerita lucu/apes soal momen hampir/beneran ngerusak controller saking frustrasinya di satu level.' },
  { topicId: 'replaying-old-favorite', category: 'console', topicSummary: 'Cerita main ulang game lama favorit setelah bertahun-tahun, gimana rasanya sekarang dibanding dulu.' },
  { topicId: 'unexpected-plot-twist', category: 'console', topicSummary: 'Reaksi kaget/takjub pas ketemu plot twist tak terduga di sebuah game console story-driven.' },
  { topicId: 'sibling-console-fight', category: 'console', topicSummary: 'Cerita berantem kecil/rebutan giliran main konsol sama saudara waktu kecil, sekarang jadi kenangan lucu.' },
  { topicId: 'console-generation-upgrade', category: 'console', topicSummary: 'Perasaan pertama kali upgrade ke generasi konsol baru — kagum sama loading time/grafis yang lompat jauh.' },
  { topicId: 'speedrun-attempt-fail', category: 'console', topicSummary: 'Cerita coba-coba speedrun/challenge run sebuah game console dan gagal berkali-kali sebelum berhasil (atau nyerah dengan legowo).' },
  { topicId: 'gaming-cafe-memory', category: 'console', topicSummary: 'Kenangan nongkrong di rental PS/warnet gaming zaman dulu bareng temen sekolah.' },
  { topicId: 'game-soundtrack-nostalgia', category: 'console', topicSummary: 'Momen denger OST sebuah game console lama secara random dan langsung keinget momen tertentu.' },
  { topicId: 'weekend-gaming-marathon', category: 'console', topicSummary: 'Cerita maraton main game console seharian penuh di akhir pekan, worth it atau menyesal paginya.' },
  { topicId: 'pc-vs-console-friendly-debate', category: 'pc', topicSummary: 'Obrolan santai (bukan war) soal pengalaman pindah dari console ke PC gaming atau sebaliknya.' },
  { topicId: 'pc-mod-community-love', category: 'pc', topicSummary: 'Cerita ketemu mod komunitas PC yang bikin pengalaman main game jadi beda/lebih seru.' },
];

function pickRandom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

/**
 * Derive topik langsung dari nama file gambar/video yang menunggu di assets/branding/ —
 * topik ini boleh sama sekali tidak ada di TOPIC_POOL, karena tujuannya caption harus
 * benar-benar tentang isi file itu, bukan topik pool yang acak.
 * @param {string} fileName
 * @returns {{topicId: string, topicSummary: string, category: null}}
 */
function topicFromFileName(fileName) {
  const baseName = fileName.replace(/\.[^.]+$/, ''); // buang ekstensi
  // Buang prefix angka urutan (mis. "01-", "02_") kalau dipakai buat atur giliran file.
  const withoutOrderPrefix = baseName.replace(/^\d+[-_.\s]+/, '');
  const humanReadable = withoutOrderPrefix.replace(/[-_]+/g, ' ').trim();
  const slug = withoutOrderPrefix
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-+|-+$)/g, '');

  return {
    topicId: `media-asset:${slug || baseName}`,
    topicSummary: humanReadable || 'Momen dari gambar/video yang di-upload',
    category: null,
  };
}

/**
 * Pilih satu topik. Kalau ada file gambar/video menunggu di assets/branding/, topik
 * DIAMBIL DARI NAMA FILE itu (di luar TOPIC_POOL, tidak kena dedupe — file yang sama
 * boleh terus dicoba tiap run sampai berhasil dipost, karena filenya sendiri hilang
 * begitu sukses). Kalau folder kosong, baru fallback ke pool statis dengan dedupe biasa.
 * @returns {Promise<{topicId: string, topicSummary: string, category: string|null} | null>}
 */
async function pickTopic() {
  const asset = mediaAsset.peek();
  if (asset.mode !== 'none') {
    return topicFromFileName(asset.fileName);
  }

  let recentTopicIds;
  try {
    recentTopicIds = await store.getRecentTopicIds(config.dedupeWindowDays);
  } catch (err) {
    throw new TopicSourceError('Gagal membaca riwayat topik dari store', err);
  }

  const candidates = TOPIC_POOL.filter((t) => !recentTopicIds.includes(t.topicId));
  if (candidates.length === 0) return null;
  return pickRandom(candidates);
}

module.exports = { pickTopic };
