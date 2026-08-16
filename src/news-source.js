// src/news-source.js
// Sumber topik dari berita gaming (RSS) — prioritas ketiga, di bawah file manual di
// assets/branding/ dan di atas TOPIC_POOL statis. Kegagalan di sini (feed down, format
// berubah, dll) TIDAK BOLEH menggagalkan pipeline — selalu fallback ke pool kalau gagal.
const { XMLParser } = require('fast-xml-parser');
const config = require('./config');
const logger = require('./logger');

const parser = new XMLParser({ ignoreAttributes: false, attributeNamePrefix: '@_', cdataPropName: '__cdata' });
// User-Agent wajar — beberapa feed (mis. Kotaku) blokir bot generik meski RSS memang
// didesain untuk diakses otomatis; IGN & GameSpot dikonfirmasi jalan dengan ini.
const USER_AGENT = 'Mozilla/5.0 (compatible; StikSatuBot/1.0; +https://facebook.com/stiksatu)';

function extractText(field) {
  if (field == null) return '';
  if (typeof field === 'string') return field;
  if (typeof field === 'number') return String(field);
  if (typeof field === 'object' && '__cdata' in field) return String(field.__cdata);
  if (typeof field === 'object' && '#text' in field) return String(field['#text']);
  return '';
}

function decodeHtmlEntities(text) {
  return text
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#0?39;/g, "'")
    .replace(/&#8211;/g, '–')
    .replace(/&#8212;/g, '—')
    .replace(/&#8216;/g, '‘')
    .replace(/&#8217;/g, '’')
    .replace(/&#8220;/g, '“')
    .replace(/&#8221;/g, '”')
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)));
}

function stripHtml(html) {
  return decodeHtmlEntities(html.replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim());
}

async function fetchFeed(feed) {
  const response = await fetch(feed.url, { headers: { 'User-Agent': USER_AGENT } });
  if (!response.ok) {
    throw new Error(`Feed ${feed.name} balas HTTP ${response.status}`);
  }
  const xml = await response.text();
  const parsed = parser.parse(xml);
  const rawItems = parsed?.rss?.channel?.item;
  if (!rawItems) return [];
  const items = Array.isArray(rawItems) ? rawItems : [rawItems];

  return items.map((item) => ({
    sourceName: feed.name,
    title: decodeHtmlEntities(extractText(item.title)),
    link: extractText(item.link),
    description: stripHtml(extractText(item.description)).slice(0, 500),
    guid: extractText(item.guid) || extractText(item.link),
  }));
}

/**
 * Coba pilih satu topik berita yang belum pernah dipakai, dari feed yang dikonfigurasi
 * di config.json (`news.feeds`). Kalau semua feed gagal diambil/kosong/sudah pernah
 * dipakai semua, return null (caller fallback ke TOPIC_POOL) — tidak pernah melempar error.
 * @param {string[]} recentTopicIds topicId yang sudah dipakai dalam window dedupe
 * @returns {Promise<{topicId: string, topicSummary: string, category: null, sourceUrl: string} | null>}
 */
async function pickNewsTopic(recentTopicIds) {
  if (!config.news?.enabled) return null;
  const feeds = config.news?.feeds ?? [];
  if (feeds.length === 0) return null;

  try {
    const results = await Promise.allSettled(feeds.map(fetchFeed));
    const allItems = results.flatMap((result, i) => {
      if (result.status === 'rejected') {
        logger.warn(
          { stage: 'news-source', status: 'feed-failed', feed: feeds[i].name, err: result.reason?.message },
          `Gagal ambil feed ${feeds[i].name}, lewati (fallback ke feed lain/pool)`
        );
        return [];
      }
      return result.value;
    });

    const candidates = allItems
      .filter((item) => item.link && item.title)
      .map((item) => ({ ...item, topicId: `news:${item.guid}` }))
      .filter((item) => !recentTopicIds.includes(item.topicId));

    if (candidates.length === 0) return null;

    const picked = candidates[Math.floor(Math.random() * candidates.length)];
    return {
      topicId: picked.topicId,
      topicSummary: `Berita dari ${picked.sourceName}: "${picked.title}". Ringkasan: ${picked.description}`,
      category: null,
      sourceUrl: picked.link,
    };
  } catch (err) {
    // Fail-safe: kegagalan tak terduga di sumber berita tidak boleh menggagalkan pipeline.
    logger.warn({ stage: 'news-source', status: 'error', err: err.message }, 'Gagal ambil topik berita, fallback ke pool');
    return null;
  }
}

module.exports = { pickNewsTopic };
