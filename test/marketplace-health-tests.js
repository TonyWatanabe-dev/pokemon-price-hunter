// Marketplace Health Agent (Fase 7, item 7): agrupa falhas/frescor/cobertura e só propõe; nunca contorna bloqueio.
// Dados SINTÉTICOS, sem rede/banco.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { marketplaceHealthReport, marketplaceHealthMarkdown, runsSummary, FORBIDDEN, ACTIONS, MARKETPLACE_HEALTH_VERSION } from '../src/agents/marketplace-health.js';

let n = 0; const t = (name, fn) => { try { fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } };
const AS_OF = '2026-10-15T12:00:00.000Z';
const H = (h) => new Date(Date.parse(AS_OF) - h * 36e5).toISOString();
const sources = () => ({
  boa: { name: 'Boa', status: 'ACTIVE', platform: 'vtex', checks: 10, ok: 10, fails: 0, listings: 50, matched: 30, lastSuccess: H(0.2), lastCheck: H(0.2), lastNonEmpty: H(0.2) },
  velha: { name: 'Velha', status: 'ACTIVE', platform: 'shopify', checks: 10, ok: 9, fails: 0, listings: 5, matched: 5, lastSuccess: H(30), lastCheck: H(30) },
  vazia: { name: 'Vazia', status: 'ACTIVE', platform: 'jsonld', checks: 10, ok: 10, fails: 0, listings: 0, matched: 0, lastSuccess: H(0.2), lastCheck: H(0.2), lastNonEmpty: H(48) },
  dica: { name: 'Dica', status: 'ACTIVE', platform: 'jsonld', platformHint: 'vtex', checks: 5, ok: 5, listings: 100, matched: 4, lastSuccess: H(0.2), lastCheck: H(0.2), partial: true },
  cf: { name: 'CF', status: 'BLOCKED', checks: 40, ok: 0, fails: 32, httpStatus: 403, errorClass: 'bloqueio', lastCheck: H(1), reason: 'Acesso bloqueado (403)',
    lastFailure: { at: H(1), status: 403, waf: 'cloudflare', server: 'cloudflare', setCookieNames: [], bodyHead: 'Access denied' } },
  cfok: { name: 'CF às vezes', status: 'BLOCKED', checks: 40, ok: 12, fails: 2, httpStatus: 403, errorClass: 'bloqueio', lastCheck: H(1), lastFailure: { at: H(1), status: 403, waf: 'akamai' } },
  lim: { name: 'Limite', status: 'BLOCKED', checks: 9, ok: 5, fails: 1, httpStatus: 429, retryAfterSec: 600, errorClass: 'bloqueio', lastCheck: H(1), lastFailure: { at: H(1), status: 429, waf: 'generic-403' } },
  lenta: { name: 'Lenta', status: 'BLOCKED', checks: 40, ok: 0, fails: 32, netCode: 'TIMEOUT', errorClass: 'timeout', lastDurationMs: 30001, lastCheck: H(1), lastFailure: { at: H(1), waf: 'timeout', errorCode: 'TIMEOUT' } },
  cred: { name: 'Credencial', status: 'BLOCKED', checks: 3, ok: 0, fails: 3, errorClass: 'auth', lastCheck: H(1), reason: 'exige token OAuth' },
  plat: { name: 'Plataforma', status: 'ERROR', checks: 3, ok: 0, fails: 3, errorClass: 'plataforma', lastCheck: H(1), lastFailure: { at: H(1), waf: 'unknown' } },
  pend: { name: 'Pendente', status: 'PENDING', checks: 0, ok: 0, reason: 'domínio ainda não confirmado' },
  marketplace: { name: 'Grande', status: 'UNAVAILABLE', checks: 0, ok: 0, reason: 'sem API pública de busca' },
});
const run = (i, x = {}) => ({ runId: String(i), generatedAt: H(10 - i), startedAt: H(10 - i), finishedAt: H(10 - i), durationSec: 500 + i, health: i === 3 ? 'degradado' : 'saudavel',
  issues: i === 3 ? ['coletores_todos_falharam'] : [], result: 'ok', stores: { active: 4, deferred: 0 },
  collectors: { tried: 10, ok: 8, failed: 2, errors: { bloqueio: 1, timeout: 1 }, slowest: [{ id: 'boa', ms: 9e5 }, { id: i % 2 ? 'dica' : 'velha', ms: 1e5 }] },
  listingsRejected: { total: 3, byStore: { dica: { 'preço ausente': 3 } } }, ...x });
