// Pistas: promoções postadas por pessoas (Pelando, canais públicos do Telegram).
// Não são ofertas verificadas: sem estoque confirmado, nunca entram no ranking.
// Só leitura de páginas públicas, respeitando robots.txt. Nada de login, WhatsApp ou contorno de bloqueio.
import crypto from 'node:crypto';
import { get } from './http.js';
import { guard, brl } from './adapters/common.js';
import { matchProduct } from './match.js';

const hash = (s) => crypto.createHash('sha1').update(s).digest('hex').slice(0, 12);
const decode = (s) => s.replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')
  .replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16)));
const strip = (html) => decode(html.replace(/<br\s*\/?>/gi, '\n').replace(/<[^>]+>/g, ' ')).replace(/[ \t]+/g, ' ').replace(/\n\s+/g, '\n').trim();
const PRICE = /R\$\s?(\d{1,3}(?:\.\d{3})*(?:,\d{2})?|\d+(?:,\d{2})?)/;
// Preço da promoção: em "De: R$ 56,79 Por: R$ 46,00" vale o "Por". Sem isso, o primeiro preço do texto.
const POR = /\b(?:por|agora|apenas|só)\b[^R\n]{0,12}R\$\s?(\d{1,3}(?:\.\d{3})*(?:,\d{2})?|\d+(?:,\d{2})?)/i;
const DE = /\bde\b[^R\n]{0,12}R\$\s?\d/i;
export const firstPrice = (txt) => {
  const t = String(txt); const por = t.match(POR); if (por) return brl(por[1]);
  const all = [...t.matchAll(new RegExp(PRICE.source, 'g'))].map((m) => brl(m[1])).filter((v) => v > 0);
  if (!all.length) return null;
  return DE.test(t) && all.length > 1 ? Math.min(...all) : all[0];
};
const STORE_NAMES = { amazon: 'Amazon', 'mercado-livre': 'Mercado Livre', mercadolivre: 'Mercado Livre', shopee: 'Shopee', magalu: 'Magalu', 'magazine-luiza': 'Magalu', americanas: 'Americanas', 'casas-bahia': 'Casas Bahia', aliexpress: 'AliExpress' };
const storeFromHost = (u) => { try { const h = new URL(u).hostname.replace(/^www\./, ''); for (const [k, v] of Object.entries(STORE_NAMES)) if (h.includes(k.replace('-', ''))) return v; if (/amzn\./.test(h)) return 'Amazon'; if (/meli\.la|mercadolivre/.test(h)) return 'Mercado Livre'; return h; } catch { return null; } };

// Pelando: a busca é renderizada no servidor; cada promoção tem link /d/<slug>.
export function parsePelando(html) {
  const re = /href="(?:https:\/\/www\.pelando\.com\.br)?\/d\/([a-z0-9-]+)"[^>]*>([\s\S]*?)<\/a>/gi;
  const hits = [...html.matchAll(re)].map((m) => ({ slug: m[1], text: strip(m[2]), at: m.index }));
  const order = []; const by = new Map();
  for (const h of hits) { if (!by.has(h.slug)) { by.set(h.slug, { slug: h.slug, start: h.at, texts: [] }); order.push(h.slug); } by.get(h.slug).texts.push(h.text); }
  return order.map((slug, i) => {
    const d = by.get(slug); const end = i + 1 < order.length ? by.get(order[i + 1]).start : d.start + 6000;
    const chunk = html.slice(d.start, end); const txt = strip(chunk);
    const title = d.texts.filter((t) => t && !PRICE.test(t)).sort((a, b) => b.length - a.length)[0] || slug.replace(/-[a-z0-9]{4}$/, '').replace(/-/g, ' ');
    const store = chunk.match(/\/cupons-de-descontos\/([a-z0-9-]+)/i)?.[1];
    return { key: 'pelando:' + slug, source: 'Pelando', title, price: firstPrice(txt), store: store ? STORE_NAMES[store] || store.replace(/-/g, ' ') : null,
      url: `https://www.pelando.com.br/d/${slug}`, expired: /\b(expirad[oa]|encerrad[oa]|esgotad[oa])\b/i.test(txt), postedAt: null };
  }).filter((t) => t.title);
}

