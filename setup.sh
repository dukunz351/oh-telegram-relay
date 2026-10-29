#!/usr/bin/env bash
# One-shot setup for your own private Telegram <-> OpenHands relay.
#
# It creates a Cloudflare Worker in YOUR account, wires your Telegram bot to it,
# and stores your OpenHands API key as a Worker secret. Nobody else runs this
# relay and nobody else holds your credentials.
#
# Run:  bash setup.sh
#
# Requirements: Node.js + npm, and a Cloudflare login (`npx wrangler login`).
# The script installs wrangler for you if it is missing.

set -u

BOLD=$(printf '\033[1m'); DIM=$(printf '\033[2m'); OFF=$(printf '\033[0m')
say()  { printf '%s\n' "$*"; }
step() { printf '\n%s==> %s%s\n' "$BOLD" "$*" "$OFF"; }
die()  { printf '\n%sERROR:%s %s\n' "$BOLD" "$OFF" "$*" >&2; exit 1; }

cd "$(dirname "$0")" || die "tidak bisa masuk ke folder skrip"

# --- 0. tools ---------------------------------------------------------------
step "Memeriksa perkakas"
command -v node >/dev/null 2>&1 || die "Node.js belum terpasang. Pasang dulu: https://nodejs.org"
command -v npm  >/dev/null 2>&1 || die "npm belum terpasang (biasanya ikut Node.js)."

WR="npx --yes wrangler@latest"
if command -v wrangler >/dev/null 2>&1; then WR="wrangler"; fi
say "  wrangler: $WR"
say "  node:     $(node --version)"

# --- 1. credentials --------------------------------------------------------
step "Kredensial kamu"
say "  Dua hal ini hanya tersimpan di akun Cloudflare-mu, tidak dikirim ke mana pun."
say ""

if [ -z "${TELEGRAM_BOT_TOKEN:-}" ]; then
  printf '  Telegram bot token (dari @BotFather): '
  read -r TELEGRAM_BOT_TOKEN
fi
[ -n "$TELEGRAM_BOT_TOKEN" ] || die "bot token kosong"

if [ -z "${OPENHANDS_API_KEY:-}" ]; then
  printf '  OpenHands API key (app.all-hands.dev > Settings > API Keys): '
  read -r OPENHANDS_API_KEY
fi
[ -n "$OPENHANDS_API_KEY" ] || die "API key kosong"

step "Memeriksa API key OpenHands"
code=$(curl -sS -o /tmp/oh_check.json -w '%{http_code}' -m 30 \
  "https://app.all-hands.dev/api/quota/status" \
  -H "Authorization: Bearer $OPENHANDS_API_KEY" || echo 000)
if [ "$code" != "200" ]; then
  say "  respons: $code $(head -c 200 /tmp/oh_check.json 2>/dev/null)"
  die "API key OpenHands ditolak. Cek di app.all-hands.dev > Settings > API Keys."
fi
say "  OK — API key berlaku."

step "Memeriksa bot Telegram"
botid=$(curl -sS -m 30 "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getMe" \
  | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const d=JSON.parse(s);process.stdout.write(d.ok?d.result.username:"")}catch{}})')
[ -n "$botid" ] || die "token bot Telegram ditolak. Cek lagi dari @BotFather."
say "  OK — bot: @$botid"

# --- 2. chat id ------------------------------------------------------------
step "Mencari chat ID kamu"
say "  Buka Telegram, kirim pesan apa saja (misal: halo) ke @$botid sekarang."
say "  Menunggu sampai 60 detik..."
CHAT_ID=""
for _ in $(seq 1 20); do
  CHAT_ID=$(curl -sS -m 30 "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/getUpdates?timeout=3" \
    | node -e 'let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{try{const d=JSON.parse(s);for(const u of d.result||[]){const c=(u.message||u.edited_message||{}).chat||{};if(c.id){process.stdout.write(String(c.id));break}}}catch{}})')
  [ -n "$CHAT_ID" ] && break
  sleep 3
done
[ -n "$CHAT_ID" ] || die "belum ada pesan masuk. Jalankan skrip ini lagi setelah mengirim pesan ke @$botid."
say "  chat ID kamu: $CHAT_ID"

