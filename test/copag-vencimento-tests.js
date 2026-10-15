// Aviso antecipado de vencimento da referência Copag oficial (copag_vencendo). Datas fixas, sem rede e sem banco.
// Cobre: quem vence e quando (a partir do import da auditoria), o efeito ao vencer (cai para mercado/NONE), o resumo da
// rodada (meta.json → ops.last.copag), o vigia (aviso separado, sem mudar estado, nota ou ranking) e a leitura no banco.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { copagExpiringSoon, copagExpiresAt, copagExpired, resolveCurrentReference, COPAG_EVIDENCE_SOURCES, COPAG_MAX_AGE_DAYS, COPAG_WARN_DAYS }
  from '../src/core/references.js';
import { copagSummary, buildRunRecord, mergeOps } from '../src/opstate.js';
import { evaluate, decide, decideWarning, commitWarning, commitLedger, RULES } from '../src/ops-watch.js';
import { readDbHealth, syncStatus } from '../src/db-health.js';
import { referenceRows } from '../src/core/mappers.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let n = 0;
async function t(name, fn) { try { await fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } }
const imp = JSON.parse(fs.readFileSync(path.join(root, 'db/reference-imports/2026-10-08-copag-audit.json'), 'utf8'));
const LOJA = (s) => `https://www.copagloja.com.br/${s}/p`;
const cur = (legacy_id, verified_at, x = {}) => ({ legacy_id, reference_kind: 'COPAG_OFFICIAL_CURRENT', verification_status: 'verified', value: 399.99,
  source: 'copag_loja', source_url: LOJA(legacy_id), verified_at, ...x });
const importRows = imp.entries.map((e) => ({ ...e }));   // linhas como o import grava (legacy_id, kind, status, fonte, URL, verified_at)
const ids = (xs) => xs.map((x) => x.id);

await t('1. medição: no import da auditoria, só me04-box36 e me05-blister3 são Copag atual verificada; vencem em 2026-11-07T00:00Z', () => {
  const verified = imp.entries.filter((e) => e.reference_kind === 'COPAG_OFFICIAL_CURRENT' && e.verification_status === 'verified');
  assert.deepEqual(verified.map((e) => e.legacy_id).sort(), ['me04-box36', 'me05-blister3']);
  for (const e of verified) { assert.equal(e.source, 'copag_loja_catalog'); assert.equal(copagExpiresAt(e.verified_at), '2026-11-07T00:00:00.000Z'); }
  // as pendentes (me01, me03, me05 Greninja) nunca entram na view: não vencem, nem avisam
  assert.deepEqual(imp.entries.filter((e) => e.reference_kind === 'COPAG_OFFICIAL_CURRENT' && e.verification_status !== 'verified').map((e) => e.legacy_id).sort(),
    ['me01-colecao_ex-mega-gengar', 'me03-colecao_ex-mega-zygarde', 'me05-colecao_ex-mega-greninja']);
});

await t('1b. cadastros manuais c30-* do catálogo (Instagram) não são Copag oficial no motor: não entram na janela', () => {
  const cat = JSON.parse(fs.readFileSync(path.join(root, 'config/catalog.json'), 'utf8'));
  // desde 15/10/2026 (decisão do proprietário) são COMUNIDADE: viram referência pendente 'internet', nunca verificada
  const c30 = Object.entries(cat.copag || {}).filter(([k, c]) => k.startsWith('c30-') && /instagram\.com/.test(c.source_url));
  assert.equal(c30.length, 12);
  const rows = referenceRows(c30.map(([id, c]) => ({ id, copagConfirmed: false, msrp: null, copagReference: c.msrp, copagReferenceUrl: c.source_url, copag: c })));
  assert.equal(rows.length, c30.length);
  for (const r of rows) { assert.equal(r.reference_kind, 'COMMUNITY_REFERENCE', r.legacy_id); assert.equal(r.source, 'internet'); assert.equal(r.verification_status, 'pending'); }
  assert.deepEqual(copagExpiringSoon(rows.map((r) => ({ ...r, verified_at: '2026-10-07T00:00:00Z' })), '2026-11-05T00:00:00Z'), []);
});

