// "Encaminhar para o bot": você manda um link ou texto de promoção para o seu bot do Telegram
// (ex.: compartilhado de um grupo de WhatsApp) e, na rodada seguinte, ele responde se vale a pena.
// Só atende o seu chat (TELEGRAM_CHAT_ID). Respeita robots.txt; loja que bloqueia robô = avisa e usa o texto da mensagem.
import { get, getJson } from './http.js';
import { guard } from './adapters/common.js';
import { parseProductPage } from './adapters/jsonld.js';
import { matchProduct } from './match.js';
import { firstPrice } from './tips.js';
import { money, pct } from './format.js';

const api = (m, body) => fetch(`https://api.telegram.org/bot${process.env.TELEGRAM_BOT_TOKEN}/${m}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
const STOCK = { IN_STOCK: 'em estoque', OUT_OF_STOCK: 'esgotado', PRE_ORDER: 'pré-venda', UNKNOWN: 'estoque não informado' };

async function readLink(url) {
  const ml = url.match(/MLB-?(\d{6,})/i);
  if (ml && /mercadoli[vb]re|meli/i.test(url)) {
    const token = process.env.ML_ACCESS_TOKEN;
    if (!token) return { note: 'Mercado Livre só pela API oficial (sem token configurado), usei o texto da mensagem.' };
    const j = await getJson(`https://api.mercadolibre.com/items/MLB${ml[1]}`, { headers: { authorization: `Bearer ${token}` } });
    if (j.condition && j.condition !== 'new') return { note: 'Anúncio de produto usado.', reject: true };
    return { title: j.title, price: j.price, stock: j.available_quantity > 0 && j.status === 'active' ? 'IN_STOCK' : 'OUT_OF_STOCK', url: j.permalink || url, read: 'API do Mercado Livre' };
  }
  await guard(url);
  const r = await get(url);
  const l = parseProductPage(r.text, r.url);
  if (!l) return { note: 'Não achei dados de produto nessa página, usei o texto da mensagem.' };
  return { title: l.title, price: l.price?.pix || l.price?.base, stock: l.stock, url: r.url, read: new URL(r.url).hostname.replace(/^www\./, '') };
}

export async function verdict({ title, price, stock }, catalog, copagOf) {
  const m = matchProduct({ title }, catalog);
  if (!m.productId) return { ok: false, lines: [`Não identifiquei o produto (${m.why.join('; ') || 'título incompleto'}).`] };
  const p = m.product; const c = copagOf(p);
  const lines = [`${p.collectionName}: ${p.typeLabel}${p.boosters ? ` com ${p.boosters} boosters` : ''}${p.variant ? ' ' + p.variant : ''}`];
  if (price) lines.push(`Preço: ${money(price)}${p.boosters ? ` (${money(price / p.boosters)} por booster)` : ''}`); else lines.push('Não achei o preço.');
  if (c?.msrp) {
    lines.push(`Copag: ${money(c.msrp)}`);
    if (price) {
      const d = 1 - price / c.msrp;
      if (price < c.msrp * 0.55) lines.push('⚠️ Barato demais: 45% abaixo da Copag ou mais. Pode ser golpe, usado ou importado.');
      else lines.push(d >= 0.15 ? `✅ Vale: ${pct(d)} abaixo da Copag.` : d > 0 ? `🟡 Só ${pct(d)} abaixo da Copag.` : `❌ ${pct(-d)} acima da Copag.`);
    }
  } else lines.push('Sem preço Copag confirmado para comparar.');
  if (stock) lines.push(`Estoque: ${STOCK[stock] || stock}`);
  return { ok: true, productId: m.productId, lines };
}

export async function processInbox(state, catalog, copagOf, log = () => {}) {
  const token = process.env.TELEGRAM_BOT_TOKEN; const chat = String(process.env.TELEGRAM_CHAT_ID || '');
  if (!token || !chat) return { handled: 0 };
  const res = await api('getUpdates', { offset: state.offset || 0, timeout: 0, allowed_updates: ['message'] });
  if (!res.ok) { log(`[bot] getUpdates: ${res.description}`); return { handled: 0 }; }
  let handled = 0;
  for (const u of res.result || []) {
    state.offset = u.update_id + 1;
    const msg = u.message; if (!msg || String(msg.chat?.id) !== chat) continue; // só o seu chat
    const text = msg.text || msg.caption || ''; if (!text.trim() || /^\/start/.test(text)) continue;
    const urls = [...new Set([...text.matchAll(/https?:\/\/[^\s<>"')]+/g)].map((m) => m[0]))].slice(0, 3);
    const bodyTitle = text.replace(/https?:\/\/\S+/g, ' ').split('\n').map((l) => l.trim()).filter(Boolean).slice(0, 4).join(' ');
    let info = { title: bodyTitle, price: firstPrice(text), stock: null }; const notes = [];
    for (const url of urls) {
      try { const r = await readLink(url); if (r.reject) { notes.push(r.note); info = null; break; } if (r.title) { info = { title: r.title, price: r.price || info.price, stock: r.stock, url: r.url }; notes.push(`Li a página (${r.read}).`); break; } if (r.note) notes.push(r.note); }
      catch (e) { const h = new URL(url).hostname.replace(/^www\./, ''); notes.push(e.blocked ? `${h} bloqueia leitura automática, usei o texto da mensagem.` : `${h} não abriu a página para o robô (${e.status ? 'erro ' + e.status : e.message}), usei o texto da mensagem.`); }
    }
    const v = info ? await verdict(info, catalog, copagOf) : { lines: [] };
    const reply = ['🔎 Análise da promoção', '', ...v.lines, ...(notes.length ? ['', ...notes] : []), '', 'Confira estoque e vendedor antes de comprar.'].join('\n');
    await api('sendMessage', { chat_id: chat, text: reply, reply_to_message_id: msg.message_id, disable_web_page_preview: true });
    handled++;
  }
  return { handled };
}
