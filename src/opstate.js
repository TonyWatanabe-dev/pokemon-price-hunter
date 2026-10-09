// Estado operacional por rodada, gravado em data/meta.json na seção "ops" (as outras chaves do arquivo, como
// dataVersion e distrust, são preservadas). Só números, status e horários: nada de segredo, token ou URL de conexão.
// Lido pelo vigia (tools/watchdog.mjs) para avisar quando o robô para, o banco não sincroniza ou o leitor falha.
import fs from 'node:fs';
import path from 'node:path';

export const OPS_VERSION = 1;
export const KEEP_RUNS = 96;            // ~24 h de rodadas a cada 15 min

const clean = (s, n = 120) => (s == null ? null : String(s).replace(/postgres(ql)?:\/\/\S+/gi, '[url]').replace(/bot\d+:[\w-]+/g, '[token]').slice(0, n));
const isIso = (s) => typeof s === 'string' && Number.isFinite(Date.parse(s));

/** Leitor oficial: 'ok' | 'unavailable' | 'off', com N (válidas) e M (lidas). */
export function readerSummary(off, validCount) {
  if (!off) return { status: 'unavailable', valid: 0, read: 0, reason: 'leitor não executado' };
  const status = off.status === 'ok' ? 'ok' : off.status === 'off' ? 'off' : 'unavailable';
  return { status, valid: status === 'ok' ? validCount : 0, read: status === 'ok' ? (off.rows?.size ?? 0) : 0, reason: clean(off.reason) };
}

/** Lojas: ativas, ativas com anúncios, ativas sem resultado, bloqueadas, com erro e adiadas pelo prazo da rodada. */
export function storesSummary(sources, deferred = 0) {
  const all = Object.values(sources || {});
  const active = all.filter((s) => s.status === 'ACTIVE');
  return {
    found: all.length,
    active: active.length,
    withListings: active.filter((s) => s.listings > 0).length,
    empty: active.filter((s) => !(s.listings > 0)).length,
    blocked: all.filter((s) => s.status === 'BLOCKED').length,
    error: all.filter((s) => s.status === 'ERROR').length,
    deferred,
  };
}

// Fontes vigiadas uma a uma pelo vigia (src/ops-watch.js), começando pelo Mercado Livre: status, anúncios da rodada
// e quando trouxe anúncios pela última vez (fonte que nunca trouxe anúncio não é "historicamente ativa").
export const WATCHED_SOURCES = ['mercadolivre'];
export function watchedSummary(sources, ids = WATCHED_SOURCES) {
  const out = {};
  for (const id of ids) {
    const s = sources?.[id]; if (!s) continue;
    out[id] = { name: clean(s.name || id, 60), status: s.status || null, listings: Number.isFinite(s.listings) ? s.listings : null, lastNonEmpty: isIso(s.lastNonEmpty) ? s.lastNonEmpty : null };
  }
  return out;
}

/**
 * Motor de oportunidades, pela batida (system_event OPPORTUNITY_ENGINE_RUN) comparada ao generatedAt da rodada
 * anterior — o motor roda logo depois da sincronização dela. lagMin = generatedAt anterior − batida.
 *  ok: batida até ENGINE_OK_MIN antes (ou depois) · parado: banco sincronizou (sync ok) e a batida ficou mais de
 *  ENGINE_STOP_MIN atrás · sem_heartbeat: banco lido, nenhuma batida ainda (estado da implantação: não alerta) ·
 *  desconhecido: sem banco, sem rodada anterior, ou sync atrasado com batida antiga (o problema é a sincronização).
 */
export const ENGINE_STOP_MIN = 30; export const ENGINE_OK_MIN = 60;
export function engineSummary(dbSync) {
  const runAt = dbSync?.engineRunAt || null;
  if (!dbSync || ['desligado', 'indisponivel'].includes(dbSync.status)) return { status: 'desconhecido', runAt, lagMin: null };
  if (!runAt) return { status: 'sem_heartbeat', runAt: null, lagMin: null };
  const prev = Date.parse(dbSync.prevGeneratedAt || ''); const at = Date.parse(runAt);
  if (!Number.isFinite(prev) || !Number.isFinite(at)) return { status: 'desconhecido', runAt, lagMin: null };
  const lagMin = Math.round((prev - at) / 6e4);
  if (dbSync.status === 'ok' && lagMin > ENGINE_STOP_MIN) return { status: 'parado', runAt, lagMin };
  return { status: lagMin <= ENGINE_OK_MIN ? 'ok' : 'desconhecido', runAt, lagMin };
}

/** Problemas da própria rodada (informativo; quem decide alerta é o vigia, com as regras dele). */
export function runIssues(rec) {
  const out = [];
  if (rec.reader?.status === 'unavailable') out.push('leitor_indisponivel');
  if (rec.reader?.status === 'off') out.push('leitor_desligado');
  if (rec.reader?.status === 'ok' && rec.reader.read > 0 && rec.reader.valid === 0) out.push('leitor_sem_nota_valida');
  if (rec.dbSync?.status === 'atrasado') out.push('sync_atrasado');
  if (rec.dbSync?.status === 'indisponivel') out.push('banco_indisponivel');
  if (rec.dbSync?.status === 'desligado') out.push('banco_desligado');
  if (rec.engine?.status === 'parado') out.push('motor_parado');
  return out;
}

