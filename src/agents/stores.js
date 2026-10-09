// Stores do Orchestrator. O de PostgreSQL usa automation_job/system_event (migration 001);
// o de memória tem a mesma semântica e serve aos testes e a rodadas sem banco.
// Toda escrita de término exige locked_by = worker e status 'running' (fencing): um worker que
// perdeu a lease não sobrescreve o trabalho de quem a assumiu.

const READY = new Set(['pending', 'retry']);

export function memoryStore() {
  const jobs = [];
  const events = [];
  let seq = 0;
  const byId = (id) => jobs.find((j) => j.id === id);
  const owned = (id, workerId) => { const j = byId(id); return j && j.status === 'running' && j.locked_by === workerId ? j : null; };

  return {
    jobs, events,
    async insert(s) {
      const found = jobs.find((j) => j.idempotency_key === s.idempotencyKey);
      if (found) return { job: { ...found }, created: false };
      const job = {
        id: ++seq, type: s.type, entity_type: s.entityType, entity_id: s.entityId, priority: s.priority,
        status: 'pending', attempts: 0, max_attempts: s.maxAttempts, idempotency_key: s.idempotencyKey,
        payload: structuredClone(s.payload), result: null, error: null, run_after: new Date(s.runAfter),
        locked_by: null, locked_at: null, created_at: new Date(s.runAfter), started_at: null, finished_at: null,
      };
      jobs.push(job);
      return { job: { ...job }, created: true };
    },
    async claim({ now, workerId, limit, leaseMs }) {
      const stale = now.getTime() - leaseMs;
      const ready = jobs
        .filter((j) => (READY.has(j.status) && j.run_after <= now) || (j.status === 'running' && j.locked_at.getTime() < stale))
        .sort((a, b) => a.priority - b.priority || a.run_after - b.run_after || a.id - b.id)
        .slice(0, limit);
      for (const j of ready) Object.assign(j, { status: 'running', attempts: j.attempts + 1, locked_by: workerId, locked_at: now, started_at: j.started_at ?? now, error: null });
      return ready.map((j) => ({ ...j, payload: structuredClone(j.payload) }));
    },
    async complete(id, workerId, result, now) {
      const j = owned(id, workerId); if (!j) return false;
      Object.assign(j, { status: 'completed', result, finished_at: now, locked_by: null, locked_at: null });
      return true;
    },
    async fail(id, workerId, { status, error, runAfter, refund, now }) {
      const j = owned(id, workerId); if (!j) return false;
      Object.assign(j, {
        status, error, run_after: runAfter ?? j.run_after, attempts: j.attempts - (refund ? 1 : 0),
        finished_at: status === 'retry' ? null : now, locked_by: null, locked_at: null,
      });
      return true;
    },
    async event(type, job, payload) { events.push({ type, entity_type: 'automation_job', entity_id: String(job.id), payload }); },
  };
}

// `db` é um pg.Pool (ou qualquer objeto com query). Cada operação é um único comando: atômica sem transação.
export function pgStore(db) {
  const one = async (sql, args) => (await db.query(sql, args)).rows[0];
  return {
    async insert(s) {
      const created = await one(
        `INSERT INTO automation_job (type, entity_type, entity_id, priority, max_attempts, idempotency_key, payload, run_after)
         VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, $8) ON CONFLICT (idempotency_key) DO NOTHING RETURNING *`,
        [s.type, s.entityType, s.entityId, s.priority, s.maxAttempts, s.idempotencyKey, JSON.stringify(s.payload ?? {}), s.runAfter]);
      if (created) return { job: created, created: true };
      return { job: await one('SELECT * FROM automation_job WHERE idempotency_key = $1', [s.idempotencyKey]), created: false };
    },
    async claim({ now, workerId, limit, leaseMs }) {
      const { rows } = await db.query(
        `WITH c AS (
           SELECT id FROM automation_job
            WHERE (status IN ('pending', 'retry') AND run_after <= $1)
               OR (status = 'running' AND locked_at < $1::timestamptz - make_interval(secs => $4::double precision / 1000))
            ORDER BY priority, run_after, id
            LIMIT $3 FOR UPDATE SKIP LOCKED)
         UPDATE automation_job j
            SET status = 'running', attempts = j.attempts + 1, locked_by = $2, locked_at = $1,
                started_at = COALESCE(j.started_at, $1), error = NULL
           FROM c WHERE j.id = c.id
         RETURNING j.*`,
        [now, workerId, limit, leaseMs]);
      return rows.sort((a, b) => a.priority - b.priority || a.run_after - b.run_after || Number(a.id) - Number(b.id));
    },
    async complete(id, workerId, result, now) {
      return !!(await one(
        `UPDATE automation_job SET status = 'completed', result = $3::jsonb, finished_at = $4, locked_by = NULL, locked_at = NULL
          WHERE id = $1 AND locked_by = $2 AND status = 'running' RETURNING id`,
        [id, workerId, JSON.stringify(result), now]));
    },
    async fail(id, workerId, { status, error, runAfter = null, refund = false, now }) {
      return !!(await one(
        `UPDATE automation_job
            SET status = $3, error = $4, run_after = COALESCE($5, run_after), attempts = attempts - $6,
                finished_at = CASE WHEN $3 = 'retry' THEN NULL ELSE $7::timestamptz END, locked_by = NULL, locked_at = NULL
          WHERE id = $1 AND locked_by = $2 AND status = 'running' RETURNING id`,
        [id, workerId, status, error, runAfter, refund ? 1 : 0, now]));
    },
    async event(type, job, payload) {
      await db.query(`INSERT INTO system_event (type, entity_type, entity_id, payload) VALUES ($1, 'automation_job', $2, $3::jsonb)`,
        [type, String(job.id), JSON.stringify(payload)]);
    },
  };
}
