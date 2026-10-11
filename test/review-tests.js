// Fila de revisão humana: validação dos 24 casos iniciais, overrides de matching (desligados por
// padrão), autorização, idempotência, concorrência, auditoria e falhas. Banco só com TEST_DATABASE_URL.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync, spawnSync } from 'node:child_process';
import { matchProduct, applyOverride, overridesIndex, canonicalUrl } from '../src/match.js';
import { validateResolution, resolutionProduct, triage } from '../src/core/review.js';

let n = 0;
const test = async (name, fn) => { try { await fn(); n++; } catch (e) { console.error(`✗ ${name}`); throw e; } };
const catalog = JSON.parse(fs.readFileSync(new URL('../config/catalog.json', import.meta.url), 'utf8'));
const { cases } = JSON.parse(fs.readFileSync(new URL('./fixtures/review-initial-cases.json', import.meta.url), 'utf8'));
const item = (c) => ({ proposal: { kind: c.kind, store: c.store, title: c.title, url: c.url, parsed: c.parsed, productId: c.productId } });
const approvals = cases.filter((c) => c.suggestion.decision === 'approve');
const ovFile = (enabled) => ({ enabled, overrides: approvals.map((c) => ({ store: c.store, url: canonicalUrl(c.url), ...c.suggestion.resolution, productId: resolutionProduct(c.suggestion.resolution), reviewId: String(c.n) })) });

await test('24 casos iniciais: sugestões válidas, nenhuma passa por cima do catálogo', async () => {
  assert.equal(cases.length, 24);
  assert.deepEqual(Object.fromEntries(['approve', 'reject', 'conferir'].map((d) => [d, cases.filter((c) => c.suggestion.decision === d).length])), { approve: 17, reject: 4, conferir: 3 });
  for (const c of approvals) assert.equal(validateResolution(item(c), c.suggestion.resolution, catalog), null, `#${c.n} ${c.title}`);
  for (const c of cases.filter((x) => x.kind === 'baixa_confianca'))
    assert.equal(resolutionProduct(c.suggestion.resolution), c.productId, `#${c.n} confirma o produto atual`);
});

await test('override ligado leva cada anúncio aprovado ao produto certo; desligado não muda nada', async () => {
  const on = overridesIndex(ovFile(true)); const off = overridesIndex(ovFile(false));
  assert.equal(off.size, 0); assert.equal(overridesIndex({ overrides: ovFile(true).overrides }).size, 0, 'sem enabled: true explícito, nada vale');
  for (const c of cases) {
    const l = { title: c.title, url: c.url };
    const base = matchProduct(l, catalog);
    assert.deepEqual(applyOverride(l, c.store, base, catalog, off), base);
    const m = applyOverride(l, c.store, base, catalog, on);
    if (c.suggestion.decision !== 'approve') { assert.deepEqual(m, base, `#${c.n} sem aprovação não muda`); continue; }
    assert.equal(m.productId, resolutionProduct(c.suggestion.resolution), `#${c.n} ${c.title}`);
    if (c.kind === 'baixa_confianca') assert.deepEqual(m, base, `#${c.n} confirmação não altera a oferta nem a confiança`);
    else { assert.equal(m.confidence, 0.8); assert.equal(m.override, String(c.n)); }
    assert.deepEqual(applyOverride(l, 'outra-loja', base, catalog, on), base, 'override vale só para a loja e a página revisadas');
  }
});

