// Vigia: causa do "(sem detalhe)" (28/28 incidentes, #756–#933) e diagnóstico offline.
// Causa confirmada (reprodução local com o resumo real da #933): tools/vigia-incidente.mjs analisa VIGIA_JSON com
// parseResumo e passa o OBJETO analisado a planIncident, que analisava de novo; o objeto tem `reasons`, não
// `reasonsDetail`, e os motivos sumiam. O transporte entre jobs (saída do job/VIGIA_JSON) não perde nada.
// Testes de falha e recuperação; sem rede, sem gh real, sem dados de produção (fixtures sintéticas no formato real).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { parseResumo, planIncident, classificar, fingerprintMarker, INCIDENT_MARKER, TRUSTED_AUTHOR, ACAO } from '../src/ops-incident.js';
import { metaAte, episodioFonte, simularTransporte, diagnosticar, classificarRetro } from '../tools/vigia-diagnostico.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let n = 0;
const t = async (nome, fn) => { try { await fn(); n++; } catch (e) { console.error('FALHOU:', nome); throw e; } };

// Resumo no formato exato gravado por tools/watchdog.mjs na checagem da #933 (reproduzido localmente).
const NOW = '2026-10-25T09:22:17.970Z';
const FACTS = { dataGeneratedAt: '2026-10-25T09:15:24.495Z', dataAgeMin: 7, lastRunAt: '2026-10-25T09:21:13Z', lastRunAgeMin: 1, lastRunConclusion: 'success', metaLastAt: '2026-10-25T09:15:24.495Z' };
const TXT = 'Mercado Livre bloqueada nas últimas 2 rodadas (último com anúncios: 25/10, 05:45). Os preços dessa fonte podem estar faltando.';
const resumo = (over = {}) => ({ v: 1, now: NOW, status: 'degradado', previousStatus: null, reasonsDetail: [{ code: 'fonte_degradada', text: TXT }], facts: FACTS, ...over });
const VALOR = JSON.stringify(resumo());   // = valor de `json=` no $GITHUB_OUTPUT (jq -c) e de VIGIA_JSON

// gh simulado (mesma interface do vigia-incidente-tests)
function fakeGh() {
  const issues = [];
  const gh = async (args) => {
    const p = args.find((a) => a.startsWith('repos/'));
    if (args.includes('--paginate')) {
      if (/\/issues\?state=open/.test(p)) return JSON.stringify([issues.filter((i) => i.state === 'open').map((i) => ({ number: i.number, state: i.state, user: { login: TRUSTED_AUTHOR }, body: i.body }))]);
      const m = p.match(/issues\/(\d+)\/comments/); if (m) return JSON.stringify([issues.find((i) => i.number === Number(m[1])).comments.map((b) => ({ user: { login: TRUSTED_AUTHOR }, body: b }))]);
    }
    const body = (args.find((a) => a.startsWith('body=')) || '').slice(5);
    if (/issues$/.test(p)) { const i = { number: 900 + issues.length, state: 'open', body, comments: [] }; issues.push(i); return JSON.stringify({ number: i.number }); }
    const c = p.match(/issues\/(\d+)\/comments$/); if (c) { issues.find((i) => i.number === Number(c[1])).comments.push(body); return '{}'; }
    const x = p.match(/issues\/(\d+)$/); if (x) { issues.find((i) => i.number === Number(x[1])).state = 'closed'; return '{}'; }
    throw new Error('rota inesperada ' + p);
  };
  return { gh, issues };
}
let k = 0;
const cli = async (valor, ghImpl) => {
  const saved = process.argv; process.argv = [saved[0], saved[1]];
  try { const m = await import(pathToFileURL(path.join(root, 'tools/vigia-incidente.mjs')).href + '?d=' + (++k)); return await m.main({ env: { VIGIA_JSON: valor }, ghImpl, log: () => {} }); }
  finally { process.argv = saved; }
};

