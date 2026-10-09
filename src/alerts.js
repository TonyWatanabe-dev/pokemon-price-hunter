// Regras, anti-spam e envio (Telegram + push via ntfy). Nenhum alerta sem estoque confirmado e produto identificado.
// Nota: só a oficial do Opportunity Engine (src/opportunity-read.js), nunca estimada. Sem nota oficial válida,
// regra que exige nota não dispara; preço-alvo, desconto, reposição e queda não dependem de nota.
import { money, pct } from './format.js';
import { officialLine } from './opportunity-read.js';

const eligible = (o) => o.stock === 'IN_STOCK' && o.productId && o.matchConfidence >= 0.75 && !o.anomalous && !o.stale && o.total > 0;
const passFilter = (f = {}, o, p) => (!f.productId || f.productId === o.productId) && (!f.productType || f.productType === p.type) && (!f.collection || f.collection === p.collection);

/** opts.opp: Map(id da oferta -> nota oficial válida, de officialFor). opts.log: avisos (regra antiga). */
export function evaluate(rules, offers, events, products, { opp = new Map(), log = () => {} } = {}) {
  const evBy = new Map(events.map((e) => [e.offerId + '|' + e.event, e]));
  // Produto vigiado (queda de preço, independe de nota): conta TODAS as regras, inclusive a antiga (legada).
  const watched = new Set(rules.flatMap((r) => (r.filter?.productId ? [r.filter.productId] : [])));
  // Regra antiga com minDealScore (Deal Score legado, outra escala): não dispara mais. Nunca vira filtro mais fraco.
  const legacy = rules.filter((r) => r.minDealScore != null && r.minOpportunityScore == null);
  for (const r of legacy) log(`[alertas] regra "${r.id}" usa minDealScore (Deal Score legado, desativado): ela não dispara. Troque por minOpportunityScore.`);
  rules = rules.filter((r) => !legacy.includes(r));
  const hits = new Map(); // rule|product -> melhor oferta
  for (const o of offers) {
    if (!eligible(o)) continue;
    const p = products[o.productId];
    for (const r of rules) {
      if (!passFilter(r.filter, o, p)) continue;
      let kind = null;
      if (r.restock) { if (evBy.has(o.id + '|restock')) kind = 'restock'; }
      else {
        if (r.minDiscount != null && !p.copagConfirmed) continue; // desconto exige Copag oficial; preço-alvo em R$ não
        const x = opp.get(o.id);
        if (r.minOpportunityScore != null && !x) continue;          // exige nota oficial válida (nunca estimada)
        const ok = (r.maxPrice == null || o.total <= r.maxPrice) && (r.maxPerBooster == null || (o.perBooster != null && o.perBooster <= r.maxPerBooster))
          && (r.minDiscount == null || o.discount >= r.minDiscount) && (r.minOpportunityScore == null || x.score >= r.minOpportunityScore);
        if (ok) kind = r.mode === 'target' ? 'target' : 'deal';
      }
      if (!kind) continue;
      const key = r.id + '|' + o.productId; const cur = hits.get(key);
      if (!cur || o.total < cur.offer.total) hits.set(key, { rule: r, offer: o, product: p, kind, opp: opp.get(o.id) || null });
    }
    if (watched.has(o.productId) && evBy.has(o.id + '|drop')) {
      const key = 'drop|' + o.id; hits.set(key, { rule: { id: 'drop', label: 'Queda de preço' }, offer: o, product: products[o.productId], kind: 'drop', from: evBy.get(o.id + '|drop').from, opp: opp.get(o.id) || null });
    }
  }
  return [...hits.entries()].map(([key, h]) => ({ key, ...h }));
}

export function dedupe(hits, sent, { cooldownHours = 6, minDropPct = 0.01 } = {}, now = Date.now(), offersById = {}) {
  const out = [];
  for (const h of hits) {
    const prev = sent[h.key];
    const o = h.offer;
    const better = prev && o.total < prev.total * (1 - minDropPct);
    const moreDiscount = prev && o.discount != null && prev.discount != null && o.discount >= prev.discount + 0.02;
    const old = prev && now - Date.parse(prev.at) > cooldownHours * 3600e3;
    const prevGone = prev && offersById[prev.offerId]?.stock !== 'IN_STOCK';
    const restockAgain = h.kind === 'restock' && old;
    if (!prev || better || moreDiscount || restockAgain || (old && prevGone)) out.push(h);
  }
  return out;
}

