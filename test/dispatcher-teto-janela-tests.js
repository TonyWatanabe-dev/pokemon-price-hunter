// Teto de despachos na janela (Fase 7, item 2): independe da telemetria de custo, conta os marcadores do próprio
// Dispatcher na janela do orçamento e falha fechado (configuração inválida ou leitura falhando pausa, sem quarentena).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { planDispatch, applyPlan, dispatchMarker, dispatchCapConfig, countDispatchesInWindow, DEFAULT_MAX_DESPACHOS_JANELA, QUEUE_LABEL, LABELS } from '../src/agents/dispatcher.js';
import { agrupar, classificar } from '../tools/fila-relatorio.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let n = 0; const t = async (name, fn) => { try { await fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } };

const NOW = '2026-10-15T12:00:00Z';
const OP = 'dono';
const BOT = 'github-actions[bot]';
const H = 3600e3;
const min = (m) => new Date(Date.parse(NOW) + m * 60_000).toISOString();
const issue = (number, over = {}) => ({ number, title: `Tarefa ${number}`, state: 'open', author: OP, body: `Ordem: ${number}`,
  labels: [QUEUE_LABEL], labelEvents: [{ event: 'labeled', label: QUEUE_LABEL, actor: OP, createdAt: min(-600) }], comments: [], ...over });
const snap = (issues, over = {}) => ({ now: NOW, operators: [OP], dispatcherActor: BOT, maxSlots: '10', issues, pulls: [], issueStates: {}, ...over });
const marker = (nr, attempt, at, author = BOT, id = nr * 100 + attempt) => ({ id, author, body: `Dispatcher: despachando.\n${dispatchMarker(nr, attempt, at)}` });

await t('configuração: vazio usa o padrão; 1..500 aceito; inválido vira erro (fail-closed)', () => {
  assert.equal(DEFAULT_MAX_DESPACHOS_JANELA, 60);
  assert.deepEqual(dispatchCapConfig({}), { limite: 60, erro: null });
  assert.deepEqual(dispatchCapConfig({ DISPATCHER_MAX_DESPACHOS_JANELA: ' 12 ' }), { limite: 12, erro: null });
  assert.deepEqual(dispatchCapConfig({ DISPATCHER_MAX_DESPACHOS_JANELA: '500' }), { limite: 500, erro: null });
  for (const bad of ['0', '501', '-1', 'x', '1.5', '10 por dia', '9999']) assert.match(dispatchCapConfig({ DISPATCHER_MAX_DESPACHOS_JANELA: bad }).erro, /inválido/, bad);
});

await t('contagem: só marcadores do Dispatcher, dentro da janela, chave repetida conta uma vez', () => {
  const desde = Date.parse(NOW) - 24 * H;
  const cs = [marker(1, 1, min(-60)), marker(1, 1, min(-59), BOT, 999), marker(2, 1, min(-30)), marker(3, 1, min(-25 * 60)),
    marker(4, 1, min(-10), 'intruso'), { id: 5, author: BOT, body: 'sem marcador' }];
  assert.equal(countDispatchesInWindow(cs, { desde, dispatcherActor: BOT }), 2);
  assert.equal(countDispatchesInWindow([], { desde, dispatcherActor: BOT }), 0);
  assert.throws(() => countDispatchesInWindow(cs, {}), /desde obrigatório/);
});

await t('teto atingido: pausa tudo, sem despacho e sem quarentena; fila intacta', () => {
  const tentativas = issue(7, { comments: [marker(7, 1, min(-300)), marker(7, 2, min(-200))] }); // iria para quarentena
  const p = planDispatch(snap([issue(1), tentativas], { dispatchCap: { limite: 5, usados: 5, janelaH: 24 } }));
  assert.equal(p.paused, true); assert.deepEqual(p.dispatch, []); assert.deepEqual(p.quarantine, []);
  assert.ok(p.skipped.every((s) => /^pausado por teto de despachos na janela: 5\/5 despacho\(s\) em 24 h/.test(s.reason)));
  assert.equal(planDispatch(snap([issue(1)], { dispatchCap: { limite: 5, usados: 9, janelaH: 24 } })).paused, true, 'acima do teto também pausa');
  const r = agrupar(p); assert.equal(r.pausado, true);
  assert.deepEqual(r.grupos.find((g) => g.id === 'teto').itens.map((i) => i.issue), [1, 7]);
});

