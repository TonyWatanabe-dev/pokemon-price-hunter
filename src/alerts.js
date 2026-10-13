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

// Base de comparação do total (como comparableDrop e offer-change): total com frete conhecido só se compara com total
// com frete conhecido; preço sem frete, só com preço sem frete. A queda "real" é medida dentro da mesma base.
const basisOf = (o) => o.productId + (shipKnown(o) ? '|frete' : '|sem-frete');

/** Melhor oferta elegível (e confirmada) de cada produto em cada base de frete, pelo "menor total" comparável
 *  (byComparableTotal). Map(`${productId}|frete` ou `${productId}|sem-frete` -> oferta). */
export function bestByBasis(offers) {
  const best = new Map();
  for (const o of offers || []) {
    if (!o || o.confirmed === false || !eligible(o)) continue;
    const k = basisOf(o); const b = best.get(k); if (!b || byComparableTotal(o, b) < 0) best.set(k, o);
  }
  return best;
}

/** Melhor oferta ANTERIOR (ofertas da rodada passada) por produto e base, pela mesma regra. Oferta que falhou na
 *  rodada passada (stale, ver src/run.js staleCopy/lastValidOf) conta pela última leitura válida: voltar ao mesmo preço
 *  não é queda. Stale sem lastValid fica de fora (sem base). */
export function prevBestOf(prevOffers) {
  return bestByBasis((prevOffers || []).map((o) => (!o?.stale ? o : o.lastValid ? { ...o, ...o.lastValid, stale: false } : null)));
}

/**
 * opts.opp: Map(id da oferta -> nota oficial válida, de officialFor). opts.log: avisos (regra antiga).
 * opts.prevBest: melhor oferta da rodada anterior por produto e base de frete, de prevBestOf.
 * Queda de preço só vale como NOVO MELHOR PREÇO do produto na mesma base de frete: a oferta com queda precisa ser a
 * mais barata das elegíveis agora nessa base (empate no total vale) e ficar abaixo da melhor anterior dessa base (sem
 * melhor anterior: abaixo do "de" da própria queda, que já é da mesma base). Nunca compara preço sem frete com total
 * com frete. A chave segue a da main (drop|<id da oferta>), compatível com a fila pending de alerts-sent.json.
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
  const nowBest = bestByBasis(offers);
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
    if (watched.has(o.productId) && dropEv && (dropEv.fromShippingKnown == null || dropEv.fromShippingKnown === shipKnown(o))
      && o.confirmed !== false && o.total === nowBest.get(basisOf(o))?.total) {
      const pb = prevBest.get(basisOf(o)); const before = pb ? pb.total : dropEv.from;
      const key = 'drop|' + o.id;
      if (before > 0 && o.total < before) hits.set(key, { rule: { id: 'drop', label: 'Queda de preço' }, offer: o, product: p, kind: 'drop', from: before, opp: opp.get(o.id) || null });
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
// Prazo por envio: cada chamada a um canal tem no máximo ALERT_TIMEOUT_MS (10 s, como o vigia em src/ops-notify.js).
// Estourou = falha daquele canal (segue a fila pending abaixo); um canal travado não segura a rodada (job de 12 min).
export const ALERT_TIMEOUT_MS = 10000;
// Canal que falhou CHANNEL_DOWN_AFTER vezes seguidas na mesma chamada de dispatch/dispatchTips fica fora do resto dela
// (conta como falha sem nova tentativa): numa queda geral do canal, a rodada não espera o prazo a cada alerta.
export const CHANNEL_DOWN_AFTER = 2;
const timeoutOf = (ctx) => (Number(ctx?.timeoutMs) > 0 ? Number(ctx.timeoutMs) : ALERT_TIMEOUT_MS);
// Canal: null = não configurado · true = entregue · false (ou erro, inclusive prazo esgotado) = falhou.
// ctx.timeoutMs (prazo), ctx.env e ctx.fetchImpl: para testes; em produção valem process.env e fetch.
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

// Garantia do prazo também para canal que não repassa o signal ao fetch (ex.: canal injetado): passou do prazo = falha.
function withDeadline(p, ms) {
  let timer;
  const limit = new Promise((_, rej) => { timer = setTimeout(() => rej(Object.assign(new Error('prazo do envio esgotado'), { name: 'TimeoutError' })), ms); });
  return Promise.race([Promise.resolve(p), limit]).finally(() => clearTimeout(timer));
}

// Envia a todos os canais. false/exceção/prazo esgotado = tentativa que falhou; null/undefined = canal não configurado
// (não conta como falha). failed = todos os canais configurados falharam. io.down: falhas seguidas por canal nesta
// chamada; com CHANNEL_DOWN_AFTER ou mais, o canal é pulado e conta como falha (sem esperar o prazo de novo).
async function sendAll(msg, send, io = {}) {
  const channels = []; let failed = 0; const down = io.down || {}; const ms = timeoutOf(io);
  for (const [name, fn] of Object.entries(send)) {
    if ((down[name] || 0) >= CHANNEL_DOWN_AFTER) { failed++; continue; }
    let r; try { r = await withDeadline(fn(msg, { timeoutMs: ms }), ms); } catch { r = false; /* canal indisponível ou prazo esgotado */ }
    if (r) { channels.push(name); down[name] = 0; } else if (r === false) { failed++; down[name] = (down[name] || 0) + 1; }
  }
  return { channels, failed: !channels.length && failed > 0 };
}