await t('regressão #933: caminho real do job incidente (main) leva o motivo à issue e à impressão digital', async () => {
  const { gh, issues } = fakeGh();
  const p = await cli(VALOR, gh);
  assert.equal(p.type, 'create');
  assert.doesNotMatch(issues[0].body, /sem detalhe/);
  assert.match(issues[0].body, /- `fonte_degradada`: Mercado Livre bloqueada nas últimas 2 rodadas/);
  assert.match(issues[0].body, /<!-- vigia:estado status=degradado codigos=fonte_degradada -->/);
  assert.equal(p.fingerprint, 'degradado:fonte_degradada');
});

await t('parseResumo é idempotente (a 2ª análise do objeto não zera os motivos)', () => {
  const a = parseResumo(VALOR); const b = parseResumo(a);
  assert.equal(b, a); assert.deepEqual(b.reasons.map((x) => x.code), ['fonte_degradada']);
  // objeto parecido com o analisado, mas sem a marca (ex.: serializado e lido de novo): não vira resumo válido com motivo
  const copia = JSON.parse(JSON.stringify(a));
  assert.equal(parseResumo(copia).reasons.length, 0, 'sem reasonsDetail continua sem motivo (fail-closed)');
  assert.equal(parseResumo(copia).reasonsInfo.received, null);
  assert.equal(parseResumo('{"status":"degradado"'), null, 'JSON truncado: nenhuma ação');
});

await t('falha → mudança → recuperação: comenta quando os códigos mudam e fecha com 2 checagens saudáveis', async () => {
  const { gh, issues } = fakeGh();
  assert.equal((await cli(VALOR, gh)).type, 'create');
  assert.equal((await cli(VALOR, gh)).type, 'none', 'mesma checagem: sem repetir');
  const dois = JSON.stringify(resumo({ reasonsDetail: [{ code: 'fonte_degradada', text: TXT }, { code: 'sync_falhando', text: 'banco atrasado' }] }));
  const c = await cli(dois, gh);
  assert.equal(c.type, 'comment', 'antes da correção os códigos sumiam e esta mudança nunca era registrada');
  assert.match(issues[0].comments[0], /codigos=fonte_degradada,sync_falhando/);
  assert.equal((await cli(dois, gh)).type, 'none');
  assert.equal((await cli(JSON.stringify(resumo({ status: 'saudavel', previousStatus: 'degradado', reasonsDetail: [] })), gh)).type, 'none', '1ª saudável: espera');
  assert.equal((await cli(JSON.stringify(resumo({ status: 'saudavel', previousStatus: 'saudavel', reasonsDetail: [] })), gh)).type, 'close');
  assert.equal(issues[0].state, 'closed'); assert.equal(issues.length, 1);
});

await t('issue aberta antes da correção (codigos= vazio): um único comentário com o motivo, depois silêncio', () => {
  const aberta = { number: 933, state: 'open', author: TRUSTED_AUTHOR, body: `${INCIDENT_MARKER}\n${fingerprintMarker('degradado', [])}` };
  const p = planIncident({ resumo: parseResumo(VALOR), openIssues: [aberta] });
  assert.equal(p.type, 'comment'); assert.match(p.body, /fonte_degradada/);
  const depois = planIncident({ resumo: VALOR, openIssues: [aberta], comments: [{ author: TRUSTED_AUTHOR, body: p.body }] });
  assert.equal(depois.type, 'none');
});

