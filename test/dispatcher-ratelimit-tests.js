// Rate limit fail-closed no Dispatcher (issue #429; docs/auditorias/agentes-fabrica.md §3.2, T2): a leitura de
// `rate_limit` falhando (ou com resposta sem a cota core) pausa o despacho em vez de seguir sem checar a cota.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { rateLimitPause, planDispatch, RATE_LIMIT_MIN_REMAINING, RATE_LIMIT_FAIL_PAUSE_MIN, QUEUE_LABEL } from '../src/agents/dispatcher.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let n = 0; const t = async (name, fn) => { try { await fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } };

const NOW = '2026-10-12T03:00:00Z';
const OP = 'dono';
const FAIL_UNTIL = new Date(Date.parse(NOW) + RATE_LIMIT_FAIL_PAUSE_MIN * 60_000).toISOString();
const core = (remaining, reset) => ({ resources: { core: { limit: 5000, used: 5000 - remaining, remaining, reset } } });
const resetEm = (min) => Math.floor(Date.parse(NOW) / 1000) + min * 60;

await t('entrada null ou erro: pauseUntil definido (fail-closed) com motivo', () => {
  assert.equal(RATE_LIMIT_MIN_REMAINING, 200);
  const nulo = rateLimitPause(null, { now: NOW });
  assert.equal(nulo.pauseUntil, FAIL_UNTIL);
  assert.match(nulo.motivo, /sem resposta.*fail-closed/);
  assert.equal(rateLimitPause(undefined, { now: NOW }).pauseUntil, FAIL_UNTIL);
  const erro = rateLimitPause(new Error('HTTP 502: Bad Gateway (token ghp_abcdefghijklmnopqrstuvwxyz0123)'), { now: NOW });
  assert.equal(erro.pauseUntil, FAIL_UNTIL);
  assert.match(erro.motivo, /falhou \(HTTP 502.*fail-closed/);
  assert.doesNotMatch(erro.motivo, /ghp_/, 'motivo sem token');
});

await t('resposta sem cota core numérica: pausa (fail-closed)', () => {
  for (const bad of [{}, { resources: {} }, { resources: { core: {} } }, core('500', resetEm(30)), core(NaN, resetEm(30)), 'texto', 42]) {
    const r = rateLimitPause(bad, { now: NOW });
    assert.equal(r.pauseUntil, FAIL_UNTIL, JSON.stringify(bad));
    assert.match(r.motivo, /sem cota core.*fail-closed/);
  }
});

await t('remaining >= 200: sem pausa', () => {
  for (const remaining of [200, 201, 4999, 5000]) {
    const r = rateLimitPause(core(remaining, resetEm(30)), { now: NOW });
    assert.equal(r.pauseUntil, null, String(remaining));
    assert.match(r.motivo, new RegExp(`${remaining} restante`));
  }
  assert.equal(rateLimitPause(core(200, undefined), { now: NOW }).pauseUntil, null, 'reset irrelevante com cota suficiente');
});

await t('remaining < 200: pausa até o reset; reset inválido ou passado pausa (fail-closed)', () => {
  const r = rateLimitPause(core(199, resetEm(42)), { now: NOW });
  assert.equal(r.pauseUntil, new Date(resetEm(42) * 1000).toISOString());
  assert.match(r.motivo, /baixa \(199 < 200\)/);
  assert.equal(rateLimitPause(core(0, resetEm(1)), { now: NOW }).pauseUntil, new Date(resetEm(1) * 1000).toISOString());
  for (const reset of [undefined, null, 'x', resetEm(0), resetEm(-5)]) {
    const f = rateLimitPause(core(10, reset), { now: NOW });
    assert.equal(f.pauseUntil, FAIL_UNTIL, String(reset));
    assert.match(f.motivo, /reset inválido.*fail-closed/);
  }
});

await t('now obrigatório; aceita ISO ou ms', () => {
  assert.throws(() => rateLimitPause(null), /now obrigatório/);
  assert.throws(() => rateLimitPause(core(5000, resetEm(30)), { now: 'ontem' }), /now obrigatório/);
  assert.equal(rateLimitPause(null, { now: Date.parse(NOW) }).pauseUntil, FAIL_UNTIL);
});

await t('planDispatch com a pausa da função: leitura falhando não despacha; cota suficiente despacha', () => {
  const issue = { number: 7, title: 'Tarefa 7', state: 'open', author: OP, body: 'Ordem: 1', labels: [QUEUE_LABEL],
    labelEvents: [{ event: 'labeled', label: QUEUE_LABEL, actor: OP, createdAt: '2026-10-12T01:00:00Z' }], comments: [] };
  const plan = (rl) => planDispatch({ now: NOW, operators: [OP], issues: [issue], pulls: [], issueStates: {}, pauseUntil: rateLimitPause(rl, { now: NOW }).pauseUntil });
  for (const rl of [null, new Error('timeout'), {}, core(150, resetEm(20))]) {
    const p = plan(rl);
    assert.equal(p.paused, true); assert.deepEqual(p.dispatch, []); assert.deepEqual(p.quarantine, []);
    assert.match(p.skipped[0].reason, /pausado por rate limit\/quota/);
  }
  const ok = plan(core(4000, resetEm(20)));
  assert.equal(ok.paused, false); assert.deepEqual(ok.dispatch.map((d) => d.issue), [7]);
});

await t('tools/dispatcher.mjs usa a função pura e não engole a falha da leitura', () => {
  const cli = fs.readFileSync(path.join(root, 'tools/dispatcher.mjs'), 'utf8');
  assert.match(cli, /rateLimitPause\(await api\('rate_limit'\)\.catch\(\(e\) => e\), \{ now \}\)/);
  assert.doesNotMatch(cli, /api\('rate_limit'\)\.catch\(\(\) => null\)/, 'leitura falhando não pode virar "sem pausa"');
  assert.doesNotMatch(cli, /remaining < 200/, 'limite fica só na função pura');
  assert.match(cli, /DISPATCHER_PAUSA_ATE/, 'pausa manual continua valendo');
});

console.log(`✓ Dispatcher rate limit: ${n} grupos de testes passaram`);
