// Importa os arquivos de db/reference-imports/*.json (referências auditadas) para reference_price. Idempotente.
// Uso: DATABASE_URL=... node tools/db-import-references.mjs [pasta-ou-arquivo]   (padrão: db/reference-imports)
import fs from 'node:fs';
import path from 'node:path';
import { dbEnabled, tx, close } from '../src/db/pg.js';
import { importReferences } from '../src/core/reference-import.js';

if (!dbEnabled()) { console.log('Banco desligado (sem DATABASE_URL): nada a importar.'); process.exit(0); }
const arg = process.argv[2] || path.join(path.dirname(new URL(import.meta.url).pathname), '../db/reference-imports');
const files = fs.statSync(arg).isDirectory() ? fs.readdirSync(arg).filter((f) => f.endsWith('.json')).sort().map((f) => path.join(arg, f)) : [arg];
try {
  for (const f of files) {
    const r = await tx((c) => importReferences(c, JSON.parse(fs.readFileSync(f, 'utf8'))));
    console.log('Referências:', JSON.stringify({ ...r, rejected: r.rejected.length, rejectedIds: r.rejected.map((x) => x.legacy_id), excluded: r.excluded.length }));
    if (r.rejected.length) console.log('Recusadas:', JSON.stringify(r.rejected));
  }
} catch (e) {
  console.error('Importação de referências falhou (o site não é afetado):', e.message);
  process.exitCode = 1;
} finally { await close(); }
