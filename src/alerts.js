// Regras, anti-spam e envio (Telegram + push via ntfy). Nenhum alerta sem estoque confirmado e produto identificado.
// Nota: só a oficial do Opportunity Engine (src/opportunity-read.js), nunca estimada. Sem nota oficial válida,
// regra que exige nota não dispara; preço-alvo, desconto, reposição e queda não dependem de nota.
import { money, pct } from './format.js';
import { officialLine } from './opportunity-read.js';
// Frete comparável (issue #84): mesma regra do servidor e do site (api/_lib/offer-rank.mjs, PR #182). Frete conhecido
// (ou grátis) compara por total; frete desconhecido nunca vence nem substitui uma oferta com frete conhecido; se todas
// forem desconhecidas, vence o menor preço e a mensagem diz "frete a calcular". Nunca se inventa frete: sem frete
// conhecido, o "total" da oferta é só o preço (src/run.js), e é ele que vale para preço-alvo, desconto e por booster.
import { shipKnown, byComparableTotal } from '../api/_lib/offer-rank.mjs';

/** Queda de preço na MESMA base (como api/_lib/offer-change.mjs): total com frete conhecido contra total com frete
 *  conhecido, ou preço contra preço com frete desconhecido. Frete que passou a ser (des)conhecido não é queda, e só
 *  estoque confirmado agora gera evento (estoque desconhecido nunca vira disponível). prev = última leitura válida. */
export function comparableDrop(prev, cur) {
  if (!prev || !cur || cur.stock !== 'IN_STOCK' || !(prev.total > 0) || !(cur.total > 0)) return null;
  if (shipKnown(prev) !== shipKnown(cur) || !(cur.total < prev.total)) return null;
  return { from: prev.total, shippingKnown: shipKnown(cur) };
}
// Registro antigo (sem a base do total gravada) segue comparável, como antes; com a base gravada, só na mesma base.
const sameBasis = (prev, o) => prev?.shippingKnown == null || prev.shippingKnown === shipKnown(o);

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
      // Melhor oferta do produto para a regra: "menor total" comparável (frete desconhecido não vence o conhecido).
      if (!cur || byComparableTotal(o, cur.offer) < 0) hits.set(key, { rule: r, offer: o, product: p, kind, opp: opp.get(o.id) || null });
    }
    const dropEv = evBy.get(o.id + '|drop');
    // Evento que traz a base do valor anterior (src/run.js) só vale na mesma base; evento sem a base segue como antes.
    if (watched.has(o.productId) && dropEv && (dropEv.fromShippingKnown == null || dropEv.fromShippingKnown === shipKnown(o))) {
      const key = 'drop|' + o.id; hits.set(key, { rule: { id: 'drop', label: 'Queda de preço' }, offer: o, product: products[o.productId], kind: 'drop', from: dropEv.from, opp: opp.get(o.id) || null });
    }
  }
  return [...hits.entries()].map(([key, h]) => ({ key, ...h }));
}

export function dedupe(hits, sent, settings, now = Date.now(), offersById = {}) {
  // Preferências ausentes (settings null/undefined) ou inválidas caem no padrão, sem lançar.
  const num = (v, d) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : d);
  const cooldownHours = num(settings?.cooldownHours, 6); const minDropPct = num(settings?.minDropPct, 0.01);
  const out = [];
  for (const h of hits) {
    const prev = sent[h.key];
    const o = h.offer;
    // "Mais barato" e "mais desconto" só na mesma base: preço sem frete não supera um total com frete conhecido.
    const better = prev && sameBasis(prev, o) && o.total < prev.total * (1 - minDropPct);
    const moreDiscount = prev && sameBasis(prev, o) && o.discount != null && prev.discount != null && o.discount >= prev.discount + 0.02;
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
  // Sem frete conhecido o valor é só o preço: a mensagem diz "+ frete" (sem valor inventado).
  const plus = shipKnown(o) ? '' : ' + frete';
  if (kind === 'drop') lines.push('', `${money(h.from)} → ${money(o.total)}${plus}`); else lines.push('', money(o.total) + plus + ` (${o.priceKindLabel})`);
  lines.push('', p.copagConfirmed ? `Copag: ${money(p.msrp)}` : 'Copag: sem preço oficial');
  if (o.discount != null) lines.push(`↓ ${pct(o.discount)}`);
  if (o.perBooster) lines.push(`${money(o.perBooster)} / booster`);
  lines.push('', `Estoque: ${o.quantity ? o.quantity + ' unidades' : 'confirmado'}`, `Loja: ${o.storeName}${o.seller ? ' · ' + o.seller : ''}`);
  lines.push(`Frete: ${shipKnown(o) && o.shipping === 0 ? 'grátis' : shipKnown(o) && o.shipping > 0 ? money(o.shipping) : 'a calcular'}`);
  if (o.source_timestamp && Number.isFinite(Date.parse(o.source_timestamp))) lines.push(`Lido em: ${new Date(o.source_timestamp).toISOString().replace('T', ' ').slice(0, 16)} UTC`);
  const sl = officialLine(h.opp); if (sl) lines.push(sl);   // nota oficial; sem nota válida, a linha não aparece
  return { title: head, text: lines.join('\n'), url: o.url };
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const transports = {
  async telegram(msg) {
    const token = process.env.TELEGRAM_BOT_TOKEN; const chat = process.env.TELEGRAM_CHAT_ID; if (!token || !chat) return null;
    const r = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chat, text: esc(msg.text), parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: { inline_keyboard: [[{ text: msg.button || 'COMPRAR', url: msg.url }]] } }) });
    return r.ok;
  },
  async ntfy(msg) {
    const topic = process.env.NTFY_TOPIC; if (!topic) return null;
    const r = await fetch(process.env.NTFY_SERVER || 'https://ntfy.sh/', { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ topic, title: msg.title, message: msg.text.split('\n').slice(2).filter(Boolean).join('\n'), click: msg.url, priority: 4, actions: [{ action: 'view', label: msg.button ? 'Ver pista' : 'Comprar', url: msg.url }] }) });
    return r.ok;
  },
};

