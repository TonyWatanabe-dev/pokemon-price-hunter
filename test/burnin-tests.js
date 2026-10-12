// Burn-in da fábrica 24/7: dia em Brasília, cadência com bordas, critérios honestos (sem dado ≠ verde), sequência
// de dias verdes, marcador seguro e publicação idempotente (hoje atualiza, ontem finaliza, dia final não muda).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { diaSP, janelaDia, cadencia, qualidadeColeta, avaliarDia, sequenciaVerde, formatarDia, parseDias, planoPublicacao, CRITERIOS } from '../src/agents/burnin.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let n = 0;
async function t(name, fn) { try { await fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } }

const DIA = '2026-10-11';
const [A, B] = janelaDia(DIA);
const every = (stepMin, { from = A, to = B, conclusion = 'success', event = 'workflow_dispatch', skip = () => false } = {}) => {
  const out = [];
  for (let x = from + 60e3, i = 0; x < to; x += stepMin * 60e3, i++) if (!skip(i)) out.push({ created_at: new Date(x).toISOString(), status: 'completed', conclusion: typeof conclusion === 'function' ? conclusion(i) : conclusion, event });
  return out;
};
const ops = (stepMin, over = () => ({})) => every(stepMin).map((r, i) => ({ generatedAt: r.created_at, result: 'ok', dbSync: { status: 'ok' }, reader: { status: 'ok' }, engine: { status: 'ok' }, ...over(i) }));
const diaBom = (o = {}) => ({ dia: DIA, now: B + 3600e3, hunter: every(15), vigia: every(15), dispatcher: every(15), tarefas: [], opsRuns: ops(15), ...o });

await t('1. dia de Brasília (UTC−3) e janela', () => {
  assert.equal(diaSP('2026-10-12T02:59:00Z'), '2026-10-11'); assert.equal(diaSP('2026-10-12T03:00:00Z'), '2026-10-12');
  assert.deepEqual(janelaDia('2026-10-11').map((x) => new Date(x).toISOString()), ['2026-10-11T03:00:00.000Z', '2026-10-12T03:00:00.000Z']);
  assert.throws(() => janelaDia('11/10/2026'));
});

await t('2. cadência: conta as bordas do dia, eventos e falhas; dia em curso mede só até agora', () => {
  const c = cadencia([...every(15, { skip: (i) => i >= 20 && i < 24 }), ...every(60, { event: 'schedule', to: A + 3 * 3600e3 })], [A, B], B + 1);
  assert.equal(c.maiorIntervaloMin, 75, '4 rodadas faltando = 75 min sem rodada');
  assert.equal(c.porEvento.schedule, 3);
  const vazio = cadencia([], [A, B], B + 1); assert.equal(vazio.maiorIntervaloMin, 1440); assert.equal(vazio.taxaSucesso, null);
  const parcial = cadencia(every(15, { to: A + 2 * 3600e3 }), [A, B], A + 2 * 3600e3 + 10 * 60e3);
  assert.ok(parcial.maiorIntervaloMin <= 25, 'em curso: até agora, não até o fim do dia');
  const falhas = cadencia(every(15, { conclusion: (i) => (i % 10 === 0 ? 'failure' : i % 10 === 1 ? 'cancelled' : 'success') }), [A, B], B + 1);
  assert.equal(falhas.falhas, 10, 'cancelado não conta como falha');
});

await t('3. dia completo e saudável é verde; cada critério reprovado vira vermelho com o motivo', () => {
  const ok = avaliarDia(diaBom());
  assert.equal(ok.veredito, 'verde'); assert.equal(ok.final, true); assert.deepEqual(ok.falhas, []);
  const casos = [
    [{ hunter: every(15, { skip: (i) => i >= 30 && i < 34 }) }, 'hunter_intervalo'],
    [{ vigia: every(20) }, 'vigia_rodadas'],
    [{ hunter: every(15, { conclusion: (i) => (i % 5 === 0 ? 'failure' : 'success') }) }, 'hunter_sucesso'],
    [{ dispatcher: every(60, { conclusion: (i) => (i === 3 ? 'failure' : 'success') }) }, 'dispatcher_falhas'],
    [{ opsRuns: ops(15, (i) => (i % 5 === 0 ? { dbSync: { status: 'atrasado' } } : {})) }, 'sync'],
    [{ opsRuns: ops(15, (i) => (i % 4 === 0 ? { reader: { status: 'unavailable' } } : {})) }, 'leitor'],
    [{ opsRuns: ops(15, (i) => (i % 5 === 0 ? { engine: { status: 'parado' } } : {})) }, 'motor'],
    [{ opsRuns: ops(30) }, 'coleta_amostra'],
  ];
  for (const [o, id] of casos) { const r = avaliarDia(diaBom(o)); assert.equal(r.veredito, 'vermelho', id); assert.ok(r.falhas.includes(id), `${id}: ${r.falhas}`); }
});

