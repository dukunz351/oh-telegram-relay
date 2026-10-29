/**
 * Personal Telegram <-> OpenHands relay.
 *
 * One deployment serves exactly ONE Telegram chat and uses exactly ONE
 * OpenHands account: yours. Nothing is shared with anyone else, and no other
 * operator sees your API key or your conversations.
 *
 * Telegram -> OpenHands: Telegram POSTs each message to /telegram, this Worker
 * resumes your conversation's sandbox and sends the text into it.
 * OpenHands -> Telegram: the bot token is injected into the conversation as a
 * secret, so the agent in your sandbox can reply to you directly.
 *
 * Self-contained, free, and unlimited: everything runs in your own Cloudflare
 * account, and this relay never contacts the author or any third party. There is
 * no licence, no quota, and no kill switch, because none of them could be
 * enforced in code you own.
 *
 * Deploy steps are in README.md. All configuration is Cloudflare secrets, so no
 * credential ever lives in this file.
 */

const OH_API = "https://app.all-hands.dev/api/v1";

const activeKey = (chatId) => `active:${chatId}`;
const convKey = (chatId) => `conv:${chatId}`;

const START_COMMANDS = ["/start"];
const STOP_COMMANDS = ["/stop", "/berhenti", "/keluar", "/selesai"];
const MENU_COMMANDS = ["/menu", "/help"];

const NEED_CHAT_TEXT =
  "TELEGRAM_CHAT_ID belum diisi di Worker ini. Kirim /whoami ke bot, lalu " +
  "simpan angka itu dengan `wrangler secret put TELEGRAM_CHAT_ID`.";

const MENU_TEXT = `Cara pakai bot ini:

/start              buka sesi
/start <pertanyaan> buka sesi sekaligus tanya
/stop               tutup sesi
/menu               tampilkan menu ini
/whoami             lihat chat ID kamu
/bayar              tidak ada jatah di bot ini — penjelasannya

Setelah /start, kirim pesan biasa saja. Sesi tidak punya kedaluwarsa: terus
aktif sampai kamu kirim /stop.

Tidak ada batas di bot ini. Yang membatasi cuma kuota akun OpenHands-mu
sendiri (platform: 20 sandbox/hari per akun).`;

const loginHint = () => `Bot ini memakai akun OpenHands milikmu sendiri. Yang membatasi
cuma kuota akun itu (platform: 20 sandbox/hari). Lihat
https://app.all-hands.dev/settings/quota`;

const quotaExhaustedText = () =>
  `Kuota sandbox akun OpenHands-mu habis untuk hari ini.\n\n` +
  `Ini kuota akunmu sendiri, bukan batas dari bot ini. Bot ini tidak punya batas. ` +
  `Tunggu reset, atau ajukan kenaikan di https://app.all-hands.dev/settings/quota`;

/** Shown by /bayar. There is nothing to buy: the limit lives in the platform. */
const upgradeText = (contact) =>
  `Bot ini tidak punya jatah dan tidak menjual apa pun.

Tidak ada lisensi, tidak ada langganan, dan tidak ada penghitung di bot ini.
Yang membatasi cuma kuota akun OpenHands-mu sendiri: platform memberi 20
sandbox/hari per akun.

Mau lebih banyak sesi? Itu urusan akun OpenHands-mu, bukan bot ini:
https://app.all-hands.dev/settings/quota` +
  (contact ? `\n\nTanya: ${contact}` : "");

/**
 * Reply instructions for the agent. The bot token reaches the sandbox as an
 * injected secret, so this only has to tell the agent how to send.
 */
function replyPreamble(chatId) {
  return `PETUNJUK TETAP untuk percakapan ini. Kamu melayani Telegram chat_id ${chatId} SAJA.
Setiap balasan ke pengguna HARUS dikirim dengan menjalankan satu perintah ini, jawaban ada di REPLY:

REPLY="<jawabanmu>" python3 - <<'PY'
import json, os, urllib.request, urllib.parse
tok = os.environ.get("TELEGRAM_BOT_TOKEN", "").strip()
if not tok:
    raise SystemExit("TELEGRAM_BOT_TOKEN tidak ada di sandbox ini")
data = urllib.parse.urlencode({"chat_id": "${chatId}", "text": os.environ.get("REPLY", "(kosong)")}).encode()
r = json.loads(urllib.request.urlopen(urllib.request.Request(f"https://api.telegram.org/bot{tok}/sendMessage", data=data), timeout=25).read())
print("ok:", r.get("ok"), "|", r.get("description", ""))
PY

Jangan pernah mengirim ke chat_id lain. Jawab singkat, jelas, bahasa Indonesia.

`;
}

