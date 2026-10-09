// Regras, anti-spam e envio (Telegram + push via ntfy). Nenhum alerta sem estoque confirmado e produto identificado.
// Nota: só a oficial do Opportunity Engine (src/opportunity-read.js), nunca estimada. Sem nota oficial válida,
// regra que exige nota não dispara; preço-alvo, desconto, reposição e queda não dependem de nota.
import { money, pct } from './format.js';
import { officialLine } from './opportunity-read.js';

export const eligible = (o) => o.stock === 'IN_STOCK' && o.productId && o.matchConfidence >= 0.75 && !o.anomalous && !o.stale && o.total > 0;
const passFilter = (f = {}, o, p) => (!f.productId || f.productId === o.productId) && (!f.productType || f.productType === p.type) && (!f.collection || f.collection === p.collection);

/** Menor total entre as ofertas elegíveis (e confirmadas) de cada produto: Map(productId -> total). */
export function bestByProduct(offers) {
  const best = new Map();
  for (const o of offers || []) {
    if (!o || o.confirmed === false || !eligible(o)) continue;
    const b = best.get(o.productId); if (b == null || o.total < b) best.set(o.productId, o.total);
  }
  return best;
}

/** Melhor preço ANTERIOR por produto. Oferta que falhou na rodada passada (stale, ver src/run.js staleCopy) conta pela
 *  última leitura válida (lastValid): a volta dela ao mesmo preço não é queda. Stale sem lastValid fica de fora. */
export function prevBestOf(prevOffers) {
  return bestByProduct((prevOffers || []).map((o) => (o?.stale && o.lastValid ? { ...o, ...o.lastValid, stale: false } : o)));
}

/**
 * opts.opp: Map(id da oferta -> nota oficial válida, de officialFor). opts.log: avisos (regra antiga).
 * opts.prevBest: Map(productId -> menor total elegível da rodada anterior), de bestByProduct(ofertas anteriores).
 * Queda de preço só vale como NOVO MELHOR PREÇO do produto: a oferta com queda precisa ser a mais barata das elegíveis
 * agora e ficar abaixo do melhor da rodada anterior (sem melhor anterior: abaixo do "de" da própria queda). Chave por produto.
 */
