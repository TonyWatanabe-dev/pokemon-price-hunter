// Opportunity Engine: avalia as ofertas a partir de product_stats e grava em opportunity. Sem DATABASE_URL, não faz nada.
// Uso: DATABASE_URL=... node tools/db-opportunity.mjs
import { dbEnabled, tx, close } from '../src/db/pg.js';
import { runOpportunityEngine } from '../src/core/opportunity-run.js';

if (!dbEnabled()) { console.log('Banco desligado (sem DATABASE_URL): nada a calcular.'); process.exit(0); }
try {
  const r = await tx((c) => runOpportunityEngine(c));
  console.log('Opportunity Engine:', JSON.stringify(r));
} catch (e) {
  console.error('Opportunity Engine falhou (o site não é afetado):', e.message);
  process.exitCode = 1;
} finally { await close(); }