function parseCommand(text) {
  const m = /^(\/[a-zA-Z_]+)(?:@\S+)?\s*([\s\S]*)$/.exec(text);
  if (!m) return { command: null, arg: text.trim() };
  return { command: m[1].toLowerCase(), arg: m[2].trim() };
}

async function telegram(env, method, params) {
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(params),
  });
  return res.json();
}

function send(env, chatId, text) {
  return telegram(env, "sendMessage", { chat_id: chatId, text });
}

function ohHeaders(env, apiKey) {
  return {
    Authorization: `Bearer ${apiKey ?? env.OPENHANDS_API_KEY}`,
    "Content-Type": "application/json",
    Accept: "application/json",
  };
}

async function ohGet(env, path) {
  const r = await fetch(`${OH_API}${path}`, { headers: ohHeaders(env) });
  if (!r.ok) throw new Error(`GET ${path} -> ${r.status}`);
  return r.json();
}

async function ohPost(env, path, body) {
  const r = await fetch(`${OH_API}${path}`, {
    method: "POST",
    headers: ohHeaders(env),
    body: JSON.stringify(body ?? {}),
  });
  if (!r.ok) throw new Error(humanizeOhError(path, r.status, await r.text()));
  return r.json();
}

function humanizeOhError(path, status, raw) {
  const text = String(raw).slice(0, 300);
  if (/Daily sandbox limit of \d+ reached/i.test(text)) return "KUOTA_HABIS";
  return `${path} -> ${status} ${text}`;
}

async function isActive(env, chatId) {
  return (await env.WAKE_KV.get(activeKey(chatId))) !== null;
}

async function conversationOf(env, chatId) {
  return env.WAKE_KV.get(convKey(chatId));
}

async function sendMessage(env, conversationId, instruction) {
  const res = await fetch(`${OH_API}/app-conversations/${conversationId}/send-message`, {
    method: "POST",
    headers: ohHeaders(env),
    body: JSON.stringify({ content: [{ type: "text", text: instruction }] }),
  });
  if (!res.ok) throw new Error(`send-message -> ${res.status}`);
  return res.status;
}

async function sandboxOf(env, conversationId) {
  const data = await ohGet(env, `/app-conversations?ids=${conversationId}`);
  return Array.isArray(data) ? data[0] : data;
}

/** Resume the sandbox if it was reaped, so send-message does not fail. */
async function ensureSandboxRunning(env, conversationId) {
  const conv = await sandboxOf(env, conversationId);
  const sandboxId = conv?.sandbox_id;
  if (!sandboxId) throw new Error("conversation has no sandbox_id");
  if (conv?.sandbox_status === "RUNNING") return sandboxId;

  const res = await fetch(`${OH_API}/sandboxes/${sandboxId}/resume`, {
    method: "POST",
    headers: ohHeaders(env),
    body: "{}",
  });
  if (!res.ok) throw new Error(`resume ${sandboxId} -> ${res.status}`);

  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const cur = await sandboxOf(env, conversationId);
    if (cur?.sandbox_status === "RUNNING") return sandboxId;
  }
  throw new Error(`sandbox ${sandboxId} never reached RUNNING`);
}

/**
 * Start the dedicated conversation. The first message doubles as the reply
 * instructions, and TELEGRAM_BOT_TOKEN rides along as a conversation secret so
 * the agent can answer without this Worker in the loop.
 */
async function createConversation(env, chatId, instruction) {
  const created = await ohPost(env, "/app-conversations", {
    title: `Telegram ${chatId}`,
    llm_profile: "Default",
    secrets: { TELEGRAM_BOT_TOKEN: env.TELEGRAM_BOT_TOKEN },
    initial_message: {
      content: [{ type: "text", text: replyPreamble(chatId) + instruction }],
      run: true,
    },
  });

  const taskId = created?.id;
  if (!taskId) throw new Error("conversation start returned no task id");

  for (let i = 0; i < 20; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const task = await ohGet(env, `/app-conversations/start-tasks?ids=${taskId}`);
    const t = Array.isArray(task) ? task[0] : task;
    if (t?.app_conversation_id) {
      await env.WAKE_KV.put(convKey(chatId), t.app_conversation_id);
      return t.app_conversation_id;
    }
    if (t?.status === "ERROR") throw new Error(`conversation start failed: ${t.detail}`);
  }
  throw new Error("conversation never became ready");
}

