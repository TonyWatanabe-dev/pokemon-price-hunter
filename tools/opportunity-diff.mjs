// Compara duas fotografias do Opportunity Engine (tools/opportunity-snapshot.mjs), oferta a oferta e produto a produto.
// Uso: node tools/opportunity-diff.mjs <antes.json> <depois.json> [saida.json]
import fs from 'node:fs';

const W = { reference: 0.30, historical: 0.20, market: 0.20, price: 0.10, freight: 0.10, reliability: 0.10 };
const contrib = (r, k) => (r[`s_${k}`] == null ? null : +(W[k] * (100 * r[`s_${k}`] - 50)).toFixed(1));   // pontos sobre 50 (antes das travas)

export function diffSnapshots(A, B) {
  const a = new Map(A.rows.map((r) => [r.offer, r])); const pairs = B.rows.filter((r) => a.has(r.offer)).map((r) => ({ b: r, a: a.get(r.offer) }));
  const d = (p) => p.b.score - p.a.score;
  const moves = {}; for (const p of pairs) if (p.a.band !== p.b.band) { const k = `${p.a.band}→${p.b.band}`; moves[k] = (moves[k] || 0) + 1; }
  const prodKind = (S) => { const m = new Map(); for (const r of S.rows) m.set(r.product, r); return m; };
  const pa = prodKind(A); const pb = prodKind(B);
  const kinds = (m) => [...m.values()].reduce((x, r) => ((x[r.ref_kind] = (x[r.ref_kind] || 0) + 1), x), {});
  const reasonsNone = (m) => [...m.values()].filter((r) => r.ref_kind === 'NONE').reduce((x, r) => ((x[r.ref_reason] = (x[r.ref_reason] || 0) + 1), x), {});
  const kindChanges = [...pb.keys()].filter((k) => pa.has(k) && pa.get(k).ref_kind !== pb.get(k).ref_kind)
    .map((k) => ({ product: k, before: pa.get(k).ref_kind, after: pb.get(k).ref_kind, before_reason: pa.get(k).ref_reason, after_reason: pb.get(k).ref_reason,
      sources_before: pa.get(k).market_reference?.stores ?? null, sources_after: pb.get(k).market_reference?.sources ?? null }));
  const row = (p) => ({ product: p.b.product, offer: p.b.offer, store: p.b.store, seller: p.b.seller, price: p.b.price,
    ref: `${p.a.ref_kind}→${p.b.ref_kind}`, score: `${p.a.score}→${p.b.score}`, band: `${p.a.band}→${p.b.band}`, delta: d(p), confidence: `${p.a.confidence}→${p.b.confidence}` });
  // dupla contagem: ofertas cuja referência era mercado antes e depois
  const dedup = pairs.filter((p) => p.a.ref_kind === 'MARKET_CURRENT' && p.b.ref_kind === 'MARKET_CURRENT' && p.a.s_market != null)
    .sort((x, y) => Math.abs(d(y)) - Math.abs(d(x)) || y.b.score - x.b.score)
    .map((p) => ({ product: p.b.product, offer: p.b.offer, price: p.b.price, market_price: p.b.ref_price,
      before: { reference: contrib(p.a, 'reference'), market: contrib(p.a, 'market'), coverage: p.a.coverage, raw: p.a.raw, score: p.a.score, band: p.a.band, caps: p.a.caps },
      after: { reference: contrib(p.b, 'reference'), market: contrib(p.b, 'market'), coverage: p.b.coverage, raw: p.b.raw, score: p.b.score, band: p.b.band, caps: p.b.caps } }));
  // Mercado Livre: produtos com ofertas de marketplace
  const mlProducts = [...new Set(B.rows.filter((r) => r.marketplace === 'mercadolivre').map((r) => r.product))];
  const ml = mlProducts.map((k) => { const rb = B.rows.filter((r) => r.product === k); const best = (S) => S.rows.find((r) => r.product === k && r.is_best) || null;
    const ba = best(A); const bb = best(B); const mb = pb.get(k)?.market_reference || {}; const ma = pa.get(k)?.market_reference || {};
    return { product: k, ml_offers: rb.filter((r) => r.marketplace === 'mercadolivre').length, ml_sellers: new Set(rb.filter((r) => r.marketplace === 'mercadolivre').map((r) => r.seller)).size,
      sources_before: ma.stores ?? null, market_before: pa.get(k)?.ref_kind === 'MARKET_CURRENT', best_before: ba?.score ?? null,
      sources_after: mb.sources ?? null, stores_after: mb.stores ?? null, sellers_after: mb.marketplace_sellers ?? null, untrusted_sources: mb.untrusted_sources ?? null,
      market_after: pb.get(k)?.ref_kind === 'MARKET_CURRENT', best_after: bb?.score ?? null, reason_after: pb.get(k)?.ref_reason }; });
  const best = (S) => S.rows.filter((r) => r.is_best).reduce((x, r) => ((x[r.band] = (x[r.band] || 0) + 1), x), {});
  // composição do mercado da REFERÊNCIA (6A.2); em fotografias antigas, derivada das contagens gravadas
  const comp = (r) => { if (r.ref_kind !== 'MARKET_CURRENT') return 'NONE'; const m = r.market_reference || {}; if (m.composition) return m.composition;
    const mk = (m.marketplace_sellers || 0) + (r.store === 'mercadolivre' ? 0 : 0); const st = (m.stores || 0); return !mk ? 'MARKET_STORES' : !st ? 'MARKETPLACE_ONLY' : 'MARKET_MIXED'; };
  const compStats = (S) => { const g = {}; for (const r of S.rows) { const k = comp(r); (g[k] = g[k] || []).push(r); }
    return Object.fromEntries(Object.entries(g).map(([k, rs]) => { const c = rs.map((r) => r.confidence); const prods = new Set(rs.map((r) => r.product)).size;
      return [k, { products: prods, offers: rs.length, confidence_avg: +(c.reduce((a, b) => a + b, 0) / c.length).toFixed(3), confidence_min: Math.min(...c), confidence_max: Math.max(...c),
        ref_confidence: [...new Set(rs.map((r) => r.ref_confidence).filter((x) => x != null))].sort() }]; })); };
  const warnCount = (S) => S.rows.reduce((x, r) => { for (const w of r.warnings || []) x[w] = (x[w] || 0) + 1; return x; }, {});
  return {
    before: { label: A.label, engines: A.engines, offers: A.offers, products: A.products }, after: { label: B.label, engines: B.engines, offers: B.offers, products: B.products },
    products_by_reference: { before: kinds(pa), after: kinds(pb) }, none_reasons: { before: reasonsNone(pa), after: reasonsNone(pb) },
    reference_kind_changes: kindChanges,
    offers_compared: pairs.length, offers_changed: pairs.filter((p) => d(p) !== 0).length,
    over5: pairs.filter((p) => Math.abs(d(p)) > 5).length, over10: pairs.filter((p) => Math.abs(d(p)) > 10).length, over25: pairs.filter((p) => Math.abs(d(p)) > 25).length,
    up: pairs.filter((p) => d(p) > 0).length, down: pairs.filter((p) => d(p) < 0).length, mean_delta: pairs.length ? +(pairs.reduce((s, p) => s + d(p), 0) / pairs.length).toFixed(2) : 0,
    band_moves: moves, best_bands: { before: best(A), after: best(B) },
    composition: { before: compStats(A), after: compStats(B) }, warnings: { before: warnCount(A), after: warnCount(B) },
    confidence_changed: pairs.filter((p) => p.a.confidence !== p.b.confidence).length,
    by_reference_after: Object.fromEntries(['COPAG_OFFICIAL_CURRENT', 'MARKET_CURRENT', 'NONE'].map((k) => { const g = pairs.filter((p) => p.b.ref_kind === k);
      return [k, { offers: g.length, changed: g.filter((p) => d(p) !== 0).length, mean_delta: g.length ? +(g.reduce((s, p) => s + d(p), 0) / g.length).toFixed(2) : 0 }]; })),
    biggest: pairs.filter((p) => d(p) !== 0).sort((x, y) => Math.abs(d(y)) - Math.abs(d(x))).slice(0, 15).map(row),
    best_changes: pairs.filter((p) => p.b.is_best && p.a.band !== p.b.band).map(row),
    dedup_cases: dedup.slice(0, 15),
    c30: pairs.filter((p) => p.b.product.startsWith('c30') && (p.b.is_best || p.a.is_best)).map(row),
    mercado_livre: ml,
  };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [fa, fb, out] = process.argv.slice(2);
  const r = diffSnapshots(JSON.parse(fs.readFileSync(fa, 'utf8')), JSON.parse(fs.readFileSync(fb, 'utf8')));
  if (out) fs.writeFileSync(out, JSON.stringify(r, null, 2));
  console.log(JSON.stringify({ comparadas: r.offers_compared, mudaram: r.offers_changed, mais5: r.over5, mais10: r.over10, mais25: r.over25, subiram: r.up, desceram: r.down,
    faixas: r.band_moves, melhor: r.best_bands, confiancaMudou: r.confidence_changed, referencia: r.products_by_reference, semReferencia: r.none_reasons, porReferencia: r.by_reference_after }));
}
