#!/usr/bin/env node
// Gera config/refs-copag.json: código de referência da Copag (5 dígitos, 3xxxx) → produto do catálogo, minerado das
// ofertas já casadas pelo título (data/offers.json + data/products.json). Só entra o código visto em 2+ ofertas com
// 90%+ apontando para o mesmo produto, sem variante (Mega X ex dividem o mesmo código). Uso: node tools/refs-copag.mjs [pasta-data]
import fs from 'node:fs';
import path from 'node:path';

export const REF = /(?<!\d)(3\d{4})(?!\d)/g;
export const refsDe = (s) => [...new Set(String(s || '').match(REF) || [])];

export function minerar(offers, products, { min = 2, acordo = 0.9 } = {}) {
  const por = new Map();
  for (const o of Object.values(offers || {})) {
    if (!o?.productId) continue;
    for (const r of refsDe(`${o.title || ''} ${o.sku || ''}`)) { const c = por.get(r) || new Map(); c.set(o.productId, (c.get(o.productId) || 0) + 1); por.set(r, c); }
  }
  const out = {};
  for (const [r, c] of [...por].sort()) {
    const tot = [...c.values()].reduce((a, b) => a + b, 0); const [pid, n] = [...c].sort((a, b) => b[1] - a[1])[0];
    const p = products?.[pid];
    if (tot < min || n / tot < acordo || !p || p.variant || !p.collection || !p.type) continue;
    out[r] = { productId: pid, collection: p.collection, type: p.type, boosters: p.boosters ?? null, ofertas: n };
  }
  return out;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const dir = process.argv[2] || 'data';
  const offers = JSON.parse(fs.readFileSync(path.join(dir, 'offers.json'), 'utf8'));
  const products = JSON.parse(fs.readFileSync(path.join(dir, 'products.json'), 'utf8'));
  const refs = minerar(offers, products);
  fs.writeFileSync('config/refs-copag.json', JSON.stringify({ _nota: 'Gerado por tools/refs-copag.mjs a partir das ofertas casadas pelo título. Código de referência da Copag → produto. Usado só quando o título não identifica o produto (src/match.js).', refs }, null, 2) + '\n');
  console.log(`refs-copag: ${Object.keys(refs).length} códigos`);
}