const meta = () => ({ ops: { runs: [0, 1, 2, 3, 4, 5].map((i) => run(i)) } });
const state = () => ({ generatedAt: AS_OF, offers: [{ id: 'o1', storeId: 'boa', stock: 'IN_STOCK' }, { id: 'o2', storeId: 'dica', stock: 'UNKNOWN', stale: true }] });
const stores = { stores: [{ id: 'boa' }, { id: 'nova-config' }] };
const report = (o = {}) => marketplaceHealthReport({ sources: sources(), meta: meta(), state: state(), stores, asOf: AS_OF, ...o });
const kinds = (r, id) => r.proposals.filter((p) => p.stores.includes(id)).map((p) => p.kind).sort();

t('envelope: só proposta, nada gravado, lista do que nunca é proposto', () => {
  const r = report();
  assert.equal(r.agent, 'marketplace-health'); assert.equal(r.version, MARKETPLACE_HEALTH_VERSION);
  assert.equal(r.mode, 'proposta'); assert.equal(r.writes, false); assert.equal(r.autoApply, false);
  assert.deepEqual(r.forbidden, FORBIDDEN);
  for (const p of r.proposals) {
    assert.equal(p.decision, 'needs_review'); assert.equal(p.autoApply, false);
    assert.ok(ACTIONS[p.action], `${p.key}: ação fora da lista (${p.action})`); assert.equal(p.actionText, ACTIONS[p.action]);
    assert.ok(p.evidence.length && p.evidence.every((e) => e.code && e.detail && e.source && e.basis === 'observado'), p.key);
  }
  assert.equal(new Set(r.proposals.map((p) => p.key)).size, r.proposals.length);
});

t('nenhuma ação propõe contornar bloqueio (UA, proxy, CAPTCHA, robots, login, reativar)', () => {
  const bad = /user.?agent|proxy|rota[cç][aã]o de ip|captcha|ignorar robots|contornar|burlar|reativar|bypass|stealth|headless/i;
  for (const [k, txt] of Object.entries(ACTIONS)) assert.doesNotMatch(`${k} ${txt}`, bad, k);
  const r = report();
  for (const p of r.proposals) assert.doesNotMatch(`${p.action} ${p.actionText} ${p.note || ''}`.replace(/não muda frequência nem identificação/, ''), bad, p.key);
});

t('bloqueio anti-robô: nunca leu → pausar; já leu → respeitar; 429 → Retry-After', () => {
  const r = report();
  const by = (id) => r.proposals.find((p) => p.stores[0] === id);
  assert.equal(by('cf').kind, 'bloqueio_anti_robo'); assert.equal(by('cf').action, 'pausar_fonte'); assert.match(by('cf').evidence[1].detail, /cloudflare/);
  assert.equal(by('cfok').action, 'respeitar_bloqueio');
  assert.equal(by('lim').kind, 'limite_de_requisicoes'); assert.equal(by('lim').action, 'respeitar_retry_after'); assert.match(by('lim').evidence[1].detail, /Retry-After 600/);
});

t('rede persistente, credencial, plataforma, domínio pendente; indisponível conhecido fica sem proposta', () => {
  const r = report();
  assert.deepEqual(kinds(r, 'lenta').filter((k) => k !== 'lenta_recorrente'), ['falha_de_rede_persistente']);
  assert.deepEqual(kinds(r, 'cred'), ['credencial_ausente']);
  assert.deepEqual(kinds(r, 'plat'), ['plataforma_nao_reconhecida']);
  assert.deepEqual(kinds(r, 'pend'), ['dominio_pendente']);
  assert.deepEqual(kinds(r, 'marketplace'), []);
});

t('ativas: dados velhos, vazio suspeito, paginação, matching baixo, adaptador dedicado', () => {
  const r = report();
  assert.deepEqual(kinds(r, 'velha').filter((k) => k !== 'lenta_recorrente'), ['dados_velhos']);
  assert.deepEqual(kinds(r, 'vazia'), ['vazio_suspeito']);
  assert.deepEqual(kinds(r, 'dica').filter((k) => !['lenta_recorrente', 'recusas_do_contrato'].includes(k)), ['adaptador_dedicado_disponivel', 'matching_baixo', 'paginacao_incompleta']);
  assert.deepEqual(kinds(r, 'boa').filter((k) => k !== 'lenta_recorrente'), []);
  assert.equal(r.proposals.find((p) => p.kind === 'dados_velhos').severity, 'alta');
});

t('frescor e agrupamento por plataforma e por motivo de falha', () => {
  const r = report();
  assert.deepEqual(r.groups.freshnessActive, { fresca: 3, atrasada: 0, velha: 1, nunca: 0 });
  assert.equal(r.groups.byPlatform.vtex.active, 1); assert.equal(r.groups.byPlatform.jsonld.active, 2);
  assert.deepEqual(r.groups.byFailure.cloudflare, ['cf']); assert.deepEqual(r.groups.byFailure.akamai, ['cfok']);
  assert.deepEqual(r.groups.byFailure.timeout, ['lenta']); assert.deepEqual(r.groups.byFailure.pending, ['pend']);
  const boa = r.stores.find((s) => s.id === 'boa'); assert.equal(boa.offers, 1); assert.equal(boa.matchRate, 0.6);
});

