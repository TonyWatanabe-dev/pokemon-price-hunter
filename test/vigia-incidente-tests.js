// Vigia / SRE (Fase 7, item 5): issue de incidente com diagnóstico, idempotente. Cria uma vez, comenta só quando os
// problemas mudam, fecha depois de 2 checagens saudáveis; nunca age sem resumo válido; só reconhece a própria issue
// (autor bot + marcador); texto dos dados sanitizado. Job desligado por padrão (vars.VIGIA_ISSUES).
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { planIncident, parseResumo, findIncident, lastFingerprint, fingerprintMarker, safeText, INCIDENT_MARKER, INCIDENT_LABEL, TRUSTED_AUTHOR } from '../src/ops-incident.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let n = 0; const t = async (name, fn) => { try { await fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } };
const NOW = '2026-10-15T12:00:00.000Z';
const BOT = TRUSTED_AUTHOR;
const res = (status, codes = [], over = {}) => ({ v: 1, now: NOW, status, previousStatus: null, facts: { dataGeneratedAt: NOW, dataAgeMin: 5 },
  reasonsDetail: codes.map((code) => ({ code, text: `texto de ${code}` })), ...over });
const inc = (number, over = {}) => ({ number, state: 'open', author: BOT, body: `${INCIDENT_MARKER}\nx\n${fingerprintMarker('degradado', ['sync_falhando'])}`, ...over });

await t('resumo inválido ou desconhecido: nenhuma ação (fail-closed)', () => {
  for (const r of [null, '', '{trunc', '[]', { status: 'talvez' }, 42]) assert.equal(planIncident({ resumo: r }).type, 'none', JSON.stringify(r));
  assert.equal(planIncident({ resumo: res('desconhecido', ['dados_indisponiveis']) }).type, 'none');
  assert.equal(planIncident({ resumo: res('saudavel') }).type, 'none', 'saudável sem incidente aberto');
  assert.equal(parseResumo(JSON.stringify(res('parado', ['dados_parados', 'X-ruim']))).reasons.length, 1, 'código fora do formato é descartado');
});

await t('degradado/parado sem issue: cria uma, com marcador, label, diagnóstico e impressão digital', () => {
  const p = planIncident({ resumo: res('degradado', ['sync_falhando', 'motor_parado']), runUrl: 'https://github.com/o/r/actions/runs/123' });
  assert.equal(p.type, 'create'); assert.equal(p.title, 'Vigia: TCG Price Hunter com problema'); assert.deepEqual(p.labels, [INCIDENT_LABEL]);
  assert.ok(p.body.startsWith(INCIDENT_MARKER));
  assert.match(p.body, /`sync_falhando`: texto de sync_falhando/); assert.match(p.body, /Checagem: https:\/\/github\.com\/o\/r\/actions\/runs\/123/);
  assert.match(p.body, /<!-- vigia:estado status=degradado codigos=motor_parado,sync_falhando -->/);
  assert.match(p.body, /não reinicia, não altera dados nem faz deploy/);
  assert.equal(planIncident({ resumo: res('parado', ['dados_parados']) }).title, 'Vigia: TCG Price Hunter parado');
  assert.doesNotMatch(planIncident({ resumo: res('parado', ['dados_parados']), runUrl: 'https://evil.example/x' }).body, /evil/, 'URL de checagem só do GitHub Actions');
});

await t('idempotência: mesma impressão digital não repete; problema novo ou status novo comenta', () => {
  const same = planIncident({ resumo: res('degradado', ['sync_falhando']), openIssues: [inc(9)] });
  assert.equal(same.type, 'none'); assert.equal(same.issue, 9);
  const novo = planIncident({ resumo: res('degradado', ['sync_falhando', 'deploy_falhou']), openIssues: [inc(9)] });
  assert.equal(novo.type, 'comment'); assert.equal(novo.issue, 9); assert.match(novo.body, /codigos=deploy_falhou,sync_falhando/);
  assert.equal(planIncident({ resumo: res('parado', ['sync_falhando']), openIssues: [inc(9)] }).type, 'comment', 'mudança de status');
  // o último comentário do bot vale; ordem dos códigos não importa
  const cs = [{ author: BOT, body: fingerprintMarker('degradado', ['deploy_falhou', 'sync_falhando']) }];
  assert.equal(planIncident({ resumo: res('degradado', ['sync_falhando', 'deploy_falhou']), openIssues: [inc(9)], comments: cs }).type, 'none');
  // marcador forjado por terceiro em comentário não conta
  const forjado = [{ author: 'intruso', body: fingerprintMarker('degradado', ['deploy_falhou', 'sync_falhando']) }];
  assert.equal(lastFingerprint(inc(9), forjado), 'degradado:sync_falhando');
});