await t('2. janela do aviso: 7 dias antes (inclusive) até o instante do vencimento; fora disso, nada', () => {
  assert.equal(COPAG_WARN_DAYS, 7); assert.equal(COPAG_MAX_AGE_DAYS, 30);
  assert.deepEqual(copagExpiringSoon(importRows, '2026-10-11T12:00:00Z'), [], 'hoje (27 dias de folga): sem aviso');
  assert.deepEqual(copagExpiringSoon(importRows, '2026-10-30T23:59:59Z'), [], 'um segundo antes da janela');
  const at7 = copagExpiringSoon(importRows, '2026-10-31T00:00:00Z');
  assert.deepEqual(ids(at7), ['me04-box36', 'me05-blister3']); assert.equal(at7[0].days_left, 7);
  assert.equal(at7[0].expires_at, '2026-11-07T00:00:00.000Z'); assert.equal(at7[0].verified_at, '2026-10-08T00:00:00.000Z');
  assert.deepEqual(at7.map((x) => x.prices), [[449.99], [42.99]]);
  assert.equal(copagExpiringSoon(importRows, '2026-11-06T12:00:00Z')[1].days_left, 0.5);
  assert.deepEqual(ids(copagExpiringSoon(importRows, '2026-11-07T00:00:00Z')), ['me04-box36', 'me05-blister3'], 'no instante exato ainda vale (mesma regra da view)');
  assert.deepEqual(copagExpiringSoon(importRows, '2026-11-07T00:00:01Z'), [], 'vencida: não é mais "vencendo"');
  assert.deepEqual(ids(copagExpiringSoon(importRows, '2026-10-20T00:00:00Z', { days: 20 })), ['me04-box36', 'me05-blister3'], 'antecedência configurável');
});

await t('3. efeito ao vencer: a mesma linha deixa de ser referência Copag e o produto cai para mercado ou NONE', () => {
  const row = { ...importRows.find((e) => e.legacy_id === 'me04-box36') };
  const market = { ok: true, price: 420, confidence: 0.7, reason: 'robust_current_market' };
  const before = resolveCurrentReference({ copag: row, market, asOf: '2026-11-07T00:00:00Z' });
  assert.equal(before.kind, 'COPAG_OFFICIAL_CURRENT'); assert.equal(before.price, 449.99);
  const after = resolveCurrentReference({ copag: row, market, asOf: '2026-11-07T00:00:01Z' });
  assert.equal(after.kind, 'MARKET_CURRENT'); assert.equal(after.price, 420); assert.equal(after.copag_expired_verified_at, row.verified_at);
  const none = resolveCurrentReference({ copag: row, market: { ok: false, reason: 'insufficient_offers' }, asOf: '2026-11-07T00:00:01Z' });
  assert.equal(none.kind, 'NONE'); assert.equal(none.price, null);
  assert.equal(copagExpired(row.verified_at, '2026-11-07T00:00:01Z'), true);
});

await t('4. só evidência que a view aceita: fonte da loja Copag/manual, URL Copag, verificada; captura renovada não avisa', () => {
  const asOf = '2026-11-01T00:00:00Z';
  const rows = [
    cur('me05-etb', '2026-10-31T23:45:00Z'),                                                        // captura do robô, renovada: vence só em 30/11
    cur('c30-etb', '2026-10-07T00:00:00Z', { source: 'manual', source_url: 'https://www.instagram.com/voltztcg/' }), // manual fora da Copag: a view recusa
    cur('sv9-etb', '2026-10-07T00:00:00Z', { source: 'internet' }),                               // fonte não aceita
    cur('sv8-etb', '2026-10-07T00:00:00Z', { verification_status: 'pending' }),                   // não verificada
    cur('sv7-etb', '2026-10-07T00:00:00Z', { reference_kind: 'COPAG_OFFICIAL_HISTORICAL' }),      // histórica
    cur('sv6-etb', '2026-10-07T00:00:00Z', { value: 0 }),                                         // sem preço
    cur('me04-etb', '2026-10-07T00:00:00Z'),                                                      // loja Copag, vence 06/11: avisa
    cur('me03-etb', '2026-10-05T00:00:00Z'), cur('me03-etb', '2026-10-30T00:00:00Z', { source: 'copag_loja_catalog' }), // a mais recente vale: sem aviso
    cur('sv5-etb', '2026-09-01T00:00:00Z'),                                                       // já vencida: não é "vencendo"
    cur('me02-etb', '2026-10-07T00:00:00Z', { source: 'manual', source_url: 'https://copag.com.br/pokemon/x' }), // manual com URL Copag: a view aceita
  ];
  const out = copagExpiringSoon(rows, asOf);
  assert.deepEqual(ids(out), ['me02-etb', 'me04-etb']);
  assert.deepEqual(copagExpiringSoon([], asOf), []); assert.deepEqual(copagExpiringSoon(null, asOf), []);
  assert.deepEqual(copagExpiringSoon(rows, 'não é data'), []);
  // conflito de preços dentro da validade também avisa (os dois preços vão juntos), pela verificação mais recente
  const conf = copagExpiringSoon([cur('me06-etb', '2026-10-06T00:00:00Z', { value: 399.99 }), cur('me06-etb', '2026-10-07T00:00:00Z', { value: 379.99 })], asOf);
  assert.deepEqual(conf.map((x) => [x.id, x.expires_at, x.prices]), [['me06-etb', '2026-11-06T00:00:00.000Z', [379.99, 399.99]]]);
});

