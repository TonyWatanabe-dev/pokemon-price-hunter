// Ciclo de agentes depois da sincronização com o banco (src/agents/cycle.js). Sem DATABASE_URL, não faz nada.
// Sempre termina com código 0: agente nunca derruba a rodada. Problema vira aviso no log e, se for
// falha de job, aviso no Telegram/ntfy pelo canal do vigia.
// Uso: DATABASE_URL=... node tools/agents-run.mjs [pasta-data]
import fs from 'node:fs';
import path from 'node:path';
import { dbEnabled, pool, close } from '../src/db/pg.js';
import { runAgentCycle, summarize } from '../src/agents/cycle.js';

if (!dbEnabled()) { console.log('Banco desligado (sem DATABASE_URL): agentes não rodam.'); process.exit(0); }
const dir = process.argv[2] || 'data';
try {
  const state = JSON.parse(fs.readFileSync(path.join(dir, 'state.json'), 'utf8'));
  let catalog = null;
  try { catalog = JSON.parse(fs.readFileSync(new URL('../config/catalog.json', import.meta.url), 'utf8')); } catch { /* sem catálogo: propostas sem 'parsed' */ }
  const r = await runAgentCycle({ db: await pool(), state, catalog });
  console.log(summarize(r));
  if (!r.ok) console.log(`::warning::Agentes com erro (coleta e preços não afetados): ${r.errors.join(' | ')}`);
} catch (e) {
  console.log(`::warning::Agentes não rodaram (coleta e preços não afetados): ${String(e?.message || e).slice(0, 200)}`);
} finally { await close().catch(() => {}); }
process.exit(0);