# --- 3. KV namespace -------------------------------------------------------
step "Membuat penyimpanan KV di akun Cloudflare-mu"
kvout=$($WR kv namespace create WAKE_KV 2>&1) || true
KV_ID=$(printf '%s' "$kvout" | grep -oE '[a-f0-9]{32}' | head -1)
if [ -z "$KV_ID" ]; then
  say "$kvout"
  die "gagal membuat KV namespace. Pastikan sudah 'npx wrangler login'."
fi
say "  KV id: $KV_ID"
KV_ID="$KV_ID" node -e '
const fs=require("fs");
const p="wrangler.toml";
fs.writeFileSync(p, fs.readFileSync(p,"utf8").replace(/^id = ".*"$/m, `id = "${process.env.KV_ID}"`));
'
say "  wrangler.toml diperbarui."

# --- 4. deploy -------------------------------------------------------------
step "Deploy Worker ke akunmu"
depout=$($WR deploy 2>&1) || { say "$depout"; die "deploy gagal. Pastikan 'npx wrangler login' sudah dilakukan."; }
say "$depout" | grep -E 'Deployed|Version ID|workers.dev' || say "$depout"
URL=$(printf '%s' "$depout" | grep -oE 'https://[a-zA-Z0-9._-]+\.workers\.dev' | head -1)
[ -n "$URL" ] || die "tidak menemukan URL Worker di keluaran deploy."
say "  URL: $URL"

# --- 5. secrets ------------------------------------------------------------
step "Menyimpan kredensial sebagai secret Worker"
WEBHOOK_SECRET=$(node -e 'process.stdout.write(require("crypto").randomBytes(24).toString("hex"))')
printf '%s' "$TELEGRAM_BOT_TOKEN"     | $WR secret put TELEGRAM_BOT_TOKEN     >/dev/null 2>&1 || die "gagal menyimpan TELEGRAM_BOT_TOKEN"
printf '%s' "$CHAT_ID"                | $WR secret put TELEGRAM_CHAT_ID       >/dev/null 2>&1 || die "gagal menyimpan TELEGRAM_CHAT_ID"
printf '%s' "$OPENHANDS_API_KEY"      | $WR secret put OPENHANDS_API_KEY      >/dev/null 2>&1 || die "gagal menyimpan OPENHANDS_API_KEY"
printf '%s' "$WEBHOOK_SECRET"         | $WR secret put TELEGRAM_WEBHOOK_SECRET >/dev/null 2>&1 || die "gagal menyimpan TELEGRAM_WEBHOOK_SECRET"
say "  4 secret tersimpan."

# --- 6. webhook ------------------------------------------------------------
step "Menghubungkan Telegram ke Worker-mu"
hook=$(curl -sS -m 30 "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook" \
  --data-urlencode "url=$URL/telegram" \
  --data-urlencode "secret_token=$WEBHOOK_SECRET" \
  --data-urlencode 'allowed_updates=["message","edited_message"]')
printf '%s' "$hook" | grep -q '"ok":true' || { say "$hook"; die "gagal memasang webhook Telegram."; }
say "  webhook terpasang."

# --- 7. verify -------------------------------------------------------------
step "Verifikasi"
curl -sS -m 30 "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/sendMessage" \
  --data-urlencode "chat_id=$CHAT_ID" \
  --data-urlencode "text=$(printf 'Relay pribadimu aktif.\n\nKetik /start lalu pertanyaanmu.\nKetik /menu untuk cara pakai.\n\nKuota sandbox: 20/hari dari akunmu sendiri.')" \
  >/dev/null && say "  pesan uji terkirim ke Telegram-mu."

cat <<EOF

${BOLD}Selesai.${OFF} Bot @$botid sekarang jalan di akunmu sendiri.

  Worker   : $URL
  Chat ID  : $CHAT_ID
  Penyimpanan: KV di akun Cloudflare-mu

Yang perlu diingat:
  - Kredensial hanya ada di akun Cloudflare-mu. Tidak ada pihak lain yang
    bisa membacanya.
  - Kuota sandbox 20/hari memakai akun OpenHands-mu sendiri.
  - Ubah/berhenti kapan saja: 'wrangler delete' lalu hapus bot di @BotFather.

Cek di Telegram: kirim /start.
EOF
