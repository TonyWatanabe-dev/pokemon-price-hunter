// Lote 1 — detecção operacional: estado por rodada (data/meta.json → ops), saúde do banco, vigia por estado,
// avisos (canais, deduplicação, recuperação) e robustez (meta ausente/ilegível/antigo, escrita concorrente).
// Puro, com uma parte em PostgreSQL quando TEST_DATABASE_URL existe.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import http from 'node:http';
import { spawn, execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { buildRunRecord, mergeOps, recordRun, readerSummary, storesSummary, watchedSummary, validRecord, KEEP_RUNS } from '../src/opstate.js';
import { readDbHealth, syncStatus } from '../src/db-health.js';
import { evaluate, decide, commitLedger, RULES } from '../src/ops-watch.js';
import { sendAll } from '../src/ops-notify.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let n = 0;
async function t(name, fn) { try { await fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } }
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'ops-'));
const iso = (base, min) => new Date(Date.parse(base) + min * 6e4).toISOString();
const NOW = '2026-10-09T12:00:00.000Z';

// rodada sintética, montada pelo mesmo construtor do robô
let seq = 0;
function rec({ at, reader = { status: 'ok', valid: 500, read: 520, reason: null }, sync = 'ok', stores, watched } = {}) {
  seq++;
  const prev = iso(at, -15);
  const lastSeenAt = sync === 'atrasado' ? iso(at, -45) : prev;
  const dbSync = sync === 'ok' || sync === 'atrasado' ? syncStatus({ status: 'ok', lastSeenAt, engineAt: prev }, prev)
    : sync === 'indisponivel' ? syncStatus({ status: 'error', reason: 'ECONNREFUSED' }, prev) : syncStatus({ status: 'off' }, prev);
  return buildRunRecord({ env: { GITHUB_RUN_ID: String(1000 + seq), GITHUB_RUN_ATTEMPT: '1', GITHUB_SHA: 'abcdef1234567890', GITHUB_EVENT_NAME: 'workflow_dispatch' },
    startedAt: iso(at, 0), finishedAt: iso(at, 6), generatedAt: at, prevGeneratedAt: prev, reader, dbSync,
    stores: stores || { found: 128, active: 54, withListings: 32, empty: 22, blocked: 54, error: 2, deferred: 0 }, watched, offers: 916, alerts: 0 });
}
const metaOf = (...recs) => recs.reduce((m, r) => mergeOps(m, r, r.finishedAt), { dataVersion: 3, distrust: { stores: ['x'] } });
const okRuns = (at, k = 3, conclusion = 'success') => Array.from({ length: k }, (_, i) => ({ status: 'completed', conclusion, createdAt: iso(at, -15 * i - 7), updatedAt: iso(at, -15 * i), event: 'workflow_dispatch' }));