await test('override nunca passa por cima de idioma, acessório, EAN ou coleção diferente', async () => {
  const c = cases.find((x) => x.n === 15); const res = c.suggestion.resolution;
  const idx = overridesIndex({ enabled: true, overrides: [{ store: 's', url: 'loja.com.br/p', ...res, productId: resolutionProduct(res), reviewId: '1' }] });
  const at = (title, extra = {}) => applyOverride({ title, url: 'https://www.loja.com.br/p?x=1', ...extra }, 's', matchProduct({ title, ...extra }, catalog), catalog, idx);
  assert.equal(at(c.title).productId, 'me05-box36', 'mesma página com query e www');
  assert.equal(at('Pokémon TCG Pack 36 Booster Escuridão Absoluta - Inglês').productId, null, 'idioma');
  assert.equal(at('Pokémon TCG PACK 36 BOOSTER Amigos de Jornada').productId, null, 'outra coleção no título');
  const ean = catalog.products.find((p) => p.ean);
  const idxE = overridesIndex({ enabled: true, overrides: [{ store: 's', url: 'loja.com.br/e', collection: ean.collection, type: ean.type, boosters: ean.boosters, productId: ean.id, reviewId: '2' }] });
  const lt = { title: 'Pokémon Box Display', url: 'https://loja.com.br/e', ean: '7890000000000' };
  assert.equal(applyOverride(lt, 's', matchProduct(lt, catalog), catalog, idxE).productId, null, 'EAN divergente continua recusado');
  const bad = overridesIndex({ enabled: true, overrides: [{ store: 's', url: 'loja.com.br/p', ...res, productId: 'me05-etb', reviewId: '3' }] });
  assert.equal(applyOverride({ title: c.title, url: 'https://loja.com.br/p' }, 's', matchProduct({ title: c.title }, catalog), catalog, bad).productId, null, 'productId que não confere é ignorado');
});

await test('validação da resolução', async () => {
  const it = item(cases[14]);
  assert.match(validateResolution(it, null, catalog), /obrigatória/);
  assert.match(validateResolution(it, { collection: 'xx', type: 'booster_box', boosters: 36 }, catalog), /coleção desconhecida/);
  assert.match(validateResolution(it, { collection: 'me05', type: 'pelucia' }, catalog), /tipo desconhecido/);
  assert.match(validateResolution(it, { collection: 'me05', type: 'booster_box' }, catalog), /quantidade/);
  assert.match(validateResolution(it, { collection: 'me05', type: 'booster_box', boosters: 99 }, catalog), /1 a 36/);
  assert.match(validateResolution(it, { collection: 'sv9', type: 'booster_box', boosters: 36 }, catalog), /diverge do anúncio/);
  assert.match(validateResolution(item(cases[20]), { collection: 'sv1', type: 'booster_box', boosters: 36 }, catalog), /diverge da oferta/);
});

await test('triagem agrupa o que pede a mesma decisão', async () => {
  const g = triage(cases.map((c) => ({ id: String(c.n), ...item(c) })));
  const ids = g.map((x) => x.ids.join(','));
  assert.ok(ids.includes('15,16') && ids.includes('14,17') && ids.includes('21,22,23'), JSON.stringify(g));
});