await t('5. regra espelhada da migration 010 (fontes e janela), sem alterar a view', () => {
  const sql = fs.readFileSync(path.join(root, 'db/migrations/010_reference_evidence.sql'), 'utf8');
  const srcs = sql.match(/r\.source IN \(([^)]*)\)/)[1].match(/'([^']+)'/g).map((s) => s.slice(1, -1));
  assert.deepEqual(srcs, COPAG_EVIDENCE_SOURCES);
  assert.match(sql, new RegExp(`interval '${COPAG_MAX_AGE_DAYS} days'`));
});

// ------------------------------------------------------------------ rodada do robô → meta.json
const AT = '2026-10-31T11:00:00.000Z';
function rec(copag, at = AT) {
  const prev = new Date(Date.parse(at) - 15 * 6e4).toISOString();
  return buildRunRecord({ env: { GITHUB_RUN_ID: String(Date.parse(at)), GITHUB_RUN_ATTEMPT: '1' }, startedAt: at, finishedAt: at, generatedAt: at, prevGeneratedAt: prev,
    reader: { status: 'ok', valid: 500, read: 520, reason: null }, dbSync: syncStatus({ status: 'ok', lastSeenAt: prev, engineAt: prev, engineRunAt: prev }, prev),
    stores: { found: 10, active: 8, withListings: 8, empty: 0, blocked: 0, error: 0, deferred: 0 }, offers: 900, alerts: 0, copag });
}

await t('6. copagSummary e registro da rodada: lista o que vence, não vira problema da rodada', () => {
  assert.equal(copagSummary(null, AT), null, 'banco não lido: sem medida');
  assert.equal(copagSummary(undefined, AT), null);
  const s = copagSummary(importRows.filter((e) => e.reference_kind === 'COPAG_OFFICIAL_CURRENT' && e.verification_status === 'verified'), AT);
  assert.equal(s.warnDays, 7); assert.equal(s.checked, 2);
  assert.deepEqual(s.expiring, [{ id: 'me04-box36', verified_at: '2026-10-08T00:00:00.000Z', expires_at: '2026-11-07T00:00:00.000Z' },
    { id: 'me05-blister3', verified_at: '2026-10-08T00:00:00.000Z', expires_at: '2026-11-07T00:00:00.000Z' }]);
  const r = rec(s);
  assert.deepEqual(r.copag, s); assert.equal(r.health, 'saudavel'); assert.deepEqual(r.issues, []);
  assert.equal(rec(null).copag, null);
  assert.deepEqual(copagSummary([], AT), { warnDays: 7, checked: 0, expiring: [] });
});

// ------------------------------------------------------------------ vigia
const copagNow = copagSummary(importRows, AT);
const meta = mergeOps({}, rec(copagNow), AT);
const state = AT; const NOW = '2026-10-31T11:10:00.000Z';
const runs = [0, 1, 2].map((i) => ({ status: 'completed', conclusion: 'success', createdAt: AT, updatedAt: new Date(Date.parse(AT) - i * 15 * 6e4).toISOString(), event: 'workflow_dispatch' }));

