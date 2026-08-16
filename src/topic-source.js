// src/topic-source.js
// TODO (draft): pool topik awal ini tebakan berdasarkan brand guideline PRD, belum dikurasi
// oleh Suminar. Tambah/ganti/hapus ide sesuai game & momen yang relevan saat ini.
const store = require('./store');
const config = require('./config');
const mediaAsset = require('./media-asset');
const newsSource = require('./news-source');
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
  { topicId: 'best-character-in-game', category: 'console', topicSummary: 'Cerita soal karakter game favorit yang paling nempel di hati — kenapa karakter itu spesial dan momen apa yang bikin makin suka.' },
  { topicId: 'mobile-legends-rank-grind', category: 'mobile', topicSummary: 'Cerita perjuangan push rank di Mobile Legends bareng squad, drama menang-kalah pas lagi deket ke tier berikutnya.' },
  { topicId: 'mobile-gacha-luck-story', category: 'mobile', topicSummary: 'Cerita soal keberuntungan (atau apesnya) waktu gacha di game mobile favorit, rasanya pas dapet/gagal dapet item impian.' },
  { topicId: 'mobile-gaming-commute', category: 'mobile', topicSummary: 'Cerita main game mobile buat ngisi waktu pas di angkot/KRL/macetan — game mobile jadi teman ngebunuh waktu paling praktis.' },
  { topicId: 'squad-mabar-mobile-legends', category: 'mobile', topicSummary: 'Kedekatan sama squad tetap buat mabar (main bareng) game mobile — obrolan random di voice chat yang jadi kenangan.' },
  { topicId: 'first-mobile-game-obsession', category: 'mobile', topicSummary: 'Kenangan pertama kali kecanduan sebuah game mobile, sampai lupa waktu/baterai HP abis gara-gara keasyikan main.' },
  { topicId: 'mobile-vs-console-lifestyle', category: 'mobile', topicSummary: 'Obrolan santai soal kenapa game mobile jadi pilihan praktis buat main sehari-hari dibanding harus nyalain console dulu.' },
  { topicId: 'clutch-moment-mobile-esports', category: 'mobile', topicSummary: 'Momen clutch/comeback dramatis waktu nonton atau main pertandingan esports mobile (MLBB, PUBGM, dll).' },
  { topicId: 'battle-royale-mobile-victory', category: 'mobile', topicSummary: 'Cerita momen menang chicken dinner/victory di game battle royale mobile setelah sekian kali gagal.' },
];

function pickRandom(list) {
  return list[Math.floor(Math.random() * list.length)];
}

const JAKARTA_HOUR_FORMAT = new Intl.DateTimeFormat('en-US', { timeZone: 'Asia/Jakarta', hour: 'numeric', hourCycle: 'h23' });

/**
 * Cek apakah jam sekarang (WIB, bukan timezone server) ada di jam-jam yang
 * dikhususkan buat topik berita (`news.preferredHours` di config.json).
 * Kalau `preferredHours` tidak diisi, anggap tidak ada batasan jam (selalu boleh berita).
 * @returns {boolean}
 */
function isWithinNewsPreferredHours() {
  const window = config.news?.preferredHours;
  if (!window) return true;
  const hour = Number(JAKARTA_HOUR_FORMAT.format(new Date()));
  return hour >= window.start && hour < window.end;
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
 * Pilih satu topik, urutan prioritas:
 * 1. `forcedTopicId` (lewat flag CLI manual, lihat index.js) — cari di TOPIC_POOL,
 *    lewati semua pengecekan lain (dipakai buat testing manual satu topik tertentu).
 * 2. File gambar/video menunggu di assets/branding/ — topik DIAMBIL DARI NAMA FILE
 *    (di luar TOPIC_POOL, tidak kena dedupe — file yang sama boleh terus dicoba tiap
 *    run sampai berhasil dipost, karena filenya sendiri hilang begitu sukses). Ini
 *    prioritas tertinggi setelah forced topic, TIDAK peduli jam berapa sekarang.
 * 3. Berita gaming terbaru (RSS, lihat news-source.js) — HANYA dicoba kalau jam
 *    sekarang (WIB) ada di jendela `news.preferredHours` di config.json (mis. jam
 *    08:00-10:00 pagi). Di luar jendela itu, berita dilewati sama sekali, langsung
 *    ke pool. Kalau di dalam jendela tapi gagal ambil/tidak ada yang baru, diam-diam
 *    tetap lanjut ke pool (fail-safe, jangan sampai run kosong).
 * 4. Fallback: TOPIC_POOL statis dengan dedupe biasa.
 * @param {string} [forcedTopicId]
 * @returns {Promise<{topicId: string, topicSummary: string, category: string|null, sourceUrl?: string} | null>}
 */
async function pickTopic(forcedTopicId) {
  if (forcedTopicId) {
    const forced = TOPIC_POOL.find((t) => t.topicId === forcedTopicId);
    if (!forced) {
      throw new TopicSourceError(
        `Topik "${forcedTopicId}" tidak ditemukan di TOPIC_POOL. Topik yang tersedia: ${TOPIC_POOL.map((t) => t.topicId).join(', ')}`
      );
    }
    return forced;
  }

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

  if (isWithinNewsPreferredHours()) {
    const newsTopic = await newsSource.pickNewsTopic(recentTopicIds);
    if (newsTopic) return newsTopic;
  }

  const candidates = TOPIC_POOL.filter((t) => !recentTopicIds.includes(t.topicId));
  if (candidates.length === 0) return null;
  return pickRandom(candidates);
}

module.exports = { pickTopic };
