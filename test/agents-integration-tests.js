// Integração dos agentes com a rodada do robô: seleção de revisões, avisos sem duplicar, ciclo que
// nunca derruba a rodada e passo do workflow. Parte com banco só roda com TEST_DATABASE_URL.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { reviewCandidates, canonicalUrl } from '../src/agents/matching-review.js';
import { composeAgentAlert } from '../src/agents/notify.js';
import { runAgentCycle } from '../src/agents/cycle.js';
import { validateReviewProposal } from '../src/agents/handlers/review-propose.js';

let n = 0;
const test = async (name, fn) => { try { await fn(); n++; } catch (e) { console.error(`✗ ${name}`); throw e; } };
const catalog = JSON.parse(fs.readFileSync(new URL('../config/catalog.json', import.meta.url), 'utf8'));
const U = (store, title, why, url = `https://${store}.com.br/p/${encodeURIComponent(title).slice(0, 40)}`) => ({ store, title, url, why: [why] });
const unmatched = [
  U('pbkids', 'POKEMON TCG PACK 36 BOOSTER POKEMON ESCURIDAO ABSOLUTA - COPAG', 'tipo de produto não identificado'),
  U('gatogingado', 'Booster Box ME02 Fogo Fantasmagórico Pokémon TCG', 'quantidade de boosters não informada'),
  U('loja', 'Pokémon Box Megaevolução Escuridão Absoluta', 'mais de uma coleção no título: me01, me05'),
  U('loja', 'Pokémon ETB Escuridão Absoluta', 'EAN diverge do catálogo'),
  U('ruido', 'Pelúcia Pikachu Pokémon', 'coleção não identificada'),                    // ruído: fora
  U('ruido', 'Pokémon Deck em inglês', 'idioma diferente de PT'),                        // recusa legítima: fora
  { store: 'dois', title: 'Kit Pokémon', url: 'https://dois.com.br/k', why: ['acessório ou item não-TCG', 'tipo de produto não identificado'] }, // dois motivos: fora
  { store: 'semurl', title: 'Pokémon Box', url: null, why: ['tipo de produto não identificado'] },                                              // sem URL: fora
];
unmatched.push({ ...unmatched[0], url: unmatched[0].url.replace('https://', 'https://www.') + '/?utm=x' }); // mesma página: fora
const offerFx = (id, conf, extra = {}) => ({ id, productId: 'me05-etb', storeId: 'omni', title: 'Megaevolução - Caixa de Booster - Pokémon', url: `https://omni.com.br/${id}`, matchConfidence: conf, ...extra });

await test('seleção: só casos com evidência, um por página, chave estável', async () => {
  const state = { unmatched, offers: [offerFx('o1', 0.6), offerFx('o2', 0.7), offerFx('o3', 0.85), offerFx('o4', 0.6, { productId: null })] };
  const c = reviewCandidates(state, { catalog });
  assert.deepEqual(c.map((x) => x.payload.proposal.kind), ['tipo_desconhecido', 'boosters_desconhecidos', 'colecao_ambigua', 'ean_divergente', 'baixa_confianca']);
  assert.ok(c.every((x) => validateReviewProposal(x.payload) === null), 'payload passa a validação do handler');
  assert.ok(c.every((x) => x.idempotencyKey === `review:${x.payload.dedupeKey}` && x.payload.dedupeKey.length <= 200));
  assert.deepEqual(c[0].payload.proposal.parsed, { collection: 'me05', type: null, boosters: null }, 'proposta traz o que o matching entendeu (e onde ele parou)');
  assert.equal(c[4].payload.confidence, 60); assert.equal(c[4].payload.entityType, 'offer');
  assert.deepEqual(reviewCandidates(state, { catalog }).map((x) => x.idempotencyKey), c.map((x) => x.idempotencyKey), 'determinístico');
  assert.equal(reviewCandidates(state, { limit: 2 }).length, 2);
  assert.equal(canonicalUrl('https://www.Loja.com.br/a/?x=1#y'), 'loja.com.br/a');
  assert.deepEqual(reviewCandidates({}), []);
});

