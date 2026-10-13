// SEO & Content Agent — isolamento e falhas do ciclo (issue #613). Complementa test/seo-content-agent-tests.js e
// test/seo-content-hardening-tests.js: agente desativado não executa job da fila, falha/timeout de um handler de SEO
// não derruba a rodada, a rodada principal não carrega o auditor, entradas malformadas viram abstenção (não exceção),
// achado sem evidência é descartado no relatório e a auditoria com dados stale/indisponíveis não altera estado, preço,
// oferta, ranking nem página publicada. Sem rede e sem banco: banco falso, store em memória e CLI offline.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readiness, PREREQUISITOS, auditPage, auditSitemap, auditRoutes, report, SEVERIDADES } from '../src/agents/seo-content.js';
import { createOrchestrator, PermanentError, PROTECTED_NAMESPACES } from '../src/agents/orchestrator.js';
import { memoryStore } from '../src/agents/stores.js';
import { reviewProposeHandler, memoryReviewSink } from '../src/agents/handlers/review-propose.js';
import { buildEvidence } from '../src/agents/evidence.js';
import { runAgentCycle } from '../src/agents/cycle.js';
import { LIMITS } from '../api/_lib/freshness.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let n = 0;
const test = async (name, fn) => { try { await fn(); n++; } catch (e) { console.error(`✗ ${name}`); throw e; } };
const SITE = 'https://tcg-price-hunter.vercel.app';
const T0 = Date.parse('2026-10-13T12:00:00Z');
const now = () => new Date(T0);
const SEO_TIPOS = ['seo.audit', 'seo-content.audit', 'seo-content.report'];
const CAMPOS = ['evidencia', 'file', 'recomendacao', 'regra', 'severidade', 'url'];

// Proposta válida de matching: o job que a rodada real executa, para provar que ele segue em frente ao lado do de SEO.
const evidence = buildEvidence({ source: 'state.offers', url: 'https://omni.com.br/o1', reason: 'título ambíguo', basis: 'observado', observedAt: '2026-10-13T11:45:00Z' }, { now: T0 }).evidence;
const proposal = { category: 'matching', entityType: 'offer', entityId: 'o1', confidence: 62, dedupeKey: 'm:1', proposal: { productId: 'me05-etb', evidence } };
function setup(handlers = [], o = {}) {
  const store = memoryStore(); const sink = memoryReviewSink();
  const orch = createOrchestrator({ store, now, workerId: 'w1', handlers: [reviewProposeHandler({ sink }), ...handlers], aiEnabled: false, ...o });
  return { store, sink, orch };
}
const jobOf = (store, type) => store.jobs.find((j) => j.type === type);

// ---- Agente desativado não executa tarefas ----
await test('desativado: job de SEO na fila fica bloqueado sem handler, sem consumir tentativa, e a revisão real conclui', async () => {
  for (const aiEnabled of [false, true]) {
    const { store, sink, orch } = setup([], { aiEnabled });
    assert.ok(!orch.handlers().some((h) => /seo/i.test(h)), 'nenhum handler de SEO registrado');
    for (const type of SEO_TIPOS) await orch.enqueue({ type, idempotencyKey: `k:${type}`, payload: { site: SITE, publicar: true } });
    await orch.enqueue({ type: 'review.propose', idempotencyKey: 'k:review', payload: proposal });
    assert.deepEqual(await orch.runOnce({ limit: 10 }), { claimed: 4, completed: 1, retried: 0, failed: 0, blocked: 3, lost: 0 }, `aiEnabled=${aiEnabled}`);
    for (const type of SEO_TIPOS) {
      const j = jobOf(store, type);
      assert.equal(j.status, 'blocked'); assert.equal(j.error, 'sem handler registrado'); assert.equal(j.attempts, 0, 'bloqueio devolve a tentativa');
      assert.equal(j.result, null);
    }
    assert.equal(jobOf(store, 'review.propose').status, 'completed'); assert.equal(sink.items.length, 1, 'só a revisão real gera item');
    assert.deepEqual(store.events.map((e) => e.type), ['AGENT_JOB_BLOCKED', 'AGENT_JOB_BLOCKED', 'AGENT_JOB_BLOCKED']);
    assert.equal((await orch.runOnce({ limit: 10 })).claimed, 0, 'bloqueado não volta para a fila');
  }
});
await test('desativado: handler de SEO marcado como IA não roda com AI_AGENTS_ENABLED desligado', async () => {
  let chamadas = 0;
  const seo = { type: 'seo.audit', ai: true, run: () => { chamadas++; return { ok: true }; } };
  const { store, orch } = setup([seo]);
  await orch.enqueue({ type: 'seo.audit', idempotencyKey: 'k1', payload: {} });
  assert.deepEqual(await orch.runOnce(), { claimed: 1, completed: 0, retried: 0, failed: 0, blocked: 1, lost: 0 });
  assert.equal(chamadas, 0); assert.equal(store.jobs[0].error, 'ai_disabled'); assert.equal(store.jobs[0].attempts, 0);
});
await test('handler de SEO não pode ser registrado em namespace de preço, score, ranking, oportunidade, oferta ou referência', async () => {
  for (const ns of PROTECTED_NAMESPACES) {
    assert.throws(() => setup([{ type: `${ns}.seo`, ai: true, run: () => ({}) }]), /não pode atuar/, ns);
  }
});

