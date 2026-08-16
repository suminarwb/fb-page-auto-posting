# Stik Satu — Facebook Page Auto-Posting Agent

Agent Node.js yang otomatis membuat dan mempublikasikan konten storytelling gaming ke Facebook Page **Stik Satu** (komunitas gaming Indonesia, fokus console gaming & mobile gaming, PC sekunder) — dari cari topik, generate caption via AI, self-verify, sampai publish ke Facebook, dengan jadwal terkontrol dan guardrail keamanan di setiap langkah.

## Fitur

- Generate ide topik dari pool statis yang bisa dikustomisasi, dengan dedupe otomatis (topik yang sama tidak diulang dalam N hari).
- Generate caption storytelling personal berbahasa Indonesia casual lewat AI (Anthropic Claude, OpenAI, atau Google Gemini — tinggal pilih).
- Self-verification otomatis sebelum publish — caption yang tidak sesuai brand voice/guideline **tidak pernah** tayang, disimpan untuk direview manual.
- Publish otomatis ke Facebook Page: teks, gambar, atau video, dipilih otomatis dari isi folder `assets/branding/` — tidak perlu ubah config.
- Kalau ada file gambar/video menunggu, topik postingan diambil dari nama file itu sendiri (bukan dari pool acak), dan file-nya otomatis terhapus setelah berhasil dipost.
- Kalau folder `assets/branding/` kosong, agent generate sendiri gambar fallback (via Cloudflare Workers AI, gratis) supaya post tetap punya elemen visual — gagal generate tidak pernah menggagalkan publish, cukup fallback ke teks.
- Bisa juga ambil topik dari **berita gaming terbaru** (RSS IGN, GameSpot & Gamebrott) sebagai sumber topik prioritas terendah — caption ditulis sebagai reaksi personal, bukan artikel ditulis ulang, plus link sumber berita di baris terakhir (tanpa re-host gambar berita, demi aman hak cipta).
- Setiap caption otomatis menyertakan hashtag relevan (topik + `#StikSatu`) untuk memperluas jangkauan, jumlahnya tidak dibatasi selama relevan — dicek juga oleh verifier.
- Bisa dipaksa posting topik tertentu lewat CLI (`--once --<topicId>`) untuk testing manual, di luar rotasi dedupe otomatis.
- Retry + backoff untuk error transient, tanpa retry tak berujung untuk error permanen (token invalid, dll).
- Jadwal otomatis (cron) dengan timezone Indonesia (WIB), berjalan sebagai proses long-running (siap dipakai dengan `pm2`).
- Log terstruktur (JSON) dan audit trail lengkap di SQLite lokal.

## Arsitektur & Alur Kerja

```
[Scheduler / trigger manual]
        |
        v
[Topic Source] --(cek dedupe / nama file media)--> [Store: history]
        |
        v
[Content Generator] --(panggil AI provider)
        |
        v
[Self-Verifier] --(panggil AI provider, gagal -> simpan utk review, STOP)
        |  (lolos)
        v
[FB Publisher] --(pilih teks/gambar/video otomatis)--> [Facebook Graph API]
        |
        v
[Store: log hasil publish]
```

Satu kali jalan = satu keputusan (publish, ditahan untuk review, atau skip). Tidak ada logic tersembunyi di luar `src/pipeline.js` — itu satu-satunya tempat yang tahu urutan penuh.

### Guardrail keamanan (tidak bisa dinonaktifkan)

- **Tidak ada publish tanpa lolos self-verify.** Kalau `verifier.js` mengembalikan `pass: false`, caption disimpan untuk direview manual, tidak pernah dikirim ke Facebook.
- **Tidak ada secret di kode atau `config.json`.** Semua API key/access token wajib lewat `.env`.
- **Modul terisolasi ketat** — hanya `src/llm-client.js` yang boleh bicara ke SDK/API provider AI, hanya `src/fb-publisher.js` yang boleh bicara ke Facebook Graph API.
- **Retry maksimum 2x** dengan backoff (5 detik, lalu 15 detik) untuk error transient saja. Error permanen (token invalid, parameter salah) gagal langsung, tidak diulang.
- Kalau output verifier gagal di-parse, default-nya **`pass: false`** (fail-safe, bukan fail-open).

## Prasyarat

