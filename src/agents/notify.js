// Leva eventos operacionais dos agentes (AGENT_JOB_FAILED / AGENT_JOB_BLOCKED) ao canal do vigia (sendAll).
// Uma mensagem agregada por rodada, só com eventos novos. O cursor fica em system_event
// (AGENT_ALERT_CURSOR) e só avança quando a mensagem chegou a pelo menos um canal: mesma regra do
// livro do vigia. 'ai_disabled' é estado esperado e não gera aviso.
import { sendAll } from '../ops-notify.js';

export const ALERT_TYPES = ['AGENT_JOB_FAILED', 'AGENT_JOB_BLOCKED'];
const ACTIONS = 'https://github.com/TonyWatanabe-dev/pokemon-price-hunter/actions';
const MAX_EVENTS = 50;

export function composeAgentAlert(events) {
  if (!events.length) return null;
  const group = (t) => {
    const by = new Map();
    for (const e of events.filter((x) => x.type === t)) {
      const k = `${e.payload?.type || '?'} — ${String(e.payload?.error || 'sem detalhe').slice(0, 120)}`;
      by.set(k, (by.get(k) || 0) + 1);
    }
    return [...by].map(([k, n]) => `• ${n}× ${k}`);
  };
  const failed = group('AGENT_JOB_FAILED'); const blocked = group('AGENT_JOB_BLOCKED');
  const title = '🟠 TCG Price Hunter: agentes com problema';
  const text = [title, '', ...(failed.length ? ['Falharam:', ...failed] : []), ...(blocked.length ? ['Bloqueados:', ...blocked] : []),
    '', 'Preços e coleta não foram afetados.', ACTIONS].join('\n');
  return { kind: 'falha', title, text };
}

export async function pendingAgentEvents(db) {
  const cur = (await db.query(`SELECT (payload->>'upTo')::bigint AS up FROM system_event WHERE type = 'AGENT_ALERT_CURSOR' ORDER BY id DESC LIMIT 1`)).rows[0];
  const after = cur?.up ?? 0;
  const { rows } = await db.query(
    `SELECT id, type, payload FROM system_event
      WHERE type = ANY($1) AND id > $2 AND coalesce(payload->>'error', '') <> 'ai_disabled'
      ORDER BY id LIMIT $3`, [ALERT_TYPES, after, MAX_EVENTS]);
  return rows;
}

/** @returns {Promise<{ events: number, delivered: boolean|null }>} delivered null = nada a avisar. */
export async function notifyAgentEvents(db, { send = sendAll } = {}) {
  const events = await pendingAgentEvents(db);
  const msg = composeAgentAlert(events);
  if (!msg) return { events: 0, delivered: null };
  const { delivered } = await send(msg);
  if (delivered) {
    const upTo = String(events[events.length - 1].id);
    await db.query(`INSERT INTO system_event (type, entity_type, payload) VALUES ('AGENT_ALERT_CURSOR', 'agents', $1::jsonb)`, [JSON.stringify({ upTo, events: events.length })]);
  }
  return { events: events.length, delivered };
}
