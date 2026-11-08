// Histórico de preço por produto e por loja: um arquivo pequeno por produto em data/hist/<id>.json,
// com o menor preço total (com estoque confirmado) de cada loja em cada dia. Guarda 180 dias.
// O site carrega só o arquivo do produto que a pessoa abrir.
import fs from 'node:fs';
import { readJson, readJsonl, dataPath } from './db.js';
import { trustedPoint } from './distrust.js';
import { PLAUSIBLE_MIN, PLAUSIBLE_MAX, MIN_HISTORY_DAYS } from './core/price-engine.js';

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
  if (JSON.stringify(h) !== before) { fs.mkdirSync(file.slice(0, file.lastIndexOf('/')), { recursive: true }); const tmp = file + '.tmp'; try { fs.writeFileSync(tmp, JSON.stringify(h)); fs.renameSync(tmp, file); } catch (e) { try { fs.unlinkSync(tmp); } catch { /* sem tmp */ } throw e; } return true; }
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
      if (v < med * PLAUSIBLE_MIN || v > med * PLAUSIBLE_MAX) continue;
      const cur = (byDay[d] ||= {})[sid];
      if (!cur || v < cur.v) byDay[d][sid] = { name: storeNames[sid] || sid, d, v };
    }
    for (const stores of Object.values(byDay)) if (merge(histPath(pid), pid, {}, stores)) n++;
  }
  return n;
}