// Preço-alvo/desconto: a condição persiste, então a próxima rodada gera o hit de novo e o retry é só não gravar.
// Queda, reposição e pista só existem na rodada da transição: em falha total vão para a fila de pendentes
// (campo pending em alerts-sent.json), aparecem no painel como falha e são reenviados nas rodadas seguintes.
const RETRY_BY_CONDITION = new Set(['target', 'deal']);
const PENDING_MAX_MS = 24 * 3600e3; // pendente mais velho que isso é informação vencida: sai da fila sem enviar

async function retryPending(sent, mine, handled, send, now, io) {
  const out = [];
  for (const [key, s] of Object.entries(sent)) {
    if (!s?.pending || !mine(key) || handled.has(key)) continue;
    if (now.getTime() - Date.parse(s.pending.since) > PENDING_MAX_MS) { delete s.pending; continue; }
    const { channels, failed } = await sendAll(s.pending.msg, send, io);
    if (failed) continue; // segue pendente, sem repetir no painel
    out.push({ at: now.toISOString(), ...s.pending.alert, channels, text: s.pending.msg.text, url: s.pending.msg.url, retried: true });
    delete s.pending;
  }
  return out;
}

// Retenção de alerts-sent.json (issue #314): sem poda o registro só ganha chaves. Entrada sem pending e com "at" mais
// velho que maxAgeDays sai; pendente (ainda na fila de reenvio, que tem limite próprio) e recente ficam. "at" inválido
// fica (não dá para provar que é velho). Pura: devolve um objeto novo, sem mexer em sent. Efeito: depois do prazo,
// condição que persiste (preço-alvo/desconto) pode avisar de novo, como uma regra sem histórico.
export const SENT_MAX_AGE_DAYS = 30;
export function pruneSent(sent, now = Date.now(), maxAgeDays = SENT_MAX_AGE_DAYS) {
  const t = now instanceof Date ? now.getTime() : Number(now); const maxMs = maxAgeDays * 24 * 3600e3;
  return Object.fromEntries(Object.entries(sent || {}).filter(([, s]) => s?.pending || !(t - Date.parse(s?.at) > maxMs)));
}

// Retenção de alerts.jsonl: sem limite o arquivo só cresce. Mantém as últimas maxLines linhas não vazias (GET /alerts
// lê só as últimas 200, então o resultado não muda enquanto maxLines >= 200). Pura: texto entra, texto sai.
export const ALERTS_LOG_MAX_LINES = 1000;
export function capJsonlLines(text, maxLines = ALERTS_LOG_MAX_LINES) {
  const lines = String(text || '').split('\n').filter(Boolean);
  if (lines.length <= maxLines) return null;
  return lines.slice(-maxLines).join('\n') + '\n';
}