await test('aviso agregado; nada a avisar = nenhuma mensagem', async () => {
  assert.equal(composeAgentAlert([]), null);
  const m = composeAgentAlert([
    { type: 'AGENT_JOB_FAILED', payload: { type: 'review.propose', error: 'payload inválido: x' } },
    { type: 'AGENT_JOB_FAILED', payload: { type: 'review.propose', error: 'payload inválido: x' } },
    { type: 'AGENT_JOB_BLOCKED', payload: { type: 'alert.compose', error: 'sem handler registrado' } },
  ]);
  assert.equal(m.kind, 'falha');
  assert.match(m.text, /2× review\.propose — payload inválido: x/); assert.match(m.text, /1× alert\.compose — sem handler/);
  assert.match(m.text, /Preços e coleta não foram afetados/);
});

await test('ciclo nunca lança: banco quebrado vira relatório com erro', async () => {
  const broken = { query: async () => { throw new Error('conexão recusada'); } };
  const sent = [];
  const r = await runAgentCycle({ db: broken, state: { unmatched }, catalog, send: async (m) => { sent.push(m); return { delivered: true }; } });
  assert.equal(r.ok, false); assert.equal(r.enqueued, 0); assert.equal(sent.length, 0);
  assert.ok(r.errors.some((e) => /enfileirar: conexão recusada/.test(e)) && r.errors.some((e) => /avisar/.test(e)));
});

await test('ferramenta sempre sai com 0 (sem banco e com banco inacessível)', async () => {
  const env = { ...process.env }; delete env.DATABASE_URL;
  const off = spawnSync('node', ['tools/agents-run.mjs', 'data'], { env, encoding: 'utf8' });
  assert.equal(off.status, 0); assert.match(off.stdout, /Banco desligado/);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'agents-')); fs.writeFileSync(`${tmp}/state.json`, JSON.stringify({ unmatched }));
  const down = spawnSync('node', ['tools/agents-run.mjs', tmp], { env: { ...env, DATABASE_URL: 'postgres://x@127.0.0.1:1/x' }, encoding: 'utf8', timeout: 30_000 });
  assert.equal(down.status, 0); assert.match(down.stdout, /::warning::Agentes/);
  const bad = spawnSync('node', ['tools/agents-run.mjs', '/nao/existe'], { env: { ...env, DATABASE_URL: 'postgres://x@127.0.0.1:1/x' }, encoding: 'utf8' });
  assert.equal(bad.status, 0); assert.match(bad.stdout, /::warning::Agentes não rodaram/);
  fs.rmSync(tmp, { recursive: true });
});

await test('workflow: passo depois do banco, antes de salvar config, tolerante e com prazo', async () => {
  const y = fs.readFileSync(new URL('../.github/workflows/hunter.yml', import.meta.url), 'utf8');
  const iSync = y.indexOf('- name: Sincronizar com o banco'); const iAg = y.indexOf('- name: Agentes (fila de revisão)'); const iCfg = y.indexOf('- name: Salvar configuração');
  assert.ok(iSync > 0 && iAg > iSync && iCfg > iAg, 'ordem: banco → agentes → salvar configuração');
  const step = y.slice(iAg, iCfg);
  assert.match(step, /continue-on-error: true/); assert.match(step, /timeout-minutes: 2/);
  assert.match(step, /if: steps\.gap\.outputs\.skip != 'true'/); assert.match(step, /node tools\/agents-run\.mjs data/);
  assert.doesNotMatch(step, /AI_AGENTS_ENABLED|ANTHROPIC|OPENAI/, 'IA continua desligada');
  assert.match(y, /concurrency:\s*\n\s*group: hunter\s*\n\s*cancel-in-progress: false/, 'rodadas serializadas');
});

