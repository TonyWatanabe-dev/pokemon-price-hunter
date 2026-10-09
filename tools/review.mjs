// Operação da fila de revisão humana (src/core/review.js).
// Uso:
//   node tools/review.mjs list [--category matching] [--limit 50]
//   node tools/review.mjs triage                       pendentes de matching + grupos que pedem a mesma decisão
//   node tools/review.mjs approve 12,15 --collection me05 --type booster_box --boosters 36 --reason "..."
//   node tools/review.mjs reject 14,17 --reason "..."   |   dismiss <ids> --reason "..."
//   node tools/review.mjs export                       grava config/matching-overrides.json (mantém "enabled")
// Autor: REVIEW_ACTOR (login GitHub, precisa estar em REVIEW_OPERATORS) ou REVIEW_USER_ID (app_user com permissão).
import fs from 'node:fs';
import { dbEnabled, pool, tx, close } from '../src/db/pg.js';
import { authorize, listPending, triage, decideReview, approvedOverrides, ReviewError } from '../src/core/review.js';

const [cmd, ...rest] = process.argv.slice(2);
const args = { _: [] };
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith('--')) { const k = rest[i].slice(2); const v = rest[i + 1]; if (v === undefined || v.startsWith('--')) args[k] = true; else { args[k] = v; i++; } }
  else args._.push(rest[i]);
}
const env = process.env;
const actor = env.REVIEW_USER_ID ? { userId: env.REVIEW_USER_ID } : env.REVIEW_ACTOR ? { github: env.REVIEW_ACTOR } : null;
const operators = String(env.REVIEW_OPERATORS || '').split(',');
const catalog = JSON.parse(fs.readFileSync(new URL('../config/catalog.json', import.meta.url), 'utf8'));
const OUT = args.out || new URL('../config/matching-overrides.json', import.meta.url).pathname;
const line = (it) => {
  const p = it.proposal || {};
  return `#${it.id} [${p.kind || it.category}] ${p.store || ''} | ${String(p.title || it.entity_id || '').slice(0, 80)} | ${p.productId || (p.parsed ? JSON.stringify(p.parsed) : '')}${p.url ? `\n    ${p.url}` : ''}`;
};

if (!dbEnabled()) { console.error('Sem DATABASE_URL.'); process.exit(2); }
let code = 0;
try {
  const p = await pool();
  if (cmd === 'list' || cmd === 'triage') {
    await authorize(p, actor, 'review.read', { operators });
    const items = await listPending(p, { category: cmd === 'triage' ? 'matching' : (args.category || null), limit: Number(args.limit) || 200 });
    console.log(`${items.length} pendentes`);
    for (const it of items) console.log(line(it));
    if (cmd === 'triage') {
      const g = triage(items);
      console.log(`\n${g.length} grupos que pedem a mesma decisão:`);
      for (const x of g) console.log(`• ${x.key.slice(0, 100)} → #${x.ids.join(', #')}`);
    }
  } else if (['approve', 'reject', 'dismiss'].includes(cmd)) {
    const ids = String(args._[0] || '').split(',').map((s) => s.trim()).filter(Boolean);
    if (!ids.length) throw new ReviewError('invalid', 'informe os ids (ex.: 12,15)');
    const resolution = cmd === 'approve' ? { collection: args.collection, type: args.type, boosters: args.boosters ? Number(args.boosters) : null, variant: args.variant || null } : null;
    for (const id of ids) {
      try {
        const r = await tx((c) => decideReview(c, { id, decision: cmd, reason: args.reason, actor, resolution, catalog, operators, source: env.GITHUB_RUN_ID ? `actions:${env.GITHUB_RUN_ID}` : 'cli' }));
        console.log(`#${id}: ${r.changed ? r.item.status : `${r.item.status} (já estava assim)`}${r.item.resolution ? ` → ${r.item.resolution.productId}` : ''}`);
      } catch (e) {
        code = 1;
        console.log(`#${id}: NÃO decidido (${e.code || 'erro'}): ${e.message}`);
        if (e.code === 'forbidden') break;
      }
    }
  } else if (cmd === 'export') {
    await authorize(p, actor, 'review.decide', { operators });
    const { overrides, skipped } = await approvedOverrides(p, catalog);
    let cur = {}; try { cur = JSON.parse(fs.readFileSync(OUT, 'utf8')); } catch { /* novo */ }
    const next = { _nota: cur._nota, enabled: cur.enabled === true, overrides };
    fs.writeFileSync(OUT, JSON.stringify(next, null, 2) + '\n');
    console.log(`${overrides.length} overrides exportados (enabled: ${next.enabled}); ${skipped.length} inválidos ignorados${skipped.length ? ': ' + skipped.map((s) => `#${s.id} ${s.err}`).join('; ') : ''}`);
  } else {
    console.error('comando: list | triage | approve | reject | dismiss | export'); code = 2;
  }
} catch (e) {
  console.error(`Erro (${e.code || 'erro'}): ${e.message}`); code = e.code === 'forbidden' ? 3 : 1;
} finally { await close().catch(() => {}); }
process.exit(code);