// Canal público do Telegram: prévia web em t.me/s/<canal>.
export function parseTelegram(html, channel) {
  const out = [];
  const parts = html.split(/<div class="tgme_widget_message_wrap/).slice(1);
  for (const p of parts) {
    const post = p.match(/data-post="([^"]+)"/)?.[1]; if (!post) continue;
    const body = p.match(/<div class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/)?.[1]; if (!body) continue;
    const text = strip(body);
    const links = [...body.matchAll(/href="(https?:\/\/[^"]+)"/g)].map((m) => decode(m[1])).filter((u) => !/^https?:\/\/(t\.me|telegram\.me)\//.test(u));
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    const title = lines.find((l) => /pok[eé]mon|booster|blister|treinador|box|cole[cç][aã]o|lata/i.test(l) && !/^https?:/.test(l)) || lines[0] || '';
    out.push({ key: 'tg:' + post, source: 'Telegram ' + channel, title: title.slice(0, 160), text: text.slice(0, 600), price: firstPrice(text),
      store: links[0] ? storeFromHost(links[0]) : null, url: links[0] || `https://t.me/${post}`, postUrl: `https://t.me/${post}`,
      expired: /\b(esgotou|esgotado|encerrad[oa]|acabou)\b/i.test(text), postedAt: p.match(/<time[^>]+datetime="([^"]+)"/)?.[1] || null });
  }
  return out;
}

const slugify = (q) => q.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const channelOf = (c) => String(c).trim().replace(/^@/, '').replace(/^https?:\/\/(t\.me|telegram\.me)\/(s\/)?/i, '').split(/[/?#]/)[0];

// Lê todas as fontes configuradas e devolve as pistas brutas (com produto identificado quando possível).
export async function collectTips(cfg, catalog, log = () => {}) {
  const raw = []; const status = [];
  for (const q of cfg.pelando?.buscas || []) {
    const url = `https://www.pelando.com.br/busca/${slugify(q)}`;
    try { await guard(url); const r = await get(url); const found = parsePelando(r.text); raw.push(...found); status.push({ source: 'Pelando: ' + q, ok: true, found: found.length }); }
    catch (e) { status.push({ source: 'Pelando: ' + q, ok: false, reason: e.message }); log(`[pistas] Pelando "${q}": ${e.message}`); }
  }
  for (const c of cfg.telegram || []) {
    const ch = channelOf(c); if (!/^[A-Za-z0-9_]{4,}$/.test(ch)) { status.push({ source: 'Telegram ' + c, ok: false, reason: 'use o @ ou o link t.me do canal' }); continue; }
    const url = `https://t.me/s/${ch}`;
    try {
      await guard(url); const r = await get(url);
      if (!/tgme_widget_message/.test(r.text)) throw new Error('canal privado, grupo ou nome errado (só canais públicos têm prévia)');
      const found = parseTelegram(r.text, ch); raw.push(...found); status.push({ source: 'Telegram @' + ch, ok: true, found: found.length });
    } catch (e) { status.push({ source: 'Telegram @' + ch, ok: false, reason: e.message }); log(`[pistas] Telegram ${ch}: ${e.message}`); }
  }
  const seen = new Set();
  const tips = raw.filter((t) => !seen.has(t.key) && seen.add(t.key)).map((t) => {
    const m = matchProduct({ title: t.title }, catalog);
    const alt = !m.productId && t.text ? matchProduct({ title: t.text.split('\n').slice(0, 3).join(' ') }, catalog) : null;
    const best = m.productId ? m : alt?.productId ? alt : m;
    return { ...t, id: hash(t.key), productId: best.productId || null, product: best.product || null, matchConfidence: best.confidence || 0, why: best.why || [] };
  });
  return { tips, status };
}

export { channelOf };
