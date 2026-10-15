// Relatório de integridade SOMENTE LEITURA: banco × arquivos publicados (data/state.json + config/catalog.json). Issue #113 / Fase 5.
// Não corrige nada: transação READ ONLY + ROLLBACK (src/core/integrity-report.js). Nunca imprime a URL do banco.
// Uso: DATABASE_URL=... node tools/db-integrity-report.mjs [pasta-data] [saida.json] [--estrito]
//   --estrito: sai com código 2 se alguma verificação (fora as "revisar") falhar. Sem a flag, o relatório nunca falha a execução.
// Rodar contra produção é leitura de dados reais: exige autorização (docs/agentes.md); o worker de tarefas não tem DATABASE_URL.
import fs from 'node:fs';
import path from 'node:path';
import { dbEnabled, pool, close } from '../src/db/pg.js';
import { integrityReport } from '../src/core/integrity-report.js';

const args = process.argv.slice(2);
const strict = args.includes('--estrito');
const [dir = 'data', out = 'db-integrity.json'] = args.filter((a) => !a.startsWith('--'));
if (!dbEnabled()) { console.log('Banco desligado (sem DATABASE_URL): nada a verificar.'); process.exit(0); }
let state, catalog, arquivo;
try {
  arquivo = path.join(dir, 'state.json'); state = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
  arquivo = 'config/catalog.json'; catalog = JSON.parse(fs.readFileSync(new URL('../config/catalog.json', import.meta.url), 'utf8'));
} catch (e) {
  console.error(`Relatório não iniciado: ${arquivo} ilegível (${e.message}). O banco não foi aberto.`);
  process.exit(1);
}
let client;
try {
  client = await (await pool()).connect();
  const rep = await integrityReport(client, { state, catalog });
  fs.writeFileSync(out, JSON.stringify(rep, null, 2) + '\n');
  for (const c of rep.checks) console.log(`${c.ok ? '✓' : c.review ? '?' : '✗'} ${c.name}: ${c.count}${c.sample.length ? ` (ex.: ${c.sample.slice(0, 5).join(', ')})` : ''}`);
  console.log(`Integridade (somente leitura): ${rep.failing} falha(s), ${rep.to_review} para revisar. Relatório em ${out}.`);
  if (strict && rep.failing) process.exitCode = 2;
} catch (e) {
  console.error('Relatório de integridade falhou (nada foi alterado):', e.message);
  process.exitCode = 1;
} finally { client?.release(); await close(); }
