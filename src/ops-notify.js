// Envio dos avisos do vigia: Telegram e ntfy, cada um com prazo próprio. Entregue = pelo menos um canal aceitou.
// Nenhum token aparece em erro ou log (a URL do Telegram contém o token e é mascarada).

const mask = (s, env) => {
  let out = String(s ?? '');
  for (const v of [env.TELEGRAM_BOT_TOKEN, env.NTFY_TOPIC, env.TELEGRAM_CHAT_ID].filter((x) => x && String(x).length >= 4)) out = out.split(String(v)).join('***');
  return out.replace(/bot\d+:[\w-]+/g, 'bot***').slice(0, 160);
};

async function post(fetchImpl, url, body, timeoutMs) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(new Error('tempo esgotado')), timeoutMs);
  try {
    const r = await fetchImpl(url, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ac.signal });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return true;
  } finally { clearTimeout(t); }
}

export const CHANNELS = {
  telegram: {
    configured: (env) => !!(env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID),
    send: (msg, env, f, ms) => post(f, `${env.TELEGRAM_API || 'https://api.telegram.org'}/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`,
      { chat_id: env.TELEGRAM_CHAT_ID, text: msg.text, disable_web_page_preview: true }, ms),
  },
  ntfy: {
    configured: (env) => !!env.NTFY_TOPIC,
    send: (msg, env, f, ms) => post(f, env.NTFY_SERVER || 'https://ntfy.sh/',
      { topic: env.NTFY_TOPIC, title: msg.title, message: msg.text, priority: msg.kind === 'recuperado' ? 3 : 4 }, ms),
  },
};

/** @returns {Promise<{ delivered: boolean, channels: Array<{ name: string, ok: boolean, skipped?: boolean, error?: string }> }>} */
export async function sendAll(msg, { env = process.env, fetchImpl = fetch, timeoutMs = 10000, channels = CHANNELS } = {}) {
  const results = await Promise.all(Object.entries(channels).map(async ([name, ch]) => {
    if (!ch.configured(env)) return { name, ok: false, skipped: true };
    try { await ch.send(msg, env, fetchImpl, timeoutMs); return { name, ok: true }; }
    catch (e) { return { name, ok: false, error: mask(e?.message || e, env) }; }
  }));
  return { delivered: results.some((r) => r.ok), channels: results };
}
