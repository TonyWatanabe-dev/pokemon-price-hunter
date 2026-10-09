// Frescor dos dados servidos pela API e pelas páginas (Lote 2).
// Relógio confiável de cada fonte:
//  • banco: max(offer.last_seen_at) das ofertas ativas/pendentes. A sincronização grava last_seen_at = horário da
//    rodada do robô em toda oferta lida, então esse valor é a rodada mais recente que chegou ao banco. Se a
//    sincronização parar, ele para junto (o generatedAt do state.json, não).
//  • state.json: generatedAt (horário da rodada que gerou o arquivo).
// Limites (minutos), a partir do ciclo do robô: rodada a cada 15 min; job de 5–8 min (máx. observado 7,8 min);
// a sincronização termina ~1–2 min depois de publicar. Idade normal do banco: até ~25 min.
//  • atual: até 30 min · atrasado: até 90 min (1 a ~5 rodadas perdidas; é o mesmo limite que o site já usa para
//    "Robô pausado") · desatualizado: acima de 90 min · indisponivel: acima de 24 h, ou sem horário válido.
// Desatualizado é servido só quando não há fonte mais nova, sempre marcado; indisponível não é servido como dado.
import { q } from './db.mjs';

export const LIMITS = { ATUAL_MIN: 30, ATRASADO_MIN: 90, EXPIRA_MIN: 24 * 60 };
const USABLE = new Set(['atual', 'atrasado']);

let clock = () => Date.now();
export const nowMs = () => clock();
/** Só para testes: fixa o relógio usado na classificação. */
export function setFreshnessClock(fn) { clock = typeof fn === 'function' ? fn : () => Date.now(); dbCache = { at: 0, v: undefined }; }

/** Classifica um horário. Horário ausente/inválido ou no futuro (> 5 min) = indisponivel. */
export function classify(at, now = nowMs(), source = null) {
  const t = Date.parse(at ?? '');
  if (!Number.isFinite(t) || t - now > 5 * 60e3) return { status: 'indisponivel', source, dataAt: null, ageMin: null, limits: LIMITS };
  const ageMin = Math.max(0, Math.round((now - t) / 6e4));
  const status = ageMin <= LIMITS.ATUAL_MIN ? 'atual' : ageMin <= LIMITS.ATRASADO_MIN ? 'atrasado' : ageMin <= LIMITS.EXPIRA_MIN ? 'desatualizado' : 'indisponivel';
  return { status, source, dataAt: new Date(t).toISOString(), ageMin, limits: LIMITS };
}
export const usable = (fr) => !!fr && USABLE.has(fr.status);

const DB_AT_SQL = `SELECT max(last_seen_at) AS at FROM hunter.offer WHERE status IN ('active', 'pending')`;
let dbCache = { at: 0, v: undefined };
/** Horário da rodada mais recente que chegou ao banco (cache de 60 s, como o catálogo). Lança se o banco falhar. */
export async function dbDataAt({ now = nowMs() } = {}) {
  if (dbCache.v !== undefined && now - dbCache.at < 60_000) return dbCache.v;
  const rows = await q(DB_AT_SQL);
  const v = rows[0]?.at ? new Date(rows[0].at).toISOString() : null;
  dbCache = { at: now, v };
  return v;
}
export function clearFreshnessCache() { dbCache = { at: 0, v: undefined }; }

/** Coloca o frescor no corpo da resposta: em meta (listas paginadas) ou no topo. */
export function attach(body, fr, fallback = null) {
  if (!body || typeof body !== 'object' || !fr) return body;
  const f = { status: fr.status, source: fr.source, dataAt: fr.dataAt, ageMin: fr.ageMin, ...(fallback ? { fallback } : {}) };
  if (body.meta && typeof body.meta === 'object') body.meta.freshness = f; else body.freshness = f;
  if ('generatedAt' in body) body.generatedAt = fr.dataAt;          // Home: o horário mostrado é o da fonte servida
  return body;
}
export function headers(fr) {
  if (!fr) return {};
  return { 'X-Data-Freshness': fr.status, ...(fr.dataAt ? { 'X-Data-At': fr.dataAt } : {}), ...(fr.ageMin != null ? { 'X-Data-Age-Min': String(fr.ageMin) } : {}) };
}