await t('classificar: transitório × real × observabilidade; texto da issue com tipo e o que olhar', () => {
  assert.equal(classificar(VALOR).tipo, 'transitorio');
  assert.equal(classificar(resumo({ facts: { ...FACTS, dataAgeMin: 40 } })).tipo, 'real', 'dados velhos: não é só a fonte');
  assert.equal(classificar(resumo({ facts: { ...FACTS, lastRunConclusion: 'failure' } })).tipo, 'real');
  assert.equal(classificar(resumo({ reasonsDetail: [{ code: 'sync_falhando', text: 'x' }] })).tipo, 'real');
  assert.equal(classificar(resumo({ status: 'parado', reasonsDetail: [{ code: 'fonte_degradada', text: 'x' }] })).tipo, 'real');
  const obs = classificar(resumo({ reasonsDetail: [] }));
  assert.equal(obs.tipo, 'observabilidade'); assert.match(obs.texto, /lista de motivos vazia/);
  assert.equal(classificar(resumo({ status: 'saudavel', reasonsDetail: [] })), null);
  const body = planIncident({ resumo: VALOR }).body;
  assert.match(body, /\*\*Tipo:\*\* indisponibilidade transitória provável/);
  assert.match(body, /O que olhar: ver `data\/sources\.json`/);
  assert.ok(Object.values(ACAO).every((s) => !/<!--|@\w/.test(s)), 'texto fixo sem marcador nem menção');
});

// ---- ferramenta offline
const RUN = (at, status, extra = {}) => ({ generatedAt: at, watched: { mercadolivre: { name: 'Mercado Livre', status, listings: 362, lastNonEmpty: '2026-10-25T08:45:20.313Z' } },
  dbSync: { status: 'ok' }, reader: { status: 'ok', read: 5, valid: 5 }, engine: { status: 'ok' }, collectors: { errors: status === 'BLOCKED' ? { bloqueio: 1 } : {} }, ...extra });
const H = ['08:30', '08:45', '09:00', '09:15', '09:30', '09:45'].map((h) => `2026-10-25T${h}:00.000Z`);
const META = { ops: { runs: [RUN(H[0], 'ACTIVE'), RUN(H[1], 'ACTIVE'), RUN(H[2], 'BLOCKED'), RUN(H[3], 'BLOCKED'), RUN(H[4], 'ACTIVE'), RUN(H[5], 'ACTIVE')] } };
META.ops.last = META.ops.runs.at(-1);
const RUNS = [{ databaseId: 1, status: 'completed', conclusion: 'success', createdAt: '2026-10-25T09:15:00Z', updatedAt: '2026-10-25T09:21:13Z', event: 'workflow_dispatch' }];
const SOURCES = { mercadolivre: { status: 'BLOCKED', reason: 'Limite de requisições (429) em api.mercadolibre.com' } };

await t('metaAte reconstrói o estado da época e episodioFonte mede a volta', () => {
  const c = metaAte(META, H[3]);
  assert.equal(c.meta.ops.runs.length, 4); assert.equal(c.meta.ops.last.generatedAt, H[3]); assert.equal(c.cobre, true); assert.equal(c.depois.length, 2);
  assert.equal(metaAte(META, '2026-10-25T09:16:00.000Z').cobre, false, 'sem a rodada exata: avisa');
  const e = episodioFonte('mercadolivre', c.meta.ops.runs, c.depois);
  assert.deepEqual([e.seguidas, e.inicio, e.voltou, e.rodadasAteVoltar], [2, H[2], H[4], 2]);
});

await t('diagnosticar: 429 de 2 rodadas que volta na 3ª = transitório confirmado; sources.json só da mesma rodada', () => {
  const d = diagnosticar({ meta: META, sources: SOURCES, ate: H[3], now: '2026-10-25T09:22:00.000Z', runs: RUNS });
  assert.equal(d.status, 'degradado'); assert.deepEqual(d.reasons.map((r) => r.code), ['fonte_degradada']);
  assert.equal(d.transporte.ok, true); assert.equal(d.transporte.motivosNaIssue, 1);
  assert.equal(d.classificacao.tipo, 'transitorio'); assert.equal(d.classificacao.confianca, 'confirmada');
  assert.equal(d.classificacaoNaChecagem.tipo, 'transitorio');
  assert.equal(diagnosticar({ meta: META, ate: H[3], now: '2026-10-25T09:22:00.000Z' }).classificacaoNaChecagem.tipo, 'real', 'sem as rodadas do robô não presume saúde');
  assert.match(d.fontes[0].sourcesReason, /outra rodada/, 'sources.json de 09:45 não descreve 09:15');
  assert.deepEqual(d.coletoresErros, { bloqueio: 1 });
  const mesma = diagnosticar({ meta: metaAte(META, H[3]).meta, sources: SOURCES, now: '2026-10-25T09:22:00.000Z' });
  assert.match(mesma.fontes[0].sourcesReason, /429/);
  assert.equal(mesma.classificacao.tipo, 'transitorio_ou_real', 'sem o futuro: só provável');
});

