// Price Engine: recalcula price_daily e product_stats a partir do banco. Sem DATABASE_URL, não faz nada.
// Uso: DATABASE_URL=... node tools/db-stats.mjs
import { dbEnabled, tx, close } from '../src/db/pg.js';
import { runPriceEngine } from '../src/core/price-stats.js';

if (!dbEnabled()) { console.log('Banco desligado (sem DATABASE_URL): nada a calcular.'); process.exit(0); }
try {
  const r = await tx((c) => runPriceEngine(c));
  console.log('Price Engine:', JSON.stringify(r));
} catch (e) {
  console.error('Price Engine falhou (o site não é afetado):', e.message);
  process.exitCode = 1;
} finally { await close(); }