export function compose(h) {
  const { offer: o, product: p, kind } = h;
  const head = { target: '🎯 PREÇO-ALVO ATINGIDO', deal: '🔥 POKÉMON DEAL', restock: '🟢 RESTOCK', drop: '📉 QUEDA DE PREÇO' }[kind];
  const lines = [head, '', p.collectionName.toUpperCase(), p.typeLabel + (p.boosters ? ` com ${p.boosters} boosters` : '')];
  if (kind === 'drop') lines.push('', `${money(h.from)} → ${money(o.total)}`); else lines.push('', money(o.total) + ` (${o.priceKindLabel})`);
  lines.push('', p.copagConfirmed ? `Copag: ${money(p.msrp)}` : 'Copag: sem preço oficial');
  if (o.discount != null) lines.push(`↓ ${pct(o.discount)}`);
  if (o.perBooster) lines.push(`${money(o.perBooster)} / booster`);
  lines.push('', `Estoque: ${o.quantity ? o.quantity + ' unidades' : 'confirmado'}`, `Loja: ${o.storeName}${o.seller ? ' · ' + o.seller : ''}`);
  lines.push(`Frete: ${o.shipping === 0 ? 'grátis' : o.shipping > 0 ? money(o.shipping) : 'não informado'}`);
  const sl = officialLine(h.opp); if (sl) lines.push(sl);   // nota oficial; sem nota válida, a linha não aparece
  return { title: head, text: lines.join('\n'), url: o.url };
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const transports = {
  async telegram(msg) {
    const token = process.env.TELEGRAM_BOT_TOKEN; const chat = process.env.TELEGRAM_CHAT_ID; if (!token || !chat) return false;
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: esc(msg.text), parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: { inline_keyboard: [[{ text: msg.button || 'COMPRAR', url: msg.url }]] } }) });
    return r.ok;
  },
  async ntfy(msg) {
    const topic = process.env.NTFY_TOPIC; if (!topic) return false;
    const r = await fetch(process.env.NTFY_SERVER || 'https://ntfy.sh/', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ topic, title: msg.title, message: msg.text.split('\n').slice(2).filter(Boolean).join('\n'), click: msg.url, priority: 4, actions: [{ action: 'view', label: msg.button ? 'Ver pista' : 'Comprar', url: msg.url }] }) });
    return r.ok;
  },
};

export async function dispatch(hits, sent, { send = transports, now = new Date() } = {}) {
  const delivered = [];
  for (const h of hits) {
    const msg = compose(h); const channels = [];
    for (const [name, fn] of Object.entries(send)) { try { if (await fn(msg)) channels.push(name); } catch { /* canal indisponível */ } }
    sent[h.key] = { at: now.toISOString(), total: h.offer.total, discount: h.offer.discount ?? null, offerId: h.offer.id };
    delivered.push({ at: now.toISOString(), kind: h.kind, rule: h.rule.id, ruleLabel: h.rule.label, offerId: h.offer.id, productId: h.offer.productId, total: h.offer.total, channels, text: msg.text, url: msg.url });
  }
  return delivered;
}

// Pistas (Pelando/Telegram): avisam só quando o produto foi identificado, o preço Copag está confirmado
// e o desconto passa do mínimo. Sempre marcadas como não verificadas (sem estoque confirmado).
export function tipHits(tips, sent, { tipMinDiscount = 0.15 } = {}) {
  return tips.filter((t) => t.isNew && t.productId && t.msrp && t.price && !t.anomalous && !t.expired && t.discount >= tipMinDiscount && !sent['tip|' + t.id]);
}
export function composeTip(t) {
  const lines = ['💡 PISTA (NÃO VERIFICADA)', '', t.collectionName.toUpperCase(), t.label, '', money(t.price), ...(t.store ? [`Loja: ${t.store}`] : []), '', `Copag: ${money(t.msrp)}`, `↓ ${pct(t.discount)}`];
  if (t.perBooster) lines.push(`${money(t.perBooster)} / booster`);
  lines.push('', `Fonte: ${t.source}`, 'Estoque e vendedor não confirmados. Confira antes de comprar.');
  return { title: '💡 Pista: ' + t.label, text: lines.join('\n'), url: t.url, button: 'VER PROMOÇÃO' };
}
export async function dispatchTips(hits, sent, { send = transports, now = new Date() } = {}) {
  const delivered = [];
  for (const t of hits) {
    const msg = composeTip(t); const channels = [];
    for (const [name, fn] of Object.entries(send)) { try { if (await fn(msg)) channels.push(name); } catch { /* canal indisponível */ } }
    sent['tip|' + t.id] = { at: now.toISOString(), total: t.price };
    delivered.push({ at: now.toISOString(), kind: 'tip', rule: 'pista', ruleLabel: 'Pista', productId: t.productId, total: t.price, channels, text: msg.text, url: msg.url });
  }
  return delivered;
}
