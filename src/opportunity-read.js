// Nota oficial do Opportunity Engine para o robô (alertas e bestDeals). Só LÊ hunter.opportunity: nenhuma fórmula,
// peso, faixa ou confiança é calculada aqui — a faixa vem gravada pelo motor e os rótulos vêm do próprio motor.
// Nunca lança e nunca trava a rodada: sem DATABASE_URL, banco fora do ar ou lento, devolve "sem nota" e os alertas
// que não dependem de nota seguem normalmente.
import { confidenceLevel, BAND_LABEL } from './core/opportunity-engine.js';

export const MAX_AGE_MIN = 60;            // nota calculada há mais de 60 min não vale como oficial
const FUTURE_SKEW_MS = 5 * 60e3;          // tolerância de relógio entre o banco e o robô

const SQL = `SELECT o.legacy_id, op.opportunity_score::int AS score, op.opportunity_band AS band, op.confidence::float8 AS confidence,
    op.price::float8 AS price, op.calculated_at, (SELECT max(calculated_at) FROM opportunity) AS engine_at
  FROM offer o JOIN opportunity op ON op.offer_id = o.id
 WHERE o.legacy_id = ANY($1::text[])`;

// mensagem de erro sem endereço de conexão (nunca vai para o log nada parecido com a URL do banco)
const safeMsg = (e) => String(e?.code || e?.message || e || 'erro').replace(/postgres(ql)?:\/\/\S+/gi, '[url]').slice(0, 120);

/**
 * Lê as linhas oficiais das ofertas pedidas (ids do robô = offer.legacy_id).
 * @returns {{ status: 'ok'|'off'|'error', rows: Map<string, object>, reason: string|null }}
 */
export async function readOfficial(ids, { env = process.env, timeoutMs = 5000, loadPg = () => import('pg') } = {}) {
  const rows = new Map();
  const url = env.DATABASE_URL;
  if (!url) return { status: 'off', rows, reason: 'sem DATABASE_URL' };
  const list = [...new Set((ids || []).map(String))];
  if (!list.length) return { status: 'ok', rows, reason: null };
  let client = null; let timer = null;
  try {
    const { default: pg } = await loadPg();
    const local = /@(localhost|127\.0\.0\.1)[:/]/.test(url);
    client = new pg.Client({ connectionString: url, ssl: local ? false : { rejectUnauthorized: false }, options: '-c search_path=hunter,public',
      connectionTimeoutMillis: timeoutMs, query_timeout: timeoutMs, statement_timeout: timeoutMs });
    client.on('error', () => {});   // erro tardio de socket não derruba o robô
    const work = (async () => {
      await client.connect();
      await client.query('BEGIN READ ONLY');
      const r = await client.query(SQL, [list]);
      await client.query('COMMIT');
      return r.rows;
    })();
    // teto geral: conexão que fica pendurada (TLS, rede) também desiste no prazo
    const limit = new Promise((_, rej) => { timer = setTimeout(() => rej(Object.assign(new Error('tempo esgotado'), { code: 'TIMEOUT' })), timeoutMs + 500); });
    for (const r of await Promise.race([work, limit])) rows.set(String(r.legacy_id), r);
    return { status: 'ok', rows, reason: null };
  } catch (e) {
    return { status: 'error', rows: new Map(), reason: safeMsg(e) };
  } finally {
    clearTimeout(timer);
    if (client) { try { client.connection?.stream?.destroy?.(); } catch { /* já fechado */ } client.end().catch(() => {}); }
  }
}

/**
 * Nota oficial válida para a oferta ATUAL, ou null. Vale só se a linha avaliou o mesmo preço do item que o robô leu
 * agora e foi calculada há no máximo MAX_AGE_MIN. Nada é estimado: sem linha válida, não há nota.
 */
export function officialFor(offer, row, now = Date.now(), maxAgeMin = MAX_AGE_MIN) {
  if (!offer || !row || row.score == null || !Number.isFinite(Number(row.score)) || !row.band) return null;
  if (!(offer.price > 0) || !(row.price > 0) || Math.round(row.price * 100) !== Math.round(offer.price * 100)) return null;
  const ms = (v) => (v instanceof Date ? v.getTime() : Date.parse(v));
  const at = ms(row.calculated_at);
  // O motor só regrava a linha quando algo muda: linha igual continua sendo a avaliação da última rodada do motor.
  // Por isso o prazo conta da rodada mais recente do motor (engine_at), não da última mudança desta linha.
  const engineAt = row.engine_at == null ? NaN : ms(row.engine_at);
  const age = new Date(now).getTime() - (Number.isFinite(engineAt) && engineAt > at ? engineAt : at);
  if (!Number.isFinite(age) || age > maxAgeMin * 60e3 || age < -FUTURE_SKEW_MS) return null;
  const confidence = row.confidence == null ? null : Number(row.confidence);
  return { score: Number(row.score), band: row.band, confidence, level: confidenceLevel(confidence), calculatedAt: new Date(at).toISOString() };
}

/** Texto da linha da nota no alerta (rótulos do próprio motor). */
export function officialLine(x) {
  if (!x) return null;
  return `Opportunity Score: ${x.score}/100 · ${BAND_LABEL[x.band] || x.band}${x.level ? ` · confiança ${x.level}` : ''}`;
}