- **Node.js 18+** (dikembangkan & dites dengan Node 22).
- Akun & API key untuk **minimal satu** provider AI: [Anthropic](https://platform.claude.com/), [OpenAI](https://platform.openai.com/), atau [Google Gemini](https://aistudio.google.com/apikey).
- Facebook Page yang ingin dikelola, plus satu **Facebook App** di [developers.facebook.com](https://developers.facebook.com/apps) (gratis, dipakai untuk generate Page Access Token — lihat panduan di bawah).
- **Opsional:** akun [Cloudflare](https://dash.cloudflare.com) (gratis) kalau mau pakai fitur auto-generate gambar fallback — lihat bagian "Setup Cloudflare Workers AI".

## Instalasi

```bash
git clone <url-repo-ini>
cd stik-satu-agent
npm install
cp .env.example .env
```

## Konfigurasi

### `.env` — secret & identifier yang tidak boleh public

| Variabel | Wajib? | Keterangan |
|---|---|---|
| `ANTHROPIC_API_KEY` | Kalau pakai provider `anthropic` | API key Claude |
| `OPENAI_API_KEY` | Kalau pakai provider `openai` | API key OpenAI |
| `GEMINI_API_KEY` | Kalau pakai provider `gemini` | API key Gemini |
| `FB_PAGE_ACCESS_TOKEN` | **Wajib** | Page Access Token (lihat panduan di bawah) |
| `FB_PAGE_ID` | **Wajib** | ID Facebook Page yang mau di-post |
| `FB_APP_ID` | Wajib kalau mau posting **video** | App ID Facebook App (dipakai untuk resumable upload) |
| `CLOUDFLARE_ACCOUNT_ID` | Wajib kalau `imageGeneration.enabled` | Account ID Cloudflare (lihat "Setup Cloudflare Workers AI") |
| `CLOUDFLARE_API_TOKEN` | Wajib kalau `imageGeneration.enabled` | API Token dengan permission Workers AI |

Isi hanya secret provider AI yang benar-benar dipakai (lihat `llm.generatorProvider`/`llm.verifierProvider` di `config.json`) — tidak perlu isi ketiganya.

`FB_PAGE_ID` dan `FB_APP_ID` sebenarnya bukan rahasia (keduanya terlihat publik di URL/dashboard), tapi sengaja ditaruh di `.env` (bukan `config.json`) supaya file config yang mungkin ikut ter-commit tidak otomatis menunjuk ke Page/App yang asli.

### `config.json` — pengaturan non-rahasia

```json
{
  "schedule": { "cronExpressions": ["0 9 * * *", "0 12 * * 1-5", "0 13 * * 0,6", "0 19 * * *"] },
  "dedupeWindowDays": 14,
  "llm": {
    "generatorProvider": "gemini",
    "generatorModel": "gemini-3.6-flash",
    "verifierProvider": "gemini",
    "verifierModel": "gemini-3.5-flash-lite",
    "maxTokens": 1500
  },
  "facebook": { "graphApiVersion": "v26.0" },
  "imageGeneration": {
    "enabled": true,
    "provider": "cloudflare",
    "model": "@cf/black-forest-labs/flux-1-schnell"
  },
  "news": {
    "enabled": true,
    "preferredHours": { "start": 8, "end": 10 },
    "feeds": [
      { "name": "IGN", "url": "https://www.ign.com/rss/articles/feed?tags=games" },
      { "name": "GameSpot", "url": "https://www.gamespot.com/feeds/mashup/" },
      { "name": "Gamebrott", "url": "https://gamebrott.com/feed/" }
    ]
  }
}
```

- **`schedule.cronExpressions`** — array cron expression standar (`sec? min hour day month weekday`), dipakai `src/scheduler.js`. Default: jam 09:00 setiap hari (masuk jendela `news.preferredHours`, khusus berita), jam 12:00 weekday, jam 13:00 weekend, dan jam 19:00 setiap hari.
- **`dedupeWindowDays`** — berapa hari topik dari pool tidak boleh diulang.
- **`llm.generatorProvider`/`verifierProvider`** — `"anthropic"` | `"openai"` | `"gemini"`. Boleh beda antara generator dan verifier (mis. model besar untuk generate, model ringan untuk verify).
- **`llm.generatorModel`/`verifierModel`** — **cek dulu daftar model terbaru dari provider terkait sebelum diisi** (model sering deprecated/berganti nama — lihat bagian Troubleshooting).
- **`llm.maxTokens`** — token budget untuk generator. Kalau pakai model dengan "thinking"/reasoning internal (mis. Gemini 3.x), sisakan budget besar (1000+) karena sebagian besar token bisa terpakai untuk proses berpikir sebelum menghasilkan teks caption.
- **`facebook.graphApiVersion`** — cek versi terbaru di [Graph API changelog](https://developers.facebook.com/docs/graph-api/changelog) Meta.
- **`imageGeneration.enabled`** — set `false` untuk mematikan total fitur auto-generate gambar (fallback jadi selalu teks-only kalau `assets/branding/` kosong).
- **`imageGeneration.provider`/`model`** — saat ini cuma didukung `"cloudflare"` dengan model image-gen apa pun yang tersedia di [katalog Workers AI](https://developers.cloudflare.com/workers-ai/models/) (default `flux-1-schnell`, cepat & gratis untuk skala kecil).
- **`news.enabled`** — set `false` untuk mematikan total sumber topik dari berita (topik selalu diambil dari `TOPIC_POOL` atau nama file media).
- **`news.preferredHours`** — jendela jam WIB (`{ "start": ..., "end": ... }`, format 24 jam, `end` eksklusif) tempat topik berita boleh dicoba. Di luar jam ini, topik selalu random dari `TOPIC_POOL`. Hapus field ini kalau mau berita bisa muncul kapan saja.
- **`news.feeds`** — daftar RSS feed gaming yang dipantau, tiap entry `{ "name": ..., "url": ... }`. Lihat bagian "Topik dari Berita Gaming (RSS)" di bawah untuk detail mekanismenya dan cara menambah feed lain.

## Setup Kredensial Facebook

Ini bagian paling sering bikin bingung — ikuti urut-urutan ini.

### 1. Buat Facebook App

Buka [developers.facebook.com/apps](https://developers.facebook.com/apps) → buat App baru (tipe apa saja, mis. "Business"). Catat **App ID**-nya (terlihat di halaman App Settings → Basic).

### 2. Aktifkan use case "Manage everything on your Page"

Di sidebar App kamu, klik **"Use cases"**. Kalau belum ada **"Manage everything on your Page"** (Pages API), tambahkan. Buka **"Customize"** pada use case itu, lalu klik **"+ Add"** untuk permission:
- `pages_manage_posts` (wajib — untuk publish)
- `pages_read_engagement` (wajib)

> Kalau permission `pages_*` tidak muncul sama sekali di Graph API Explorer, ini biasanya karena use case ini belum diaktifkan/di-customize — bukan masalah dokumentasi atau typo scope.

### 3. Dapatkan Page Access Token (tanpa perlu Business Manager)

Kamu **tidak wajib** punya Business Portfolio/Business Manager untuk ini — kalau App-mu terhubung langsung ke profil pribadi yang mengelola Page, ikuti jalur ini:

1. Buka [Graph API Explorer](https://developers.facebook.com/tools/explorer), pilih App kamu di dropdown kanan atas.
2. Klik **"Add a Permission"**, tambahkan `pages_manage_posts` dan `pages_read_engagement`.
3. Klik **"Generate Access Token"**, approve. Ini menghasilkan **User Access Token short-lived** (berlaku ~1-2 jam) — salin.
4. Exchange ke **User Access Token long-lived** (buka URL ini di browser, ganti placeholder):
   ```
   https://graph.facebook.com/v26.0/oauth/access_token?grant_type=fb_exchange_token&client_id=<APP_ID>&client_secret=<APP_SECRET>&fb_exchange_token=<TOKEN_DARI_LANGKAH_3>
   ```
   `APP_SECRET` ada di App Settings → Basic (klik "Show"). Respons berisi `access_token` baru yang berlaku ~60 hari.
5. Ambil **Page Access Token** dari token di atas (buka URL ini, ganti placeholder):
   ```
   https://graph.facebook.com/v26.0/me/accounts?access_token=<TOKEN_DARI_LANGKAH_4>
   ```
   Cari Page yang kamu mau di daftar `data[]` hasilnya — field `access_token` di situ adalah **Page Access Token final** (diawali `EAA...`, ratusan karakter). Field `id` adalah `FB_PAGE_ID`.

Page Access Token yang didapat dengan cara ini **tidak expired** selama tidak di-revoke (cek lewat `GET /v26.0/debug_token?input_token=<token>&access_token=<token>`, field `expires_at` akan `0`).

> **Kalau punya Business Portfolio (Business Manager):** cara yang lebih direkomendasikan Meta untuk penggunaan jangka panjang adalah lewat **System User** (Business Settings → Users → System Users → generate token). Hasilnya sama-sama Page Access Token yang tidak expired, tapi lebih mudah dikelola/di-revoke terpisah dari akun pribadi.

### Kesalahan umum yang perlu dihindari

Ada 3 credential di App Settings yang bentuknya mirip (string ~32 karakter) tapi **bukan** Page Access Token — jangan salah taruh ke `FB_PAGE_ACCESS_TOKEN`:
- **App Secret** (App Settings → Basic) — cuma dipakai sebagai `client_secret` di langkah exchange di atas.
- **Client Token** (App Settings → Advanced) — untuk autentikasi SDK client-side, tidak relevan di sini.
- Page Access Token asli **jauh lebih panjang** (~200-300 karakter) dan selalu diawali `EAA`.

Kalau salah taruh salah satu di atas, Facebook akan menolak dengan error `"Invalid OAuth access token - Cannot parse access token"` (code 190).

## Setup Cloudflare Workers AI (opsional — untuk auto-generate gambar)

Cuma perlu ini kalau `imageGeneration.enabled: true` di `config.json` (default: aktif).

1. Daftar akun gratis di [dash.cloudflare.com](https://dash.cloudflare.com).
2. Catat **Account ID** — terlihat di sidebar kanan halaman overview domain manapun, atau di URL dashboard.
3. Buka [dash.cloudflare.com/profile/api-tokens](https://dash.cloudflare.com/profile/api-tokens) → **Create Token** → cari template terkait Workers AI (kalau tidak ada template siap pakai, buat token custom dengan permission **"Workers AI Read"** dan **"Workers AI Write"**, scope "Entire account" atau dibatasi ke akun tertentu).
4. Isi `CLOUDFLARE_ACCOUNT_ID` dan `CLOUDFLARE_API_TOKEN` di `.env`.

Kuota gratis: **10.000 neuron/hari** (bukan trial, gratis terus-menerus) — cukup untuk ratusan gambar per hari, jauh lebih dari kebutuhan 1 post/hari. Kalau lewat kuota, generate akan gagal jelas (bukan tagihan mengejutkan) dan pipeline otomatis fallback ke teks-only.

## Menjalankan

### Trigger manual (sekali jalan)

```bash
npm run once
# sama dengan: node src/index.js --once
```

Cocok untuk testing awal. **Ini akan publish sungguhan ke Page yang di-set di `FB_PAGE_ID`** kalau verifier lolos — pertimbangkan pakai Page test dulu untuk percobaan pertama.

### Paksa topik tertentu (testing manual)

```bash
node src/index.js --once --best-character-in-game
```

Flag apa pun selain `--once` dibaca sebagai `topicId` yang dipaksa dipakai (harus salah satu `topicId` di `TOPIC_POOL`, lihat `src/topic-source.js`) — dedupe otomatis dilewati untuk topik yang dipaksa ini. Kalau `topicId`-nya tidak ditemukan, agent berhenti dan menampilkan daftar semua `topicId` yang valid. Flag ini **hanya berlaku bareng `--once`** — dipakai tanpa `--once`, flag diabaikan (dengan warning) dan scheduler tetap jalan normal.

### Mode terjadwal (full-auto)

```bash
npm start
# sama dengan: node src/index.js
```

Proses tetap hidup, jalan sesuai `schedule.cronExpressions` di `config.json`, berhenti dengan `Ctrl+C` (SIGINT/SIGTERM ditangani rapi).

### Deploy production dengan pm2

```bash
npm install -g pm2
pm2 start ecosystem.config.js
pm2 save
pm2 startup   # ikuti instruksi yang muncul, supaya pm2 auto-start saat server reboot
```

> **Perintah di atas untuk deploy di Linux VPS**, bukan di mesin Windows lokal. `pm2 start`/`pm2 save` tetap jalan normal di Windows untuk testing, tapi `pm2 startup` khusus mengenali init system Linux (systemd/upstart) atau macOS (launchd) — di Windows akan gagal dengan `Error: Init system not found`. Kalau itu terjadi saat testing lokal, abaikan saja dan jalankan `pm2 startup` yang sesungguhnya nanti langsung di VPS Linux tempat production berjalan.

Sebelum benar-benar melepas ke mode full-auto tanpa pengawasan, pantau manual beberapa post pertama yang tayang otomatis (soft-launch) untuk memastikan brand voice dan pemilihan topik sesuai ekspektasi.

## Posting dengan Gambar atau Video

Tidak ada config yang perlu diubah — cukup taruh file di `assets/branding/`:

- **Ada file gambar** (`.jpg/.jpeg/.png/.gif/.bmp/.tiff`) → publish otomatis lewat `/photos`. Batas ukuran 4MB (limit Facebook).
- **Tidak ada gambar tapi ada video** (`.mp4/.mov`) → publish otomatis lewat resumable upload video (butuh `FB_APP_ID` di `.env`), dikirim per-chunk 4MB.
- **Folder kosong** → agent generate sendiri 1 gambar (via Cloudflare Workers AI, kalau `imageGeneration.enabled`) berdasarkan topik yang lagi diproses, lalu publish gambar itu. Kalau generate gagal (atau fitur dimatikan), fallback ke publish teks saja — tidak pernah menggagalkan run. **Pengecualian:** untuk topik dari berita, langkah ini dilewati sama sekali (selalu teks-only + URL sumber) — lihat "Topik dari Berita Gaming (RSS)".
- **Ada gambar dan video sekaligus** → gambar diproses duluan, video menunggu run berikutnya.
- **Ada beberapa file** → dipilih satu secara alfabetis per jenis (beri prefix angka kalau mau atur urutan, mis. `01-cover.jpg`).

**Nama file menentukan topik captionnya** — kalau ada file menunggu (upload manual, bukan hasil generate), caption dibuat berdasarkan nama file itu (bukan topik acak dari pool), jadi kasih nama yang deskriptif, misalnya `kemenangan-pertama-elden-ring.jpg`, bukan `IMG_2024.jpg`.

File yang dipakai (baik upload manual maupun hasil generate) **otomatis terhapus** setelah berhasil dipost (kalau gagal, file tetap ada untuk dicoba lagi di run berikutnya).

Panduan visual untuk gambar hasil generate ada di `prompts/image-style-guide.md` — sengaja diarahkan ke gaya generik/abstrak (mood gaming, bukan adegan/karakter spesifik dari game tertentu) untuk menghindari risiko hak cipta.

## Topik dari Berita Gaming (RSS)

Selain pool topik statis, agent bisa ambil topik dari berita gaming terbaru lewat RSS **IGN**, **GameSpot**, dan **Gamebrott** (`src/news-source.js`) — Gamebrott berbahasa Indonesia, dua lainnya berbahasa Inggris (tetap diterjemahkan jadi reaksi personal berbahasa Indonesia oleh generator). Urutan prioritas pemilihan topik tiap run (`src/topic-source.js`):

1. **Topik paksa** lewat CLI (lihat "Paksa topik tertentu" di atas), kalau ada.
2. **File media menunggu** di `assets/branding/` — topik diambil dari nama file. Prioritas ini berlaku **kapan pun**, tidak peduli jam berapa sekarang.
3. **Berita terbaru** dari RSS feed yang belum pernah dipakai (dedupe berdasarkan GUID artikel) — **hanya dicoba kalau jam sekarang (WIB) masuk jendela `news.preferredHours`** di `config.json` (default 08:00-10:00 pagi). Di luar jam itu, berita dilewati sama sekali, langsung ke pool.
4. **Pool topik statis** (`TOPIC_POOL`) dengan dedupe berdasarkan hari, seperti biasa.

Berita sengaja dibatasi ke jam pagi tertentu — supaya tidak mendominasi feed dan tetap seimbang dengan konten storytelling reguler dari pool.

**Mengatur jam khusus berita:** ubah `news.preferredHours` di `config.json`, mis. `{ "start": 8, "end": 10 }` berarti jam 08:00 sampai sebelum 10:00 WIB. Kalau `preferredHours` dihapus dari config, berita jadi boleh dicoba kapan saja (perilaku lama, tanpa batasan jam). Jendela ini dicek berdasarkan **jam WIB (`Asia/Jakarta`)**, bukan timezone server tempat proses berjalan — jadi tetap akurat walau server di-hosting di timezone lain.

Yang perlu diketahui soal fitur ini:

- **Caption tetap reaksi personal**, bukan artikel berita ditulis ulang — lihat instruksi khusus di `prompts/generator-system.md`. Verifier juga tahu membedakan ini (lihat kriteria #1 di `prompts/verifier-system.md`).
- **URL sumber berita dikirim terpisah dari teks caption** (field `link` di `draft`, diisi oleh kode `src/content-generator.js`, bukan ditulis AI — supaya selalu akurat, tidak berisiko dipotong/diparafrase model) lalu dikirim lewat parameter `link` ke endpoint `/feed` Facebook (`src/fb-publisher.js`). Ini penting: URL yang cuma ditempel di dalam teks `message` **tidak** memicu kartu preview di Facebook — cuma jadi teks biasa yang dihyperlink. Hanya dengan parameter `link` terpisah Facebook benar-benar men-scrape halamannya dan menghasilkan kartu (gambar + judul + deskripsi dari IGN/GameSpot sendiri).
- **Tidak pernah re-host gambar dari artikel berita** — ini keputusan sengaja untuk menghindari pelanggaran hak cipta foto media lain. **Image generator otomatis (Cloudflare) juga tidak pernah dijalankan untuk topik berita**, walau `imageGeneration.enabled` dan `assets/branding/` kosong — post berita selalu teks-only (plus URL sumber), karena Facebook sudah otomatis membuat preview kartu dari link tersebut; menambah gambar AI generik di sini cuma redundan/berpotensi membingungkan.
- **Kotaku tidak didukung** — RSS-nya diblokir oleh proteksi bot Cloudflare (butuh headless browser untuk bypass, di luar scope project ini).
- Kalau semua feed gagal diakses (down, berubah format, dll), fitur ini **tidak pernah menggagalkan run** — pipeline otomatis lanjut ke pool topik statis seperti biasa, cukup log warning per feed yang gagal.
- Untuk menambah/mengurangi feed, edit `news.feeds` di `config.json` — feed lain harus format RSS/XML standar dan idealnya sudah ada tag/kategori khusus game (supaya tidak ikut mengambil berita non-gaming dari media umum).

## Kustomisasi

### Brand voice

Edit `prompts/style-guide.md` — panduan gaya bahasa, fokus konten, batasan, dan aturan hashtag (wajib ada, jumlah tidak dibatasi selama relevan) yang dipakai baik oleh generator maupun verifier. Ini file yang paling menentukan karakter caption yang dihasilkan.

### Gaya visual gambar auto-generate

Edit `prompts/image-style-guide.md` — panduan untuk gambar fallback (lihat bagian "Posting dengan Gambar atau Video"). Ubah di sini kalau mau gaya visual berbeda dari default (generik/abstrak, neon biru-ungu ala PlayStation).

### Pool topik

Edit array `TOPIC_POOL` di `src/topic-source.js` — setiap entry punya `topicId` (unik), `topicSummary` (ide/starting point untuk AI, bukan caption jadi), dan `category`.

### Ganti provider AI

Ubah `llm.generatorProvider`/`verifierProvider` di `config.json` ke `"anthropic"`, `"openai"`, atau `"gemini"`, isi model id yang sesuai (cek dokumentasi resmi provider untuk nama model terkini), dan isi API key yang sesuai di `.env`. Tidak ada perubahan kode yang diperlukan — semua detail provider terisolasi di `src/llm-client.js`.

## Struktur Project

```
src/
  index.js               entrypoint (--once = manual, tanpa flag = scheduler)
  pipeline.js             orchestrator: urutan penuh + retry/backoff
  scheduler.js            node-cron, baca jadwal dari config.json
  topic-source.js         pool topik + dedupe, nama file media, atau berita (prioritas)
  news-source.js          fetch & parse RSS berita gaming (IGN, GameSpot)
  content-generator.js    generate caption via llm-client, sisip URL sumber berita
  verifier.js             self-verify caption (structured JSON output)
  image-generator.js      generate gambar fallback via llm-client (Cloudflare)
  llm-client.js           satu-satunya modul yang bicara ke SDK/API provider AI
  fb-publisher.js         satu-satunya modul yang bicara ke Facebook Graph API
  media-asset.js          scan/tulis/hapus file di assets/branding/
  store.js                SQLite: riwayat & audit trail
  logger.js               logger terstruktur (pino)
  config.js               loader config.json + .env
  errors.js               error class + klasifikasi retryable
prompts/
  style-guide.md          brand voice (termasuk aturan hashtag)
  generator-system.md     system prompt generator
  verifier-system.md      system prompt verifier
  image-style-guide.md    panduan visual gambar auto-generate
assets/branding/          taruh gambar/video di sini untuk posting otomatis
data/                     database SQLite (gitignored)
config.json               pengaturan non-rahasia
ecosystem.config.js       konfigurasi pm2
.env.example              template variabel environment
```

## Audit & Log

Setiap run (berhasil, ditahan untuk review, atau gagal) tercatat di `data/stik-satu.db` (SQLite), tabel `posts_history`: topik, caption, status, `fbPostId`, media yang dipakai, dan alasan kalau ditahan/gagal. Log runtime (JSON per baris, lewat `pino`) mencatat setiap tahap pipeline beserta durasinya.

## Troubleshooting

**`Invalid OAuth access token - Cannot parse access token` (code 190)**
Value di `FB_PAGE_ACCESS_TOKEN` salah bentuk — kemungkinan besar App Secret atau Client Token yang ke-taruh, bukan Page Access Token asli. Lihat bagian "Kesalahan umum" di atas.

**Permission `pages_manage_posts` dkk tidak muncul di Graph API Explorer**
Use case "Manage everything on your Page" di App kamu belum di-customize/permission-nya belum di-"+ Add". Lihat langkah 2 di atas.

**Model AI error 404 / "no longer available"**
Provider AI (terutama Gemini) cukup sering deprecate model lama untuk API key baru. Cek daftar model terkini langsung dari dokumentasi resmi provider sebelum mengisi `generatorModel`/`verifierModel` — jangan asumsikan nama model dari contoh manapun (termasuk dari README ini) masih berlaku.

**Caption terpotong/kosong dari Gemini**
Model dengan "adaptive thinking" (Gemini 3.x) bisa menghabiskan sebagian besar token budget untuk proses berpikir internal sebelum menghasilkan teks. Naikkan `llm.maxTokens` di `config.json` (1500+ biasanya aman).

**Topik yang sama terus muncul / topik baru tidak pernah dipakai**
Cek `dedupeWindowDays` di `config.json` dan isi `TOPIC_POOL` di `src/topic-source.js` — pool yang terlalu kecil relatif ke window dedupe akan sering kehabisan kandidat (pipeline akan `skip`, bukan error).

**Upload video gagal: `"There was a problem uploading your video file"` (code 6000)**
Error ini sudah diklasifikasikan retryable (pipeline otomatis coba lagi), tapi kalau tetap gagal terus untuk video tertentu meski format/ukurannya wajar (H.264/AAC, MP4 standar), kemungkinan videonya terdeteksi sistem hak cipta Facebook (umum terjadi untuk rekaman gameplay dari game komersial) — pesan errornya sengaja generik/tidak menyebut hak cipta secara eksplisit. Coba video lain yang jelas bukan gameplay untuk konfirmasi.

**Generate gambar gagal / `imageGeneration` selalu fallback ke teks**
Cek kuota Cloudflare Workers AI (`Ready for testing`/rate limit di dashboard Cloudflare) dan pastikan `CLOUDFLARE_ACCOUNT_ID`/`CLOUDFLARE_API_TOKEN` di `.env` benar. Ini tidak pernah menggagalkan publish — cuma fallback diam-diam ke teks, jadi cek log (`stage: "image-generator"`) untuk pesan error aslinya.

**Caption tidak ada hashtag**
Verifier seharusnya menolak caption tanpa hashtag (lihat kriteria di `prompts/verifier-system.md`) — kalau lolos tanpa hashtag, cek apakah `prompts/style-guide.md`/`generator-system.md` sempat diedit dan instruksi hashtag-nya hilang.

**`pm2 startup` gagal: `Error: Init system not found`**
Normal kalau dijalankan di Windows — pm2 cuma bisa mendeteksi init system Linux (systemd/upstart) atau macOS (launchd), tidak ada integrasi Windows. `pm2 start`/`pm2 save` tetap bisa dipakai untuk testing di Windows; `pm2 startup` cukup dijalankan nanti langsung di VPS Linux tempat production sungguhan berjalan.

**Topik berita tidak pernah muncul / selalu fallback ke pool**
Berita memang prioritas terendah — cek dulu apakah ada file media menunggu di `assets/branding/` (prioritas lebih tinggi). Kalau memang kosong tapi tetap tidak muncul, cek log (`stage: "news-source"`) untuk error fetch/parse per feed, atau kemungkinan semua artikel di feed sudah pernah dipakai (dedupe berdasarkan GUID, tidak diulang).
