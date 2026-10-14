// Relatório da fila do Dispatcher (tools/fila-relatorio.mjs): agrupamento por motivo de espera a partir do plano
// real de planDispatch, markdown do step summary, leitura de plano/snapshot e ausência de escrita no GitHub.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { planDispatch, dispatchMarker, QUEUE_LABEL, LABELS } from '../src/agents/dispatcher.js';
import { agrupar, classificar, markdown, lerArgs, carregarPlano, main, MOTIVOS } from '../tools/fila-relatorio.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let n = 0; const t = async (name, fn) => { try { await fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } };

const NOW = '2026-10-14T03:00:00Z';
const OP = 'dono';
const BOT = 'github-actions[bot]';
const min = (m) => new Date(Date.parse(NOW) + m * 60_000).toISOString();
const issue = (number, over = {}) => ({
  number, title: `Tarefa ${number}`, state: 'open', author: OP, body: `Ordem: ${number}`,
  labels: [QUEUE_LABEL], labelEvents: [{ event: 'labeled', label: QUEUE_LABEL, actor: OP, createdAt: min(-120) }], comments: [], ...over,
});
const snap = (issues, over = {}) => ({ now: NOW, operators: [OP], dispatcherActor: BOT, issues, pulls: [], issueStates: {}, ...over });
const grupo = (r, id) => r.grupos.find((g) => g.id === id)?.itens.map((i) => i.issue) || [];

// Fila com um motivo de cada: em curso (área), dependência, área, vaga, quarentena e quarentena nova.
const fila = () => snap([
  issue(1, { labels: [QUEUE_LABEL, LABELS.RUNNING], body: 'Ordem: 1\nÁreas: `src/agents/dispatcher.js`' }),
  issue(2, { body: 'Ordem: 2\nDepende de: #900' }),
  issue(3, { body: 'Ordem: 3\nÁreas: `src/agents/`' }),
  issue(4), issue(5), issue(6),
  issue(7, { labels: [QUEUE_LABEL, LABELS.QUARANTINE] }),
  issue(8, { comments: [1, 2].map((a) => ({ author: BOT, body: dispatchMarker(8, a, min(-300 + a)) })), labelEvents: [
    { event: 'labeled', label: QUEUE_LABEL, actor: OP, createdAt: min(-400) }, { event: 'labeled', label: LABELS.FAILED, actor: BOT, createdAt: min(-200) }] }),
], { maxSlots: 2 });

await t('agrupa o plano real por motivo de espera', () => {
  const plan = planDispatch(fila());
  const r = agrupar(plan);
  assert.deepEqual(r.emCurso, [1]);
  assert.deepEqual(r.despachar, [4]);
  assert.deepEqual(grupo(r, 'em_curso'), [1]);
  assert.deepEqual(grupo(r, 'dependencia'), [2]);
  assert.deepEqual(grupo(r, 'area'), [3]);
  assert.deepEqual(grupo(r, 'vaga'), [5, 6]);
  assert.deepEqual(grupo(r, 'quarentena'), [8, 7]);
  assert.match(r.grupos.find((g) => g.id === 'quarentena').itens[0].motivo, /^vai para quarentena: 2 tentativa/);
  // ordem fixa dos grupos e sem grupos vazios
  const ordem = MOTIVOS.map((m) => m.id);
  assert.deepEqual(r.grupos.map((g) => g.id), [...r.grupos.map((g) => g.id)].sort((a, b) => ordem.indexOf(a) - ordem.indexOf(b)));
  assert.ok(r.grupos.every((g) => g.itens.length));
});

await t('orçamento, pausa e demais motivos do planDispatch têm grupo próprio', () => {
  const r = agrupar(planDispatch(snap([issue(1), issue(2)], { budget: { permitir: false, motivo: 'gasto acima do limite' } })));
  assert.equal(r.pausado, true);
  assert.deepEqual(grupo(r, 'orcamento'), [1, 2]);
  assert.deepEqual(grupo(agrupar(planDispatch(snap([issue(1)], { pauseUntil: min(30) }))), 'pausa'), [1]);
  assert.equal(classificar('pausado: Claude sem capacidade (sessão recusada sem tokens) até x'), 'pausa');
  assert.equal(classificar('backoff até 2026-10-14T04:00:00.000Z'), 'backoff');
  assert.equal(classificar('limite de 4 despachos por ciclo (evita rajada de sessões)'), 'ciclo');
  assert.equal(classificar('despachada (lease ativo)'), 'em_curso');
  assert.equal(classificar('já existe PR aberto para a issue'), 'pr');
  assert.equal(classificar('já concluída pelo worker (aguarda revisão/merge)'), 'concluida');
  for (const m of ['issue fechada', `sem o label ${QUEUE_LABEL}`, 'autor não é operador', 'label da fila não foi aplicado por operador (ou evento ausente)']) assert.equal(classificar(m), 'inelegivel');
  assert.equal(classificar('motivo novo'), 'outro');
  assert.equal(classificar(undefined), 'outro');
  const pr = planDispatch(snap([issue(9)], { pulls: [{ number: 1, headRef: 'tarefa/issue-9-t1', body: '' }] }));
  assert.deepEqual(grupo(agrupar(pr), 'pr'), [9]);
});

