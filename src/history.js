// Histórico de preço por produto e por loja: um arquivo pequeno por produto em data/hist/<id>.json,
// com o menor preço total (com estoque confirmado) de cada loja em cada dia. Guarda 180 dias.
// O site carrega só o arquivo do produto que a pessoa abrir.
import fs from 'node:fs';
import { readJson, readJsonl, dataPath } from './db.js';

const KEEP_DAYS = 180;
const day = (iso) => String(iso).slice(0, 10);
const safeId = (id) => String(id).replace(/[^a-z0-9_.-]/gi, '_');
export const histPath = (pid) => dataPath(`hist/${safeId(pid)}.json`);

function merge(file, pid, meta, byStore) {
  const h = readJson(file, null) || { productId: pid, stores: {} };
  const before = JSON.stringify(h);
  Object.assign(h, meta);
  for (const [sid, { name, d, v }] of Object.entries(byStore)) {
    const s = (h.stores[sid] ||= { name, pts: [] });
    s.name = name;
    const i = s.pts.findIndex((p) => p[0] === d);
    if (i < 0) s.pts.push([d, v]); else if (v < s.pts[i][1]) s.pts[i][1] = v;
    s.pts.sort((a, b) => a[0].localeCompare(b[0]));
  }
  const cut = day(new Date(Date.now() - KEEP_DAYS * 864e5).toISOString());
  for (const [sid, s] of Object.entries(h.stores)) { s.pts = s.pts.filter((p) => p[0] >= cut); if (!s.pts.length) delete h.stores[sid]; }
  if (JSON.stringify(h) !== before) { fs.mkdirSync(dataPath('hist'), { recursive: true }); fs.writeFileSync(file, JSON.stringify(h)); return true; }
  return false;
}

// Primeira vez: monta o histórico a partir do history.jsonl que já existe.
export function backfill(storeNames) {
  if (fs.existsSync(dataPath('hist'))) return 0;
  fs.mkdirSync(dataPath('hist'), { recursive: true });
  const acc = {};
  for (const r of readJsonl(dataPath('history.jsonl'))) {
    if (r.stock !== 'IN_STOCK' || !(r.total > 0) || !r.productId) continue;
    (acc[r.productId] ||= []).push({ sid: r.storeId, d: day(r.t), v: r.total });
  }
  let n = 0;
  for (const [pid, rows] of Object.entries(acc)) {
    // O log bruto não marca preço suspeito: descarta o que foge muito da mediana do produto.
    const vals = rows.map((x) => x.v).sort((a, b) => a - b); const med = vals[Math.floor(vals.length / 2)];
    const byDay = {};
    for (const { sid, d, v } of rows) {
      if (v < med * 0.55 || v > med * 3) continue;
      const cur = (byDay[d] ||= {})[sid];
      if (!cur || v < cur.v) byDay[d][sid] = { name: storeNames[sid] || sid, d, v };
    }
    for (const stores of Object.values(byDay)) if (merge(histPath(pid), pid, {}, stores)) n++;
  }
  return n;
}

// A cada rodada: registra o menor preço do dia de cada loja (só ofertas válidas).
export function recordDay(offers, products, T) {
  const d = day(T); const by = {};
  const med = {};
  for (const o of offers) if (o.stock === 'IN_STOCK' && !o.stale && o.total > 0) (med[o.productId] ||= []).push(o.total);
  for (const k of Object.keys(med)) { const v = med[k].sort((a, b) => a - b); med[k] = v[Math.floor(v.length / 2)]; }
  for (const o of offers) {
    if (o.stock !== 'IN_STOCK' || o.stale || o.anomalous || !(o.total > 0)) continue;
    const msrp = products[o.productId]?.msrp;
    if ((msrp && o.total < msrp * 0.55) || o.total < med[o.productId] * 0.55) continue; // preço suspeito não entra no gráfico
    const s = ((by[o.productId] ||= {})[o.storeId]);
    if (!s || o.total < s.v) by[o.productId][o.storeId] = { name: o.storeName, d, v: o.total };
  }
  let n = 0;
  for (const [pid, stores] of Object.entries(by)) {
    const p = products[pid] || {};
    if (merge(histPath(pid), pid, { msrp: p.msrp ?? null, name: p.name || null, updated: T }, stores)) n++;
  }
  return n;
}

// history.jsonl cresce sem parar: mantém só os últimos 45 dias.
export function trimJsonl(file, days = 45) {
  try {
    if (fs.statSync(file).size < 3e6) return;
    const cut = new Date(Date.now() - days * 864e5).toISOString();
    const keep = fs.readFileSync(file, 'utf8').split('\n').filter((l) => { if (!l) return false; try { return JSON.parse(l).t >= cut; } catch { return false; } });
    fs.writeFileSync(file, keep.join('\n') + (keep.length ? '\n' : ''));
  } catch { /* sem arquivo */ }
}
