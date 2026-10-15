#!/usr/bin/env node
// Importa a exportação "Meus cupons" do ML (CSV ;) para config/social-cupons.json (#690).
// Só guarda o que serve para Pokémon TCG (ver src/agents/social/cupons.js). Cupom de loja só entra se o vendedor
// aparece hoje nas ofertas do ML do state.json.
// Uso: node tools/cupons-importar.mjs --csv cupons.csv --exportado 2026-10-15 --state data/state.json [--saida config/social-cupons.json]
import fs from 'node:fs';
import { importarCsv } from '../src/agents/social/cupons.js';

export function main(argv = process.argv.slice(2), log = console.log) {
  const a = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
  const exportadoEm = a('--exportado');
  if (!/^\d{4}-\d{2}-\d{2}$/.test(exportadoEm || '')) { log('--exportado AAAA-MM-DD é obrigatório'); return 1; }
  const st = a('--state') ? JSON.parse(fs.readFileSync(a('--state'), 'utf8')) : { offers: [] };
  const vendedores = new Set((st.offers || []).filter((o) => o.storeId === 'mercadolivre' && o.seller).map((o) => String(o.seller).trim().toLowerCase()));
  const cupons = importarCsv(fs.readFileSync(a('--csv'), 'utf8'), exportadoEm, { vendedores });
  const saida = a('--saida', 'config/social-cupons.json');
  fs.writeFileSync(saida, JSON.stringify({ fonte: 'Meus cupons (conta do proprietário), exportação manual', exportadoEm, cupons }, null, 1) + '\n');
  const por = cupons.reduce((m, c) => ({ ...m, [c.escopo]: (m[c.escopo] || 0) + 1 }), {});
  log(`${cupons.length} cupons → ${saida} (${Object.entries(por).map(([k, v]) => `${k}: ${v}`).join(', ')})`);
  return 0;
}
if (process.argv[1]?.endsWith('cupons-importar.mjs')) process.exitCode = main();