/** Forward one message into OpenHands, starting the conversation if needed. */
async function deliver(env, chatId, instruction) {
  try {
    const existing = await conversationOf(env, chatId);
    if (existing) {
      await ensureSandboxRunning(env, existing);
      await sendMessage(env, existing, instruction);
      return;
    }
    await createConversation(env, chatId, instruction);
  } catch (e) {
    console.error("delivery failed:", e);
    if (e.message === "KUOTA_HABIS") {
      await send(env, chatId, quotaExhaustedText());
      return;
    }
    await send(env, chatId, `Gagal mengirim ke OpenHands: ${e.message}`);
  }
}

/** Worker-side commands never reach OpenHands, so they cost no quota. */
async function dispatch(env, chatId, text) {
  const { command, arg } = parseCommand(text);

  if (MENU_COMMANDS.includes(command) || command === null) {
    if (command === null && text.trim()) {
      // Plain text: only meaningful inside an open session.
      if (!(await isActive(env, chatId))) {
        await send(env, chatId, `Kirim /start dulu untuk membuka sesi.\n\n${loginHint()}`);
        return;
      }
      await deliver(env, chatId, text);
      return;
    }
    await send(env, chatId, MENU_TEXT);
    return;
  }

  if (command === "/whoami" || command === "/id") {
    await send(env, chatId, `chat_id kamu: ${chatId}`);
    return;
  }

  if (command === "/panduan") {
    await send(env, chatId, `${MENU_TEXT}\n\n${loginHint()}`);
    return;
  }

  if (command === "/bayar" || command === "/upgrade" || command === "/quota") {
    await send(env, chatId, `${upgradeText(env.UPGRADE_CONTACT)}\n\n${loginHint()}`);
    return;
  }

  if (START_COMMANDS.includes(command)) {
    if (!(await isActive(env, chatId))) {
      await env.WAKE_KV.put(activeKey(chatId), "1");
    }
    if (arg) await deliver(env, chatId, arg);
    else await send(env, chatId, "Sesi dibuka. Kirim pertanyaanmu.\n\n/menu untuk cara pakai.");
    return;
  }

  if (STOP_COMMANDS.includes(command)) {
    await env.WAKE_KV.delete(activeKey(chatId));
    await send(env, chatId, "Sesi ditutup. Kirim /start untuk mulai lagi.");
    return;
  }

  await send(env, chatId, MENU_TEXT);
}

/**
 * Keep an open session's sandbox warm. The runtime reaps idle sandboxes, and a
 * resumed sandbox is what makes the next reply fast. A closed session returns
 * immediately, so this is a no-op after /stop.
 */
async function keepalive(env) {
  const chatId = String(env.TELEGRAM_CHAT_ID ?? "");
  if (!chatId) return;
  if (!(await isActive(env, chatId))) return;
  const conv = await conversationOf(env, chatId);
  if (!conv) return;
  try {
    await ensureSandboxRunning(env, conv);
  } catch (e) {
    console.error("keepalive failed:", e);
  }
}

async function onWebhook(request, env) {
  if (
    env.TELEGRAM_WEBHOOK_SECRET &&
    request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.TELEGRAM_WEBHOOK_SECRET
  ) {
    return new Response("forbidden", { status: 403 });
  }

  let update;
  try {
    update = await request.json();
  } catch {
    return new Response("bad request", { status: 400 });
  }

  const msg = update?.message ?? update?.edited_message;
  const chatId = String(msg?.chat?.id ?? "");
  const text = msg?.text ?? msg?.caption ?? "";
  if (!chatId || !text) return new Response("ok");

  // One deployment, one chat: anything else is ignored, not answered.
  const owner = String(env.TELEGRAM_CHAT_ID ?? "");
  if (!owner) {
    await send(env, chatId, NEED_CHAT_TEXT);
    return new Response("ok");
  }
  if (chatId !== owner) {
    await send(env, chatId, "Bot ini bersifat pribadi dan tidak melayani chat lain.");
    return new Response("ok");
  }

  await dispatch(env, chatId, text);
  return new Response("ok");
}

export default {
  async fetch(request, env) {
    const { pathname } = new URL(request.url);
    if (request.method === "POST" && pathname === "/telegram") {
      return onWebhook(request, env);
    }
    if (pathname === "/health") return new Response("ok");
    return new Response("not found", { status: 404 });
  },

  async scheduled(_event, env, ctx) {
    ctx.waitUntil(keepalive(env));
  },
};