await test('robô lê o override só pelo arquivo, e o arquivo nasce desligado', async () => {
  const run = fs.readFileSync(new URL('../src/run.js', import.meta.url), 'utf8');
  assert.match(run, /overridesIndex\(readJson\(configPath\('matching-overrides\.json'\), \{\}\)\)/);
  assert.match(run, /applyOverride\(l, store\.id, matchProduct\(l, catalog\), catalog, overrides\)/);
  const f = JSON.parse(fs.readFileSync(new URL('../config/matching-overrides.json', import.meta.url), 'utf8'));
  assert.equal(f.enabled, false); assert.deepEqual(f.overrides, []);
  const wf = fs.readFileSync(new URL('../.github/workflows/review.yml', import.meta.url), 'utf8');
  const runs = wf.split('\n').filter((l) => !/^\s+(IN_[A-Z]+|REVIEW_[A-Z]+|DATABASE_URL):/.test(l)).join('\n');
  assert.doesNotMatch(runs, /\$\{\{\s*inputs\./, 'entradas só via env, nunca interpoladas no script');
  assert.match(wf, /REVIEW_ACTOR: \$\{\{ github\.actor \}\}/);
  assert.doesNotMatch(wf, /enabled.*true/, 'workflow não liga os overrides');
  const save = wf.slice(wf.indexOf('- name: Salvar overrides'));
  assert.match(save, /b="review\/overrides-\$\{RUN_ID\}"/); assert.match(save, /git push origin "\$b"/);
  assert.doesNotMatch(save, /origin main|git push\s*(&&|\n|$)|--force/, 'export nunca grava direto na main');
});

await test('ferramenta sem banco não faz nada', async () => {
  const env = { ...process.env }; delete env.DATABASE_URL;
  assert.equal(spawnSync('node', ['tools/review.mjs', 'list'], { env }).status, 2);
});

// ---------- banco ----------
let DB = false;
if (process.env.TEST_DATABASE_URL) {
  DB = true;
  process.env.DATABASE_URL = process.env.TEST_DATABASE_URL;
  const { pool, tx, close } = await import('../src/db/pg.js');
  const { decideReview, listPending, authorize, approvedOverrides } = await import('../src/core/review.js');
  const { pgReviewSink } = await import('../src/agents/handlers/review-propose.js');
  const p = await pool();
  const q = async (sql, a = []) => (await p.query(sql, a)).rows;
  await p.query('DROP SCHEMA IF EXISTS hunter CASCADE');
  execFileSync('node', ['tools/db-migrate.mjs'], { env: process.env, stdio: 'pipe' });
  const sink = pgReviewSink(p);
  const ids = {};
  for (const c of cases) ids[c.n] = String((await sink.propose({ category: 'matching', entityType: 'listing', entityId: c.store, confidence: null, dedupeKey: c.dedupeKey, proposal: item(c).proposal })).id);
  const ops = ['TonyWatanabe-dev'];
  const tony = { github: 'tonywatanabe-dev' };
  const decide = (o) => tx((c) => decideReview(c, { catalog, operators: ops, actor: tony, ...o }));
  const events = async (id) => q(`SELECT payload FROM system_event WHERE type = 'REVIEW_DECIDED' AND entity_id = $1`, [id]);
  const guarded = async () => JSON.stringify(await Promise.all(['offer', 'price_history', 'price_daily', 'product_stats', 'opportunity', 'reference_price'].map((t) => q(`SELECT count(*)::int c FROM ${t}`))));
  const before = await guarded();

  await test('autorização: sem autor, fora da lista e papel sem permissão são recusados', async () => {
    for (const actor of [null, { github: 'outra-pessoa' }, { github: '' }])
      await assert.rejects(decide({ id: ids[4], decision: 'reject', reason: 'case', actor }), (e) => e.code === 'forbidden');
    const [u1] = await q(`INSERT INTO app_user (external_uid, email) VALUES ('v1', 'viewer@x') RETURNING id`);
    const [u2] = await q(`INSERT INTO app_user (external_uid, email) VALUES ('o1', 'op@x') RETURNING id`);
    await q(`INSERT INTO user_role (user_id, role_id) VALUES ($1, 'VIEWER'), ($2, 'OPERATOR')`, [u1.id, u2.id]);
    await assert.rejects(decide({ id: ids[4], decision: 'reject', reason: 'case', actor: { userId: u1.id } }), (e) => e.code === 'forbidden');
    assert.equal((await authorize(p, { userId: u1.id }, 'review.read')).userId, u1.id, 'viewer lê');
    assert.equal((await q(`SELECT status FROM review_item WHERE id = $1`, [ids[4]]))[0].status, 'open');
    const r = await decide({ id: ids[4], decision: 'reject', reason: 'case de blisters, várias unidades', actor: { userId: u2.id } });
    assert.equal(r.item.decided_by, u2.id); assert.equal(r.item.decided_by_label, 'user:op@x');
  });

  await test('aprovação: decisão rastreável, resolução validada, um evento', async () => {
    const r = await decide({ id: ids[15], decision: 'approve', reason: '36 boosters Escuridão Absoluta', resolution: { collection: 'me05', type: 'booster_box', boosters: 36 } });
    assert.equal(r.changed, true);
    const [row] = await q(`SELECT status, decided_at, decision_reason, decided_by_label, resolution FROM review_item WHERE id = $1`, [ids[15]]);
    assert.equal(row.status, 'approved'); assert.ok(row.decided_at); assert.equal(row.decided_by_label, 'github:tonywatanabe-dev');
    assert.equal(row.resolution.productId, 'me05-box36');
    const ev = await events(ids[15]);
    assert.equal(ev.length, 1);
    assert.deepEqual({ ...ev[0].payload, resolution: ev[0].payload.resolution.productId }, { category: 'matching', kind: 'tipo_desconhecido', from_status: 'open', to_status: 'approved',
      reason: '36 boosters Escuridão Absoluta', decided_by: 'github:tonywatanabe-dev', resolution: 'me05-box36', source: 'review' });
  });

  await test('idempotência: repetir não gera evento; decisão diferente é recusada', async () => {
    const again = await decide({ id: ids[15], decision: 'approve', reason: 'de novo', resolution: { collection: 'me05', type: 'booster_box', boosters: 36 } });
    assert.equal(again.changed, false);
    await assert.rejects(decide({ id: ids[15], decision: 'reject', reason: 'mudei de ideia' }), (e) => e.code === 'already_decided');
    await assert.rejects(decide({ id: ids[15], decision: 'approve', reason: 'outro produto', resolution: { collection: 'me05', type: 'etb' } }), (e) => e.code === 'already_decided');
    assert.equal((await events(ids[15])).length, 1);
    assert.equal((await q(`SELECT decision_reason FROM review_item WHERE id = $1`, [ids[15]]))[0].decision_reason, '36 boosters Escuridão Absoluta');
  });

  await test('concorrência: duas decisões simultâneas, só uma vale', async () => {
    for (const n of [16, 19, 12]) {
      const res = { collection: cases[n - 1].suggestion.resolution.collection, type: 'booster_box', boosters: 36 };
      const out = await Promise.allSettled([
        decide({ id: ids[n], decision: 'approve', reason: 'aprovar', resolution: res }),
        decide({ id: ids[n], decision: 'reject', reason: 'rejeitar', actor: tony }),
        decide({ id: ids[n], decision: 'dismiss', reason: 'descartar' }),
      ]);
      assert.equal(out.filter((o) => o.status === 'fulfilled' && o.value.changed).length, 1, `#${n} ${JSON.stringify(out.map((o) => o.status))}`);
      assert.ok(out.filter((o) => o.status === 'rejected').every((o) => o.reason.code === 'already_decided'));
      assert.equal((await events(ids[n])).length, 1);
    }
  });

  await test('falhas não deixam decisão pela metade', async () => {
    await assert.rejects(decide({ id: ids[2], decision: 'approve', reason: 'errado', resolution: { collection: 'sv9', type: 'booster_box', boosters: 36 } }), (e) => e.code === 'invalid_resolution');
    await assert.rejects(decide({ id: '999999', decision: 'reject', reason: 'x y z' }), (e) => e.code === 'not_found');
    await assert.rejects(decide({ id: ids[2], decision: 'reject', reason: '' }), (e) => e.code === 'invalid');
    await assert.rejects(decide({ id: ids[2], decision: 'aprovar', reason: 'x y z' }), (e) => e.code === 'invalid');
    await assert.rejects(decide({ id: 'abc', decision: 'reject', reason: 'x y z' }), (e) => e.code === 'invalid');
    const [{ id: pa }] = await q(`INSERT INTO review_item (category, dedupe_key) VALUES ('price_anomaly', 'pa:1') RETURNING id`);
    await assert.rejects(decide({ id: String(pa), decision: 'approve', reason: 'x y z', resolution: {} }), /caminho validado/);
    // falha no meio (evento de auditoria não grava): a transação inteira volta
    const flaky = (c) => ({ query: (sql, a) => (/INSERT INTO system_event/.test(sql) ? Promise.reject(new Error('disco cheio')) : c.query(sql, a)) });
    await assert.rejects(tx((c) => decideReview(flaky(c), { id: ids[2], decision: 'reject', reason: 'x y z', actor: tony, operators: ops, catalog })), /disco cheio/);
    assert.equal((await q(`SELECT status FROM review_item WHERE id = $1`, [ids[2]]))[0].status, 'open');
    assert.equal((await events(ids[2])).length, 0);
  });

  await test('fila, exportação e CLI fecham o ciclo sem tocar em preço ou oportunidade', async () => {
    assert.equal((await listPending(p, { category: 'matching' })).length, 24 - 5);
    // corrompe uma resolução gravada: a exportação revalida e deixa de fora
    await decide({ id: ids[24], decision: 'approve', reason: 'confirma', resolution: { collection: 'sv1', type: 'booster_box', boosters: 36 } });
    await q(`UPDATE review_item SET resolution = jsonb_set(resolution, '{productId}', '"sv1-etb"') WHERE id = $1`, [ids[24]]);
    const { overrides, skipped } = await approvedOverrides(p, catalog);
    const approved = (await q(`SELECT id FROM review_item WHERE status = 'approved' AND id <> $1 ORDER BY id`, [ids[24]])).map((r) => String(r.id));
    assert.deepEqual(overrides.map((o) => o.reviewId), approved, 'exatamente as aprovações válidas (vencedores da concorrência incluídos)');
    assert.ok(overrides.some((o) => o.reviewId === ids[15] && o.productId === 'me05-box36'));
    assert.ok(overrides.every((o) => o.store && o.url && !o.url.startsWith('http')));
    assert.deepEqual(skipped.map((s) => s.id), [ids[24]]);
    // CLI: operador fora da lista não decide; operador decide; export grava o arquivo sem ligar
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rev-')); const out = path.join(dir, 'ov.json');
    fs.writeFileSync(out, JSON.stringify({ _nota: 'x', enabled: false, overrides: [] }));
    const cli = (args, actor = 'TonyWatanabe-dev') => spawnSync('node', ['tools/review.mjs', ...args], { encoding: 'utf8', env: { ...process.env, REVIEW_ACTOR: actor, REVIEW_OPERATORS: 'TonyWatanabe-dev' } });
    const no = cli(['reject', ids[18], '--reason', 'tipo indeterminável'], 'intruso');
    assert.equal(no.status, 1); assert.match(no.stdout, /forbidden/);
    assert.equal(cli(['export', '--out', out], 'intruso').status, 3);
    const ok = cli(['reject', `${ids[18]},${ids[18]}`, '--reason', 'tipo indeterminável']);
    assert.equal(ok.status, 0, ok.stdout + ok.stderr); assert.match(ok.stdout, /rejected\n.*já estava assim/);
    const ap = cli(['approve', ids[6], '--collection', 'me02', '--type', 'booster_pack', '--reason', 'booster unitário']);
    assert.equal(ap.status, 0, ap.stdout + ap.stderr); assert.match(ap.stdout, /me02-booster/);
    assert.match(cli(['triage']).stdout, /grupos que pedem a mesma decisão/);
    const ex = cli(['export', '--out', out]);
    assert.equal(ex.status, 0, ex.stderr); assert.match(ex.stdout, /enabled: false/);
    const f = JSON.parse(fs.readFileSync(out, 'utf8'));
    assert.equal(f.enabled, false); assert.equal(f._nota, 'x'); assert.ok(f.overrides.some((o) => o.productId === 'me02-booster' && o.reviewId === ids[6]));
    fs.rmSync(dir, { recursive: true });
    assert.equal(await guarded(), before, 'oferta, preço, estatística, referência e oportunidade intactos');
  });

  await p.query('DROP SCHEMA IF EXISTS hunter CASCADE');
  await close();
}
console.log(`✓ Revisão humana: ${n} grupos de testes passaram${DB ? ' (puro + banco)' : ' (puro)'}`);

// Regressão do matching de selados (issue #42), sem nova linha no package.json.
await import('./sealed-matching-tests.js');