await t('7. evaluate: aviso copag_vencendo com produtos e data; estado continua saudável e decide não avisa falha', () => {
  const ev = evaluate({ now: NOW, stateGeneratedAt: state, meta, runs });
  assert.equal(ev.status, 'saudavel'); assert.deepEqual(ev.reasons, []);
  assert.equal(ev.warnings.length, 1);
  const w = ev.warnings[0];
  assert.equal(w.code, 'copag_vencendo'); assert.deepEqual(w.products, ['me04-box36', 'me05-blister3']); assert.equal(w.expiresAt, '2026-11-07T00:00:00.000Z');
  assert.match(w.text, /me04-box36 \(verificada em 07\/10.*sai da nota após 06\/11, 21:00\)/);   // horário de Brasília
  assert.match(w.text, /me05-blister3/); assert.match(w.text, /docs\/referencia-copag\.md/);
  assert.equal(decide(ev, null, NOW).notify, null, 'aviso não é falha');
  const L = commitLedger(null, ev, { notify: null }, false, NOW);
  assert.equal(L.notifiedStatus, 'saudavel'); assert.equal(L.incidentSince, null);
  // sem a seção copag (rodada antiga, banco não lido) ou depois de vencer: nenhum aviso
  assert.deepEqual(evaluate({ now: NOW, stateGeneratedAt: state, meta: mergeOps({}, rec(null), AT), runs }).warnings, []);
  assert.deepEqual(evaluate({ now: '2026-11-07T00:00:01Z', stateGeneratedAt: state, meta, runs }).warnings, []);
  assert.deepEqual(evaluate({ now: NOW, stateGeneratedAt: undefined, meta: null, runs }).warnings, []);
  // aviso também sai junto com uma falha, sem misturar: a falha continua decidida por decide()
  const evBad = evaluate({ now: NOW, stateGeneratedAt: '2026-10-31T09:00:00.000Z', meta, runs });
  assert.equal(evBad.status, 'parado'); assert.equal(evBad.warnings[0].code, 'copag_vencendo');
});

await t('8. decideWarning/commitWarning: avisa uma vez, lembra a cada 24 h, avisa de novo se a lista mudar, limpa ao sumir', () => {
  const ev = evaluate({ now: NOW, stateGeneratedAt: state, meta, runs });
  const d1 = decideWarning(ev, null, NOW);
  assert.equal(d1.notify.kind, 'aviso'); assert.match(d1.notify.title, /aviso antecipado/); assert.match(d1.notify.text, /me04-box36.*\n.*Nota e ranking não mudam agora/s);
  assert.deepEqual(commitWarning(null, d1, false, NOW).warnKey, null, 'não entregue: tenta de novo');
  const L1 = commitWarning(null, d1, true, NOW);
  assert.equal(L1.warnKey, d1.key); assert.equal(L1.warnAt, NOW); assert.equal(L1.notifiedStatus, 'saudavel');
  assert.equal(decideWarning(ev, L1, '2026-10-31T23:00:00.000Z').notify, null, 'mesmo aviso, antes de 24 h');
  const later = new Date(Date.parse(NOW) + RULES.WARN_REMIND_MIN * 6e4).toISOString();
  assert.match(decideWarning(ev, L1, later).notify.text, /\(continua\)/);
  // lista mudou (um produto renovado): aviso novo
  const meta2 = mergeOps({}, rec(copagSummary(importRows.filter((e) => e.legacy_id !== 'me05-blister3'), AT)), AT);
  const ev2 = evaluate({ now: NOW, stateGeneratedAt: state, meta: meta2, runs });
  const d2 = decideWarning(ev2, L1, NOW);
  assert.ok(d2.notify); assert.notEqual(d2.key, d1.key); assert.doesNotMatch(d2.notify.text, /me05-blister3/);
  // renovado tudo: sem aviso e o livro limpa
  const ev3 = evaluate({ now: NOW, stateGeneratedAt: state, meta: mergeOps({}, rec(copagSummary([], AT)), AT), runs });
  const d3 = decideWarning(ev3, L1, NOW);
  assert.equal(d3.notify, null); assert.equal(d3.key, null);
  const L3 = commitWarning(L1, d3, false, NOW);
  assert.equal(L3.warnKey, null); assert.equal(L3.warnAt, null);
  // commitLedger (falhas) preserva o livro dos avisos
  assert.equal(commitLedger(L1, ev, { notify: null }, false, NOW).warnKey, d1.key);
});