// ---- Falha do auditor não derruba a rodada ----
await test('falha isolada: exceção, erro permanente e timeout do handler de SEO não impedem a revisão real', async () => {
  const casos = [
    [{ run: () => { throw new Error('auditor quebrou'); } }, 'retry', /auditor quebrou/],
    [{ run: () => { throw new PermanentError('sem evidência'); } }, 'failed', /sem evidência/],
    [{ run: () => new Promise(() => {}), timeoutMs: 20 }, 'retry', /timeout após 20 ms/],
    [{ run: () => ({ html: 'x'.repeat(64 * 1024) }) }, 'failed', /resultado acima/],
    [{ validate: () => 'HTML ausente', run: () => { throw new Error('não deveria rodar'); } }, 'failed', /payload inválido: HTML ausente/],
  ];
  for (const [h, status, erro] of casos) {
    const { store, sink, orch } = setup([{ type: 'seo.audit', ...h }]);
    await orch.enqueue({ type: 'seo.audit', idempotencyKey: 'k:seo', priority: 1, payload: {} });       // roda primeiro
    await orch.enqueue({ type: 'review.propose', idempotencyKey: 'k:review', payload: proposal });
    const s = await orch.runOnce();
    assert.equal(s.claimed, 2); assert.equal(s.completed, 1, String(erro));
    const j = jobOf(store, 'seo.audit'); assert.equal(j.status, status, String(erro)); assert.match(j.error, erro);
    assert.equal(jobOf(store, 'review.propose').status, 'completed'); assert.equal(sink.items.length, 1);
  }
});
// Banco falso: devolve jobs de SEO no claim e grava cada SQL executado.
const fakeDb = (tipos) => {
  const sql = []; let claims = 0;
  return {
    sql,
    query: async (q, params) => {
      sql.push(q);
      if (/WITH c AS/.test(q)) return { rows: claims++ ? [] : tipos.map((type, i) => ({ id: i + 1, type, priority: 100, attempts: 1, max_attempts: 3, payload: {}, run_after: new Date(0), locked_at: new Date(T0), idempotency_key: `k${i}` })) };
      if (/^\s*UPDATE automation_job/.test(q)) return { rowCount: 1, rows: [{ id: params?.[0] }] };
      return { rows: [] };
    },
  };
};
await test('rodada de agentes: jobs de SEO ficam bloqueados, o ciclo termina ok e só escreve em automation_job/system_event', async () => {
  const db = fakeDb(SEO_TIPOS);
  const r = await runAgentCycle({ db, state: {}, send: async () => ({ delivered: true }), now, clock: () => 0, workerId: 'w', opts: { batch: 5 } });
  assert.equal(r.ok, true, r.errors.join('; ')); assert.deepEqual(r.errors, []);
  assert.equal(r.runs[0].claimed, SEO_TIPOS.length); assert.equal(r.runs[0].blocked, SEO_TIPOS.length); assert.equal(r.runs[0].completed, 0);
  const escritas = db.sql.filter((q) => /\b(INSERT|UPDATE|DELETE|TRUNCATE|ALTER|DROP)\b/i.test(q));
  assert.ok(escritas.length > 0);
  for (const q of escritas) assert.match(q, /\b(automation_job|system_event)\b/, `escrita fora da fila: ${q.slice(0, 80)}`);
  assert.ok(!db.sql.some((q) => /\b(offer|price|opportunity|ranking|score|reference|review_item|product)\w*\b/i.test(q.replace(/automation_job|system_event|entity_type|max_attempts/g, ''))),
    'job de SEO bloqueado não toca oferta, preço, oportunidade, ranking, referência nem revisão');
});

