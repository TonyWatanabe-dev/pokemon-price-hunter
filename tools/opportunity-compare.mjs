// Comparação Deal Score legado (robô, state.json) × opportunity_score (Opportunity Engine, banco), em dados reais.
// Uso: DATABASE_URL=... node tools/opportunity-compare.mjs <pasta-data> [saida.json]
import fs from 'node:fs';
import path from 'node:path';
import { pool, close } from '../src/db/pg.js';
import { bandOf } from '../src/core/opportunity-engine.js';

/** correlação de Spearman (postos médios em empates) */
export function spearman(xs, ys) {
  const rank = (v) => { const idx = v.map((x, i) => [x, i]).sort((a, b) => a[0] - b[0]); const r = Array(v.length);
    for (let i = 0; i < idx.length;) { let j = i; while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++; for (let k = i; k <= j; k++) r[idx[k][1]] = (i + j) / 2 + 1; i = j + 1; } return r; };
  const n = xs.length; if (n < 3) return null; const a = rank(xs), b = rank(ys); const ma = (n + 1) / 2;
  let num = 0, da = 0, db = 0; for (let i = 0; i < n; i++) { num += (a[i] - ma) * (b[i] - ma); da += (a[i] - ma) ** 2; db += (b[i] - ma) ** 2; }
  return da && db ? +(num / Math.sqrt(da * db)).toFixed(3) : null;
}

export function compareLegacy(state, rows) {
  const L = new Map((state.offers || []).map((o) => [o.id, o])); const P = new Map((state.products || []).map((p) => [p.id, p]));
  const pairs = rows.map((r) => ({ ...r, legacy: L.get(r.legacy_offer) })).filter((x) => x.legacy);
  const scored = pairs.filter((x) => x.legacy.dealScore != null);
  const live = (o) => o.stock === 'IN_STOCK' && !o.stale && !o.anomalous && o.total > 0;
  const matrix = {}; for (const x of scored) { const k = `${bandOf(x.legacy.dealScore)}→${x.opportunity_band}`; matrix[k] = (matrix[k] || 0) + 1; }
  const agree = scored.filter((x) => bandOf(x.legacy.dealScore) === x.opportunity_band).length;
  const d = (x) => x.opportunity_score - x.legacy.dealScore;
  const fmt = (x) => ({ product: x.product, offer: x.legacy_offer, store: x.legacy.storeName, price: x.price, legacy: x.legacy.dealScore, opportunity: x.opportunity_score,
    band: x.opportunity_band, confidence: Number(x.confidence), reasons: x.reasons.map((r) => r.text), warnings: x.warnings.map((w) => w.code) });
  // pódio da Home hoje (pool do robô) × melhor oportunidade por produto (engine)
  const legacyPool = new Map(); for (const o of state.offers || []) { const p = P.get(o.productId); if (!p?.copagConfirmed || !live(o) || o.dealScore == null || o.confirmed === false || !(o.discount > 0)) continue;
    const c = legacyPool.get(p.id); if (!c || o.dealScore > c.dealScore) legacyPool.set(p.id, o); }
  const topLegacy = [...legacyPool.values()].sort((a, b) => b.dealScore - a.dealScore).slice(0, 15).map((o) => o.productId);
  const bestBy = new Map(); for (const x of pairs) if (x.is_best) bestBy.set(x.product, x);
  const topNew = [...bestBy.values()].sort((a, b) => b.opportunity_score - a.opportunity_score || b.confidence - a.confidence).slice(0, 15).map((x) => x.product);
  return {
    offersEvaluated: rows.length, matchedWithLegacy: pairs.length, withLegacyScore: scored.length,
    spearman: spearman(scored.map((x) => x.legacy.dealScore), scored.map((x) => x.opportunity_score)),
    bandAgreement: scored.length ? +(agree / scored.length).toFixed(3) : null, matrix,
    meanDelta: scored.length ? +(scored.reduce((a, x) => a + d(x), 0) / scored.length).toFixed(1) : null,
    bigDivergences: scored.filter((x) => Math.abs(d(x)) >= 25).sort((a, b) => Math.abs(d(b)) - Math.abs(d(a))).slice(0, 12).map(fmt),
    bigDivergenceCount: scored.filter((x) => Math.abs(d(x)) >= 25).length,
    falsePositives: scored.filter((x) => x.opportunity_score >= 75 && x.legacy.dealScore < 50).map(fmt),        // engine diz boa, robô diz fraca
    falseNegatives: scored.filter((x) => x.legacy.dealScore >= 70 && x.opportunity_score < 50).map(fmt),        // robô diz boa, engine diz baixa
    legacyMissing: pairs.filter((x) => x.legacy.dealScore == null && x.opportunity_score >= 60).slice(0, 10).map(fmt),  // engine avalia o que o robô não pontua
    shortHistory: pairs.filter((x) => x.is_best && x.warnings.some((w) => w.code === 'SHORT_HISTORY')).length,
    bestWithoutCopag: [...bestBy.values()].filter((x) => x.warnings.some((w) => w.code === 'NO_REFERENCE')).length,
    bestWithCopag: [...bestBy.values()].filter((x) => !x.warnings.some((w) => w.code === 'NO_REFERENCE')).length,
    productBands: [...bestBy.values()].reduce((a, x) => ((a[x.opportunity_band] = (a[x.opportunity_band] || 0) + 1), a), {}),
    top15: { legacy: topLegacy, opportunity: topNew, overlap: topNew.filter((x) => topLegacy.includes(x)).length },
    distribution: rows.reduce((a, x) => { const b = Math.min(9, Math.floor(x.opportunity_score / 10)); a[`${b * 10}-${b * 10 + 9}`] = (a[`${b * 10}-${b * 10 + 9}`] || 0) + 1; return a; }, {}),
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = process.argv[2] || 'data'; const out = process.argv[3] || null;
  if (!process.env.DATABASE_URL) { console.log('Sem banco: nada a comparar.'); process.exit(0); }
  const state = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
  const p = await pool();
  const rows = (await p.query(`
    SELECT o.offer_id, of.legacy_id AS legacy_offer, pr.legacy_id AS product, o.opportunity_score, o.opportunity_band, o.confidence, o.price::float8 AS price,
           o.reasons, o.warnings, o.is_anomaly, (po.offer_id IS NOT NULL) AS is_best
      FROM hunter.opportunity o JOIN hunter.offer of ON of.id = o.offer_id JOIN hunter.product pr ON pr.id = o.product_id
      LEFT JOIN hunter.product_opportunity po ON po.offer_id = o.offer_id`)).rows;
  await close();
  const r = compareLegacy(state, rows);
  if (out) fs.writeFileSync(out, JSON.stringify(r, null, 2));
  console.log(JSON.stringify({ avaliadas: r.offersEvaluated, comDealScore: r.withLegacyScore, spearman: r.spearman, concordanciaFaixa: r.bandAgreement, deltaMedio: r.meanDelta,
    divergencias25: r.bigDivergenceCount, falsosPositivos: r.falsePositives.length, falsosNegativos: r.falseNegatives.length, top15: r.top15.overlap,
    produtos: r.productBands, semCopag: r.bestWithoutCopag, comCopag: r.bestWithCopag, historicoCurto: r.shortHistory, matriz: r.matrix }));
}
