// Atividade do mercado (o que mudou): quedas de preço, volta ao estoque, ofertas novas abaixo da Copag e novos menores preços.
// Só eventos com estoque confirmado e preço plausível. Guarda 7 dias em data/activity.json; o site mostra os mais recentes.
import fs from 'node:fs';
import { readJson, readJsonl, writeJson, dataPath } from './db.js';
import { trustedPoint } from './distrust.js';

const KEEP_MS = 7 * 864e5;
const FILE = () => dataPath('activity.json');
const WIN = 48 * 3600e3; // preço que vai e volta (vendedores alternando) não é queda: precisa ser o menor das últimas 48 h
// Preço de partida acima de 1,8x a Copag quase sempre é leitura errada (outro produto, kit): não vira "queda".
const plausible = (to, from, msrp) => to > 0 && !(msrp && to < msrp * 0.55) && !(from && to < from * 0.5) && !(from && msrp && from > msrp * 1.8);

// Primeira vez: monta a atividade a partir do history.jsonl (sem "novo menor preço", que precisa do estado da rodada).
function backfill(products, storeNames, now) {
  const rows = readJsonl(dataPath('history.jsonl')).filter((r) => r.offerId && r.t).sort((a, b) => a.t.localeCompare(b.t));
  if (!rows.length) return [];
  const firstRun = rows[0].t; const last = {}; const seen = {}; const out = [];
  for (const r of rows) {
    const p = products[r.productId]; const prev = last[r.offerId]; last[r.offerId] = r;
    const tt = Date.parse(r.t); const hist = (seen[r.offerId] ||= []).filter((x) => tt - x[0] <= WIN); const minPrev = hist.length ? Math.min(...hist.map((x) => x[1])) : null;
    if (r.stock === 'IN_STOCK' && r.total > 0) hist.push([tt, r.total]); seen[r.offerId] = hist;
    if (!p || r.stock !== 'IN_STOCK' || !(r.total > 0) || now - Date.parse(r.t) > KEEP_MS) continue;
    const base = { t: r.t, productId: r.productId, offerId: r.offerId, storeName: storeNames[r.storeId] || r.storeId, to: r.total, msrp: p.msrp ?? null };
    if (!prev) { if (r.t !== firstRun && p.msrp && r.total < p.msrp && plausible(r.total, null, p.msrp)) out.push({ ...base, type: 'new' }); continue; }
    if (prev.stock === 'OUT_OF_STOCK') out.push({ ...base, type: 'restock' });
    // Frete que passou a ser desconhecido (cotação vencida ou ausente) baixa o total sem baixar o preço: não é queda.
    else if (prev.total > 0 && r.total < prev.total && (prev.shipping == null) === (r.shipping == null) && (minPrev == null || r.total < minPrev) && plausible(r.total, prev.total, p.msrp)) out.push({ ...base, type: 'drop', from: prev.total });
  }
  return out;
}

export function recordActivity({ T, offers, prev, products, newLowest, quiet = new Set(), distrust = null, storeNames }) {
  const now = Date.parse(T);
  let log = readJson(FILE(), null);
  if (!Array.isArray(log)) log = backfill(products, storeNames, now);
  const fresh = []; const firstEver = !Object.keys(prev).length;
  for (const o of Object.values(offers)) {
    if (o.stale || o.anomalous || o.stock !== 'IN_STOCK' || !(o.total > 0) || quiet.has(o.storeId)) continue;
    const p = products[o.productId]; if (!p) continue;
    if (o.confirmed === false) continue; // leitura ainda não confirmada pela rodada seguinte
    // Base: a última leitura válida (lastValid de uma oferta stale), nunca o "estoque desconhecido" da falha.
    const raw = prev[o.id]; const old = raw?.stale ? raw.lastValid || null : raw;
    const base = { t: T, productId: o.productId, offerId: o.id, storeName: o.storeName, to: o.total, msrp: p.msrp ?? null };
    if (o.justConfirmed === 'new') { if (p.msrp && o.total < p.msrp && plausible(o.total, null, p.msrp)) fresh.push({ ...base, type: 'new' }); }
    else if (o.justConfirmed === 'drop') { if (plausible(o.total, o.dropFrom, p.msrp) && !log.some((e) => e.offerId === o.id && e.to <= o.total && now - Date.parse(e.t) <= WIN)) fresh.push({ ...base, type: 'drop', from: o.dropFrom }); }
    else if (!raw) { if (!firstEver && p.msrp && o.total < p.msrp && plausible(o.total, null, p.msrp)) fresh.push({ ...base, type: 'new' }); }
    else if (!old) { /* stale antiga sem leitura válida guardada: sem base, sem evento */ }
    else if (old.stock === 'OUT_OF_STOCK') fresh.push({ ...base, type: 'restock' });
    // Total que caiu só porque o frete deixou de ser conhecido não é queda (o preço não mudou).
    else if (old.total > 0 && o.total < old.total && !!old.shippingKnown === !!o.shippingKnown && plausible(o.total, old.total, p.msrp) && !log.some((e) => e.offerId === o.id && e.to <= o.total && now - Date.parse(e.t) <= WIN)) fresh.push({ ...base, type: 'drop', from: old.total });
    // Recorde que se repete a cada rodada (mesmo produto, mesmo valor ou maior) não é novidade.
    if (newLowest.has(o.id) && !log.some((e) => e.type === 'lowest' && e.productId === o.productId && e.to <= o.total && now - Date.parse(e.t) <= WIN)) fresh.push({ ...base, type: 'lowest', from: newLowest.get(o.id) });
  }
  log = [...log, ...fresh].filter((e) => now - Date.parse(e.t) <= KEEP_MS).slice(-600);
  writeJson(FILE(), log);
  // Eventos de lojas com leitura antiga não confiável ficam no arquivo, mas não vão para o site.
  const sid = (e) => offers[e.offerId]?.storeId || prev[e.offerId]?.storeId;
  // Só vai para o site evento de oferta que ainda existe (anúncio removido ou recusado pela trava some junto) e com valores plausíveis.
  return [...log].filter((e) => trustedPoint(distrust, sid(e), e.t) && offers[e.offerId] && offers[e.offerId].productId === e.productId && plausible(e.to, e.from, products[e.productId]?.msrp)).sort((a, b) => b.t.localeCompare(a.t));
}