// Envia a todos os canais. false/exceção = tentativa que falhou; null/undefined = canal não configurado (não conta como falha).
// failed = todos os canais configurados falharam.
async function sendAll(msg, send) {
  const channels = []; let failed = 0;
  for (const [name, fn] of Object.entries(send)) { try { const r = await fn(msg); if (r) channels.push(name); else if (r === false) failed++; } catch { failed++; /* canal indisponível */ } }
  return { channels, failed: !channels.length && failed > 0 };
}

// Preço-alvo/desconto: a condição persiste, então a próxima rodada gera o hit de novo e o retry é só não gravar.
// Queda, reposição e pista só existem na rodada da transição: em falha total vão para a fila de pendentes
// (campo pending em alerts-sent.json), aparecem no painel como falha e são reenviados nas rodadas seguintes.
const RETRY_BY_CONDITION = new Set(['target', 'deal']);
const PENDING_MAX_MS = 24 * 3600e3; // pendente mais velho que isso é informação vencida: sai da fila sem enviar

async function retryPending(sent, mine, handled, send, now) {
  const out = [];
  for (const [key, s] of Object.entries(sent)) {
    if (!s?.pending || !mine(key) || handled.has(key)) continue;
    if (now.getTime() - Date.parse(s.pending.since) > PENDING_MAX_MS) { delete s.pending; continue; }
    const { channels, failed } = await sendAll(s.pending.msg, send);
    if (failed) continue; // segue pendente, sem repetir no painel
    out.push({ at: now.toISOString(), ...s.pending.alert, channels, text: s.pending.msg.text, url: s.pending.msg.url, retried: true });
    delete s.pending;
  }
  return out;
}

export async function dispatch(hits, sent, { send = transports, now = new Date() } = {}) {
  const delivered = []; const handled = new Set();
  for (const h of hits) {
    const msg = compose(h); const { channels, failed } = await sendAll(msg, send);
    // Todos os canais configurados falharam num alerta que se repete: não grava, a próxima rodada tenta de novo (sem repetir no painel).
    if (failed && RETRY_BY_CONDITION.has(h.kind)) continue;
    const alert = { kind: h.kind, rule: h.rule.id, ruleLabel: h.rule.label, offerId: h.offer.id, productId: h.offer.productId, total: h.offer.total };
    sent[h.key] = { at: now.toISOString(), total: h.offer.total, shippingKnown: shipKnown(h.offer), discount: h.offer.discount ?? null, offerId: h.offer.id, ...(failed ? { pending: { since: now.toISOString(), msg, alert } } : {}) };
    handled.add(h.key);
    delivered.push({ at: now.toISOString(), ...alert, channels, text: msg.text, url: msg.url, ...(failed ? { failed: true } : {}) });
  }
  return [...delivered, ...await retryPending(sent, (k) => !k.startsWith('tip|'), handled, send, now)];
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
  const delivered = []; const handled = new Set();
  for (const t of hits) {
    const msg = composeTip(t); const { channels, failed } = await sendAll(msg, send);
    // Pista só é nova uma vez (isNew): falha total vai para a fila de pendentes em vez de sumir.
    const alert = { kind: 'tip', rule: 'pista', ruleLabel: 'Pista', productId: t.productId, total: t.price };
    sent['tip|' + t.id] = { at: now.toISOString(), total: t.price, ...(failed ? { pending: { since: now.toISOString(), msg, alert } } : {}) };
    handled.add('tip|' + t.id);
    delivered.push({ at: now.toISOString(), ...alert, channels, text: msg.text, url: msg.url, ...(failed ? { failed: true } : {}) });
  }
  return [...delivered, ...await retryPending(sent, (k) => k.startsWith('tip|'), handled, send, now)];
}
