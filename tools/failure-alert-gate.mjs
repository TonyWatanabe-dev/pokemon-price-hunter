// Portão do passo "Avisar falha no Telegram" (hunter.yml): avisa só na TRANSIÇÃO para falha.
// Se a rodada concluída anterior do robô (não cancelada/pulada) também falhou, o aviso já saiu e o vigia
// (watchdog.yml, motivo rodadas_falhando) cuida do lembrete enquanto continuar. Qualquer dúvida = AVISA:
// lista ausente, ilegível, vazia ou erro do gh nunca silencia o aviso.
// Uso: node tools/failure-alert-gate.mjs --runs runs.json --current <run id>   → imprime "send" ou "skip".
// Só imprime a decisão e o motivo (sem token, sem URL).
import fs from 'node:fs';

const FAILED = new Set(['failure', 'timed_out', 'startup_failure']);
const IGNORE = new Set(['cancelled', 'skipped', 'neutral']);

/** runs: saída de `gh run list --json databaseId,status,conclusion,createdAt,updatedAt` · current: id desta rodada. */
export function gate(runs, current) {
  if (!Array.isArray(runs)) return { decision: 'send', reason: 'lista de rodadas indisponível' };
  const cur = String(current ?? '');
  const me = runs.find((r) => r && String(r.databaseId) === cur);
  const meAt = Date.parse(me?.createdAt || '');
  const prev = runs.filter((r) => r && String(r.databaseId) !== cur && r.status === 'completed' && !IGNORE.has(r.conclusion) && Number.isFinite(Date.parse(r.createdAt))
    && (!Number.isFinite(meAt) || Date.parse(r.createdAt) < meAt))
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))[0];
  if (!prev) return { decision: 'send', reason: 'sem rodada anterior concluída' };
  if (FAILED.has(prev.conclusion)) return { decision: 'skip', reason: `rodada anterior ${prev.databaseId} também falhou (${prev.conclusion}): aviso já enviado` };
  return { decision: 'send', reason: `rodada anterior ${prev.databaseId} terminou em ${prev.conclusion}` };
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());
if (isMain) {
  let out = { decision: 'send', reason: 'erro no portão' };
  try {
    const args = process.argv.slice(2); const opt = (k) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : undefined; };
    let runs = null; try { runs = JSON.parse(fs.readFileSync(opt('runs'), 'utf8')); } catch { runs = null; }
    out = gate(runs, opt('current'));
  } catch { /* na dúvida, avisa */ }
  console.error(`[aviso de falha] ${out.decision}: ${out.reason}`);
  console.log(out.decision);
}