// ---- Rodada principal não carrega o auditor ----
const IMPORT_RE = /(?:^|[\s;])(?:import|export)\s[^'"]*?from\s*['"](\.{1,2}\/[^'"]+)['"]|import\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)|^\s*import\s*['"](\.{1,2}\/[^'"]+)['"]/gm;
function alcancaveis(entradas) {
  const vistos = new Set(); const fila = entradas.map((f) => path.join(root, f));
  while (fila.length) {
    const f = fila.pop(); if (vistos.has(f) || !fs.existsSync(f)) continue; vistos.add(f);
    for (const m of fs.readFileSync(f, 'utf8').matchAll(IMPORT_RE)) fila.push(path.resolve(path.dirname(f), m[1] || m[2] || m[3]));
  }
  return [...vistos].map((f) => path.relative(root, f));
}
await test('rodada principal (coleta, ciclo de agentes, servidor e API) não importa o auditor de SEO', async () => {
  const api = fs.readdirSync(path.join(root, 'api')).filter((f) => f.endsWith('.mjs')).map((f) => `api/${f}`);
  const entradas = ['src/run.js', 'src/server.js', 'tools/agents-run.mjs', 'src/agents/cycle.js', ...api];
  const grafo = alcancaveis(entradas);
  assert.ok(grafo.includes('src/agents/orchestrator.js') && grafo.includes('api/_lib/freshness.mjs') && grafo.length > 20, 'o grafo foi de fato percorrido');
  for (const f of ['src/agents/seo-content.js', 'tools/seo-audit.mjs']) assert.ok(!grafo.includes(f), `${f} alcançável pela rodada principal`);
  assert.ok(alcancaveis(['tools/seo-audit.mjs']).includes('src/agents/seo-content.js'), 'controle: o detector enxerga o import da CLI');
  const scripts = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8')).scripts;
  assert.ok(!Object.values(scripts).some((s) => /seo-audit|seo-content/.test(s)), 'nenhum script npm chama o auditor');
  const wf = path.join(root, '.github/workflows');
  for (const f of fs.readdirSync(wf)) assert.ok(!/seo-audit|seo-content/.test(fs.readFileSync(path.join(wf, f), 'utf8')), `${f} não deve rodar o auditor`);
});

// ---- Entradas malformadas: abstenção, nunca exceção ----
const LIXO = [undefined, null, '', 'x', 42, true, [], [null], {}, () => {}];
await test('entradas malformadas não lançam: auditor abstém-se e não recomenda nada', async () => {
  for (const x of LIXO) {
    const p = auditPage(x, { site: SITE }); assert.equal(p.abstained, true); assert.deepEqual(p.findings, []);
    if (x !== 'x') { const p2 = auditPage({ url: '/x', html: x }, x); assert.equal(p2.abstained, true, String(x)); assert.deepEqual(p2.findings, []); }
    const s = auditSitemap(x, x); assert.equal(s.abstained, true); assert.deepEqual(s.findings, []);
    const r = auditRoutes(x); assert.equal(r.abstained, true); assert.deepEqual(r.findings, []);
    const rv = auditRoutes({ vercel: x, robots: 'Sitemap: x', site: SITE });
    assert.equal(rv.abstained, !(x && typeof x === 'object' && !Array.isArray(x)), String(x)); assert.deepEqual(rv.rotas, []);   // {} é config vazia, não ausência
    const rd = readiness(x, x); assert.equal(rd.status, 'bloqueado'); assert.equal(rd.enabled, false);
    const rel = report(x); assert.equal(rel.enabled, false); assert.deepEqual(rel.findings, []); assert.equal(rel.publica, false);
    const rel2 = report({ pages: x, sitemap: x, routes: x, readiness: x }); assert.equal(rel2.enabled, false); assert.deepEqual(rel2.findings, []);
  }
  // HTML válido com opções malformadas: audita, mas sem host não acusa canonical
  const ok = auditPage({ url: '/x', html: `<title>X</title><link rel="canonical" href="https://outro.io/x">` }, null);
  assert.equal(ok.abstained, false); assert.ok(!ok.findings.some((f) => f.regra.startsWith('SEO-CANONICAL-HOST')));
  assert.ok(ok.abstencoes.includes('canonical: host do site não informado'));
});
await test('vercel.json malformado: entradas sem objeto, sem source ou com listas inválidas são ignoradas', async () => {
  const robots = `Disallow: /conta\nSitemap: ${SITE}/sitemap.xml\n`;
  for (const vercel of [{ rewrites: 'x', headers: 'y' }, { rewrites: [null, 42, 'a', []], headers: [null, { headers: 'z' }] },
    { rewrites: [{ source: 42, destination: '/api/pagina' }, { destination: '/api/pagina' }], headers: [{ headers: [{ key: 'X-Robots-Tag', value: 'noindex' }] }] },
    { headers: [{ source: '/conta', headers: [null, {}, { key: 42, value: null }] }] }]) {
    const r = auditRoutes({ vercel, robots, site: SITE });
    assert.equal(r.abstained, false); assert.deepEqual(r.rotas, []); assert.deepEqual(r.findings, [], JSON.stringify(vercel));
  }
  const valido = auditRoutes({ vercel: { rewrites: [null, { source: '/p/:slug', destination: '/api/pagina?t=produto&slug=:slug' }], headers: [null, { source: '/conta', headers: [{ key: 'X-Robots-Tag', value: 'noindex' }] }] }, robots, site: SITE });
  assert.deepEqual(valido.rotas.map((x) => x.rota), ['/p/:slug']); assert.deepEqual(valido.findings.map((f) => f.regra), ['SEO-ROBOTS-BLOQUEIA-NOINDEX'], 'o que é válido continua auditado');
});

// ---- Recomendação sem evidência é rejeitada ----
await test('relatório descarta achado sem evidência rastreável e registra o descarte como abstenção', async () => {
  const bom = { regra: 'SEO-TITULO', severidade: 'alta', url: '/a', file: 'api/pagina.mjs', evidencia: '<title> ausente', recomendacao: 'Gerar título.' };
  const ruins = [
    { ...bom, evidencia: '' }, { ...bom, evidencia: '   ' }, { ...bom, evidencia: null }, { ...bom, evidencia: ['x'] },
    { ...bom, recomendacao: '' }, { ...bom, recomendacao: 42 },
    { ...bom, url: '', file: '' }, { ...bom, url: 42, file: null },
    { ...bom, severidade: 'critica' }, { ...bom, severidade: undefined }, { ...bom, regra: '' }, { ...bom, regra: 7 },
  ];
  const r = report({ pages: [{ url: '/a', findings: [...ruins, bom, null, 'x'] }], routes: { findings: [{ ...bom, url: '', file: 'robots.txt', regra: 'SEO-ROBOTS-SEM-SITEMAP', severidade: 'media' }] } });
  assert.deepEqual(r.findings.map((f) => f.regra), ['SEO-TITULO', 'SEO-ROBOTS-SEM-SITEMAP']);
  assert.deepEqual(r.porSeveridade, { alta: 1, media: 1, baixa: 0 });
  const desc = r.abstencoes.filter((a) => a.startsWith('achado descartado sem evidência rastreável'));
  assert.equal(desc.length, ruins.length, 'cada descarte fica registrado');
  assert.ok(desc.includes('achado descartado sem evidência rastreável: (sem regra)'));
  for (const f of r.findings) {
    assert.deepEqual(Object.keys(f).sort(), CAMPOS); assert.ok(SEVERIDADES.includes(f.severidade));
    assert.ok(f.evidencia.trim() && f.recomendacao.trim() && (f.url || f.file));
  }
  assert.equal(r.enabled, false);
});
await test('relatório não repassa campos fora do contrato (publicação, preço, ranking) vindos de um achado', async () => {
  const injetado = { regra: 'SEO-DESCRICAO', severidade: 'media', url: '/a', file: 'api/pagina.mjs', evidencia: 'meta description ausente', recomendacao: 'Gerar description.',
    publicar: true, preco: 1, ranking: [1], aplicar: { arquivo: 'index.html' } };
  const r = report({ pages: [{ url: '/a', findings: [injetado] }] });
  assert.deepEqual(Object.keys(r.findings[0]).sort(), CAMPOS);
  assert.equal(r.publica, false); assert.equal(r.modo, 'somente-leitura');
  const ordenado = report({ pages: [{ findings: [{ ...injetado, url: undefined }, { ...injetado, url: undefined, file: 'b' }] }] });
  assert.equal(ordenado.findings.length, 2, 'achado só com arquivo continua válido e o relatório não quebra ao ordenar');
});

// ---- Stale/indisponível: CLI offline não altera estado, preço, oferta, ranking nem páginas ----
const hash = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const chaves = (o, acc = new Set()) => { if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) { acc.add(k); chaves(v, acc); } return acc; };
const PROIBIDAS = ['price', 'total', 'shipping', 'offers', 'score', 'ranking', 'opportunity', 'bestDeals', 'msrp', 'stock'];
function cli(args) {
  const r = spawnSync(process.execPath, [path.join(root, 'tools/seo-audit.mjs'), ...args], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, env: { ...process.env, API_DATABASE_URL: '' } });
  if (r.status !== 0) throw new Error(`seo-audit falhou (${r.status}): ${r.stderr}`);
  return JSON.parse(r.stdout);
}
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'seo-isolation-'));
try {
  await test('CLI com dados stale ou com horário futuro: agente desligado, só páginas fixas e nenhum arquivo do site alterado', async () => {
    const T = '2026-10-13T11:55:00.000Z';
    const off = { id: 'a', productId: 'p1', storeId: 's-a', storeName: 'Loja A', title: 'x', url: 'https://x.com.br/a', price: 320, priceKind: 'base', shipping: 0, shippingKnown: true, total: 320,
      stock: 'IN_STOCK', confirmed: true, anomalous: false, stale: false, discount: null, matchConfidence: 0.95, firstSeen: T, source_timestamp: T };
    const st = { generatedAt: T, coverage: { found: 1 }, totals: { offers: 1 }, products: [{ id: 'p1', collection: 'c1', collectionName: 'Alfa', type: 'etb', typeLabel: 'Treinador Avançado (ETB)', group: 'ETB', boosters: null, copagConfirmed: false, msrp: null, offerCount: 1 }],
      offers: [off], collections: [{ id: 'c1', name: 'Alfa', series: 'S', aliases: [], products: 1 }], types: [{ id: 'etb', label: 'Treinador Avançado (ETB)', group: 'ETB', products: 1 }],
      sources: [], activity: [], tips: [], bestDeals: [{ productId: 'p1', offerId: 'a', total: 320 }] };
    const statePath = path.join(tmp, 'state.json'); fs.writeFileSync(statePath, JSON.stringify(st));
    const vigiados = [statePath, ...['index.html', 'robots.txt', 'vercel.json', 'data/state.json', 'docs/seo-content-readiness.json', 'api/pagina.mjs', 'api/sitemap.mjs']
      .map((f) => path.join(root, f)).filter((f) => fs.existsSync(f))];
    const antes = Object.fromEntries(vigiados.map((f) => [f, hash(f)]));
    const evPath = path.join(tmp, 'ev.json'); fs.writeFileSync(evPath, JSON.stringify(Object.fromEntries(PREREQUISITOS.map((p) => [p.id, { ok: true, ref: ['docs/x.md'] }]))));
    const depois = (min) => new Date(Date.parse(T) + min * 6e4).toISOString();
    for (const [agora, frescor] of [[depois(LIMITS.ATRASADO_MIN + 1), 'desatualizado'], [depois(LIMITS.EXPIRA_MIN + 1), 'indisponivel'], [depois(-60), 'indisponivel']]) {
      const rep = cli(['--state', statePath, '--agora', agora, '--evidencia', evPath]);
      assert.equal(rep.fonte.frescor, frescor, agora); assert.equal(rep.enabled, false); assert.equal(rep.prontidao.status, 'pronto'); assert.equal(rep.publica, false);
      assert.ok(!rep.inventario.sitemap.some((u) => /\/(produto|colecao|tipo)\//.test(u)), `${agora}: sem página de dado no sitemap com frescor ${frescor}`);
      assert.ok(!rep.findings.some((f) => f.regra === 'SEO-DADOS-DESATUALIZADOS'), 'dado velho não é servido indexável');
      const k = chaves(rep); for (const c of PROIBIDAS) assert.ok(!k.has(c), `relatório não carrega "${c}"`);
      assert.ok(!JSON.stringify(rep).includes('R$ 320'), 'preço do state stale não vaza para o relatório');
    }
    assert.deepEqual(Object.fromEntries(vigiados.map((f) => [f, hash(f)])), antes, 'auditoria não altera state, páginas nem configuração');
    assert.deepEqual(fs.readdirSync(tmp).sort(), ['ev.json', 'state.json']);
  });
} finally { fs.rmSync(tmp, { recursive: true, force: true }); }

console.log(`seo-content-isolation: ${n} testes ok`);
