> **⚠️ DRAFT AWAL — BELUM DIREVIEW**
> Sama seperti `style-guide.md`, ini starting point berdasarkan `docs/01-PRD.md` §8 (branding: logo badge, cover PlayStation-inspired, font Baloo 2 ExtraBold) — bukan panduan visual final. Suminar perlu review/revisi, terutama soal aman-tidaknya secara hak cipta sebelum dipakai produksi.

# Panduan Visual — Image Generation Stik Satu

## Kenapa panduan ini penting (baca dulu sebelum ubah)

Gambar di-generate otomatis oleh AI **hanya sebagai fallback** kalau tidak ada file di `assets/branding/` — tujuannya post tetap ada elemen visual, bukan menggantikan foto/clip asli. Karena ini di-generate otomatis tanpa review manusia per-post, **prompt harus dirancang supaya AMAN secara hak cipta dan brand secara default**, bukan mengandalkan model "kebetulan" tidak melanggar.

## Yang WAJIB dihindari dalam prompt

- **Jangan sebutkan/deskripsikan karakter, logo, atau adegan spesifik dari game berhak cipta tertentu** (mis. "Kratos dari God of War", "logo PlayStation asli", "cutscene Uncharted 4"). Model image-gen bisa saja meniru rupa karakter/asset asli dari data latihannya — ini persis risiko yang bikin video gagal diupload sebelumnya (kemungkinan besar karena konten game asli).
- Jangan minta render logo/merek dagang apa pun (PlayStation, Xbox, Nintendo, nama game spesifik sebagai teks/logo dalam gambar).
- Jangan minta teks/tulisan di dalam gambar — model image-gen umumnya tidak akurat merender teks, hasilnya sering jadi tulisan acak/rusak.
- Jangan minta wajah/rupa orang nyata (streamer, developer, publik figur).

## Yang HARUS dipakai — gaya generik/abstrak

- **Mood & suasana**, bukan adegan spesifik: siluet controller/headset gaming, cahaya neon biru-ungu ala PlayStation, ruangan gaming setup yang atmosferik, layar TV menyala di ruangan gelap, dsb.
- Elemen abstrak yang merepresentasikan *perasaan* dari topik (semangat, nostalgia, ketegangan, kepuasan) — bukan menggambarkan game/karakter yang jadi topik ceritanya secara literal.
- Palet warna konsisten dengan branding: nuansa biru-hitam ala PlayStation, aksen neon, modern/sleek — bukan kartun ceria atau realistis foto-jurnalistik.
- Komposisi vertikal/portrait (cocok untuk feed Facebook mobile) kalau memungkinkan.

## Pola prompt yang disarankan

Gabungkan mood dari topik + gaya visual generik, contoh pola (bukan harus persis ini):

```
Atmospheric gaming setup scene, [mood dari topik, mis. "triumphant late-night victory feeling"],
silhouette of a gaming controller and glowing screen in a dark room, neon blue and purple lighting,
moody cinematic atmosphere, no text, no logos, no specific game characters, digital art style
```

## Catatan Revisi

1. Suminar perlu konfirmasi apakah pendekatan "generik/abstrak" ini sesuai selera visual yang diinginkan, atau ada gaya lain yang lebih pas.
2. Pertimbangkan bikin beberapa preset mood (nostalgia, kemenangan, santai, penasaran) yang dipetakan dari kategori/kata kunci topik, daripada generate prompt on-the-fly sepenuhnya oleh AI.
