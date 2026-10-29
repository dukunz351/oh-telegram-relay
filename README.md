# Relay Telegram pribadi (satu orang, satu akun)

Bot Telegram yang bicara ke OpenHands, jalan **di akunmu sendiri**. Tidak ada
yang dibagi dengan orang lain: relay, penyimpanan, API key, dan token bot
semuanya milikmu. Tidak ada operator lain yang bisa melihat API key atau
obrolanmu — karena memang tidak ada server pihak lain yang terlibat.

- Telegram → OpenHands: Telegram mengirim tiap pesan ke Worker ini, Worker
  membangunkan sandbox conversation-mu dan meneruskan teksnya.
- OpenHands → Telegram: token bot disuntikkan sebagai secret conversation, jadi
  agen di sandbox-mu membalas langsung ke kamu.

Gratis dan tanpa batas. Cloudflare Worker dan KV ada di paket gratis, dan tiap
sesi memakai kuota akun OpenHands-mu sendiri. Tidak ada yang perlu dibeli, tidak
ada lisensi, dan tidak ada penghitung di bot ini.

## Tidak dijual, tidak dibeli

Kode ini dibagikan **gratis**. Penulis tidak menjualnya, tidak menjual akses,
tidak menjual langganan, dan tidak menerima pembayaran dalam bentuk apa pun untuk
relay ini — baik berupa uang, token, maupun jasa.

Kalau ada orang atau pihak yang **menjual, membeli, menyewakan, atau menawarkan
layanan yang persis seperti ini** — relay Telegram ke OpenHands, bot pribadi,
akses berbayar, atau paket langganan — **itu bukan penulis**, dan tidak ada
hubungannya dengan penulis.

- Penulis tidak meminta bayaran untuk kode ini.
- Penulis tidak menjual akses, kuota, atau langganan.
- Penulis tidak memungut biaya per pesan, per sesi, atau per pengguna.
- Penulis tidak punya rekening, halaman pembayaran, atau tautan donasi untuk ini.

Karena kodenya terbuka (MIT), siapa pun boleh memakainya, mengubahnya, bahkan
menjualnya — **tapi itu urusan mereka sendiri, dan bukan penulis.** Kalau kamu
membayar seseorang untuk ini, kamu membayar orang itu, bukan penulis.

## Peringatan & tanggung jawab

**Baca ini dulu.** Kode ini terbuka dan berjalan sepenuhnya di akunmu. Penulisnya
tidak memegang kendali apa pun: tidak ada server penulis, tidak ada lisensi,
tidak ada cara mematikan bot ini dari luar, dan tidak ada satu pun kredensialmu
yang melewati penulis.

Konsekuensinya:

- **Kalau terjadi kebocoran data, itu tanggung jawabmu, bukan penulisnya.**
  Yang bocor bisa berupa API key, token bot, isi obrolan, atau isi sandbox. Semua
  itu tersimpan di akun Cloudflare dan akun OpenHands milikmu sendiri.
- **Penulis tidak bisa menolong dan tidak bisa disalahkan**, karena penulis tidak
  punya akses ke akunmu maupun ke isi obrolanmu. Itu memang tujuan desainnya.
- **Kamu yang mengurus keamanan**: jaga token bot, jaga API key, batasi siapa
  yang bisa memakai bot, dan hapus Worker kalau tidak dipakai lagi.
- Perangkat lunak ini diberikan **"sebagaimana adanya"**, tanpa jaminan apa pun,
  seperti tertulis di `LICENSE` (MIT).

Kalau kamu tidak nyaman dengan tanggung jawab itu, jangan pasang bot ini.

## Pasang dengan satu klik

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/dukunz351/oh-telegram-relay)

Klik tombol di atas, izinkan Cloudflare memakai akunmu, lalu isi nilai yang
diminta:

| Nilai | Dari mana |
|---|---|
| `TELEGRAM_BOT_TOKEN` | chat @BotFather, kirim `/newbot`, salin tokennya |
| `OPENHANDS_API_KEY` | https://app.all-hands.dev → Settings → API Keys |
| `TELEGRAM_CHAT_ID` | lihat catatan di bawah |
| `TELEGRAM_WEBHOOK_SECRET` | teks acak buatanmu sendiri |

Cloudflare yang menyalin kode ini ke akunmu, jadi kamu tidak perlu terminal.
Setelah selesai, kirim `/whoami` ke bot-mu untuk melihat chat ID, lalu simpan
angka itu sebagai `TELEGRAM_CHAT_ID` dan deploy ulang.

## Pasang lewat terminal

Kalau lebih suka terminal, atau ingin memasang ulang dengan mudah:

```bash
git clone https://github.com/dukunz351/oh-telegram-relay && cd oh-telegram-relay
npx wrangler login     # buka browser, izinkan akun Cloudflare-mu
bash setup.sh
```

`setup.sh` akan meminta token bot dan API key, membuat KV namespace di akunmu,
deploy Worker, menyimpan 4 secret, memasang webhook Telegram, dan mengirim pesan
uji ke Telegram-mu. Ikuti saja instruksinya — saat diminta, kirim pesan apa saja
ke bot-mu supaya skrip bisa menemukan chat ID.

