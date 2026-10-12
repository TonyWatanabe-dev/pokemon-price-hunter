// Telemetria real por execução do worker: só dados do execution_file, nada estimado, nada de texto livre,
// marcador seguro no comentário, leitura só do autor confiável e agregados honestos (sem dado ≠ zero).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { buildRecord, formatComment, parseRecords, parsePerfil, summarize, gastoNaJanela, AUTOR_CONFIAVEL } from '../src/agents/telemetria.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let n = 0;
async function t(name, fn) { try { await fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } }

const REPO = 'TonyWatanabe-dev/pokemon-price-hunter';
const PERFIL = JSON.stringify({ classe: 'comum', model: 'sonnet', effort: 'medium', maxTurns: 60, falhas: 0, escalada: false });
const msgs = (over = {}) => [
  { type: 'system', subtype: 'init', model: 'claude-sonnet-5-5', session_id: 's', tools: ['Read'], cwd: '/home/runner/work/segredo' },
  { type: 'assistant', message: { content: [{ type: 'text', text: 'ghp_SEGREDOFALSO1234567890 e um --> no texto' }] } },
  { type: 'result', subtype: 'success', is_error: false, num_turns: 14, duration_ms: 182000, total_cost_usd: 0.8123, result: 'texto final <script>',
    usage: { input_tokens: 2100, output_tokens: 5400, cache_read_input_tokens: 90000, cache_creation_input_tokens: 12000 },
    modelUsage: { 'claude-sonnet-5-5': { costUSD: 0.8 }, 'claude-haiku-5-5': { costUSD: 0.01 } }, ...over },
];
const base = { issue: '257', chave: 'dispatch:257:1', perfil: PERFIL, runId: '38229495517', runAttempt: '1', status: 'success',
  prUrl: `https://github.com/${REPO}/pull/258`, repo: REPO, now: Date.parse('2026-10-12T09:30:00Z') };

await t('1. registro com os dados reais do execution_file e do run', () => {
  const r = buildRecord({ ...base, messages: msgs() });
  assert.deepEqual(r, {
    v: 1, issue: 257, caminho: 'despacho', chave: 'dispatch:257:1', tentativa: 1, run: { id: 38229495517, tentativa: 1 },
    perfil: { classe: 'comum', modelo: 'sonnet', esforco: 'medium', maxTurnos: 60, falhasAnteriores: 0, escalada: false },
    modeloSessao: 'claude-sonnet-5-5',
    sessao: { sucesso: true, subtipo: 'success', turnos: 14, duracaoMs: 182000, custoUsdReportado: 0.8123,
      tokens: { entrada: 2100, saida: 5400, cacheLeitura: 90000, cacheCriacao: 12000 }, modelos: ['claude-sonnet-5-5', 'claude-haiku-5-5'] },
    resultado: { status: 'success', pr: 258 }, em: '2026-10-12T09:30:00.000Z',
  });
  const label = buildRecord({ ...base, chave: '', messages: msgs() });
  assert.equal(label.caminho, 'label'); assert.equal(label.chave, null); assert.equal(label.tentativa, null);
});

await t('2. sem execution_file ou sem mensagem result: null, nunca estimado', () => {
  for (const m of [null, [], [{ type: 'system', subtype: 'init' }]]) assert.equal(buildRecord({ ...base, messages: m }).sessao, null);
  const parcial = buildRecord({ ...base, messages: msgs({ total_cost_usd: undefined, usage: {}, num_turns: undefined }) }).sessao;
  assert.deepEqual([parcial.custoUsdReportado, parcial.turnos, parcial.tokens.entrada], [null, null, null]);
  assert.equal(buildRecord({ ...base, messages: msgs({ total_cost_usd: -1 }) }).sessao.custoUsdReportado, null, 'negativo é inválido');
});

await t('3. nada de texto livre: modelo, subtipo, chave, perfil, status e PR só de listas/formatos fechados', () => {
  const r = buildRecord({ ...base, chave: 'dispatch:257:1; rm -rf /', status: 'ok<script>', prUrl: `https://evil.example/${REPO}/pull/9`, perfil: '{"classe":"x","model":"gpt","effort":"max","maxTurns":999}',
    messages: [{ type: 'system', subtype: 'init', model: 'claude-x --> <img>' }, ...msgs({ subtype: 'erro com espaço', modelUsage: { 'gpt-4': {}, '<b>': {}, 'claude-opus-5-5[1m]': {} } }).slice(1)] });
  assert.equal(r.chave, null); assert.equal(r.caminho, 'label'); assert.equal(r.resultado.status, null); assert.equal(r.resultado.pr, null);
  assert.deepEqual(r.perfil, { classe: null, modelo: null, esforco: null, maxTurnos: null, falhasAnteriores: null, escalada: null });
  assert.equal(r.modeloSessao, null); assert.equal(r.sessao.subtipo, null); assert.deepEqual(r.sessao.modelos, ['claude-opus-5-5[1m]']);
  const json = JSON.stringify(buildRecord({ ...base, messages: msgs() }));
  for (const s of ['ghp_', 'SEGREDO', 'texto final', 'segredo', '-->', 'session']) assert.ok(!json.includes(s), s);
  assert.equal(parsePerfil('não json'), null);
});