await t('recuperação: fecha só na 2ª checagem saudável seguida', () => {
  assert.equal(planIncident({ resumo: res('saudavel', [], { previousStatus: 'degradado' }), openIssues: [inc(9)] }).type, 'none');
  const p = planIncident({ resumo: res('saudavel', [], { previousStatus: 'saudavel' }), openIssues: [inc(9)] });
  assert.equal(p.type, 'close'); assert.equal(p.issue, 9); assert.match(p.body, /duas checagens saudáveis/);
});

await t('só a própria issue: autor bot + marcador; PR, fechada e issue de terceiro com marcador são ignoradas', () => {
  const alheias = [inc(3, { author: 'intruso' }), inc(4, { state: 'closed' }), inc(5, { pull_request: {} }), { number: 6, state: 'open', author: BOT, body: 'sem marcador' }];
  assert.equal(findIncident(alheias), null);
  assert.equal(planIncident({ resumo: res('degradado', ['sync_falhando']), openIssues: alheias }).type, 'create');
  assert.equal(findIncident([...alheias, inc(12), inc(10)]).number, 10, 'várias: a de menor número');
});

await t('texto dos dados sanitizado: sem segredo, marcador forjado, HTML ou menção', () => {
  const evil = 'falhou postgres://u:SENHA@db/x token=ghp_abc123456789 <!-- vigia:incidente --> <img src=x> @TonyWatanabe-dev\nlinha2';
  const s = safeText(evil);
  assert.doesNotMatch(s, /SENHA|ghp_abc|<!--|-->|<img|\n/); assert.match(s, /@​TonyWatanabe-dev/);
  const p = planIncident({ resumo: { ...res('degradado'), reasonsDetail: [{ code: 'sync_falhando', text: evil }] } });
  assert.equal(p.body.split(INCIDENT_MARKER).length, 2, 'só o marcador legítimo');
  assert.doesNotMatch(p.body, /SENHA/);
});

await t('CLI: cria, depois não repete, comenta mudança e fecha; dry-run e resumo inválido não escrevem', async () => {
  const issues = []; const writes = []; let k = 0;
  const ghImpl = async (args) => {
    const p = args.find((a) => a.startsWith('repos/'));
    if (args.includes('--paginate')) {
      if (/\/issues\?state=open&creator=github-actions%5Bbot%5D/.test(p)) return JSON.stringify([issues.filter((i) => i.state === 'open').map((i) => ({ number: i.number, state: i.state, user: { login: BOT }, body: i.body }))]);
      const m = p.match(/issues\/(\d+)\/comments/); if (m) return JSON.stringify([issues.find((i) => i.number === Number(m[1])).comments.map((b) => ({ user: { login: BOT }, body: b }))]);
      throw new Error('rota inesperada ' + p);
    }
    writes.push(args.filter((a) => !a.startsWith('body=')).join(' '));
    const body = (args.find((a) => a.startsWith('body=')) || '').slice(5);
    if (/issues$/.test(p)) { const i = { number: 100 + issues.length, state: 'open', body, comments: [] }; issues.push(i); return JSON.stringify({ number: i.number }); }
    const c = p.match(/issues\/(\d+)\/comments$/); if (c) { issues.find((i) => i.number === Number(c[1])).comments.push(body); return '{}'; }
    const x = p.match(/issues\/(\d+)$/); if (x && args.includes('state=closed')) { issues.find((i) => i.number === Number(x[1])).state = 'closed'; return '{}'; }
    throw new Error('escrita inesperada ' + args.join(' '));
  };
  const run = async (resumo, argv = []) => {
    const saved = process.argv; process.argv = [saved[0], saved[1], ...argv];
    try { const m = await import(pathToFileURL(path.join(root, 'tools/vigia-incidente.mjs')).href + '?k=' + (++k)); return await m.main({ env: { VIGIA_JSON: resumo == null ? '' : JSON.stringify(resumo), GITHUB_RUN_ID: '1' }, ghImpl, log: () => {} }); }
    finally { process.argv = saved; }
  };
  assert.equal((await run(null)).type, 'none');
  assert.equal((await run(res('degradado', ['sync_falhando']), ['--dry-run'])).type, 'create'); assert.equal(writes.length, 0, 'dry-run não escreve');
  assert.equal((await run(res('degradado', ['sync_falhando']))).type, 'create'); assert.equal(issues.length, 1);
  assert.match(writes[0], /labels\[\]=ops:incidente/);
  assert.equal((await run(res('degradado', ['sync_falhando']))).type, 'none'); assert.equal(writes.length, 1, 'mesma checagem repetida: nenhuma escrita');
  assert.equal((await run(res('parado', ['dados_parados']))).type, 'comment');
  assert.equal((await run(res('parado', ['dados_parados']))).type, 'none');
  assert.equal((await run(res('saudavel', [], { previousStatus: 'parado' }))).type, 'none');
  assert.equal((await run(res('saudavel', [], { previousStatus: 'saudavel' }))).type, 'close');
  assert.equal(issues[0].state, 'closed'); assert.equal(writes.length, 4, 'criar, comentar, comentar recuperação, fechar');
  assert.equal((await run(res('saudavel', [], { previousStatus: 'saudavel' }))).type, 'none', 'fechada não é reaberta nem comentada');
  assert.equal(issues.length, 1, 'nunca duplicou');
});

