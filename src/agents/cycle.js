// Ciclo de agentes de uma rodada do robô: enfileira revisões de matching, executa a fila com prazo
// e avisa eventos novos. Roda DEPOIS da coleta, do ramo data e da sincronização com o banco, e
// nunca lança: qualquer erro vira { ok: false, error } e a rodada segue.
import { createOrchestrator } from './orchestrator.js';
import { pgStore } from './stores.js';
import { reviewProposeHandler, pgReviewSink } from './handlers/review-propose.js';
import { reviewCandidates } from './matching-review.js';
import { notifyAgentEvents } from './notify.js';

export const CYCLE = Object.freeze({ maxNew: 25, batch: 5, deadlineMs: 45_000, handlerTimeoutMs: 5_000 });

export async function runAgentCycle({ db, state, catalog = null, send, now = () => new Date(), clock = () => Date.now(), workerId = `hunter-${process.env.GITHUB_RUN_ID || process.pid}`, opts = {} }) {
  const cfg = { ...CYCLE, ...opts };
  const report = { ok: true, candidates: 0, enqueued: 0, runs: [], notify: null, errors: [] };
  const fail = (stage, e) => { report.ok = false; report.errors.push(`${stage}: ${String(e?.message || e).slice(0, 200)}`); };
  const started = clock();
  let orch;
  try {
    orch = createOrchestrator({ store: pgStore(db), now, workerId, handlers: [reviewProposeHandler({ sink: pgReviewSink(db), timeoutMs: cfg.handlerTimeoutMs })] });
  } catch (e) { fail('orquestrador', e); return report; }

  try {
    const cands = reviewCandidates(state, { catalog, limit: cfg.maxNew });
    report.candidates = cands.length;
    for (const c of cands) {
      try { if ((await orch.enqueue({ type: 'review.propose', idempotencyKey: c.idempotencyKey, payload: c.payload, priority: 100 })).created) report.enqueued++; }
      catch (e) { fail('enfileirar', e); }
    }
  } catch (e) { fail('candidatos', e); }

  try {
    while (clock() - started < cfg.deadlineMs) {
      const s = await orch.runOnce({ limit: cfg.batch });
      report.runs.push(s);
      if (s.claimed < cfg.batch) break;
    }
  } catch (e) { fail('executar', e); }

  try { report.notify = await notifyAgentEvents(db, send ? { send } : {}); }
  catch (e) { fail('avisar', e); }
  return report;
}

export const summarize = (r) => {
  const t = r.runs.reduce((a, s) => { for (const k of Object.keys(s)) a[k] = (a[k] || 0) + s[k]; return a; }, {});
  return `agentes: ${r.candidates} candidatos, ${r.enqueued} novos; executados ${t.claimed || 0} (ok ${t.completed || 0}, retry ${t.retried || 0}, falha ${t.failed || 0}, bloqueado ${t.blocked || 0})`
    + `${r.notify?.events ? `; aviso de ${r.notify.events} eventos ${r.notify.delivered ? 'entregue' : 'NÃO entregue'}` : ''}${r.errors.length ? `; erros: ${r.errors.join(' | ')}` : ''}`;
};
