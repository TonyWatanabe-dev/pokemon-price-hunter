// Saúde do banco vista pelo robô (só leitura): o banco recebeu a rodada anterior?
// A sincronização (passo "Sincronizar com o banco") roda DEPOIS de publicar os dados e grava em todas as ofertas
// lidas last_seen_at = horário da rodada. Por isso, na rodada seguinte, max(offer.last_seen_at) igual ao generatedAt
// da rodada anterior prova que ela chegou ao banco; menor que isso prova que não chegou.
// Nunca lança e nunca trava a rodada; nunca registra endereço de conexão.
import { pgConnectionConfig } from './db/ssl.js';

const SQL_SEEN = `SELECT max(last_seen_at) AS last_seen_at FROM hunter.offer WHERE status = 'active'`;
const SQL_ENGINE = `SELECT max(calculated_at) AS engine_at FROM hunter.opportunity`;
// Batida do motor (uma linha por execução concluída: ENGINE_HEARTBEAT, src/core/opportunity-run.js). Sem a tabela ou sem batida: null.
const SQL_HAS_EVENTS = `SELECT to_regclass('hunter.system_event') IS NOT NULL AS ok`;
const SQL_ENGINE_RUN = `SELECT max(created_at) AS run_at FROM hunter.system_event WHERE type = 'ENGINE_HEARTBEAT'`;
// Copag oficial atual verificada (só leitura), para o aviso antecipado de vencimento (copag_vencendo; ver copagExpiringSoon).
// Sem filtro de idade: quem decide o que vence é a função pura, com a mesma janela da view (migration 010).
const SQL_COPAG = `SELECT p.legacy_id, r.reference_kind, r.verification_status, r.value::float8 AS value, r.source, r.source_url, r.verified_at
  FROM hunter.reference_price r JOIN hunter.product p ON p.id = r.product_id
 WHERE r.reference_kind = 'COPAG_OFFICIAL_CURRENT' AND r.verification_status = 'verified' AND p.legacy_id IS NOT NULL`;

const safeMsg = (e) => String(e?.code || e?.message || e || 'erro').replace(/postgres(ql)?:\/\/\S+/gi, '[url]').slice(0, 120);
const iso = (v) => (v == null ? null : new Date(v).toISOString());
const isoOrNull = (v) => { const t = v == null ? NaN : new Date(v).getTime(); return Number.isFinite(t) ? new Date(t).toISOString() : null; };

/** @returns {Promise<{ status: 'ok'|'off'|'error', lastSeenAt: string|null, engineAt: string|null, engineRunAt: string|null, copagRefs: Array<object>|null, reason: string|null }>} */
export async function readDbHealth({ env = process.env, timeoutMs = 5000, loadPg = () => import('pg') } = {}) {
  const url = env.DATABASE_URL;
  if (!url) return { status: 'off', lastSeenAt: null, engineAt: null, engineRunAt: null, copagRefs: null, reason: 'sem DATABASE_URL' };
  let client = null; let timer = null;
  try {
    const { default: pg } = await loadPg();
    const { connectionString, ssl } = pgConnectionConfig(url, { env });
    client = new pg.Client({ connectionString, ssl,
      connectionTimeoutMillis: timeoutMs, query_timeout: timeoutMs });
    client.on('error', () => {});
    const work = (async () => {
      await client.connect();
      await client.query('BEGIN READ ONLY');
      await client.query(`SET LOCAL statement_timeout = ${Math.max(1, Math.floor(timeoutMs))}`);
      const a = await client.query(SQL_SEEN);
      const b = await client.query(SQL_ENGINE);
      const e = (await client.query(SQL_HAS_EVENTS)).rows[0]?.ok ? await client.query(SQL_ENGINE_RUN) : null;
      // por último e isolada: falha aqui (permissão, tempo) só deixa o aviso Copag sem medida, nunca derruba a saúde do banco
      let copagRefs = null;
      try { copagRefs = (await client.query(SQL_COPAG)).rows.map((r) => ({ ...r, verified_at: isoOrNull(r.verified_at) })); } catch { copagRefs = null; }
      await client.query('COMMIT');
      return { lastSeenAt: iso(a.rows[0]?.last_seen_at), engineAt: iso(b.rows[0]?.engine_at), engineRunAt: iso(e?.rows[0]?.run_at), copagRefs };
    })();
    const limit = new Promise((_, rej) => { timer = setTimeout(() => rej(Object.assign(new Error('tempo esgotado'), { code: 'TIMEOUT' })), timeoutMs + 500); });
    const r = await Promise.race([work, limit]);
    return { status: 'ok', ...r, reason: null };
  } catch (e) {
    return { status: 'error', lastSeenAt: null, engineAt: null, engineRunAt: null, copagRefs: null, reason: safeMsg(e) };
  } finally {
    clearTimeout(timer);
    if (client) { try { client.connection?.stream?.destroy?.(); } catch { /* já fechado */ } client.end().catch(() => {}); }
  }
}

/**
 * Situação da sincronização da rodada ANTERIOR, a partir da leitura acima.
 * ok: o banco tem a rodada anterior · atrasado: não tem · indisponivel: não deu para ler · desligado: sem banco ·
 * sem_referencia: não há rodada anterior para comparar (primeira rodada).
 */
export function syncStatus(health, prevGeneratedAt) {
  const base = { prevGeneratedAt: prevGeneratedAt || null, lastSeenAt: health?.lastSeenAt || null, engineAt: health?.engineAt || null,
    engineRunAt: health?.engineRunAt || null, lagMin: null, reason: health?.reason || null };
  if (!health || health.status === 'off') return { ...base, status: 'desligado' };
  if (health.status !== 'ok') return { ...base, status: 'indisponivel' };
  const prev = Date.parse(prevGeneratedAt || '');
  if (!Number.isFinite(prev)) return { ...base, status: 'sem_referencia' };
  const seen = Date.parse(health.lastSeenAt || '');
  if (!Number.isFinite(seen)) return { ...base, status: 'atrasado', lagMin: null };
  const lagMin = Math.round((prev - seen) / 6e4);
  // tolerância de 1 s (arredondamento de timestamp no banco)
  return { ...base, lagMin: Math.max(0, lagMin), status: seen >= prev - 1000 ? 'ok' : 'atrasado' };
}