await t('watchdog.mjs grava o resumo (VIGIA_RESUMO) com estado anterior e motivos; sem segredo', async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-inc-'));
  const w = (f, o) => fs.writeFileSync(path.join(tmp, f), typeof o === 'string' ? o : JSON.stringify(o));
  w('state.json', { generatedAt: new Date(Date.parse(NOW) - 5 * 6e4).toISOString() }); w('meta.json', '{"ops": [trunc');
  w('runs.json', []); w('ledger.json', { notifiedStatus: 'saudavel', lastStatus: 'saudavel' });
  const saved = process.argv;
  process.argv = [saved[0], saved[1], '--state', path.join(tmp, 'state.json'), '--meta', path.join(tmp, 'meta.json'), '--runs', path.join(tmp, 'runs.json'), '--ledger', path.join(tmp, 'ledger.json'), '--now', NOW, '--dry-run'];
  try {
    const m = await import(pathToFileURL(path.join(root, 'tools/watchdog.mjs')).href + '?inc=1');
    await m.main({ env: { VIGIA_RESUMO: path.join(tmp, 'vigia.json'), NTFY_TOPIC: 'topico-secreto' }, fetchImpl: async () => ({ ok: true }), log: () => {} });
  } finally { process.argv = saved; }
  const r = JSON.parse(fs.readFileSync(path.join(tmp, 'vigia.json'), 'utf8'));
  assert.equal(r.status, 'degradado'); assert.equal(r.previousStatus, 'saudavel'); assert.deepEqual(r.reasonsDetail.map((x) => x.code), ['meta_ilegivel']);
  assert.ok(!JSON.stringify(r).includes('topico-secreto'));
  assert.equal(planIncident({ resumo: r }).type, 'create', 'o resumo gravado é aceito pelo plano');
});

await t('watchdog.yml: job de incidente desligado por padrão, escrita só em issues, SHA fixo, entrada só por env', () => {
  const y = fs.readFileSync(path.join(root, '.github/workflows/watchdog.yml'), 'utf8');
  const [check, inc] = y.split(/\n  incidente:\n/);
  assert.ok(inc, 'job incidente existe');
  assert.doesNotMatch(check, /:\s*write\b/, 'job check continua só leitura');
  assert.match(inc, /if: always\(\) && vars\.VIGIA_ISSUES == 'true' && needs\.check\.outputs\.vigia != ''/);
  assert.deepEqual([...inc.matchAll(/(\w[\w-]*): write/g)].map((m) => m[1]), ['issues']);
  assert.match(inc, /persist-credentials: false/);
  assert.match(inc, /VIGIA_JSON: \$\{\{ needs\.check\.outputs\.vigia \}\}/);
  assert.doesNotMatch(inc, /run:[^\n]*\$\{\{/, 'nada interpolado no shell');
  assert.doesNotMatch(inc, /secrets\./);
  for (const m of y.matchAll(/uses:\s*(\S+)/g)) assert.match(m[1], /@[0-9a-f]{40}$/, `${m[1]} fixado por SHA`);
  assert.match(check, /outputs:\s*\n\s*vigia: \$\{\{ steps\.resumo\.outputs\.json \}\}/);
  assert.match(check, /VIGIA_RESUMO: wd\/vigia\.json/);
  assert.doesNotMatch(y, /VIGIA_ISSUES:\s*['"]?true/, 'flag não ligada pelo workflow');
});

console.log(`vigia-incidente: ${n} testes ok`);