export function evaluate(rules, offers, events, products, { opp = new Map(), log = () => {}, prevBest = new Map() } = {}) {
  const evBy = new Map(events.map((e) => [e.offerId + '|' + e.event, e]));
  // Produto vigiado (queda de preço, independe de nota): conta TODAS as regras, inclusive a antiga (legada).
  const watched = new Set(rules.flatMap((r) => (r.filter?.productId ? [r.filter.productId] : [])));
  // Regra antiga com minDealScore (Deal Score legado, outra escala): não dispara mais. Nunca vira filtro mais fraco.
  const legacy = rules.filter((r) => r.minDealScore != null && r.minOpportunityScore == null);
  for (const r of legacy) log(`[alertas] regra "${r.id}" usa minDealScore (Deal Score legado, desativado): ela não dispara. Troque por minOpportunityScore.`);
  rules = rules.filter((r) => !legacy.includes(r));
  const hits = new Map(); // rule|product -> melhor oferta
  const nowBest = bestByProduct(offers);
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
    const ev = evBy.get(o.id + '|drop');
    if (watched.has(o.productId) && ev && o.confirmed !== false && o.total === nowBest.get(o.productId)) {
      const before = prevBest.has(o.productId) ? prevBest.get(o.productId) : ev.from;
      const key = 'drop|' + o.productId;   // empate no menor total: vale a primeira oferta com queda
      if (before > 0 && o.total < before && !hits.has(key)) hits.set(key, { rule: { id: 'drop', label: 'Queda de preço' }, offer: o, product: p, kind: 'drop', from: before, opp: opp.get(o.id) || null });
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
  // Mercado Livre sem conferência por anúncio (stockVerified === false): o estoque não foi conferido, não "confirmado"
  const stockTxt = o.stockVerified === false ? 'não conferido (anúncio do Mercado Livre)' : o.quantity ? o.quantity + ' unidades' : 'confirmado';
  lines.push('', `Estoque: ${stockTxt}`, `Loja: ${o.storeName}${o.seller ? ' · ' + o.seller : ''}`);
  lines.push(`Frete: ${o.shipping === 0 ? 'grátis' : o.shipping > 0 ? money(o.shipping) : 'não informado'}`);
  const sl = officialLine(h.opp); if (sl) lines.push(sl);   // nota oficial; sem nota válida, a linha não aparece
  return { title: head, text: lines.join('\n'), url: o.url };
}

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
export const ALERT_TIMEOUT_MS = 10000;
const timeoutOf = (ctx) => (Number(ctx?.timeoutMs) > 0 ? Number(ctx.timeoutMs) : ALERT_TIMEOUT_MS);
// Canal: null = não configurado · true = entregue · false (ou erro, inclusive prazo esgotado) = falhou.
// Cada envio tem prazo próprio (AbortSignal.timeout, 10 s). ctx.fetchImpl/ctx.env/ctx.timeoutMs: testes.
export const transports = {
  async telegram(msg, ctx = {}) {
    const env = ctx.env || process.env; const token = env.TELEGRAM_BOT_TOKEN; const chat = env.TELEGRAM_CHAT_ID; if (!token || !chat) return null;
    const r = await (ctx.fetchImpl || fetch)(`https://api.telegram.org/bot${token}/sendMessage`, { method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(timeoutOf(ctx)),
      body: JSON.stringify({ chat_id: chat, text: esc(msg.text), parse_mode: 'HTML', disable_web_page_preview: true, reply_markup: { inline_keyboard: [[{ text: msg.button || 'COMPRAR', url: msg.url }]] } }) });
    return r.ok;
  },
  async ntfy(msg, ctx = {}) {
    const env = ctx.env || process.env; const topic = env.NTFY_TOPIC; if (!topic) return null;
    const r = await (ctx.fetchImpl || fetch)(env.NTFY_SERVER || 'https://ntfy.sh/', { method: 'POST', headers: { 'content-type': 'application/json' }, signal: AbortSignal.timeout(timeoutOf(ctx)),
      body: JSON.stringify({ topic, title: msg.title, message: msg.text.split('\n').slice(2).filter(Boolean).join('\n'), click: msg.url, priority: 4, actions: [{ action: 'view', label: msg.button ? 'Ver pista' : 'Comprar', url: msg.url }] }) });
    return r.ok;
  },
};

// Envia por todos os canais. Canal que falhou 2× seguidas na rodada fica fora do resto dela (conta como falha, sem
// esperar o prazo de novo): numa queda geral do canal, a rodada não fica parada esperando timeout de cada alerta.
async function deliver(msg, send, ctx, down) {
  const ok = []; const failed = [];
  for (const [name, fn] of Object.entries(send)) {
    if ((down[name] || 0) >= 2) { failed.push(name); continue; }
    let r; try { r = await fn(msg, ctx); } catch { r = false; }
    if (r == null) continue;                                   // canal não configurado
    if (r) { ok.push(name); down[name] = 0; } else { failed.push(name); down[name] = (down[name] || 0) + 1; }
  }
  return { channels: ok, failed, allFailed: failed.length > 0 && ok.length === 0 };
}

// Alerta de evento (queda, reposição, pista) não se repete sozinho na rodada seguinte: se todos os canais falharam,
// fica numa fila (data/alerts-retry.json) e é refeito enquanto a condição valer, por até RETRY_MAX_H horas.
export const RETRY_MAX_H = 3;
const RETRY_KINDS = new Set(['drop', 'restock', 'tip']);
function failedSend(h, d, { now, failed, retry }) {
  failed?.push({ kind: h.kind, rule: h.rule.id, productId: h.offer.productId, total: h.offer.total, channels: d.failed });
  if (retry && RETRY_KINDS.has(h.kind)) retry[h.key] = { at: retry[h.key]?.at || now.toISOString(), kind: h.kind, ruleId: h.rule.id, ruleLabel: h.rule.label ?? null,
    offerId: h.offer.id ?? null, productId: h.offer.productId, total: h.offer.total, from: h.from ?? null };
}

/**
 * Entregue = pelo menos um canal aceitou → marca como enviado. Todos os canais configurados falharam → NÃO marca
 * (tenta de novo na próxima rodada) e vai para opts.failed. Nenhum canal configurado → marca, como sempre ("só painel").
 * opts.retry: fila de reenvio (ver acima). opts.down: estado dos canais na rodada (compartilhado com dispatchTips).
 */
export async function dispatch(hits, sent, { send = transports, now = new Date(), failed = null, retry = null, down = {}, timeoutMs } = {}) {
  const delivered = [];
  for (const h of hits) {
    const msg = compose(h); const d = await deliver(msg, send, { timeoutMs }, down);
    if (d.allFailed) { failedSend(h, d, { now, failed, retry }); continue; }
    if (retry) delete retry[h.key];
    const channels = d.channels;
    sent[h.key] = { at: now.toISOString(), total: h.offer.total, discount: h.offer.discount ?? null, offerId: h.offer.id };
    delivered.push({ at: now.toISOString(), kind: h.kind, rule: h.rule.id, ruleLabel: h.rule.label, offerId: h.offer.id, productId: h.offer.productId, total: h.offer.total, channels, text: msg.text, url: msg.url });
  }
  return delivered;
}

/** Linha de log das falhas de envio: só tipo, produto, preço e nome dos canais (nunca token, chat ou URL). */
export const failedLine = (failed) => `[alertas] envio falhou em todos os canais: ${failed.map((f) => `${f.kind} ${f.productId} ${f.total} (${f.channels.join('/')})`).join('; ')} · tenta de novo na próxima rodada`;

/** Remove da fila o que passou de RETRY_MAX_H horas. */
export function pruneRetry(retry, now = Date.now(), maxAgeH = RETRY_MAX_H) {
  for (const [k, e] of Object.entries(retry || {})) if (!e || !(now - Date.parse(e.at) <= maxAgeH * 3600e3)) delete retry[k];
  return retry;
}

/**
 * Refaz os alertas de evento da fila que ainda valem agora: queda → a oferta mais barata elegível do produto, se
 * continua no preço da queda ou abaixo; reposição → a mesma oferta, elegível. Pistas: ver tipHits (opts.retry).
 */
export function retryHits(retry, offers, products, rules = [], { opp = new Map() } = {}) {
  const out = []; const best = bestByProduct(offers);
  const byId = new Map(offers.map((o) => [o.id, o]));
  for (const [key, e] of Object.entries(retry || {})) {
    if (!e || !products[e.productId]) continue;
    if (e.kind === 'drop') {
      const b = best.get(e.productId); if (b == null || !(b <= e.total)) continue;
      const o = offers.find((x) => x.productId === e.productId && x.confirmed !== false && eligible(x) && x.total === b);
      out.push({ key, rule: { id: 'drop', label: 'Queda de preço' }, offer: o, product: products[e.productId], kind: 'drop', from: e.from, opp: opp.get(o.id) || null });
    } else if (e.kind === 'restock') {
      const o = byId.get(e.offerId); if (!o || o.confirmed === false || !eligible(o)) continue;
      const rule = rules.find((r) => r.id === e.ruleId) || { id: e.ruleId, label: e.ruleLabel };
      out.push({ key, rule, offer: o, product: products[e.productId], kind: 'restock', opp: opp.get(o.id) || null });
    }
  }
  return out;
}

// Pistas (Pelando/Telegram): avisam só quando o produto foi identificado, o preço Copag está confirmado
// e o desconto passa do mínimo. Sempre marcadas como não verificadas (sem estoque confirmado).
export function tipHits(tips, sent, { tipMinDiscount = 0.15, retry = null } = {}) {
  return tips.filter((t) => (t.isNew || retry?.['tip|' + t.id]) && t.productId && t.msrp && t.price && !t.anomalous && !t.expired && t.discount >= tipMinDiscount && !sent['tip|' + t.id]);
}
export function composeTip(t) {
  const lines = ['💡 PISTA (NÃO VERIFICADA)', '', t.collectionName.toUpperCase(), t.label, '', money(t.price), ...(t.store ? [`Loja: ${t.store}`] : []), '', `Copag: ${money(t.msrp)}`, `↓ ${pct(t.discount)}`];
  if (t.perBooster) lines.push(`${money(t.perBooster)} / booster`);
  lines.push('', `Fonte: ${t.source}`, 'Estoque e vendedor não confirmados. Confira antes de comprar.');
  return { title: '💡 Pista: ' + t.label, text: lines.join('\n'), url: t.url, button: 'VER PROMOÇÃO' };
}
export async function dispatchTips(hits, sent, { send = transports, now = new Date(), failed = null, retry = null, down = {}, timeoutMs } = {}) {
  const delivered = [];
  for (const t of hits) {
    const msg = composeTip(t); const d = await deliver(msg, send, { timeoutMs }, down);
    const key = 'tip|' + t.id;
    if (d.allFailed) { failedSend({ key, kind: 'tip', rule: { id: 'pista', label: 'Pista' }, offer: { id: null, productId: t.productId, total: t.price } }, d, { now, failed, retry }); continue; }
    if (retry) delete retry[key];
    sent[key] = { at: now.toISOString(), total: t.price };
    delivered.push({ at: now.toISOString(), kind: 'tip', rule: 'pista', ruleLabel: 'Pista', productId: t.productId, total: t.price, channels: d.channels, text: msg.text, url: msg.url });
  }
  return delivered;
}