## Perintah

| Perintah | Fungsi |
|---|---|
| `/start` | buka sesi |
| `/start <pertanyaan>` | buka sesi sekaligus tanya |
| `/stop` | tutup sesi |
| `/menu` | cara pakai |
| `/whoami` | lihat chat ID |
| `/bayar` | penjelasan: tidak ada jatah & tidak ada yang dijual |

Setelah `/start`, kirim pesan biasa saja. Sesi tidak kedaluwarsa sampai `/stop`.

## Tanpa batasan

Bot ini **tidak punya jatah**. Tidak ada penghitung, tidak ada lisensi, dan tidak
ada cara penulis membatasimu — karena batasan seperti itu tidak mungkin ditegakkan
di kode yang kamu miliki sendiri. Kamu bisa `/start` sepuasnya.

Satu-satunya batas datang dari platform, bukan dari bot:

- **OpenHands**: 20 sandbox/hari per akun. Kalau habis, tunggu reset atau ajukan
  kenaikan di https://app.all-hands.dev/settings/quota
- **Cloudflare**: 100.000 request/hari di paket gratis. Jauh lebih dari cukup.

Karena penghitungnya tidak ada, tidak ada juga yang perlu diatur di
`wrangler.toml`.

## Distribusi (kalau kamu membagikannya)

Relay ini **aman dipublikasikan**. Di dalamnya tidak ada satu pun rahasia:
setiap kredensial menjadi Cloudflare secret milik pemasangnya. Publik juga
menghapus kecurigaan — siapa pun bisa memeriksa bahwa tidak ada data yang dikirim
ke mana-mana, karena kodenya memang tidak menghubungi server siapa pun.

Terbitkan dengan skrip di root workspace:

```bash
bash publish-relay.sh              # publik (disarankan)
bash publish-relay.sh --private    # kalau mau privat
```

Skrip itu menyalin 4 berkas relay, mengisi tombol Deploy dan tautan clone dengan
URL repo yang sebenarnya, lalu membuat repo dan mendorongnya.

## Kalau ada masalah

| Gejala | Penyebab umum |
|---|---|
| Bot diam saja | `TELEGRAM_WEBHOOK_SECRET` beda dengan yang dipasang di Telegram. Jalankan `bash setup.sh` lagi. |
| "Gagal mengirim ke OpenHands" | API key salah atau kuota habis. Cek di app.all-hands.dev. |
| Balasan tidak sampai padahal agen jalan | Token bot belum masuk sandbox. Cek: `/stop` lalu `/start` untuk membuat conversation baru. |
| `wrangler deploy` gagal | Sesi login habis. Jalankan `npx wrangler login` lagi. |

Log langsung:

```bash
npx wrangler tail
```

## Berhenti / hapus

```bash
npx wrangler delete        # hapus Worker + KV di akunmu
npx wrangler logout        # cabut akses Cloudflare
```

Lalu hapus bot di @BotFather (`/deletebot`) dan cabut API key di
app.all-hands.dev bila perlu. Tidak ada sisa di pihak lain.

## Isi folder

| Berkas | Fungsi |
|---|---|
| `worker.js` | seluruh logika relay (satu berkas) |
| `wrangler.toml` | konfigurasi Worker + cron keepalive |
| `setup.sh` | pemasangan sekali jalan |
| `README.md` | dokumen ini |
| `LICENSE` | MIT |

## Catatan teknis

- **Keepalive**: cron `*/5 * * * *` membangunkan sandbox sesi yang sedang terbuka
  supaya balasan berikutnya cepat. Sesi tertutup tidak menyentuh apa pun.
- **Secret per conversation**: `TELEGRAM_BOT_TOKEN` dikirim lewat field `secrets`
  saat membuat conversation, jadi token hanya ada di sandbox percakapan ini —
  bukan di sandbox percakapan lain.
- **Tanpa kredensial di berkas**: semua rahasia masuk sebagai Cloudflare secret.
  `worker.js` aman dibagikan/di-commit.
- **Tanpa panggilan ke luar**: relay ini hanya bicara ke Telegram dan OpenHands.
  Tidak ada telemetri, tidak ada server penulis, tidak ada lisensi.
- **Tanpa batas & tanpa kill switch**: tidak ada penghitung sesi dan tidak ada
  pemeriksaan lisensi. Penulis tidak punya cara membatasi atau mematikan bot ini
  dari jarak jauh, karena kodenya berjalan di akunmu.

## Kata kunci

Telegram bot, bot Telegram, AI agent, coding agent, OpenHands, Cloudflare
Workers, Cloudflare KV, serverless, edge computing, self-hosted, self-host,
relay, bridge, LLM, unlimited, tanpa batas, tanpa lisensi, BYO API key, bring
your own key, wrangler, workers.dev, webhook, cron keepalive, bot pribadi,
asisten kode, otomasi kode, coding assistant, agent sandbox, remote agent,
telegram relay, openhands telegram, telegram ai agent, cloudflare telegram bot,
telegram coding bot, self-hosted ai agent.