// A cada rodada: registra o menor preço do dia de cada loja (só ofertas válidas).
// opts.dir: pasta de destino ('hist' é o padrão; 'hist-ref' guarda a referência de mercado das lojas não parceiras).
export function recordDay(offers, products, T, { dir = 'hist' } = {}) {
  const d = day(T); const by = {};
  const med = {};
  for (const o of offers) if (o.stock === 'IN_STOCK' && !o.stale && !o.anomalous && o.total > 0) (med[o.productId] ||= []).push(o.total);
  for (const k of Object.keys(med)) { const v = med[k].sort((a, b) => a - b); med[k] = v[Math.floor(v.length / 2)]; }
  for (const o of offers) {
    if (o.stock !== 'IN_STOCK' || o.stale || o.anomalous || !(o.total > 0)) continue;
    const msrp = products[o.productId]?.msrp;
    if ((msrp && o.total < msrp * PLAUSIBLE_MIN) || o.total < med[o.productId] * PLAUSIBLE_MIN) continue; // preço suspeito não entra no gráfico
    const s = ((by[o.productId] ||= {})[o.storeId]);
    if (!s || o.total < s.v) by[o.productId][o.storeId] = { name: o.storeName, d, v: o.total };
  }
  let n = 0;
  for (const [pid, stores] of Object.entries(by)) {
    const p = products[pid] || {};
    if (merge(dir === 'hist' ? histPath(pid) : dataPath(`${dir}/${safeId(pid)}.json`), pid, { msrp: p.msrp ?? null, name: p.name || null, updated: T }, stores)) n++;
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

// Site só com parceiros (SITE_SO_PARCEIROS): o site lê data/hist/<id>.json, então as séries de lojas que não são parceiras SAEM
// de lá, mas nada se perde: vão para data/hist-ref/<id>.json (mesmo formato, mescla por loja e dia, nunca descarta ponto) e
// continuam acumulando como referência de mercado. Idempotente. Devolve quantos arquivos de data/hist mudaram.
const refPath = (pid) => dataPath(`hist-ref/${safeId(pid)}.json`);
function mergeSeries(dst, src) {
  for (const [sid, s] of Object.entries(src || {})) {
    const d = (dst[sid] ||= { name: s.name, pts: [] }); d.name = s.name || d.name;
    for (const [dia, v] of s.pts || []) { const i = d.pts.findIndex((p) => p[0] === dia); if (i < 0) d.pts.push([dia, v]); else if (v < d.pts[i][1]) d.pts[i][1] = v; }
    d.pts.sort((x, y) => x[0].localeCompare(y[0]));
  }
}
function gravar(file, obj) { fs.mkdirSync(file.slice(0, file.lastIndexOf('/')), { recursive: true }); const tmp = file + '.tmp'; try { fs.writeFileSync(tmp, JSON.stringify(obj)); fs.renameSync(tmp, file); } catch (e) { try { fs.unlinkSync(tmp); } catch { /* sem tmp */ } throw e; } }
export function moverLojasHist(manter) {
  const keep = new Set(manter); let n = 0; const dir = dataPath('hist');
  let files; try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')); } catch { return 0; }
  for (const f of files) {
    const h = readJson(`${dir}/${f}`, null); if (!h || typeof h.stores !== 'object') continue;
    const fora = Object.keys(h.stores).filter((sid) => !keep.has(sid)); if (!fora.length) continue;
    const ref = readJson(refPath(h.productId || f.replace(/\.json$/, '')), null) || { productId: h.productId, stores: {} };
    Object.assign(ref, { productId: h.productId ?? ref.productId, msrp: h.msrp ?? ref.msrp ?? null, name: h.name ?? ref.name ?? null, updated: h.updated ?? ref.updated });
    mergeSeries(ref.stores, Object.fromEntries(fora.map((sid) => [sid, h.stores[sid]])));
    gravar(refPath(h.productId || f.replace(/\.json$/, '')), ref);      // primeiro grava a cópia; só depois tira do arquivo público
    for (const sid of fora) delete h.stores[sid];
    gravar(`${dir}/${f}`, h); n++;
  }
  return n;
}
// Flag desligada: devolve tudo de data/hist-ref para data/hist e apaga a pasta. Devolve quantos produtos voltaram.
export function restaurarLojasHist() {
  const dir = dataPath('hist-ref'); let files; try { files = fs.readdirSync(dir).filter((f) => f.endsWith('.json')); } catch { return 0; }
  let n = 0;
  for (const f of files) {
    const ref = readJson(`${dir}/${f}`, null); if (!ref || typeof ref.stores !== 'object') continue;
    const dst = dataPath(`hist/${f}`); const h = readJson(dst, null) || { productId: ref.productId, stores: {}, msrp: ref.msrp ?? null, name: ref.name ?? null, updated: ref.updated };
    mergeSeries(h.stores, ref.stores); gravar(dst, h); n++;
  }
  for (const f of files) fs.rmSync(`${dir}/${f}`, { force: true });
  try { fs.rmdirSync(dir); } catch { /* resta algo */ }
  return n;
}
// history.jsonl: linhas de lojas fora da lista vão para o arquivo -ref (append; a retenção de trimJsonl vale nos dois). Só reescreve se algo saiu.
export function moverLojasJsonl(file, refFile, manter) {
  const keep = new Set(manter);
  let txt; try { txt = fs.readFileSync(file, 'utf8'); } catch { return 0; }
  const dentro = []; const fora = [];
  for (const l of txt.split('\n')) { if (!l) continue; let ok = false; try { ok = keep.has(JSON.parse(l).storeId); } catch { ok = true; /* linha ilegível fica onde está */ } (ok ? dentro : fora).push(l); }
  if (!fora.length) return 0;
  fs.mkdirSync(refFile.slice(0, refFile.lastIndexOf('/')), { recursive: true });
  fs.appendFileSync(refFile, fora.join('\n') + '\n');                   // primeiro a cópia, depois a remoção
  const tmp = file + '.tmp'; try { fs.writeFileSync(tmp, dentro.join('\n') + (dentro.length ? '\n' : '')); fs.renameSync(tmp, file); } catch (e) { try { fs.unlinkSync(tmp); } catch { /* sem tmp */ } throw e; }
  return fora.length;
}
export function restaurarJsonl(file, refFile) {
  let ref; try { ref = fs.readFileSync(refFile, 'utf8'); } catch { return 0; }
  let cur = ''; try { cur = fs.readFileSync(file, 'utf8'); } catch { /* novo */ }
  const lines = [...cur.split('\n'), ...ref.split('\n')].filter(Boolean);
  const t = (l) => { try { return JSON.parse(l).t || ''; } catch { return ''; } };
  lines.sort((a, b) => t(a).localeCompare(t(b)));                       // sort estável: mantém a ordem dentro do mesmo instante
  fs.writeFileSync(file, lines.join('\n') + '\n'); fs.rmSync(refFile, { force: true });
  return ref.split('\n').filter(Boolean).length;
}

// Resumo do histórico de um produto (menor preço do dia entre todas as lojas), usado no ranking "maior queda".
// Só calcula o que os dados sustentam: com menos de 2 dias, não há queda.
// Pontos inválidos (dia malformado, valor ausente, zero ou negativo) são descartados, nunca viram preço; duplicatas do mesmo dia ficam com o menor.
export const MIN_HIST_DAYS = MIN_HISTORY_DAYS; // mesmo mínimo do Price Engine
export function cleanPoints(pts) {
  const byDay = new Map(); let invalid = 0; let duplicates = 0;
  for (const p of Array.isArray(pts) ? pts : []) {
    const d = Array.isArray(p) ? p[0] : null; const v = Array.isArray(p) ? p[1] : null;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(String(d)) || typeof v !== 'number' || !Number.isFinite(v) || !(v > 0)) { invalid++; continue; }
    if (byDay.has(d)) { duplicates++; if (v < byDay.get(d)) byDay.set(d, v); } else byDay.set(d, v);
  }
  return { pts: [...byDay.entries()].sort((a, b) => a[0].localeCompare(b[0])), invalid, duplicates };
}

export function histSummary(pid, distrust = null, asOf = null) {
  const h = readJson(histPath(pid), null); if (!h) return null;
  const byDay = {};
  for (const [sid, s] of Object.entries(h.stores || {})) for (const [d, v] of cleanPoints(s.pts).pts) if (trustedPoint(distrust, sid, d) && (!byDay[d] || v < byDay[d])) byDay[d] = v;
  const days = Object.keys(byDay).sort(); if (!days.length) return null;
  const today = days[days.length - 1]; const cur = byDay[today];
  const cut = day(new Date(Date.parse(today) - 7 * 864e5).toISOString());
  const prev = days.filter((d) => d < today && d >= cut).map((d) => byDay[d]);
  const ref = prev.length ? Math.max(...prev) : null;
  // Série curta (< MIN_HIST_DAYS dias válidos) não tem queda: dois pontos não sustentam o ranking "maior queda".
  const enough = days.length >= MIN_HIST_DAYS;
  // Com asOf (YYYY-MM-DD), série cujo último dia tem mais de 7 dias é "stale" e não tem queda; sem asOf nada muda.
  const stale = asOf ? Date.parse(asOf) - Date.parse(today) > 7 * 864e5 : false;
  const out = { days: days.length, from: days[0], enough, drop7d: enough && !stale && ref && cur < ref ? +(1 - cur / ref).toFixed(4) : 0 };
  if (asOf) out.stale = stale;
  return out;
}
