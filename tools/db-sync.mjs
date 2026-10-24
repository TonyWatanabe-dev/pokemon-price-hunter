// Sincroniza a pasta data/ (estado atual do robô) com o banco. Sem DATABASE_URL, não faz nada.
// Uso: DATABASE_URL=... node tools/db-sync.mjs [pasta-data]
import fs from 'node:fs';
import path from 'node:path';
import { dbEnabled, tx, close } from '../src/db/pg.js';
import { syncState } from '../src/core/sync.js';

if (!dbEnabled()) { console.log('Banco desligado (sem DATABASE_URL): nada a sincronizar.'); process.exit(0); }
const dir = process.argv[2] || 'data';
// Arquivo ausente ou corrompido: mensagem curta (sem stack), código 1 e o banco nem é aberto.
let state, lines, catalog, arquivo;
try {
  arquivo = path.join(dir, 'state.json'); state = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  arquivo = path.join(dir, 'history.jsonl');
  lines = fs.existsSync(arquivo) ? fs.readFileSync(arquivo, 'utf8').split('\n').filter(Boolean).map((l) => JSON.parse(l)) : [];
  arquivo = 'config/catalog.json'; catalog = JSON.parse(fs.readFileSync(new URL('../config/catalog.json', import.meta.url), 'utf8'));
} catch (e) {
  console.error(`Sincronização com o banco não iniciada: ${arquivo} ilegível (${e.message}). O banco não foi tocado.`);
  process.exit(1);
}
const t0 = Date.now();
try {
  const s = await tx((c) => syncState(c, { state, catalog, historyLines: lines }));
  console.log(`Banco sincronizado em ${((Date.now() - t0) / 1000).toFixed(1)} s:`, JSON.stringify(s));
  // Quarentena: linhas recusadas ficaram de fora sem parar a rodada; aviso visível no Actions.
  if (s.quarantined) console.log(`::warning title=Sync com quarentena::${s.quarantined} linha(s) ficaram de fora: ${s.quarantine.map((x) => `${x.etapa} ${x.id} (${x.motivo})`).join('; ').slice(0, 900)}`);
} catch (e) {
  console.error('Sincronização com o banco falhou (o site não é afetado):', e.message);
  process.exitCode = 1;
} finally { await close(); }
