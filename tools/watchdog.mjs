// Vigia do robô por estado. Lê o que o workflow baixou (dados publicados, meta.json, últimas rodadas do robô e o
// livro do que já foi avisado), decide o estado e avisa só nas transições (ver src/ops-watch.js).
// Uso: node tools/watchdog.mjs --state wd/state.json --meta wd/meta.json --runs wd/runs.json --ledger wd/ledger.json
//      [--dry-run] (não envia nem grava o livro) · [--test] (envia uma mensagem de teste; o livro não muda)
//      [--now 2026-10-09T12:00:00Z] (testes)
import fs from 'node:fs';
import { evaluate, decide, commitLedger, normalizeLedger } from '../src/ops-watch.js';
import { sendAll } from '../src/ops-notify.js';
import { writeJsonAtomic } from '../src/opstate.js';

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : undefined; };
const flag = (k) => args.includes('--' + k);
const readText = (f) => { try { return f ? fs.readFileSync(f, 'utf8') : null; } catch { return null; } };
const readJsonSafe = (f) => { const t = readText(f); if (t == null || !t.trim()) return { value: null, error: 'ausente' }; try { return { value: JSON.parse(t), error: null }; } catch { return { value: null, error: 'ilegivel' }; } };

export async function main({ env = process.env, fetchImpl = fetch, log = console.log } = {}) {
  const now = opt('now') || new Date().toISOString();
  const st = readJsonSafe(opt('state')).value;
  const m = readJsonSafe(opt('meta'));
  const runs = readJsonSafe(opt('runs')).value;
  const ledgerFile = opt('ledger');
  const ledger = normalizeLedger(readJsonSafe(ledgerFile).value);

  if (flag('test')) {
    const r = await sendAll({ kind: 'teste', title: '🧪 Teste do vigia', text: '🧪 Teste do vigia do TCG Price Hunter: os avisos estão chegando.' }, { env, fetchImpl });
    log(JSON.stringify({ test: true, delivered: r.delivered, channels: r.channels }));
    return { test: true, ...r };
  }

  const meta = m.value && typeof m.value === 'object' && !Array.isArray(m.value) ? m.value : null;
  const metaError = m.error || (m.value != null && !meta ? 'ilegivel' : null);
  const ev = evaluate({ now, stateGeneratedAt: st?.generatedAt, meta, metaError, runs });
  const d = decide(ev, ledger, now);
  let sent = { delivered: false, channels: [] };
  if (d.notify && !flag('dry-run')) sent = await sendAll(d.notify, { env, fetchImpl });
  const next = commitLedger(ledger, ev, d, sent.delivered, now);
  if (ledgerFile && !flag('dry-run')) writeJsonAtomic(ledgerFile, next);

  const summary = { status: ev.status, reasons: ev.reasons.map((r) => r.code), facts: ev.facts, notify: d.notify?.kind || null,
    delivered: d.notify ? sent.delivered : null, channels: sent.channels, notifiedStatus: next.notifiedStatus };
  log(JSON.stringify(summary));
  if (d.notify) log('\n' + d.notify.text);
  if (env.GITHUB_STEP_SUMMARY) {
    const md = [`### Vigia: ${ev.status}`, '', `- Dados publicados: ${ev.facts.dataGeneratedAt || '?'} (${ev.facts.dataAgeMin ?? '?'} min)`,
      `- Última rodada concluída: ${ev.facts.lastRunAt || '?'} (${ev.facts.lastRunConclusion || '?'})`,
      ...ev.reasons.map((r) => `- ${r.text}`), `- Aviso: ${d.notify ? `${d.notify.kind} (${sent.delivered ? 'entregue' : 'não entregue'})` : 'nenhum'}`].join('\n');
    try { fs.appendFileSync(env.GITHUB_STEP_SUMMARY, md + '\n'); } catch { /* opcional */ }
  }
  return { ...summary, ledger: next, message: d.notify };
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());
if (isMain) main().catch((e) => { console.error('Vigia falhou:', String(e?.message || e).slice(0, 160)); process.exitCode = 2; });