await t('markdown resume por motivo e lista cada issue com o motivo do plano', () => {
  const md = markdown(planDispatch(fila()));
  assert.match(md, /^## Fila do Dispatcher — quem espera e por quê \(sem escrita\)/);
  assert.match(md, /Vagas: 2 · em curso: #1/);
  assert.match(md, /Despacháveis agora: #4 · aguardando: 7/);
  assert.match(md, /\| Sem vaga livre \| 2 \|/);
  assert.match(md, /### Dependência aberta \(1\)\n- #2: dependência aberta ou desconhecida: #900/);
  assert.match(md, /### Área em uso por outra tarefa \(1\)\n- #3: área crítica em uso/);
  assert.match(markdown(planDispatch(snap([]))), /Nenhuma issue aguardando\./);
  // motivo com quebra de linha ou token não vaza para o summary
  const sujo = markdown({ slots: 3, active: [], dispatch: [], quarantine: [], skipped: [{ issue: 1, reason: 'x\n## injetado ghp_abcdefghijklmnopqrstuvwxyz0123' }] });
  assert.doesNotMatch(sujo, /\n## injetado/); assert.doesNotMatch(sujo, /ghp_/);
});

await t('argumentos e leitura de plano/snapshot', () => {
  assert.deepEqual(lerArgs(['--plano', 'p.json']), { plano: 'p.json', snapshot: null, json: false });
  assert.deepEqual(lerArgs(['--snapshot', 's.json', '--json']), { plano: null, snapshot: 's.json', json: true });
  assert.throws(() => lerArgs([]), /exatamente um/);
  assert.throws(() => lerArgs(['--plano', 'a', '--snapshot', 'b']), /exatamente um/);
  assert.throws(() => lerArgs(['--plano']), /exige um caminho/);
  assert.throws(() => lerArgs(['--executar']), /argumento desconhecido/);
  const plan = planDispatch(fila());
  const files = { 'saida.json': JSON.stringify({ plan, results: null }), 'puro.json': JSON.stringify(plan), 's.json': JSON.stringify(fila()), 'x.json': '{"a":1}' };
  const ler = (p) => files[p];
  assert.deepEqual(carregarPlano({ plano: 'saida.json' }, ler), plan);
  assert.deepEqual(carregarPlano({ plano: 'puro.json' }, ler), plan);
  assert.deepEqual(carregarPlano({ snapshot: 's.json' }, ler), plan);
  assert.throws(() => carregarPlano({ plano: 'x.json' }, ler), /sem plano/);
});

await t('main: markdown, JSON, step summary e erro fechado', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'fila-relatorio-'));
  try {
    const sp = path.join(dir, 's.json'); fs.writeFileSync(sp, JSON.stringify(fila()));
    const summary = path.join(dir, 'summary.md');
    const out = []; const err = []; const io = { log: (s) => out.push(s), error: (s) => err.push(s) };
    assert.equal(main(['--snapshot', sp], { env: { GITHUB_STEP_SUMMARY: summary }, io }), 0);
    assert.match(out[0], /### Sem vaga livre \(2\)/);
    assert.equal(fs.readFileSync(summary, 'utf8'), out[0] + '\n');
    assert.equal(main(['--snapshot', sp, '--json'], { env: {}, io }), 0);
    assert.deepEqual(JSON.parse(out[1]).despachar, [4]);
    assert.equal(main(['--plano', path.join(dir, 'nao-existe.json')], { env: {}, io }), 1);
    assert.match(err[0], /^fila-relatorio: /);
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

await t('só leitura: sem rede, gh, escrita no GitHub nem --executar', () => {
  const src = fs.readFileSync(path.join(root, 'tools/fila-relatorio.mjs'), 'utf8');
  assert.doesNotMatch(src, /child_process|execFile|fetch\(|applyPlan|https?:\/\/api/);
  assert.doesNotMatch(src.replace(/^\/\/.*$/gm, ''), /--executar/);
});

console.log(`fila-relatorio: ${n} testes ok`);