await t('diagnosticar: banco atrasado = incidente real; saudável = sem incidente', () => {
  const ruim = { ops: { runs: META.ops.runs.slice(0, 4).map((r) => ({ ...r, watched: {}, dbSync: { status: 'atrasado', lastSeenAt: H[0] } })) } };
  const d = diagnosticar({ meta: ruim, ate: H[3], now: '2026-10-25T09:22:00.000Z' });
  assert.deepEqual(d.reasons.map((r) => r.code), ['sync_falhando']); assert.equal(d.classificacao.tipo, 'real');
  const ok = diagnosticar({ meta: META, ate: H[5], now: '2026-10-25T09:52:00.000Z' });
  assert.equal(ok.status, 'saudavel'); assert.equal(ok.transporte, null); assert.equal(ok.classificacao.tipo, 'sem_incidente');
});

await t('simularTransporte: segredo na saída pula o output (job incidente não roda) → falha de observabilidade', () => {
  const r = resumo();
  assert.equal(simularTransporte(r).ok, true);
  const s = simularTransporte(r, { segredos: ['bloqueada'] });
  assert.equal(s.ok, false); assert.equal(s.etapa, 'saida_do_job');
  assert.equal(classificarRetro({ status: 'degradado', reasons: [{ code: 'fonte_degradada' }] }, [], s).tipo, 'observabilidade');
  // texto com aspas, crase, emoji e quebra (o JSON escapa a quebra: a linha continua única)
  const hostil = simularTransporte(resumo({ reasonsDetail: [{ code: 'fonte_degradada', text: 'a"b`c\n🟠 d=e' }] }));
  assert.equal(hostil.ok, true); assert.equal(hostil.motivosNaIssue, 1);
});

await t('CLI offline (--meta/--sources/--ate/--json) não usa rede nem grava nada', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'vigia-diag-'));
  fs.writeFileSync(path.join(tmp, 'meta.json'), JSON.stringify(META)); fs.writeFileSync(path.join(tmp, 'sources.json'), JSON.stringify(SOURCES));
  const antes = fs.readdirSync(tmp).sort();
  const r = spawnSync(process.execPath, [path.join(root, 'tools/vigia-diagnostico.mjs'), '--meta', path.join(tmp, 'meta.json'), '--sources', path.join(tmp, 'sources.json'), '--ate', H[3], '--json'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr); const d = JSON.parse(r.stdout);
  assert.equal(d.classificacao.tipo, 'transitorio');
  const txt = spawnSync(process.execPath, [path.join(root, 'tools/vigia-diagnostico.mjs'), '--meta', path.join(tmp, 'meta.json'), '--ate', H[3]], { encoding: 'utf8' });
  assert.match(txt.stdout, /Classificação: transitorio \(confirmada\)/); assert.match(txt.stdout, /Caminho até a issue: ok/);
  const bad = spawnSync(process.execPath, [path.join(root, 'tools/vigia-diagnostico.mjs'), '--commit', 'x;rm'], { encoding: 'utf8' });
  assert.equal(bad.status, 2, 'SHA inválido recusado');
  assert.deepEqual(fs.readdirSync(tmp).sort(), antes);
});

console.log(`vigia-diagnostico: ${n} testes ok`);