// ------------------------------------------------------------------ estado por rodada (robô)
await t('1. registro da rodada: campos, sem segredo, ops preserva as outras chaves do meta.json', () => {
  const r = rec({ at: '2026-10-09T11:45:00.000Z' });
  for (const k of ['runId', 'attempt', 'sha', 'trigger', 'generatedAt', 'startedAt', 'finishedAt', 'durationSec', 'result', 'stores', 'reader', 'dbSync', 'health', 'issues']) assert.ok(k in r, k);
  assert.equal(r.durationSec, 360); assert.equal(r.health, 'saudavel'); assert.deepEqual(r.issues, []);
  assert.deepEqual(Object.keys(r.stores).sort(), ['active', 'blocked', 'deferred', 'empty', 'error', 'found', 'withListings']);
  const m = metaOf(r);
  assert.equal(m.dataVersion, 3); assert.deepEqual(m.distrust, { stores: ['x'] }, 'distrust preservado');
  assert.equal(m.ops.last.runId, r.runId); assert.equal(m.ops.lastHealthy.runId, r.runId);
  // nada de segredo, mesmo se o motivo do erro trouxer URL ou token
  const bad = buildRunRecord({ env: {}, startedAt: NOW, finishedAt: NOW, generatedAt: NOW, prevGeneratedAt: null,
    reader: readerSummary({ status: 'error', reason: 'falhou postgres://u:SENHA@host:5432/db bot123456:AAAAsecret' }, 0),
    dbSync: syncStatus({ status: 'error', reason: 'postgresql://u:SENHA@h/db' }, null), stores: storesSummary({}), offers: 0 });
  const s = JSON.stringify(metaOf(bad));
  assert.ok(!/SENHA|AAAAsecret|postgres(ql)?:\/\//.test(s), 'sem senha, token ou URL de conexão');
  assert.equal(bad.reader.status, 'unavailable'); assert.equal(bad.runId, 'local');
});

await t('2. resumo de lojas e do leitor (N válidas de M lidas)', () => {
  const sources = { a: { status: 'ACTIVE', listings: 3 }, b: { status: 'ACTIVE', listings: 0 }, c: { status: 'ACTIVE' }, d: { status: 'BLOCKED' }, e: { status: 'ERROR' }, f: { status: 'PAUSED' } };
  assert.deepEqual(storesSummary(sources, 2), { found: 6, active: 3, withListings: 1, empty: 2, blocked: 1, error: 1, deferred: 2 });
  assert.deepEqual(readerSummary({ status: 'ok', rows: new Map([['x', {}], ['y', {}]]) }, 1), { status: 'ok', valid: 1, read: 2, reason: null });
  assert.equal(readerSummary({ status: 'off', rows: new Map(), reason: 'sem DATABASE_URL' }, 0).status, 'off');
  assert.equal(readerSummary(null, 0).status, 'unavailable');
  const p = buildRunRecord({ env: {}, startedAt: NOW, finishedAt: NOW, generatedAt: NOW, reader: readerSummary({ status: 'ok', rows: new Map() }, 0), dbSync: syncStatus({ status: 'ok', lastSeenAt: NOW }, NOW), stores: storesSummary(sources, 2), offers: 1 });
  assert.equal(p.result, 'parcial', 'lojas adiadas pelo prazo = rodada parcial');
});

await t('3. sincronização: banco com a rodada anterior = ok; sem ela = atrasado; sem leitura = indisponível', () => {
  const prev = '2026-10-09T11:45:00.123Z';
  assert.equal(syncStatus({ status: 'ok', lastSeenAt: prev }, prev).status, 'ok');
  assert.equal(syncStatus({ status: 'ok', lastSeenAt: '2026-10-09T11:45:00.000Z' }, prev).status, 'ok', 'arredondamento de ms tolerado');
  const late = syncStatus({ status: 'ok', lastSeenAt: '2026-10-09T11:30:00.000Z' }, prev);
  assert.equal(late.status, 'atrasado'); assert.equal(late.lagMin, 15);
  assert.equal(syncStatus({ status: 'ok', lastSeenAt: null }, prev).status, 'atrasado', 'banco vazio');
  assert.equal(syncStatus({ status: 'error', reason: 'TIMEOUT' }, prev).status, 'indisponivel');
  assert.equal(syncStatus({ status: 'off' }, prev).status, 'desligado');
  assert.equal(syncStatus({ status: 'ok', lastSeenAt: prev }, null).status, 'sem_referencia', 'primeira rodada');
});

await t('4. meta.json: registro inválido não substitui o último; último saudável preservado; ops corrompido é refeito', () => {
  const a = rec({ at: '2026-10-09T11:30:00.000Z' });
  const b = rec({ at: '2026-10-09T11:45:00.000Z', reader: { status: 'unavailable', valid: 0, read: 0, reason: 'TIMEOUT' } });
  let m = metaOf(a, b);
  assert.equal(m.ops.last.runId, b.runId); assert.equal(m.ops.last.health, 'degradado');
  assert.equal(m.ops.lastHealthy.runId, a.runId, 'falha não apaga o último saudável');
  m = mergeOps(m, { runId: 'x', generatedAt: 'lixo' }, NOW);
  assert.equal(m.ops.last.runId, b.runId, 'inválido não entra'); assert.equal(m.ops.lastInvalid.runId, 'x');
  assert.equal(m.ops.runs.length, 2);
  // reexecução da mesma rodada (mesmo runId/tentativa) não duplica
  m = mergeOps(m, b, NOW); assert.equal(m.ops.runs.length, 2);
  // ops corrompido: refeito sem perder distrust
  const c = mergeOps({ dataVersion: 3, distrust: { stores: [] }, ops: 'lixo' }, a, NOW);
  assert.equal(c.ops.runs.length, 1); assert.deepEqual(c.distrust, { stores: [] });
  const d = mergeOps({ ops: { runs: [{ runId: 1 }, a] } }, b, NOW);
  assert.deepEqual(d.ops.runs.map((r) => r.runId), [a.runId, b.runId], 'registros antigos inválidos descartados');
  // limite de registros
  let big = {}; for (let i = 0; i < KEEP_RUNS + 10; i++) big = mergeOps(big, rec({ at: iso('2026-10-08T00:00:00.000Z', 15 * i) }), NOW);
  assert.equal(big.ops.runs.length, KEEP_RUNS);
  assert.ok(validRecord(big.ops.last));
});

await t('5. escrita concorrente: o arquivo nunca fica pela metade (4 escritores × 40 gravações, leitura contínua)', async () => {
  const file = path.join(tmp, 'meta-conc.json');
  fs.writeFileSync(file, JSON.stringify({ dataVersion: 3, distrust: { stores: ['keep'] } }));
  const script = `import { recordRun, buildRunRecord } from ${JSON.stringify(pathToFileURL(path.join(root, 'src/opstate.js')).href)};
    const w = process.argv[1];
    for (let i = 0; i < 40; i++) { const at = new Date(Date.UTC(2026, 9, 9, 0, i)).toISOString();
      recordRun(${JSON.stringify(file)}, buildRunRecord({ env: { GITHUB_RUN_ID: w + '-' + i }, startedAt: at, finishedAt: at, generatedAt: at, prevGeneratedAt: null,
        reader: { status: 'ok', valid: 1, read: 1, reason: null }, dbSync: { status: 'ok' }, stores: { found: 1, active: 1, withListings: 1, empty: 0, blocked: 0, error: 0, deferred: 0 }, offers: 1 }), at); }`;
  const kids = [1, 2, 3, 4].map((w) => new Promise((res, rej) => { const p = spawn(process.execPath, ['--input-type=module', '-e', script, String(w)], { stdio: ['ignore', 'ignore', 'pipe'] }); let err = ''; p.stderr.on('data', (d) => (err += d)); p.on('exit', (c) => (c === 0 ? res() : rej(new Error(err)))); }));
  let reads = 0; let done = false; const all = Promise.all(kids).then(() => { done = true; });
  while (!done) { const j = JSON.parse(fs.readFileSync(file, 'utf8')); assert.ok(j.distrust); reads++; await new Promise((r) => setTimeout(r, 2)); }
  await all;
  const fin = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.ok(reads > 5, 'leu durante as gravações'); assert.ok(validRecord(fin.ops.last)); assert.deepEqual(fin.distrust, { stores: ['keep'] });
  assert.equal(fs.readdirSync(tmp).filter((f) => f.endsWith('.tmp')).length, 0, 'sem temporário esquecido');
});

// ------------------------------------------------------------------ vigia: estados
const T0 = '2026-10-09T11:45:00.000Z';
const healthy = () => metaOf(rec({ at: iso(T0, -15) }), rec({ at: T0 }));
const healthyAt = (at) => metaOf(rec({ at: iso(at, -15) }), rec({ at }));   // meta que acompanha os dados publicados

await t('6. saudável: dados frescos, rodadas ok, banco e leitor ok', () => {
  const ev = evaluate({ now: NOW, stateGeneratedAt: T0, meta: healthy(), runs: okRuns(NOW) });
  assert.equal(ev.status, 'saudavel', JSON.stringify(ev.reasons)); assert.equal(ev.facts.dataAgeMin, 15); assert.equal(ev.facts.lastRunAgeMin, 0);
  assert.equal(decide(ev, {}, NOW).notify, null);
});

await t('7. robô parado: dados velhos, com o motivo provável', () => {
  const old = iso(NOW, -60);
  let ev = evaluate({ now: NOW, stateGeneratedAt: old, meta: healthy(), runs: okRuns(iso(NOW, -70)) });
  assert.equal(ev.status, 'parado'); assert.deepEqual(ev.reasons.map((r) => r.code), ['dados_parados', 'sem_rodadas']);
  ev = evaluate({ now: NOW, stateGeneratedAt: old, meta: healthy(), runs: okRuns(NOW, 2, 'failure') });
  assert.deepEqual(ev.reasons.map((r) => r.code), ['dados_parados', 'rodada_falhou']);
  ev = evaluate({ now: NOW, stateGeneratedAt: old, meta: healthy(), runs: okRuns(NOW) });
  assert.deepEqual(ev.reasons.map((r) => r.code), ['dados_parados', 'rodada_sem_publicar']);
  assert.equal(evaluate({ now: NOW, stateGeneratedAt: iso(NOW, -RULES.STOP_MIN), meta: healthy(), runs: okRuns(NOW) }).status, 'saudavel', 'exatamente 45 min ainda não é parado');
  const d = decide(ev, {}, NOW); assert.equal(d.notify.kind, 'falha'); assert.match(d.notify.text, /^🔴 TCG Price Hunter parado/);
});

await t('8. sincronização falhando: 1 rodada atrasada só registra; 2 seguidas = degradado', () => {
  const one = metaOf(rec({ at: iso(T0, -15) }), rec({ at: T0, sync: 'atrasado' }));
  assert.equal(evaluate({ now: NOW, stateGeneratedAt: T0, meta: one, runs: okRuns(NOW) }).status, 'saudavel');
  const two = metaOf(rec({ at: iso(T0, -15), sync: 'atrasado' }), rec({ at: T0, sync: 'atrasado' }));
  const ev = evaluate({ now: NOW, stateGeneratedAt: T0, meta: two, runs: okRuns(NOW) });
  assert.equal(ev.status, 'degradado'); assert.deepEqual(ev.reasons.map((r) => r.code), ['sync_falhando']);
  assert.match(decide(ev, {}, NOW).notify.text, /banco não recebeu as últimas rodadas/);
  const off = metaOf(rec({ at: iso(T0, -15), sync: 'desligado', reader: { status: 'off', valid: 0, read: 0, reason: 'sem DATABASE_URL' } }), rec({ at: T0, sync: 'desligado', reader: { status: 'off', valid: 0, read: 0, reason: 'sem DATABASE_URL' } }));
  assert.deepEqual(evaluate({ now: NOW, stateGeneratedAt: T0, meta: off, runs: okRuns(NOW) }).reasons.map((r) => r.code), ['banco_desligado']);
  const down = metaOf(rec({ at: iso(T0, -15), sync: 'indisponivel', reader: { status: 'unavailable', valid: 0, read: 0, reason: 'ECONNREFUSED' } }), rec({ at: T0, sync: 'indisponivel', reader: { status: 'unavailable', valid: 0, read: 0, reason: 'ECONNREFUSED' } }));
  assert.deepEqual(evaluate({ now: NOW, stateGeneratedAt: T0, meta: down, runs: okRuns(NOW) }).reasons.map((r) => r.code), ['banco_inacessivel', 'leitor_indisponivel']);
});

await t('9. leitor: indisponível 2× = degradado; zero válidas só com contexto (≥ 10 lidas, 2×)', () => {
  const un = { status: 'unavailable', valid: 0, read: 0, reason: 'TIMEOUT' };
  assert.equal(evaluate({ now: NOW, stateGeneratedAt: T0, meta: metaOf(rec({ at: iso(T0, -15) }), rec({ at: T0, reader: un })), runs: okRuns(NOW) }).status, 'saudavel', 'uma falha isolada não avisa');
  const ev = evaluate({ now: NOW, stateGeneratedAt: T0, meta: metaOf(rec({ at: iso(T0, -15), reader: un }), rec({ at: T0, reader: un })), runs: okRuns(NOW) });
  assert.deepEqual(ev.reasons.map((r) => r.code), ['leitor_indisponivel']); assert.match(ev.reasons[0].text, /TIMEOUT/);
  const zero = { status: 'ok', valid: 0, read: 530, reason: null };
  assert.deepEqual(evaluate({ now: NOW, stateGeneratedAt: T0, meta: metaOf(rec({ at: iso(T0, -15), reader: zero }), rec({ at: T0, reader: zero })), runs: okRuns(NOW) }).reasons.map((r) => r.code), ['leitor_sem_nota']);
  const few = { status: 'ok', valid: 0, read: 4, reason: null };
  const evf = evaluate({ now: NOW, stateGeneratedAt: T0, meta: metaOf(rec({ at: iso(T0, -15), reader: few }), rec({ at: T0, reader: few })), runs: okRuns(NOW) });
  assert.equal(evf.status, 'saudavel', 'pouca oferta lida: zero válidas não é falha');
  assert.deepEqual(metaOf(rec({ at: T0, reader: few })).ops.last.issues, ['leitor_sem_nota_valida'], 'mas fica registrado na rodada');
});

await t('9b. fonte vigiada (Mercado Livre): historicamente ativa e zerada/bloqueada 2× = degradado', () => {
  const S = '2026-10-08T10:00:00.000Z';
  const ml = (status, listings, lastNonEmpty = S) => watchedSummary({ mercadolivre: { name: 'Mercado Livre', status, listings, lastNonEmpty }, outra: { status: 'BLOCKED' } });
  assert.deepEqual(Object.keys(ml('ACTIVE', 3)), ['mercadolivre'], 'só as fontes vigiadas entram no registro');
  const ev = (a, b) => evaluate({ now: NOW, stateGeneratedAt: T0, meta: metaOf(rec({ at: iso(T0, -15), watched: a }), rec({ at: T0, watched: b })), runs: okRuns(NOW) });
  assert.equal(ev(ml('ACTIVE', 12), ml('ACTIVE', 9)).status, 'saudavel', 'com anúncios: saudável');
  assert.equal(ev(ml('ACTIVE', 12), ml('ACTIVE', 0)).status, 'saudavel', 'uma rodada zerada só não avisa');
  const z = ev(ml('ACTIVE', 0), ml('ACTIVE', 0));
  assert.equal(z.status, 'degradado'); assert.deepEqual(z.reasons.map((r) => r.code), ['fonte_degradada']); assert.match(z.reasons[0].text, /Mercado Livre sem nenhum anúncio nas últimas 2 rodadas/);
  const b = ev(ml('BLOCKED', 0), ml('ERROR', 0));
  assert.deepEqual(b.reasons.map((r) => r.code), ['fonte_degradada'], 'bloqueada/com erro 2× = degradado'); assert.match(b.reasons[0].text, /com erro/);
  assert.equal(ev(ml('BLOCKED', null, null), ml('BLOCKED', null, null)).status, 'saudavel', 'fonte que nunca trouxe anúncio (ex.: ML não autorizado) não avisa');
  assert.equal(ev(undefined, undefined).status, 'saudavel', 'registro antigo sem watched: nada muda');
  assert.match(decide(z, {}, NOW).notify.text, /Mercado Livre/);
});

await t('10. rodadas do robô falhando com dados ainda frescos = degradado (cancelada não conta)', () => {
  const runs = [{ status: 'completed', conclusion: 'failure', updatedAt: iso(NOW, -2) }, { status: 'completed', conclusion: 'cancelled', updatedAt: iso(NOW, -10) }, { status: 'completed', conclusion: 'failure', updatedAt: iso(NOW, -17) }, { status: 'in_progress', conclusion: null, updatedAt: NOW }];
  const ev = evaluate({ now: NOW, stateGeneratedAt: iso(NOW, -20), meta: healthy(), runs });
  assert.deepEqual(ev.reasons.map((r) => r.code), ['rodadas_falhando']);
});

await t('11. meta.json ausente, ilegível ou antigo', () => {
  const abs = evaluate({ now: NOW, stateGeneratedAt: T0, meta: null, metaError: 'ausente', runs: okRuns(NOW) });
  assert.equal(abs.status, 'desconhecido'); assert.equal(decide(abs, { notifiedStatus: 'degradado', lastStatus: 'saudavel' }, NOW).notify, null, 'desconhecido nunca avisa');
  assert.equal(evaluate({ now: NOW, stateGeneratedAt: T0, meta: { dataVersion: 3 }, runs: okRuns(NOW) }).status, 'desconhecido', 'meta antigo sem ops (antes da publicação)');
  const bad = evaluate({ now: NOW, stateGeneratedAt: T0, meta: null, metaError: 'ilegivel', runs: okRuns(NOW) });
  assert.equal(bad.status, 'degradado'); assert.deepEqual(bad.reasons.map((r) => r.code), ['meta_ilegivel']);
  const stale = metaOf(rec({ at: iso(T0, -75) }), rec({ at: iso(T0, -60) }));
  assert.deepEqual(evaluate({ now: NOW, stateGeneratedAt: T0, meta: stale, runs: okRuns(NOW) }).reasons.map((r) => r.code), ['meta_desatualizado']);
  assert.equal(evaluate({ now: NOW, stateGeneratedAt: undefined, meta: healthy(), runs: okRuns(NOW) }).status, 'desconhecido', 'dados ilegíveis');
  // publicação parcial: meta de uma rodada mais nova que os dados (outro commit) não derruba a avaliação
  const ahead = metaOf(rec({ at: iso(T0, -15) }), rec({ at: T0 }), rec({ at: iso(T0, 15) }));
  assert.equal(evaluate({ now: NOW, stateGeneratedAt: T0, meta: ahead, runs: okRuns(NOW) }).status, 'saudavel');
});

// ------------------------------------------------------------------ vigia: avisos e livro
function cycle(steps, ledger = {}) {
  const sent = [];
  for (const s of steps) {
    const ev = evaluate({ now: s.now, stateGeneratedAt: s.data, meta: s.meta ?? healthyAt(s.data), runs: okRuns(s.now) });
    const d = decide(ev, ledger, s.now);
    const delivered = d.notify ? s.deliver !== false : false;
    if (d.notify && delivered) sent.push(d.notify.kind + ':' + ev.status);
    ledger = commitLedger(ledger, ev, d, delivered, s.now);
  }
  return { sent, ledger };
}

await t('12. deduplicação: falha avisada uma vez, lembrete a cada 6 h, problema novo avisa', () => {
  const steps = []; let at = '2026-10-09T00:00:00.000Z';
  for (let i = 0; i < 30; i++) { at = iso(at, 15); steps.push({ now: at, data: iso(at, -60) }); }   // 7,5 h parado
  const { sent, ledger } = cycle(steps);
  assert.deepEqual(sent, ['falha:parado', 'lembrete:parado'], sent.join());
  assert.equal(ledger.notifiedStatus, 'parado');
  // degradado → parado (piora) avisa de novo; mesmo estado com problema novo também
  const two = metaOf(rec({ at: iso(T0, -15), sync: 'atrasado' }), rec({ at: T0, sync: 'atrasado' }));
  const un = { status: 'unavailable', valid: 0, read: 0, reason: 'TIMEOUT' };
  const both = metaOf(rec({ at: iso(T0, -15), sync: 'atrasado', reader: un }), rec({ at: T0, sync: 'atrasado', reader: un }));
  const r = cycle([{ now: NOW, data: T0, meta: two }, { now: iso(NOW, 15), data: iso(T0, 15), meta: two }, { now: iso(NOW, 30), data: iso(T0, 30), meta: both }, { now: iso(NOW, 120), data: iso(NOW, 30), meta: both }]);
  assert.deepEqual(r.sent, ['falha:degradado', 'falha:degradado', 'falha:parado']);
});

await t('13. recuperação: avisa depois de 2 checagens saudáveis; sem falha avisada, não avisa', () => {
  const steps = [{ now: NOW, data: iso(NOW, -60) }, { now: iso(NOW, 15), data: iso(NOW, 5) }, { now: iso(NOW, 30), data: iso(NOW, 20) }, { now: iso(NOW, 45), data: iso(NOW, 35) }];
  const { sent, ledger } = cycle(steps);
  assert.deepEqual(sent, ['falha:parado', 'recuperado:saudavel']);
  assert.equal(ledger.notifiedStatus, 'saudavel'); assert.equal(ledger.incidentSince, null);
  const ev = evaluate({ now: iso(NOW, 30), stateGeneratedAt: iso(NOW, 20), meta: healthy(), runs: okRuns(iso(NOW, 30)) });
  assert.match(decide(ev, { notifiedStatus: 'parado', notifiedCodes: ['dados_parados'], incidentSince: NOW, lastStatus: 'saudavel' }, iso(NOW, 30)).notify.text, /recuperado.*durou 30 min/s);
  // vaivém: saudável, falha, saudável — sem recuperação no primeiro saudável
  assert.deepEqual(cycle([{ now: NOW, data: iso(NOW, -60) }, { now: iso(NOW, 15), data: iso(NOW, 5) }, { now: iso(NOW, 30), data: iso(NOW, -50) }]).sent, ['falha:parado']);
  assert.deepEqual(cycle([{ now: NOW, data: iso(NOW, -5) }, { now: iso(NOW, 15), data: iso(NOW, 10) }]).sent, [], 'sempre saudável: silêncio');
});

await t('14. aviso não entregue: livro não muda e o aviso é tentado de novo', () => {
  const { sent, ledger } = cycle([{ now: NOW, data: iso(NOW, -60), deliver: false }, { now: iso(NOW, 15), data: iso(NOW, -75), deliver: false }, { now: iso(NOW, 30), data: iso(NOW, -90) }]);
  assert.deepEqual(sent, ['falha:parado']); assert.equal(ledger.notifiedStatus, 'parado');
  assert.equal(ledger.incidentSince, NOW, 'início do incidente guardado desde a primeira checagem');
});

// ------------------------------------------------------------------ canais
const fakeFetch = (plan) => async (url, opt) => {
  const name = url.includes('/bot') ? 'telegram' : 'ntfy';
  const p = plan[name];
  if (p === 'hang') return new Promise((_, rej) => opt.signal.addEventListener('abort', () => rej(opt.signal.reason)));
  if (p === 'throw') throw new Error(`falha em ${url}`);
  return new Response('{}', { status: p === 500 ? 500 : 200 });
};
const ENV = { TELEGRAM_BOT_TOKEN: '123456:SEGREDO-telegram', TELEGRAM_CHAT_ID: '987654', NTFY_TOPIC: 'topico-secreto' };
const MSG = { kind: 'falha', title: 'x', text: 'y' };

await t('15. um canal falha e o outro entrega = entregue; os dois falham = não entregue; travado cai no prazo', async () => {
  let r = await sendAll(MSG, { env: ENV, fetchImpl: fakeFetch({ telegram: 'throw', ntfy: 200 }) });
  assert.equal(r.delivered, true); assert.deepEqual(r.channels.map((c) => [c.name, c.ok]), [['telegram', false], ['ntfy', true]]);
  assert.ok(!JSON.stringify(r).includes('SEGREDO') && !JSON.stringify(r).includes('topico-secreto'), 'erro sem token: ' + JSON.stringify(r));
  r = await sendAll(MSG, { env: ENV, fetchImpl: fakeFetch({ telegram: 500, ntfy: 'throw' }) });
  assert.equal(r.delivered, false);
  const t0 = Date.now(); r = await sendAll(MSG, { env: ENV, timeoutMs: 150, fetchImpl: fakeFetch({ telegram: 'hang', ntfy: 'hang' }) });
  assert.equal(r.delivered, false); assert.ok(Date.now() - t0 < 2000, 'prazo respeitado');
  r = await sendAll(MSG, { env: {}, fetchImpl: fakeFetch({}) });
  assert.equal(r.delivered, false); assert.ok(r.channels.every((c) => c.skipped), 'sem canal configurado');
});

// ------------------------------------------------------------------ vigia de ponta a ponta (CLI, canais locais)
await t('16. tools/watchdog.mjs: parado → avisa e grava o livro; de novo → silêncio; volta → recuperado; nada de segredo na saída', async () => {
  const got = [];
  const srv = http.createServer((req, res) => { let b = ''; req.on('data', (d) => (b += d)); req.on('end', () => { got.push({ url: req.url, body: JSON.parse(b || '{}') }); res.end('{}'); }); });
  await new Promise((r) => srv.listen(0, r)); const port = srv.address().port;
  const env = { ...process.env, ...ENV, TELEGRAM_API: `http://127.0.0.1:${port}`, NTFY_SERVER: `http://127.0.0.1:${port}/ntfy` };
  const d = fs.mkdtempSync(path.join(tmp, 'wd-'));
  const w = (f, o) => fs.writeFileSync(path.join(d, f), typeof o === 'string' ? o : JSON.stringify(o));
  w('meta.json', healthy()); w('runs.json', okRuns(NOW));
  const run = (now) => new Promise((res, rej) => { const p = spawn(process.execPath, [path.join(root, 'tools/watchdog.mjs'), '--state', path.join(d, 'state.json'), '--meta', path.join(d, 'meta.json'), '--runs', path.join(d, 'runs.json'), '--ledger', path.join(d, 'ledger.json'), '--now', now], { env }); let o = ''; p.stdout.on('data', (x) => (o += x)); p.stderr.on('data', (x) => (o += x)); p.on('exit', (c) => (c === 0 ? res(o) : rej(new Error(o)))); });
  w('state.json', { generatedAt: iso(NOW, -60) });
  let out = await run(NOW);
  assert.equal(JSON.parse(out.split('\n')[0]).status, 'parado'); assert.equal(got.length, 2, 'Telegram e ntfy');
  assert.match(got[0].url, /^\/bot123456:SEGREDO-telegram\/sendMessage$/); assert.match(got[0].body.text, /parado/);
  assert.ok(!out.includes('SEGREDO') && !out.includes('topico-secreto'), 'saída sem segredo');
  assert.equal(JSON.parse(fs.readFileSync(path.join(d, 'ledger.json'))).notifiedStatus, 'parado');
  out = await run(iso(NOW, 15)); assert.equal(got.length, 2, 'mesma falha: silêncio');
  w('state.json', { generatedAt: iso(NOW, 25) }); w('meta.json', metaOf(rec({ at: iso(NOW, 10) }), rec({ at: iso(NOW, 25) }))); w('runs.json', okRuns(iso(NOW, 30)));
  await run(iso(NOW, 30)); assert.equal(got.length, 2, 'primeira checagem saudável: espera');
  await run(iso(NOW, 45)); assert.equal(got.length, 4); assert.match(got[2].body.text, /recuperado/);
  // meta ilegível e livro corrompido não quebram o vigia
  w('meta.json', '{"ops": [truncado'); w('ledger.json', 'lixo');
  out = await run(iso(NOW, 60)); assert.equal(JSON.parse(out.split('\n')[0]).status, 'degradado'); assert.deepEqual(JSON.parse(out.split('\n')[0]).reasons, ['meta_ilegivel']);
  fs.rmSync(path.join(d, 'meta.json')); fs.rmSync(path.join(d, 'state.json'));
  out = await run(iso(NOW, 75)); assert.equal(JSON.parse(out.split('\n')[0]).status, 'desconhecido');
  srv.close();
});

// ------------------------------------------------------------------ workflow do vigia
await t('17. watchdog.yml: disparo externo + reserva, concorrência, permissões mínimas, livro em cache, sem segredo impresso', () => {
  const y = fs.readFileSync(path.join(root, '.github/workflows/watchdog.yml'), 'utf8');
  assert.match(y, /workflow_dispatch:/); assert.match(y, /schedule:/);
  assert.match(y, /concurrency:\s*\n\s*group: watchdog\s*\n\s*cancel-in-progress: false/);
  assert.match(y, /permissions:\s*\n\s*contents: read\s*\n\s*actions: read/); assert.doesNotMatch(y, /contents: write/);
  assert.match(y, /actions\/cache\/restore@v4/); assert.match(y, /actions\/cache\/save@v4/); assert.match(y, /restore-keys: watchdog-ledger-/);
  assert.match(y, /tools\/watchdog\.mjs --state wd\/state\.json --meta wd\/meta\.json --runs wd\/runs\.json --ledger wd\/ledger\.json/);
  assert.doesNotMatch(y, /(echo|printf)[^\n]*\$\{?\{?\s*(secrets\.|TELEGRAM_BOT_TOKEN|NTFY_TOPIC)/, 'nenhum segredo impresso');
  assert.doesNotMatch(y, /run:[^\n]*\$\{\{\s*inputs\./, 'input só por variável de ambiente');
  const h = fs.readFileSync(path.join(root, '.github/workflows/hunter.yml'), 'utf8');
  assert.match(h, /DATABASE_URL: \$\{\{ secrets\.DATABASE_URL \}\}[\s\S]*npm run hunt|npm run hunt[\s\S]*DATABASE_URL: \$\{\{ secrets\.DATABASE_URL \}\}/, 'robô já recebe DATABASE_URL na caça');
});

// ------------------------------------------------------------------ saúde do banco (falhas simuladas e PostgreSQL real)
await t('18. readDbHealth: sem DATABASE_URL, pg ausente, conexão recusada e travada — nunca lança, nunca vaza URL', async () => {
  assert.equal((await readDbHealth({ env: {} })).status, 'off');
  let r = await readDbHealth({ env: { DATABASE_URL: 'postgres://u:SENHA@db.exemplo:5432/x' }, loadPg: async () => { throw new Error('Cannot find package pg'); } });
  assert.equal(r.status, 'error'); assert.ok(!JSON.stringify(r).includes('SENHA'));
  r = await readDbHealth({ env: { DATABASE_URL: 'postgres://u:SENHA@127.0.0.1:1/x' }, timeoutMs: 1500 });
  assert.equal(r.status, 'error'); assert.ok(!JSON.stringify(r).includes('SENHA'));
  const hang = { default: { Client: class { on() {} connect() { return new Promise(() => {}); } query() { return new Promise(() => {}); } end() { return Promise.resolve(); } } } };
  const t0 = Date.now(); r = await readDbHealth({ env: { DATABASE_URL: 'postgres://u:p@h/x' }, timeoutMs: 200, loadPg: async () => hang });
  assert.equal(r.status, 'error'); assert.equal(r.reason, 'TIMEOUT'); assert.ok(Date.now() - t0 < 2000);
});

const DBURL = process.env.TEST_DATABASE_URL;
if (DBURL) {
  await t('19. PostgreSQL: lê max(last_seen_at) e max(calculated_at) só lendo; sync ok/atrasado contra o banco real', async () => {
    const { default: pg } = await import('pg');
    const name = 'ops_health_' + process.pid;
    const admin = new pg.Client(DBURL); await admin.connect();
    await admin.query(`DROP DATABASE IF EXISTS ${name}`); await admin.query(`CREATE DATABASE ${name}`);
    const u = new URL(DBURL); u.pathname = '/' + name; const url = u.toString();
    const c = new pg.Client(url); await c.connect();
    try {
      await c.query(`CREATE SCHEMA hunter; CREATE TABLE hunter.offer (id serial, status text, last_seen_at timestamptz);
        CREATE TABLE hunter.opportunity (offer_id int, calculated_at timestamptz);
        INSERT INTO hunter.offer (status, last_seen_at) VALUES ('active', '2026-10-09T11:45:00.123Z'), ('active', '2026-10-09T11:30:00Z'), ('removed', '2026-10-09T12:00:00Z');
        INSERT INTO hunter.opportunity VALUES (1, '2026-10-09T11:46:00Z')`);
      const h = await readDbHealth({ env: { DATABASE_URL: url } });
      assert.equal(h.status, 'ok', h.reason); assert.equal(h.lastSeenAt, '2026-10-09T11:45:00.123Z', 'só ofertas ativas'); assert.equal(h.engineAt, '2026-10-09T11:46:00.000Z');
      assert.equal(syncStatus(h, '2026-10-09T11:45:00.123Z').status, 'ok');
      assert.equal(syncStatus(h, '2026-10-09T12:00:00.000Z').status, 'atrasado');
      // só leitura: a transação é READ ONLY (uma escrita no mesmo esquema falharia); o banco continua igual
      assert.equal((await c.query('SELECT count(*)::int n FROM hunter.offer')).rows[0].n, 3);
    } finally { await c.end(); await admin.query(`DROP DATABASE IF EXISTS ${name}`); await admin.end(); }
  });
} else console.log('(sem TEST_DATABASE_URL: teste 19, de PostgreSQL, pulado)');

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`✓ Detecção operacional (Lote 1): ${n} grupos de testes passaram${DBURL ? ' (puro + banco)' : ' (puro)'}`);