t('rodadas: tendência, lentas recorrentes (≥ metade) e recusas do contrato', () => {
  const r = report();
  assert.equal(r.runs.runs, 6); assert.equal(r.runs.degraded, 1); assert.equal(r.runs.collectorsFailedAvg, 2);
  assert.deepEqual(r.runs.errorsByClass, { bloqueio: 6, timeout: 6 }); assert.equal(r.runs.durationSec.max, 505);
  const slow = r.proposals.filter((p) => p.kind === 'lenta_recorrente').map((p) => p.stores[0]).sort();
  assert.deepEqual(slow, ['boa', 'dica', 'velha']);
  assert.deepEqual(r.proposals.filter((p) => p.kind === 'recusas_do_contrato').map((p) => p.stores[0]), ['dica']);
  assert.deepEqual(runsSummary(null).runs, 0); assert.deepEqual(runsSummary([{ generatedAt: 'x' }]).runs, 0);
});

t('cobertura: loja configurada fora das fontes', () => {
  assert.deepEqual(kinds(report(), 'nova-config'), ['fora_das_fontes']);
});

t('pré-requisitos medidos com os dados recebidos', () => {
  const st = (r, id) => r.prerequisites.find((p) => p.id === id).status;
  const r = report();
  assert.equal(st(r, 'historico_de_rodadas'), 'parcial');
  assert.equal(st(report({ meta: null }), 'historico_de_rodadas'), 'nao_atendido');
  const many = { ops: { runs: Array.from({ length: 30 }, (_, i) => run(i)) } };
  assert.equal(st(report({ meta: many }), 'historico_de_rodadas'), 'atendido');
  assert.equal(st(r, 'rate_limits'), 'parcial'); assert.match(r.prerequisites.find((p) => p.id === 'rate_limits').detail, /lim/);
  assert.equal(st(r, 'telemetria_por_loja'), 'atendido');
});

t('determinístico, não muta a entrada e recusa sem horário de referência', () => {
  const s = sources(); const m = meta(); const before = JSON.stringify([s, m]);
  const a = marketplaceHealthReport({ sources: s, meta: m, asOf: AS_OF }); const b = marketplaceHealthReport({ sources: s, meta: m, asOf: AS_OF });
  assert.deepEqual(a, b); assert.equal(JSON.stringify([s, m]), before);
  assert.throws(() => marketplaceHealthReport({ sources: s }), /asOf ausente/);
});

t('Markdown: só proposta, nunca proposto, pré-requisitos, plataformas e propostas', () => {
  const md = marketplaceHealthMarkdown(report());
  for (const re of [/somente proposta/, /Nunca proposto:/, /## Pré-requisitos/, /## Por plataforma/, /## Por motivo de falha/, /## Rodadas/, /## Propostas/]) assert.match(md, re);
});

t('módulo e CLI sem rede, banco ou escrita nos dados', () => {
  const src = fs.readFileSync(new URL('../src/agents/marketplace-health.js', import.meta.url), 'utf8');
  assert.doesNotMatch(src, /from 'node:(fs|http|https|net|child_process)'|pg\.js|fetch\(|writeFile/);
  const cli = fs.readFileSync(new URL('../tools/agente-saude-lojas.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(cli, /DATABASE_URL|pg\.js|fetch\(/);
  assert.equal((cli.match(/writeFileSync/g) || []).length, 1, 'só o --out');
});

// Workflow opcional: manual, só leitura, sem secrets e desligado por variável.
{
  const y = fs.readFileSync(new URL('../.github/workflows/agente-saude-lojas.yml', import.meta.url), 'utf8');
  const code = y.split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
  assert.match(code, /^on:\n  workflow_dispatch:\n(?!\s+\w)/m, 'só workflow_dispatch');
  assert.doesNotMatch(code, /schedule:|push:|pull_request|workflow_run|issues:/);
  assert.match(code, /^permissions:\n  contents: read\nconcurrency:/m, 'permissão mínima');
  assert.doesNotMatch(code, /secrets\.|DATABASE_URL|write|GH_TOKEN|github\.token/);
  assert.match(code, /if: vars\.AGENTE_SAUDE_LOJAS == 'true'/);
  assert.match(code, /node tools\/agente-saude-lojas\.mjs rel >> "\$GITHUB_STEP_SUMMARY"/);
  n++;
}

console.log(`OK — marketplace health agent: ${n} testes`);