// ---------- fluxo completo no PostgreSQL ----------
let DB = false;
if (process.env.TEST_DATABASE_URL) {
  DB = true;
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  const { pool, tx, close } = await import('../src/db/pg.js');
  const { syncState } = await import('../src/core/sync.js');
  const { runPriceEngine } = await import('../src/core/price-stats.js');
  const { runOpportunityEngine } = await import('../src/core/opportunity-run.js');
  const { createOrchestrator } = await import('../src/agents/orchestrator.js');
  const { pgStore } = await import('../src/agents/stores.js');
  const p = await pool();
  const q = async (sql, a = []) => (await p.query(sql, a)).rows;
  await p.query('DROP SCHEMA IF EXISTS hunter CASCADE');
  execFileSync('node', ['tools/db-migrate.mjs'], { env: process.env, stdio: 'pipe' });

  // rodada sintética no formato do state.json (mesmo molde de test/opportunity-db-tests.js)
  const cat = { collections: [{ id: 'me05', name: 'Escuridão Absoluta', series: 'Megaevolução' }] };
  const prod = { id: 'me05-etb', collection: 'me05', collectionName: 'Escuridão Absoluta', type: 'etb', typeLabel: 'Treinador Avançado (ETB)', group: 'ETB', boosters: 9,
    copagConfirmed: true, msrp: 400, copag: { source_url: 'https://www.copagloja.com.br/etb/p', confidence: 'OFICIAL', source_timestamp: '2026-10-08T10:00:00Z' } };
  const mk = (id, storeId, price, conf) => ({ id, productId: 'me05-etb', storeId, title: 'Escuridão Absoluta - Caixa de Booster - Pokémon', url: `https://${storeId}.com.br/etb`, price, total: price,
    shipping: null, shippingKnown: false, stock: 'IN_STOCK', matchConfidence: conf, firstSeen: '2026-10-05T10:00:00Z', source_timestamp: '2026-10-09T12:00:00Z' });
  const state = { collections: [], products: [prod], sources: ['a', 'b'].map((id) => ({ id, name: id, url: `https://${id}.com.br`, status: 'ACTIVE' })), reputation: {},
    offers: [mk('oa', 'a', 380, 0.85), mk('ob', 'b', 360, 0.6)], unmatched };
  await tx((c) => syncState(c, { state, catalog: cat, historyLines: [] }));
  await tx((c) => runPriceEngine(c, { asOf: new Date('2026-10-10T12:00:00Z') }));
  await tx((c) => runOpportunityEngine(c, { now: new Date('2026-10-10T12:05:00Z') }));
  const snapshot = async () => JSON.stringify({
    offer: await q('SELECT * FROM offer ORDER BY id'), opp: await q('SELECT * FROM opportunity ORDER BY offer_id'),
    ph: await q('SELECT count(*)::int c FROM price_history'), pd: await q('SELECT * FROM price_daily ORDER BY 1, 2'), ps: await q('SELECT * FROM product_stats ORDER BY 1'),
    others: await q(`SELECT id, status, dedupe_key FROM review_item WHERE dedupe_key NOT LIKE 'matching:%' ORDER BY id`),
  });
  const before = await snapshot();
  const sent = [];
  const send = async (m) => { sent.push(m); return { delivered: true }; };
  let t = Date.parse('2026-10-10T12:10:00Z'); const now = () => new Date(t);
  const cycle = (o = {}) => runAgentCycle({ db: p, state, catalog, send, now, workerId: 'hunter-test', ...o });

  await test('fluxo: revisões abertas uma vez, preço/oferta/oportunidade intactos', async () => {
    const r1 = await cycle();
    assert.equal(r1.ok, true, r1.errors.join()); assert.equal(r1.candidates, 5); assert.equal(r1.enqueued, 5);
    assert.equal(r1.runs.reduce((a, s) => a + s.completed, 0), 5); assert.deepEqual(r1.notify, { events: 0, delivered: null });
    const items = await q(`SELECT category, status, entity_type, proposal->>'kind' AS kind FROM review_item WHERE dedupe_key LIKE 'matching:%' ORDER BY id`);
    assert.equal(items.length, 5); assert.ok(items.every((i) => i.category === 'matching' && i.status === 'open'));
    assert.deepEqual(items.filter((i) => i.entity_type === 'offer').map((i) => i.kind), ['baixa_confianca']);
    assert.equal(await snapshot(), before, 'agentes não tocaram em oferta, preço, estatística nem oportunidade');
    assert.equal(sent.length, 0);
  });

  await test('rodadas repetidas: nenhum job, revisão ou aviso novo', async () => {
    for (let i = 0; i < 3; i++) { t += 15 * 60_000; const r = await cycle(); assert.equal(r.enqueued, 0); assert.equal(r.runs[0].claimed, 0); }
    assert.equal((await q('SELECT count(*)::int c FROM review_item WHERE dedupe_key LIKE \'matching:%\''))[0].c, 5);
    assert.equal((await q(`SELECT count(*)::int c FROM automation_job WHERE type = 'review.propose'`))[0].c, 5);
    // revisão já decidida não volta a ser proposta enquanto o anúncio continuar igual
    await p.query(`UPDATE review_item SET status = 'rejected', decided_at = now() WHERE dedupe_key LIKE 'matching:%'`);
    await p.query(`DELETE FROM automation_job`);              // mesmo se a fila for limpa
    t += 15 * 60_000; const r = await cycle();
    assert.equal(r.enqueued, 5); assert.equal((await q('SELECT count(*)::int c FROM review_item WHERE dedupe_key LIKE \'matching:%\''))[0].c, 5);
    assert.equal((await q(`SELECT count(*)::int c FROM review_item WHERE status = 'open' AND dedupe_key LIKE 'matching:%'`))[0].c, 0);
    assert.equal(sent.length, 0);
  });

  await test('eventos operacionais: um aviso por evento novo, sem duplicar, e reenvio se não entregou', async () => {
    const orch = createOrchestrator({ store: pgStore(p), now, workerId: 'outro', handlers: [] });
    const aiOrch = createOrchestrator({ store: pgStore(p), now, workerId: 'ai', aiEnabled: false, handlers: [{ type: 'catalog.ai', ai: true, run: async () => ({}) }] });
    await orch.enqueue({ type: 'catalog.ai', idempotencyKey: 'x:ai' });
    assert.equal((await aiOrch.runOnce()).blocked, 1);                                                     // evento ai_disabled
    await orch.enqueue({ type: 'alert.compose', idempotencyKey: 'x:sem-handler' });                       // vira blocked
    await orch.enqueue({ type: 'review.propose', idempotencyKey: 'x:invalido', payload: { category: 'preco' } }); // vira failed
    t += 60_000;
    const r1 = await cycle();
    assert.equal(sent.length, 1, 'um aviso agregado');
    assert.match(sent[0].text, /review\.propose — payload inválido/); assert.match(sent[0].text, /alert\.compose — sem handler/);
    assert.doesNotMatch(sent[0].text, /ai_disabled/, 'IA desligada é estado esperado, não alerta');
    assert.equal(r1.notify.delivered, true);
    t += 15 * 60_000; await cycle(); await cycle();
    assert.equal(sent.length, 1, 'nada novo = nenhum aviso');
    // falha nova com canal fora do ar: não marca como avisado; próxima rodada entrega uma vez
    await orch.enqueue({ type: 'alert.compose', idempotencyKey: 'x:sem-handler-2' });
    t += 60_000;
    const down = await runAgentCycle({ db: p, state, catalog, now, workerId: 'hunter-test', send: async () => ({ delivered: false }) });
    assert.deepEqual(down.notify, { events: 1, delivered: false });
    t += 15 * 60_000; await cycle(); await cycle();
    assert.equal(sent.length, 2); assert.match(sent[1].text, /1× alert\.compose/); assert.doesNotMatch(sent[1].text, /payload inválido/);
  });

  await test('prazo do ciclo: para entre lotes e o resto fica para a próxima rodada', async () => {
    await p.query(`DELETE FROM review_item WHERE dedupe_key LIKE 'matching:%'; DELETE FROM automation_job`);
    let fake = 0; const r = await cycle({ clock: () => (fake += 30_000), opts: { batch: 2, deadlineMs: 45_000 } });
    assert.equal(r.enqueued, 5); assert.equal(r.runs.length, 1); assert.equal(r.runs[0].completed, 2);
    assert.equal((await q(`SELECT count(*)::int c FROM automation_job WHERE status = 'pending'`))[0].c, 3);
    t += 15 * 60_000; await cycle();
    assert.equal((await q(`SELECT count(*)::int c FROM review_item WHERE dedupe_key LIKE 'matching:%'`))[0].c, 5);
  });

  await p.query('DROP SCHEMA IF EXISTS hunter CASCADE');
  await close();
}

console.log(`✓ Integração dos agentes: ${n} grupos de testes passaram${DB ? ' (puro + banco)' : ' (puro)'}`);

// Contrato de evidência das decisões dos agentes (issue #91)
await import('./agent-evidence-tests.js');