// opts.timeoutMs: prazo por envio (padrão ALERT_TIMEOUT_MS). opts.down: falhas seguidas por canal (ver sendAll); vale
// para os alertas novos e para o reenvio dos pendentes desta mesma chamada.
export async function dispatch(hits, sent, { send = transports, now = new Date(), timeoutMs, down = {} } = {}) {
  const delivered = []; const handled = new Set(); const io = { timeoutMs, down };
  for (const h of hits) {
    const msg = compose(h); const { channels, failed } = await sendAll(msg, send, io);
    // Todos os canais configurados falharam num alerta que se repete: não grava, a próxima rodada tenta de novo (sem repetir no painel).
    if (failed && RETRY_BY_CONDITION.has(h.kind)) continue;
    const alert = { kind: h.kind, rule: h.rule.id, ruleLabel: h.rule.label, offerId: h.offer.id, productId: h.offer.productId, total: h.offer.total };
    sent[h.key] = { at: now.toISOString(), total: h.offer.total, shippingKnown: shipKnown(h.offer), discount: h.offer.discount ?? null, offerId: h.offer.id, ...(failed ? { pending: { since: now.toISOString(), msg, alert } } : {}) };
    handled.add(h.key);
    delivered.push({ at: now.toISOString(), ...alert, channels, text: msg.text, url: msg.url, ...(failed ? { failed: true } : {}) });
  }
  return [...delivered, ...await retryPending(sent, (k) => !k.startsWith('tip|'), handled, send, now, io)];
}

// Pistas (Pelando/Telegram): avisam só quando o produto foi identificado, o preço Copag está confirmado
// e o desconto passa do mínimo. Sempre marcadas como não verificadas (sem estoque confirmado).
// Pistas iguais (mesmo produto e preço) de fontes diferentes geram um só alerta: a marca tipp|<produto>|<preço> em sent
// vale por TIP_DEDUPE_HORAS (padrão 24h, opção tipDedupeHoras); preço diferente gera outro alerta.
export const TIP_DEDUPE_HORAS = 24;
const tipPriceKey = (t) => `tipp|${t.productId}|${t.price}`;
export function tipHits(tips, sent, { tipMinDiscount = 0.15, tipDedupeHoras = TIP_DEDUPE_HORAS, now = Date.now() } = {}) {
  const maxMs = tipDedupeHoras * 3600000; const seen = new Set();
  return tips.filter((t) => {
    if (!(t.isNew && t.productId && t.msrp && t.price && !t.anomalous && !t.expired && t.discount >= tipMinDiscount && !sent['tip|' + t.id])) return false;
    const k = tipPriceKey(t); const at = Date.parse(sent[k]?.at);
    if (seen.has(k) || now - at <= maxMs) return false;
    seen.add(k); return true;
  });
}
export function composeTip(t) {
  const lines = ['💡 PISTA (NÃO VERIFICADA)', '', t.collectionName.toUpperCase(), t.label, '', money(t.price), ...(t.store ? [`Loja: ${t.store}`] : []), '', `Copag: ${money(t.msrp)}`, `↓ ${pct(t.discount)}`];
  if (t.perBooster) lines.push(`${money(t.perBooster)} / booster`);
  lines.push('', `Fonte: ${t.source}`, 'Estoque e vendedor não confirmados. Confira antes de comprar.');
  return { title: '💡 Pista: ' + t.label, text: lines.join('\n'), url: t.url, button: 'VER PROMOÇÃO' };
}
export async function dispatchTips(hits, sent, { send = transports, now = new Date(), timeoutMs, down = {} } = {}) {
  const delivered = []; const handled = new Set(); const io = { timeoutMs, down };
  for (const t of hits) {
    const msg = composeTip(t); const { channels, failed } = await sendAll(msg, send, io);
    // Pista só é nova uma vez (isNew): falha total vai para a fila de pendentes em vez de sumir.
    const alert = { kind: 'tip', rule: 'pista', ruleLabel: 'Pista', productId: t.productId, total: t.price };
    sent['tip|' + t.id] = { at: now.toISOString(), total: t.price, ...(failed ? { pending: { since: now.toISOString(), msg, alert } } : {}) };
    sent[tipPriceKey(t)] = { at: now.toISOString(), total: t.price };
    handled.add('tip|' + t.id);
    delivered.push({ at: now.toISOString(), ...alert, channels, text: msg.text, url: msg.url, ...(failed ? { failed: true } : {}) });
  }
  return [...delivered, ...await retryPending(sent, (k) => k.startsWith('tip|'), handled, send, now, io)];
}

// Limite diário por usuário: deixa passar só as vagas restantes (max - já entregues), preservando a ordem.
export function capPerUser(hits, deliveredToday, max) {
  const left = Math.max(0, Math.floor(Number(max) || 0) - Math.max(0, Math.floor(Number(deliveredToday) || 0)));
  return (hits || []).slice(0, left);
}