await t('9. readDbHealth: lê a Copag atual verificada na mesma transação só de leitura; falha nessa leitura não derruba a saúde', async () => {
  const fake = (rows, failCopag = false) => { const seen = []; return { seen, mod: { default: { Client: class {
    on() {} async connect() {} async end() {}
    async query(sql) { seen.push(sql);
      if (/COPAG_OFFICIAL_CURRENT/.test(sql)) { if (failCopag) throw new Error('permission denied'); return { rows }; }
      if (/last_seen_at/.test(sql)) return { rows: [{ last_seen_at: '2026-10-31T10:45:00Z' }] };
      return { rows: [] }; } } } } }; };
  const db = [{ legacy_id: 'me04-box36', reference_kind: 'COPAG_OFFICIAL_CURRENT', verification_status: 'verified', value: 449.99, source: 'copag_loja_catalog',
    source_url: LOJA('box-display-pokemon-me04-caos-ascendente'), verified_at: new Date('2026-10-08T00:00:00Z') },
  { legacy_id: 'x', reference_kind: 'COPAG_OFFICIAL_CURRENT', verification_status: 'verified', value: 1, source: 'copag_loja', source_url: LOJA('x'), verified_at: 'lixo' }];
  let f = fake(db);
  let h = await readDbHealth({ env: { DATABASE_URL: 'postgres://u:p@h/x' }, loadPg: async () => f.mod });
  assert.equal(h.status, 'ok');
  assert.deepEqual(h.copagRefs.map((r) => [r.legacy_id, r.verified_at]), [['me04-box36', '2026-10-08T00:00:00.000Z'], ['x', null]]);
  assert.equal(f.seen[0], 'BEGIN READ ONLY'); assert.equal(f.seen.at(-1), 'COMMIT');
  assert.ok(f.seen.every((s) => !/\b(INSERT|UPDATE|DELETE)\b/.test(s)), 'só leitura');
  assert.deepEqual(ids(copagExpiringSoon(h.copagRefs, '2026-11-01T00:00:00Z')), ['me04-box36']);
  f = fake(db, true);
  h = await readDbHealth({ env: { DATABASE_URL: 'postgres://u:p@h/x' }, loadPg: async () => f.mod });
  assert.equal(h.status, 'ok'); assert.equal(h.copagRefs, null); assert.equal(h.lastSeenAt, '2026-10-31T10:45:00.000Z');
  assert.equal((await readDbHealth({ env: {} })).copagRefs, null);
});

await t('10. vigia de ponta a ponta (tools/watchdog.mjs --dry-run): registra copag_vencendo sem enviar nem gravar', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'copagv-'));
  try {
    fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ generatedAt: state }));
    fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta));
    fs.writeFileSync(path.join(dir, 'runs.json'), JSON.stringify(runs));
    const out = execFileSync(process.execPath, [path.join(root, 'tools/watchdog.mjs'), '--state', path.join(dir, 'state.json'), '--meta', path.join(dir, 'meta.json'),
      '--runs', path.join(dir, 'runs.json'), '--ledger', path.join(dir, 'ledger.json'), '--now', NOW, '--dry-run'],
    { encoding: 'utf8', env: { PATH: process.env.PATH, SYSTEMROOT: process.env.SYSTEMROOT || '' } });
    const summary = JSON.parse(out.split('\n')[0]);
    assert.equal(summary.status, 'saudavel'); assert.deepEqual(summary.warnings, ['copag_vencendo']); assert.equal(summary.warn, 'aviso');
    assert.equal(summary.notify, null); assert.match(out, /me04-box36/);
    assert.ok(!fs.existsSync(path.join(dir, 'ledger.json')), 'dry-run não grava o livro');
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

console.log(`✓ Aviso antecipado de vencimento Copag (copag_vencendo): ${n} grupos passaram`);
