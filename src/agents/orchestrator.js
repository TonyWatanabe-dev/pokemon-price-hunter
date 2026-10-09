// Hunter Orchestrator: fila de jobs de agentes sobre automation_job.
// Regras fixas:
// - A IA é opcional. Com AI_AGENTS_ENABLED desligado, handlers de IA ficam 'blocked' e nada mais muda.
// - Agentes só PROPÕEM. Preço, score, ranking e oportunidades continuam nos serviços determinísticos:
//   handler de IA não pode ser registrado nesses namespaces, e o Orchestrator só escreve em
//   automation_job e system_event (pelo store).
// - Cada job tem idempotency_key; repetir enfileiramento não duplica. Tentativas, timeout, backoff
//   e lease (locked_by/locked_at) protegem contra falha, travamento e worker morto.

export const PROTECTED_NAMESPACES = ['price', 'score', 'ranking', 'opportunity', 'offer', 'reference'];

export const DEFAULTS = Object.freeze({
  timeoutMs: 30_000,        // limite por execução de handler
  leaseMs: 120_000,         // job 'running' há mais que isso volta a ser elegível (worker morreu)
  backoffBaseMs: 60_000,    // 1 min, 2 min, 4 min...
  backoffMaxMs: 3_600_000,  // teto de 1 h
  maxResultBytes: 32 * 1024,
  limit: 5,                 // jobs por rodada
});

export class PermanentError extends Error {
  constructor(message) { super(message); this.permanent = true; }
}

const nsOf = (type) => String(type).split('.')[0];
export const backoffMs = (attempts, base = DEFAULTS.backoffBaseMs, max = DEFAULTS.backoffMaxMs) =>
  Math.min(max, base * 2 ** Math.max(0, attempts - 1));

export function withTimeout(fn, ms) {
  const ac = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      ac.abort();
      reject(Object.assign(new Error(`timeout após ${ms} ms`), { code: 'TIMEOUT' }));
    }, ms);
  });
  const work = Promise.resolve().then(() => fn(ac.signal));
  work.catch(() => {}); // resultado tardio depois do timeout é descartado
  return Promise.race([work, timeout]).finally(() => clearTimeout(timer));
}

function checkResult(result, maxBytes) {
  let json;
  try { json = JSON.stringify(result ?? null); } catch { throw new PermanentError('resultado não serializável'); }
  if (json === undefined) throw new PermanentError('resultado não serializável');
  if (Buffer.byteLength(json) > maxBytes) throw new PermanentError(`resultado acima de ${maxBytes} bytes`);
  return JSON.parse(json);
}

export function createOrchestrator({
  store,
  handlers = [],
  workerId = `worker-${process.pid}`,
  now = () => new Date(),
  aiEnabled = process.env.AI_AGENTS_ENABLED === '1',
  ...opts
} = {}) {
  if (!store) throw new Error('store obrigatório');
  const cfg = { ...DEFAULTS, ...opts };
  const registry = new Map();

  function register(h) {
    if (!h || typeof h.type !== 'string' || typeof h.run !== 'function') throw new Error('handler inválido');
    if (registry.has(h.type)) throw new Error(`handler duplicado: ${h.type}`);
    if (h.ai && PROTECTED_NAMESPACES.includes(nsOf(h.type)))
      throw new Error(`handler de IA não pode atuar em "${nsOf(h.type)}": é responsabilidade dos serviços determinísticos`);
    registry.set(h.type, h);
  }
  handlers.forEach(register);

  async function enqueue({ type, entityType = null, entityId = null, payload = {}, idempotencyKey, priority = 100, maxAttempts = 5, runAfter } = {}) {
    if (!type) throw new Error('type obrigatório');
    if (!idempotencyKey) throw new Error('idempotencyKey obrigatória');
    const { job, created } = await store.insert({
      type, entityType, entityId, payload, idempotencyKey, priority, maxAttempts, runAfter: runAfter ?? now(),
    });
    if (job.type !== type) throw new Error(`idempotencyKey "${idempotencyKey}" já pertence a um job do tipo ${job.type}`);
    return { job, created };
  }

  async function settle(job, status, error, extra = {}) {
    const ok = await store.fail(job.id, workerId, { status, error, now: now(), ...extra });
    if (ok && (status === 'failed' || status === 'blocked'))
      await store.event?.(status === 'failed' ? 'AGENT_JOB_FAILED' : 'AGENT_JOB_BLOCKED', job, { type: job.type, attempts: job.attempts, error });
    return ok;
  }

  async function runJob(job, summary) {
    const h = registry.get(job.type);
    if (job.attempts > job.max_attempts) { await settle(job, 'failed', 'lease expirada sem conclusão e tentativas esgotadas'); summary.failed++; return; }
    if (!h) { await settle(job, 'blocked', 'sem handler registrado', { refund: true }); summary.blocked++; return; }
    if (h.ai && !aiEnabled) { await settle(job, 'blocked', 'ai_disabled', { refund: true }); summary.blocked++; return; }

    try {
      const invalid = h.validate?.(job.payload);
      if (invalid) throw new PermanentError(`payload inválido: ${invalid}`);
      const raw = await withTimeout((signal) => h.run(job.payload, { signal, job, now }), h.timeoutMs ?? cfg.timeoutMs);
      const result = checkResult(raw, cfg.maxResultBytes);
      if (await store.complete(job.id, workerId, result, now())) summary.completed++;
      else summary.lost++; // lease perdida: outro worker assumiu; nada é sobrescrito
    } catch (e) {
      const msg = String(e?.message || e).slice(0, 500);
      if (e?.permanent || job.attempts >= job.max_attempts) {
        if (await settle(job, 'failed', msg)) summary.failed++; else summary.lost++;
      } else {
        const runAfter = new Date(now().getTime() + backoffMs(job.attempts, cfg.backoffBaseMs, cfg.backoffMaxMs));
        if (await settle(job, 'retry', msg, { runAfter })) summary.retried++; else summary.lost++;
      }
    }
  }

  async function runOnce({ limit = cfg.limit } = {}) {
    const jobs = await store.claim({ now: now(), workerId, limit, leaseMs: cfg.leaseMs });
    const summary = { claimed: jobs.length, completed: 0, retried: 0, failed: 0, blocked: 0, lost: 0 };
    for (const job of jobs) await runJob(job, summary); // sequencial: barato e previsível no plano gratuito
    return summary;
  }

  return { register, enqueue, runOnce, handlers: () => [...registry.keys()] };
}