await t('perto do teto: só o que resta na janela é despachado, o resto espera com motivo próprio', () => {
  const p = planDispatch(snap([issue(1), issue(2), issue(3)], { dispatchCap: { limite: 10, usados: 9, janelaH: 24 } }));
  assert.equal(p.paused, false);
  assert.deepEqual(p.dispatch.map((d) => d.issue), [1]);
  assert.deepEqual(p.skipped.map((s) => s.issue), [2, 3]);
  assert.match(p.skipped[0].reason, /^teto de despachos na janela: 9\/10 despacho\(s\) em 24 h, resta\(m\) 1/);
  assert.equal(classificar(p.skipped[0].reason), 'teto');
  assert.deepEqual(p.dispatchCap, { limite: 10, usados: 9, motivo: '9/10 despacho(s) em 24 h' });
  // com folga, o limite por ciclo continua valendo
  const folga = planDispatch(snap([1, 2, 3, 4, 5, 6].map((i) => issue(i)), { dispatchCap: { limite: 60, usados: 0, janelaH: 24 } }));
  assert.equal(folga.dispatch.length, 4); assert.match(folga.skipped[0].reason, /^limite de 4 despachos por ciclo/);
});

await t('fail-closed: erro de configuração/leitura ou dados inválidos pausam com motivo sanitizado', () => {
  for (const cap of [{ erro: 'DISPATCHER_MAX_DESPACHOS_JANELA inválido' }, { erro: 'leitura falhou (token ghp_abcdefghijklmnopqrstuvwxyz0123)' },
    { limite: 5 }, { limite: 0, usados: 0 }, { limite: 5, usados: -1 }, { limite: '5', usados: 0 }]) {
    const p = planDispatch(snap([issue(1)], { dispatchCap: cap }));
    assert.equal(p.paused, true, JSON.stringify(cap)); assert.deepEqual(p.dispatch, []);
    assert.match(p.skipped[0].reason, /^pausado por teto de despachos na janela: teto de despachos indisponível/);
    assert.doesNotMatch(p.skipped[0].reason, /ghp_/);
  }
  assert.equal(planDispatch(snap([issue(1)])).dispatchCap, undefined, 'sem teto no snapshot: comportamento anterior');
});

await t('rate limit e orçamento continuam tendo precedência (pausa antes do teto)', () => {
  const p = planDispatch(snap([issue(1)], { budget: { permitir: false, motivo: 'gasto ≥ limite' }, dispatchCap: { limite: 5, usados: 0, janelaH: 24 } }));
  assert.match(p.skipped[0].reason, /^pausado por orçamento/);
});

await t('applyPlan: revalidação usa o mesmo teto; teto atingido entre o plano e o disparo não dispara', async () => {
  const s = snap([issue(1)], { dispatchCap: { limite: 3, usados: 2, janelaH: 24 } });
  const plan = planDispatch(s);
  assert.deepEqual(plan.dispatch.map((d) => d.issue), [1]);
  const calls = [];
  const ad = { async reload() { return issue(1); }, async comment() { calls.push('comment'); return { id: 1 }; }, async addLabel() {}, async dispatch() { calls.push('dispatch'); } };
  const r = await applyPlan(plan, { ...s, dispatchCap: { limite: 3, usados: 3, janelaH: 24 } }, ad, { now: () => new Date(NOW) });
  assert.equal(r[0].status, 'skipped'); assert.deepEqual(calls, [], 'nem marcador nem disparo');
});

await t('workflow e CLI: os dois jobs leem a variável; o CLI conta pelos marcadores e falha fechado', () => {
  const y = fs.readFileSync(path.join(root, '.github/workflows/dispatcher.yml'), 'utf8');
  assert.equal((y.match(/DISPATCHER_MAX_DESPACHOS_JANELA: \$\{\{ vars\.DISPATCHER_MAX_DESPACHOS_JANELA \}\}/g) || []).length, 2);
  const cli = fs.readFileSync(path.join(root, 'tools/dispatcher.mjs'), 'utf8');
  assert.match(cli, /dispatchCap: await dispatchCap\(/);
  assert.match(cli, /countDispatchesInWindow\(/);
  assert.match(cli, /if \(erro\) return \{ erro:/);
  assert.match(cli, /catch \(e\) \{ return \{ erro: `leitura dos despachos da janela falhou/);
  assert.doesNotMatch(y, /DISPATCHER_ATIVO:\s*['"]?true/, 'nenhuma flag de produção ligada pelo workflow');
});

console.log(`dispatcher-teto-janela: ${n} testes ok`);