await t('4. comentário: resumo legível + marcador que não fecha o HTML; ida e volta exata', () => {
  const r = buildRecord({ ...base, messages: msgs() }); const body = formatComment(r);
  assert.match(body, /\*\*Telemetria da execução\*\* \(despacho · `dispatch:257:1`\)/);
  assert.match(body, /comum · sonnet\/medium · até 60 turnos/); assert.match(body, /US\$ 0\.8123/); assert.match(body, /PR #258/);
  assert.match(body, /não a cobrança da assinatura/);
  assert.equal((body.match(/-->/g) || []).length, 1, 'um único fechamento de comentário');
  assert.doesNotMatch(body, /dispatcher:despacho/, 'não se confunde com o marcador do Dispatcher');
  assert.deepEqual(parseRecords([{ author: AUTOR_CONFIAVEL, body }]), [r]);
  const vazio = formatComment(buildRecord({ ...base, messages: null, perfil: '' }));
  assert.match(vazio, /Custo reportado pelo runtime \| n\/d/); assert.match(vazio, /Perfil solicitado \| n\/d/);
  assert.throws(() => formatComment({ ...r, modeloSessao: '<x>' }), /proibido/);
});

await t('5. leitura só do bot do workflow; marcador forjado, corrompido ou de outra versão é ignorado', () => {
  const body = formatComment(buildRecord({ ...base, messages: msgs() }));
  assert.equal(parseRecords([{ author: 'TonyWatanabe-dev', body }, { author: 'claude[bot]', body }]).length, 0);
  assert.equal(parseRecords([{ author: AUTOR_CONFIAVEL, body: body.replace('"v":1', '"v":1,') }]).length, 0);
  assert.equal(parseRecords([{ author: AUTOR_CONFIAVEL, body: body.replace('v=1 ', 'v=2 ') }]).length, 0);
});

await t('6. agregado: sem dado não vira zero; custo por PR integrada inclui o retrabalho da issue', () => {
  const at = (h) => Date.parse(`2026-10-12T${h}:00:00Z`);
  const falha = buildRecord({ ...base, chave: 'dispatch:300:1', issue: 300, status: 'failure', prUrl: '', messages: msgs({ total_cost_usd: 0.5 }), now: at('08') });
  const ok = buildRecord({ ...base, chave: 'dispatch:300:2', issue: 300, perfil: PERFIL.replace('"escalada":false', '"escalada":true'), prUrl: `https://github.com/${REPO}/pull/301`, messages: msgs({ total_cost_usd: 1.5 }), now: at('09') });
  const semArquivo = buildRecord({ ...base, issue: 310, chave: '', status: 'failure', prUrl: '', messages: null, now: at('10') });
  const s = summarize([falha, ok, semArquivo], { prsIntegradas: [301] });
  assert.deepEqual([s.execucoes, s.sucesso, s.falhas, s.escaladas, s.semExecutionFile], [3, 1, 2, 1, 1]);
  assert.deepEqual(s.custoUsdReportado, { soma: 2, execucoesSemCusto: 1 });
  assert.equal(s.prsIntegradas, 1); assert.equal(s.custoPorPrIntegrada, 2, '0,5 da falha + 1,5 da entrega');
  assert.deepEqual(s.porIssue.find((x) => x.issue === 300).prs, [301]);
  assert.equal(summarize([semArquivo]).custoUsdReportado.soma, null, 'nenhum custo informado: null, não zero');
  const semCustoNaIntegrada = buildRecord({ ...base, issue: 400, prUrl: `https://github.com/${REPO}/pull/401`, messages: msgs({ total_cost_usd: undefined }) });
  assert.equal(summarize([semCustoNaIntegrada], { prsIntegradas: [401] }).custoPorPrIntegrada, null, 'custo incompleto não gera média');
  assert.equal(gastoNaJanela([falha, ok, semArquivo], { now: at('10'), janelaMs: 90 * 60e3 }), 1.5);
  assert.equal(gastoNaJanela([semArquivo], { now: at('10') }), null);
});

await t('7. CLI registrar: lê o arquivo do env, imprime o comentário, grava o resumo sem o marcador, sem rede', () => {
  const dir = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'tele-'));
  const file = path.join(dir, 'claude-execution-output.json'); fs.writeFileSync(file, JSON.stringify(msgs()));
  const summary = path.join(dir, 'summary.md');
  const env = { PATH: process.env.PATH, GITHUB_REPOSITORY: REPO, EXECUTION_FILE: file, PERFIL, ISSUE: '257', CHAVE: 'dispatch:257:1',
    RUN_ID: '1', RUN_ATTEMPT: '1', STATUS: 'success', PR_URL: `https://github.com/${REPO}/pull/258`, GITHUB_STEP_SUMMARY: summary };
  const out = execFileSync('node', [path.join(root, 'tools/telemetria.mjs'), 'registrar'], { env, encoding: 'utf8' });
  assert.equal(parseRecords([{ author: AUTOR_CONFIAVEL, body: out }])[0].sessao.turnos, 14);
  const sum = fs.readFileSync(summary, 'utf8'); assert.match(sum, /Telemetria da execução/); assert.doesNotMatch(sum, /telemetria:execucao/);
  const semArquivo = execFileSync('node', [path.join(root, 'tools/telemetria.mjs'), 'registrar'], { env: { ...env, EXECUTION_FILE: path.join(dir, 'nao-existe.json'), GITHUB_STEP_SUMMARY: '' }, encoding: 'utf8' });
  assert.equal(parseRecords([{ author: AUTOR_CONFIAVEL, body: semArquivo }])[0].sessao, null);
  assert.throws(() => execFileSync('node', [path.join(root, 'tools/telemetria.mjs'), 'registrar'], { env: { ...env, ISSUE: 'x' }, stdio: 'pipe' }));
});

console.log(`✓ Telemetria do worker: ${n} grupos de testes passaram`);