export function buildRunRecord({ env = process.env, startedAt, finishedAt, generatedAt, prevGeneratedAt, reader, dbSync, stores, watched, offers, alerts, alertsFailed = 0 }) {
  const s = Date.parse(startedAt); const f = Date.parse(finishedAt);
  const rec = {
    runId: env.GITHUB_RUN_ID ? String(env.GITHUB_RUN_ID) : 'local',
    attempt: env.GITHUB_RUN_ATTEMPT ? Number(env.GITHUB_RUN_ATTEMPT) : 1,
    sha: env.GITHUB_SHA ? String(env.GITHUB_SHA).slice(0, 12) : null,
    trigger: env.GITHUB_EVENT_NAME || 'local',
    generatedAt, prevGeneratedAt: prevGeneratedAt || null,
    startedAt, finishedAt, durationSec: Number.isFinite(f - s) ? Math.round((f - s) / 1000) : null,
    result: stores?.deferred > 0 ? 'parcial' : 'ok',
    stores, watched: watched || {}, offers: offers ?? null, alerts: alerts ?? 0, alertsFailed,
    reader, dbSync: dbSync ? { ...dbSync, reason: clean(dbSync.reason) } : null,
    engine: engineSummary(dbSync),
  };
  rec.issues = runIssues(rec);
  rec.health = rec.issues.length ? 'degradado' : 'saudavel';
  return rec;
}

export function validRecord(r) {
  return !!(r && typeof r === 'object' && typeof r.runId === 'string' && isIso(r.generatedAt) && isIso(r.startedAt) && isIso(r.finishedAt)
    && r.reader && ['ok', 'unavailable', 'off'].includes(r.reader.status) && r.stores && typeof r.stores.active === 'number');
}

/**
 * Junta o registro da rodada ao meta.json anterior. Não perde as outras chaves; um registro inválido nunca
 * substitui o último válido (fica em ops.lastInvalid); o último saudável só é trocado por outro saudável.
 */
export function mergeOps(prevMeta, rec, now = new Date().toISOString()) {
  const meta = prevMeta && typeof prevMeta === 'object' && !Array.isArray(prevMeta) ? { ...prevMeta } : {};
  const old = meta.ops && typeof meta.ops === 'object' && Array.isArray(meta.ops.runs) ? meta.ops : null;
  const ops = old ? { ...old, runs: old.runs.filter(validRecord) } : { version: OPS_VERSION, runs: [], last: null, lastHealthy: null, resetAt: now };
  ops.version = OPS_VERSION;
  if (!validRecord(rec)) {
    ops.lastInvalid = { at: now, reason: 'registro da rodada incompleto ou inválido', runId: typeof rec?.runId === 'string' ? rec.runId : null };
  } else {
    const same = (r) => r.runId === rec.runId && r.attempt === rec.attempt && r.generatedAt === rec.generatedAt;   // mesma rodada gravada de novo
    ops.runs = [...ops.runs.filter((r) => !same(r)), rec].slice(-KEEP_RUNS);
    ops.last = rec;
    if (rec.health === 'saudavel') ops.lastHealthy = rec;
    ops.updatedAt = now;
  }
  meta.ops = ops;
  return meta;
}

/** Escrita atômica com nome temporário único (nunca deixa o arquivo pela metade, nem com dois escritores). */
export function writeJsonAtomic(file, obj) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.${Math.random().toString(36).slice(2)}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(obj, null, 2));
  try { renameRetry(tmp, file); } catch (e) { try { fs.unlinkSync(tmp); } catch { /* já foi */ } throw e; }
}

// No Windows, trocar um arquivo que outro processo está lendo/trocando falha por um instante (EPERM/EACCES/EBUSY).
// Repetir com espera curta e aleatória mantém a troca atômica; no Linux o rename não falha assim e o laço não roda.
const RETRY_CODES = new Set(['EPERM', 'EACCES', 'EBUSY']);
const pause = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
function renameRetry(from, to, budgetMs = 2000) {
  const start = Date.now();
  for (let i = 0; ; i++) {
    try { return fs.renameSync(from, to); }
    catch (e) { if (!RETRY_CODES.has(e.code) || Date.now() - start > budgetMs) throw e; pause(1 + Math.floor(Math.random() * Math.min(2 ** i, 50))); }
  }
}

export function readMeta(file) {
  try { const j = JSON.parse(fs.readFileSync(file, 'utf8')); return j && typeof j === 'object' && !Array.isArray(j) ? j : {}; } catch { return {}; }
}

/** Grava o registro da rodada em meta.json (lê de novo na hora para não perder o que outra parte do robô gravou). */
export function recordRun(file, rec, now) {
  const meta = mergeOps(readMeta(file), rec, now);
  writeJsonAtomic(file, meta);
  return meta.ops;
}
