// Atividade do mercado (o que mudou): quedas de preço, volta ao estoque, ofertas novas abaixo da Copag e novos menores preços.
// Só eventos com estoque confirmado e preço plausível. Guarda 7 dias em data/activity.json; o site mostra os mais recentes.
import fs from 'node:fs';
import { readJson, readJsonl, writeJson, dataPath } from './db.js';
import { trustedPoint } from './distrust.js';

const KEEP_MS = 7 * 864e5;
const FILE = () => dataPath('activity.json');
const WIN = 48 * 3600e3; // preço que vai e volta (vendedores alternando) não é queda: precisa ser o menor das últimas 48 h
const plausible = (to, from, msrp) => to > 0 && !(msrp && to < msrp * 0.55) && !(from && to < from * 0.5);

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
    else if (prev.total > 0 && r.total < prev.total && (minPrev == null || r.total < minPrev) && plausible(r.total, prev.total, p.msrp)) out.push({ ...base, type: 'drop', from: prev.total });
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
    const old = prev[o.id];
    const base = { t: T, productId: o.productId, offerId: o.id, storeName: o.storeName, to: o.total, msrp: p.msrp ?? null };
    if (!old) { if (!firstEver && p.msrp && o.total < p.msrp && plausible(o.total, null, p.msrp)) fresh.push({ ...base, type: 'new' }); }
    else if (old.stock === 'OUT_OF_STOCK' && !old.stale) fresh.push({ ...base, type: 'restock' });
    else if (old.total > 0 && o.total < old.total && plausible(o.total, old.total, p.msrp) && !log.some((e) => e.offerId === o.id && e.to <= o.total && now - Date.parse(e.t) <= WIN)) fresh.push({ ...base, type: 'drop', from: old.total });
    if (newLowest.has(o.id)) fresh.push({ ...base, type: 'lowest', from: newLowest.get(o.id) });
  }
  log = [...log, ...fresh].filter((e) => now - Date.parse(e.t) <= KEEP_MS).slice(-600);
  writeJson(FILE(), log);
  // Eventos de lojas com leitura antiga não confiável ficam no arquivo, mas não vão para o site.
  const sid = (e) => offers[e.offerId]?.storeId || prev[e.offerId]?.storeId;
  return [...log].filter((e) => trustedPoint(distrust, sid(e), e.t)).sort((a, b) => b.t.localeCompare(a.t));
}