await t('4. sem dado não é verde; dia em curso sem falha é parcial; contagem mínima só no dia encerrado', () => {
  assert.equal(avaliarDia({ dia: DIA, now: B + 1, hunter: [], vigia: [], dispatcher: [], tarefas: [], opsRuns: [] }).veredito, 'sem_dados');
  const meio = A + 6 * 3600e3;
  const r = avaliarDia(diaBom({ now: meio }));
  assert.equal(r.veredito, 'parcial'); assert.equal(r.final, false);
  assert.ok(!r.criterios.some((c) => c.id === 'hunter_rodadas' || c.id === 'coleta_amostra'));
  assert.equal(avaliarDia(diaBom({ opsRuns: [] })).veredito, 'vermelho', 'sem estado operacional não passa');
});

await t('5. fallback e telemetria entram como informação', () => {
  const r = avaliarDia(diaBom({ vigia: [...every(15), ...every(120, { event: 'schedule' })], telemetria: { execucoes: 3, sucesso: 2, falhas: 1, custoUsdReportado: { soma: 1.25 } } }));
  assert.deepEqual(r.fallback, { hunter: 0, vigia: 12, dispatcher: 0 });
  assert.deepEqual(r.telemetria, { execucoes: 3, sucesso: 2, falhas: 1, custoUsdReportado: 1.25 });
});

await t('6. sequência: só dias finais verdes consecutivos; buraco ou vermelho quebra', () => {
  const d = (dia, veredito, final = true) => ({ dia, veredito, final });
  assert.equal(sequenciaVerde([d('2026-10-09', 'verde'), d('2026-10-10', 'verde'), d('2026-10-11', 'verde'), d('2026-10-12', 'parcial', false)]), 3);
  assert.equal(sequenciaVerde([d('2026-10-09', 'verde'), d('2026-10-11', 'verde')]), 1, 'dia faltando quebra');
  assert.equal(sequenciaVerde([d('2026-10-10', 'verde'), d('2026-10-11', 'vermelho')]), 0);
  assert.equal(sequenciaVerde([]), 0);
});

await t('7. comentário: tabela + marcador seguro; leitura só do bot; publicação idempotente', () => {
  const av = avaliarDia(diaBom()); const body = formatarDia(av, { sequencia: 4 });
  assert.match(body, /🟢 \*\*Burn-in 2026-10-11\*\* — verde \(dia encerrado\) · sequência verde: \*\*4\/7\*\*/);
  assert.equal((body.match(/-->/g) || []).length, 1);
  const lidos = parseDias([{ id: 9, author: 'github-actions[bot]', body }, { id: 10, author: 'intruso', body: body.replace('"verde"', '"verde"') }]);
  assert.deepEqual([...lidos.keys()], [DIA]); assert.equal(lidos.get(DIA).commentId, 9); assert.deepEqual(lidos.get(DIA).avaliacao, av);
  assert.equal(parseDias([{ id: 1, author: 'intruso', body }]).size, 0);
  assert.throws(() => formatarDia({ ...av, dia: '<x>' }), /proibido/);
  const now = Date.parse('2026-10-12T15:00:00Z');
  assert.deepEqual(planoPublicacao(new Map(), now), [{ dia: '2026-10-11', acao: 'criar', commentId: null }, { dia: '2026-10-12', acao: 'criar', commentId: null }]);
  const ex = new Map([['2026-10-11', { avaliacao: { final: true }, commentId: 5 }], ['2026-10-12', { avaliacao: { final: false }, commentId: 6 }]]);
  assert.deepEqual(planoPublicacao(ex, now).map((p) => p.acao), ['manter', 'atualizar']);
  assert.equal(CRITERIOS.maiorIntervaloMin, 45, 'mesmo limite do Vigia');
});

await t('8. workflow do burn-in: depois do Vigia na main, permissões mínimas, sem secrets, token só no passo', () => {
  const y = fs.readFileSync(path.join(root, '.github/workflows/burnin.yml'), 'utf8').split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
  assert.match(y, /workflow_run:\n {4}workflows: \['Vigia do robô'\]\n {4}types: \[completed\]/);
  assert.match(y, /github\.event_name != 'workflow_run' \|\| github\.event\.workflow_run\.head_branch == 'main'/);
  assert.match(y, /^permissions: \{\}$/m);
  const p = y.match(/ {4}permissions:\n((?: {6}.+\n)+)/)[1];
  assert.deepEqual(Object.fromEntries(p.trim().split('\n').map((l) => l.trim().split(/:\s*/))), { contents: 'read', actions: 'read', issues: 'write' });
  assert.doesNotMatch(y, /secrets\.|contents: write|npm ci|npm install|pull_request/);
  assert.match(y, /persist-credentials: false/);
  assert.match(y, /cancel-in-progress: true/);
  assert.match(y, /node tools\/burnin\.mjs --publicar/);
  assert.equal((y.match(/github\.token/g) || []).length, 1);
});

console.log(`✓ Burn-in 24/7: ${n} grupos de testes passaram`);
