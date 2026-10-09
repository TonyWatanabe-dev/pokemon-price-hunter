// Lote 5 — Dados: rendimento das lojas, estoque não conferido do Mercado Livre e política única do preço Copag
// (validade de 30 dias, paridade robô × API). Sem rede e sem banco.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';

process.env.HUNTER_DOMAIN_DELAY_MS = '0';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'lote5-'));
process.env.HUNTER_CONFIG_DIR = path.join(tmp, 'config'); process.env.HUNTER_DATA_DIR = path.join(tmp, 'data');
fs.mkdirSync(process.env.HUNTER_CONFIG_DIR, { recursive: true }); fs.mkdirSync(process.env.HUNTER_DATA_DIR, { recursive: true });
process.env.ML_CLIENT_ID = '123'; process.env.ML_CLIENT_SECRET = 'segredo-de-teste';
delete process.env.ML_ACCESS_TOKEN; delete process.env.DATABASE_URL; delete process.env.TELEGRAM_BOT_TOKEN; delete process.env.NTFY_TOPIC;
process.env.HUNTER_TIPS = '0';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const realCatalog = JSON.parse(fs.readFileSync(path.join(root, 'config/catalog.json'), 'utf8'));

const H = await import('../src/source-health.js');
const P = await import('../src/copag-policy.js');
const PA = await import('../api/_lib/copag-policy.mjs');
const { copagStatus } = await import('../src/score.js');
const { compose, evaluate } = await import('../src/alerts.js');
const { referenceRows } = await import('../src/core/mappers.js');
const runMod = await import('../src/run.js');
const { runOnce } = runMod;

let n = 0;
const t = async (name, fn) => { try { await fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } };
const DAY = 864e5;
const NOW = new Date('2026-10-09T12:00:00Z');
const ago = (d, base = NOW) => new Date(base.getTime() - d * DAY).toISOString();

// ------------------------------------------------------------------ 1. rendimento das lojas
await t('1. classificação: transições e contador de leituras vazias', () => {
  const s = { status: 'ACTIVE', listings: 0, matched: 0, checks: 5, ok: 5 };
  s.emptyStreak = H.nextEmptyStreak(s, 0); assert.equal(H.classifySource(s), 'ok', '1 leitura vazia ainda não conclui');
  s.emptyStreak = H.nextEmptyStreak(s, 0); assert.equal(H.classifySource(s), 'ok');
  s.emptyStreak = H.nextEmptyStreak(s, 0); assert.equal(s.emptyStreak, H.EMPTY_STREAK); assert.equal(H.classifySource(s), 'sem_resultado');
  s.listings = 4; s.matched = 0; s.emptyStreak = H.nextEmptyStreak(s, 4);
  assert.equal(s.emptyStreak, 0, 'leitura com anúncios zera o contador'); assert.equal(H.classifySource(s), 'sem_match');
  s.matched = 2; assert.equal(H.classifySource(s), 'ok');
  assert.equal(H.classifySource({ status: 'BLOCKED', ok: 0, checks: H.NEVER_CHECKS - 1, fails: 19 }), 'falhando', 'poucas tentativas: ainda não é "nunca"');
  assert.equal(H.classifySource({ status: 'BLOCKED', ok: 0, checks: H.NEVER_CHECKS, fails: 20 }), 'nunca_funcionou');
  assert.equal(H.classifySource({ status: 'ERROR', ok: 0, checks: 190, fails: 190 }), 'nunca_funcionou');
  assert.equal(H.classifySource({ status: 'BLOCKED', ok: 3, checks: 190, fails: 50 }), 'falhando', 'já funcionou: não é "nunca"');
  for (const st of ['PENDING', 'UNAVAILABLE', 'PAUSED']) assert.equal(H.classifySource({ status: st }), null);
  // volta a funcionar: a classe acompanha (nada fica preso)
  assert.equal(H.classifySource({ status: 'ACTIVE', ok: 1, checks: 191, listings: 3, matched: 1, emptyStreak: 0 }), 'ok');
});

await t('2. espera entre tentativas: 6 h no máximo; 24 h para quem nunca funcionou', () => {
  assert.equal(H.backoffMinutes({ status: 'BLOCKED', fails: 0 }), 0);
  assert.equal(H.backoffMinutes({ status: 'BLOCKED', fails: 1, ok: 0, checks: 1 }), 15);
  assert.equal(H.backoffMinutes({ status: 'BLOCKED', fails: 3, ok: 0, checks: 3 }), 60);
  assert.equal(H.backoffMinutes({ status: 'BLOCKED', fails: 6, ok: 2, checks: 30 }), 360, 'quem já funcionou: teto de 6 h (como antes)');
  assert.equal(H.backoffMinutes({ status: 'BLOCKED', fails: 190, ok: 2, checks: 300 }), 360);
  assert.equal(H.backoffMinutes({ status: 'BLOCKED', fails: 190, ok: 0, checks: 190 }), 1440, 'nunca funcionou: teto de 24 h');
  assert.equal(H.backoffMinutes({ status: 'ERROR', fails: 7, ok: 0, checks: 25 }), 960);
  assert.equal(H.backoffMinutes({ status: 'ERROR', fails: 19, ok: 0, checks: 19 }), 360, 'antes do limite de tentativas: 6 h');
  assert.ok(Number.isFinite(H.backoffMinutes({ status: 'BLOCKED', fails: 5000, ok: 0, checks: 5000 })));
  assert.deepEqual(H.yieldCounts({ a: { status: 'ACTIVE', listings: 1, matched: 1 }, b: { status: 'ACTIVE', listings: 0, emptyStreak: 3 }, c: { status: 'ACTIVE', listings: 2, matched: 0 },
    d: { status: 'BLOCKED', ok: 0, checks: 190, fails: 190 }, e: { status: 'ERROR', ok: 1, checks: 9, fails: 2 }, f: { status: 'PAUSED' } }),
  { ok: 1, sem_resultado: 1, sem_match: 1, nunca_funcionou: 1, falhando: 1 });
});

// ------------------------------------------------------------------ 3. política Copag (casos de borda)
const pol = (entry, origin = 'catalog', productId = 'x-etb', now = NOW) => P.evaluateReference(P.fromRobotEntry(entry, origin), { now, productId });
const LOJA = 'https://www.copagloja.com.br/treinador-avancado/p';
await t('3. Copag: 30 dias exatos valem, 31 não; sem data fica pendente', () => {
  assert.equal(pol({ msrp: 399.99, source_url: LOJA, confidence: 'OFICIAL', source_timestamp: ago(30) }, 'captura').status, 'confirmado', 'exatamente 30 dias');
  const e31 = pol({ msrp: 399.99, source_url: LOJA, confidence: 'OFICIAL', source_timestamp: ago(31) }, 'captura');
  assert.equal(e31.status, 'expirado'); assert.equal(e31.confirmed, false); assert.equal(e31.msrp, null); assert.equal(e31.reference, 399.99); assert.equal(e31.referenceUrl, LOJA);
  assert.equal(pol({ msrp: 399.99, source_url: LOJA, confidence: 'OFICIAL', source_timestamp: new Date(NOW.getTime() - 30 * DAY - 1).toISOString() }, 'captura').status, 'expirado', '1 ms depois dos 30 dias');
  const none = pol({ msrp: 399.99, source_url: LOJA, confidence: 'OFICIAL' }, 'captura');
  assert.equal(none.status, 'pendente'); assert.match(none.reason, /sem data/); assert.equal(none.reference, 399.99);
  assert.equal(pol({ msrp: 399.99, source_url: LOJA, confidence: 'OFICIAL', source_timestamp: 'ontem' }, 'captura').status, 'pendente', 'data ilegível = sem data');
  assert.equal(pol({ msrp: 399.99, source_url: LOJA, confidence: 'OFICIAL', source_timestamp: new Date(NOW.getTime() + 3 * DAY).toISOString() }, 'captura').status, 'pendente', 'data no futuro');
  // carimbo só com dia (catalog.json): meia-noite UTC
  assert.equal(pol({ msrp: 10, source_url: 'https://www.copag.com.br/x', confidence: 'OFICIAL', source_timestamp: '2026-09-09' }, 'catalog', 'x', new Date('2026-10-09T00:00:00Z')).status, 'confirmado');
  assert.equal(pol({ msrp: 10, source_url: 'https://www.copag.com.br/x', confidence: 'OFICIAL', source_timestamp: '2026-09-09' }, 'catalog', 'x', new Date('2026-10-09T00:00:01Z')).status, 'expirado');
});

await t('4. Copag: domínio oficial, cadastro manual, marketplace, catálogo de terceiros', () => {
  const insta = pol({ msrp: 69.99, source_url: 'https://www.instagram.com/voltztcg/', confidence: 'OFICIAL', manual: true, source_timestamp: ago(2) });
  assert.equal(insta.status, 'pendente'); assert.match(insta.reason, /fora do domínio oficial/); assert.equal(insta.reference, 69.99);
  assert.equal(pol({ msrp: 69.99, source_url: 'https://copagloja.com.br.golpe.test/x', confidence: 'OFICIAL', source_timestamp: ago(1) }).status, 'pendente', 'domínio parecido não vale');
  assert.equal(pol({ msrp: 69.99, source_url: 'ftp://www.copag.com.br/x', confidence: 'OFICIAL', source_timestamp: ago(1) }).status, 'pendente', 'só http(s)');
  const manual = pol({ msrp: 449.99, source_url: 'https://www.copag.com.br/tabela', confidence: 'OFICIAL', manual: true, source_timestamp: ago(5) });
  assert.equal(manual.status, 'confirmado', 'cadastro manual marcado como oficial com URL da Copag'); assert.equal(manual.msrp, 449.99);
  assert.equal(pol({ msrp: 449.99, source_url: 'https://pokemon.copag.com.br/x', confidence: 'OFICIAL', source_timestamp: ago(5) }).status, 'confirmado', 'subdomínio da Copag');
  const notOfficial = pol({ msrp: 115.99, source_url: 'https://www.copag.com.br/x', confidence: 'CATALOGO_COPAG', source_timestamp: ago(1) });
  assert.equal(notOfficial.status, 'pendente'); assert.match(notOfficial.reason, /não marcada como oficial/);
  const mk = pol({ msrp: 449.99, source_url: 'https://www.mercadolivre.com.br/loja/copag', confidence: 'OFICIAL', source_timestamp: ago(1) });
  assert.equal(mk.status, 'sem_referencia'); assert.equal(mk.reference, null, 'marketplace nunca vira referência');
  assert.equal(pol({ msrp: 0, source_url: LOJA, confidence: 'OFICIAL', source_timestamp: ago(1) }).status, 'sem_referencia');
  assert.equal(pol({ msrp: 10, confidence: 'OFICIAL', source_timestamp: ago(1) }).status, 'pendente', 'sem fonte');
  // a conferência diária (copag-check) que bate renova a validade; a que não bate, não
  assert.equal(pol({ msrp: 10, source_url: LOJA, confidence: 'OFICIAL', source_timestamp: ago(40), last_check: { at: ago(1), matches: true } }).status, 'confirmado');
  assert.equal(pol({ msrp: 10, source_url: LOJA, confidence: 'OFICIAL', source_timestamp: ago(40), last_check: { at: ago(1), matches: false } }).status, 'expirado');
  // compatibilidade do copagStatus (score.js): catálogo divulgado por terceiros continua só referência
  const st = copagStatus({ copag: { msrp: 115.99, source_url: 'https://blog.test/x', confidence: 'CATALOGO_COPAG' } });
  assert.ok(!st.confirmed && st.reference === 115.99);
  assert.ok(copagStatus({ copag: { msrp: 13.99, source_url: LOJA, confidence: 'OFICIAL', source_timestamp: ago(3) } }, { now: NOW }).confirmed);
});

await t('5. me04-box36 continua pendente (captura automática não confirma)', () => {
  assert.ok(!realCatalog.copag['me04-box36'], 'catálogo real sem cadastro para me04-box36');
  const cap = { msrp: 449.99, source_url: 'https://www.copagloja.com.br/box-display-pokemon-me04-caos-ascendente/p', confidence: 'OFICIAL', source_timestamp: ago(1), msrp_updated_at: ago(1) };
  const d = pol(cap, 'captura', 'me04-box36');
  assert.equal(d.status, 'pendente'); assert.equal(d.reason, P.PENDENTES['me04-box36']); assert.equal(d.reference, 449.99); assert.equal(d.msrp, null);
  assert.equal(pol(cap, 'catalog', 'me04-box36').status, 'pendente', 'cadastro com URL da loja = mesma fonte automática');
  assert.equal(pol(cap, 'captura', 'me05-box36').status, 'confirmado', 'a trava é só do produto pendente');
  assert.equal(pol({ ...cap, source_url: 'https://www.copag.com.br/tabela-oficial' }, 'catalog', 'me04-box36').status, 'confirmado', 'liberação: cadastro manual do responsável com URL da Copag');
  // pelo resolvedor do robô, com o catálogo real e a captura da loja
  const { resolveCopag } = runMod;
  const r = resolveCopag({ id: 'me04-box36', collection: 'me04', type: 'booster_box', boosters: 36 }, realCatalog, { 'me04-box36': cap }, NOW);
  assert.equal(r.decision.status, 'pendente'); assert.equal(r.decision.confirmed, false);
  // API: linha da auditoria (copag_loja_catalog, verificada) não vira preço Copag; captura (copag_loja) fica pendente
  const api = PA.decideCopagFromRows([
    { id: 1, value: 449.99, source: 'copag_loja_catalog', source_url: cap.source_url, verification_status: 'verified', verified_at: ago(1), reference_scope: 'current' },
    { id: 2, value: 449.99, source: 'copag_loja', source_url: cap.source_url, verification_status: 'verified', verified_at: ago(1), reference_scope: 'current' },
  ], { now: NOW, productId: 'me04-box36' });
  assert.equal(api.status, 'pendente'); assert.equal(api.row.id, 2);
});

await t('6. resolvedor do robô: ordem dos candidatos e referência vencida', () => {
  const { resolveCopag } = runMod;
  const p = { id: 'c30-blister2', collection: 'c30', type: 'blister_2', boosters: 2 };
  const insta = { msrp: 69.99, source_url: 'https://www.instagram.com/voltztcg/', source_timestamp: '2026-10-07', confidence: 'OFICIAL', manual: true };
  const cap = { msrp: 69.99, source_url: 'https://www.copagloja.com.br/blister-duplo-com-moeda/p', source_timestamp: '2026-10-08T18:45:19.474Z', confidence: 'OFICIAL', msrp_updated_at: '2026-10-08T13:30:10.097Z' };
  const cat = { copag: { 'c30-blister2': insta } };
  let r = resolveCopag(p, cat, { 'c30-blister2': cap }, NOW);
  assert.equal(r.decision.status, 'confirmado', 'cadastro do Instagram não vale, a captura da loja oficial sim'); assert.equal(r.copag.origin, 'captura'); assert.equal(r.decision.msrp, 69.99);
  r = resolveCopag(p, cat, { 'c30-blister2': cap }, new Date('2026-11-08T18:45:19.475Z'));
  assert.equal(r.decision.status, 'expirado', 'captura vencida: a referência mostrada é a oficial vencida'); assert.equal(r.decision.reference, 69.99); assert.equal(r.decision.referenceUrl, cap.source_url);
  r = resolveCopag(p, cat, {}, NOW);
  assert.equal(r.decision.status, 'pendente'); assert.equal(r.decision.referenceUrl, insta.source_url);
  r = resolveCopag({ id: 'sv1-etb', collection: 'sv1', type: 'etb' }, { copag: {} }, {}, NOW);
  assert.equal(r.decision.status, 'sem_referencia'); assert.equal(r.copag.msrp, null);
  const f = P.productCopagFields(resolveCopag(p, cat, {}, NOW).decision);
  assert.deepEqual(Object.keys(f), ['copagConfirmed', 'msrp', 'copagReason', 'copagReference', 'copagReferenceUrl', 'copagReferenceStatus', 'copagVerifiedAt']);
  assert.equal(f.copagReferenceStatus, 'pendente'); assert.equal(f.copagConfirmed, false);
});

// ------------------------------------------------------------------ 7. paridade robô × API
await t('7. paridade: robô (catálogo/captura) e API (linhas gravadas pelo robô) decidem igual', () => {
  const { resolveCopag } = runMod;
  const T0 = new Date('2026-10-01T12:00:00Z');
  const cases = [
    { name: 'captura fresca', id: 'me04-etb', p: { id: 'me04-etb', collection: 'me04', type: 'etb' }, seen: { 'me04-etb': { msrp: 399.99, source_url: 'https://www.copagloja.com.br/etb-me04/p', confidence: 'OFICIAL', source_timestamp: ago(1, T0), msrp_updated_at: ago(5, T0) } } },
    { name: 'cadastro manual oficial (copag.com.br)', id: 'me05-etb', p: { id: 'me05-etb', collection: 'me05', type: 'etb' }, cat: { 'me05-etb': { msrp: 399.99, source_url: 'https://www.copag.com.br/tabela', confidence: 'OFICIAL', manual: true, source_timestamp: '2026-09-25' } } },
    { name: 'cadastro conferido pelo copag-check', id: 'sv10-etb', p: { id: 'sv10-etb', collection: 'sv10', type: 'etb' }, cat: { 'sv10-etb': { msrp: 379.99, source_url: 'https://www.copagloja.com.br/etb-sv10/p', confidence: 'OFICIAL', source_timestamp: '2026-08-01', last_check: { at: ago(2, T0), matches: true } } } },
    { name: 'Instagram (fora do domínio)', id: 'c30-etb', p: { id: 'c30-etb', collection: 'c30', type: 'etb' }, cat: { 'c30-etb': { msrp: 399.99, source_url: 'https://www.instagram.com/voltztcg/', confidence: 'OFICIAL', manual: true, source_timestamp: '2026-10-07' } } },
    { name: 'Instagram + captura (c30-blister2)', id: 'c30-blister2', p: { id: 'c30-blister2', collection: 'c30', type: 'blister_2', boosters: 2 },
      cat: { 'c30-blister2': { msrp: 69.99, source_url: 'https://www.instagram.com/voltztcg/', confidence: 'OFICIAL', manual: true, source_timestamp: '2026-09-29' } },
      seen: { 'c30-blister2': { msrp: 69.99, source_url: 'https://www.copagloja.com.br/blister-duplo-com-moeda/p', confidence: 'OFICIAL', source_timestamp: ago(0.5, T0) } } },
    { name: 'catálogo de terceiros', id: 'sv9-etb', p: { id: 'sv9-etb', collection: 'sv9', type: 'etb' }, cat: { 'sv9-etb': { msrp: 349.99, source_url: 'https://blog.test/tabela', confidence: 'CATALOGO_COPAG' } } },
    { name: 'me04-box36 capturada', id: 'me04-box36', p: { id: 'me04-box36', collection: 'me04', type: 'booster_box', boosters: 36 }, seen: { 'me04-box36': { msrp: 449.99, source_url: 'https://www.copagloja.com.br/box-display-pokemon-me04-caos-ascendente/p', confidence: 'OFICIAL', source_timestamp: ago(1, T0) } } },
    { name: 'sem referência', id: 'sv8-etb', p: { id: 'sv8-etb', collection: 'sv8', type: 'etb' } },
  ];
  const pick = (d) => ({ status: d.status, confirmed: d.confirmed, msrp: d.msrp, reference: d.reference, referenceUrl: d.referenceUrl, reason: d.reason });
  let compared = 0;
  // a rodada T0 grava no banco (referenceRows, o mapeamento real da sincronização); a API lê depois, em vários momentos
  for (const later of [0, 3, 29, 31, 45, 70]) {
    const T1 = new Date(T0.getTime() + later * DAY);
    for (const c of cases) {
      const catalog = { copag: c.cat || {} };
      const r0 = resolveCopag(c.p, catalog, c.seen || {}, T0);
      const prod = { id: c.id, copag: r0.copag, ...P.productCopagFields(r0.decision) };
      const rows = referenceRows([prod]).map((x, i) => ({ id: i + 1, ...x, reference_scope: x.reference_kind === 'COPAG_OFFICIAL_CURRENT' ? 'current' : 'community' }));
      const robot = resolveCopag(c.p, catalog, c.seen || {}, T1).decision;
      const api = PA.decideCopagFromRows(rows, { now: T1, productId: c.id });
      // o robô pode ter mais candidatos que o banco (o banco só guarda o escolhido); a decisão sobre o preço é a mesma
      assert.deepEqual(pick(api), pick(robot), `${c.name} (+${later} dias)`);
      compared++;
    }
  }
  assert.equal(compared, 48);
  // o mesmo código nos dois lados (src reexporta api/_lib), e a mesma lista de pendentes
  assert.equal(P.evaluateReference, PA.evaluateReference); assert.equal(P.PENDENTES, PA.PENDENTES); assert.equal(PA.VALIDADE_DIAS, 30);
  // linhas antigas já gravadas no banco (cadastro do Instagram como 'manual' verificado): a API não confirma, como o robô
  const old = PA.decideCopagFromRows([{ id: 9, value: 230.99, source: 'manual', source_url: 'https://www.instagram.com/voltztcg/', verification_status: 'verified', verified_at: '2026-10-07T00:00:00Z', reference_scope: 'community' }], { now: NOW, productId: 'c30-colecao_fichario' });
  const rob = runMod.resolveCopag({ id: 'c30-colecao_fichario', collection: 'c30', type: 'colecao_fichario' }, realCatalog, {}, NOW).decision;
  assert.deepEqual(pick(old), pick(rob));
  // histórico nunca entra; verificada vence pendente da mesma fonte só se valer
  assert.equal(PA.decideCopagFromRows([{ id: 1, value: 319.99, source: 'copag_loja', source_url: LOJA, verification_status: 'verified', verified_at: ago(1), reference_scope: 'historical' }], { now: NOW }).status, 'sem_referencia');
});

// ------------------------------------------------------------------ 8. Mercado Livre: estoque não conferido
const http = await import('../src/http.js');
const ml = await import('../src/mlauth.js');
const { search: mlSearch } = await import('../src/adapters/mercadolivre.js');
globalThis.fetch = async () => new Response(JSON.stringify({ access_token: 'AT-1', refresh_token: 'RT-1', expires_in: 21600, user_id: 9 }), { status: 200 });
await ml.exchange('TG-1');
const coll = realCatalog.collections[0].name;
const j = (o, s = 200) => new Response(JSON.stringify(o), { status: s, headers: { 'content-type': 'application/json' } });
let itemsOpen = false; let searchOpen = false;
const mlFetch = (url) => {
  if (url.includes('/sites/MLB/search')) return searchOpen ? j({ results: [{ id: 'MLB9001', title: `Pokémon TCG ${coll} Treinador Avançado Copag`, permalink: 'https://produto.mercadolivre.com.br/MLB-9001', price: 310, available_quantity: 4, condition: 'new', seller: { id: 77, nickname: 'LOJA_TCG' } }] }) : j({}, 403);
  if (url.includes('/products/search') && url.includes(encodeURIComponent('pokemon ' + coll))) return j({ results: [{ id: 'MLB111', name: `Pokémon TCG ${coll} Treinador Avançado Copag` }] });
  if (url.includes('/products/search')) return j({ results: [] });
  if (url.endsWith('/products/MLB111/items')) return j({ results: [{ item_id: 'MLB5551', price: 299.9, seller_id: 77, condition: 'new' }] });
  if (url.includes('/items?ids=')) return j(url.match(/ids=([^&]+)/)[1].split(',').map((id) => (itemsOpen
    ? { code: 200, body: { id, price: 299.9, status: 'active', condition: 'new', available_quantity: 1, permalink: 'https://produto.mercadolivre.com.br/' + id, catalog_product_id: 'MLB111' } }
    : { code: 403, body: { id, error: 'access_denied' } })));
  if (url.endsWith('/users/77')) return j({ nickname: 'LOJA_TCG', seller_reputation: { level_id: '5_green', transactions: { completed: 900 } } });
  return null;
};
await t('8. adaptador do ML marca stockVerified (conferido × não conferido)', async () => {
  http.setFetch(async (url) => mlFetch(url) || j({}, 404));
  itemsOpen = false; let L = await mlSearch({ id: 'mercadolivre' }, realCatalog);
  assert.ok(L.length >= 1 && L.every((l) => l.stock === 'IN_STOCK' && l.stockVerified === false), '/items fechado: IN_STOCK como antes, mas não conferido');
  assert.equal(JSON.parse(fs.readFileSync(path.join(process.env.HUNTER_DATA_DIR, 'ml-debug.json'), 'utf8')).stockUnverified, L.length);
  fs.rmSync(path.join(process.env.HUNTER_DATA_DIR, 'ml-catalog.json'));
  itemsOpen = true; L = await mlSearch({ id: 'mercadolivre' }, realCatalog);
  assert.ok(L.length >= 1 && L.every((l) => l.stockVerified === true), '/items aberto: conferido anúncio a anúncio');
  searchOpen = true; L = await mlSearch({ id: 'mercadolivre' }, realCatalog);
  assert.ok(L.length >= 1 && L.every((l) => l.stockVerified === true), 'busca de anúncios: estoque lido no anúncio');
  searchOpen = false; itemsOpen = false;
  fs.rmSync(path.join(process.env.HUNTER_DATA_DIR, 'ml-catalog.json'));
});

await t('9. texto do alerta: "não conferido" só quando stockVerified === false', () => {
  const p = { collectionName: 'Escarlate e Violeta', typeLabel: 'Treinador Avançado', boosters: 9, copagConfirmed: false };
  const base = { total: 299.9, priceKindLabel: 'preço da loja', storeName: 'Mercado Livre', seller: 'LOJA_TCG', shipping: null, url: 'https://x' };
  const txt = (o) => compose({ offer: { ...base, ...o }, product: p, kind: 'target', rule: { id: 'r' } }).text;
  assert.match(txt({ stockVerified: false }), /Estoque: não conferido \(anúncio do Mercado Livre\)/);
  assert.doesNotMatch(txt({ stockVerified: false }), /Estoque: confirmado/);
  assert.match(txt({ stockVerified: true }), /Estoque: confirmado/);
  assert.match(txt({}), /Estoque: confirmado/, 'outras lojas: como antes');
  assert.match(txt({ stockVerified: true, quantity: 4 }), /Estoque: 4 unidades/);
  // elegibilidade não muda: a oferta não conferida dispara a mesma regra que a conferida
  const offer = { id: 'o1', productId: 'sv1-etb', stock: 'IN_STOCK', matchConfidence: 0.9, total: 299.9, confirmed: true };
  const rules = [{ id: 'alvo', mode: 'target', filter: { productId: 'sv1-etb' }, maxPrice: 300 }];
  const prods = { 'sv1-etb': { id: 'sv1-etb', type: 'etb', collection: 'sv1', copagConfirmed: false } };
  assert.equal(evaluate(rules, [{ ...offer, stockVerified: false }], [], prods).length, 1);
  assert.equal(evaluate(rules, [{ ...offer, stockVerified: true }], [], prods).length, 1);
});

// ------------------------------------------------------------------ 10. rodada completa (runOnce)
await t('10. rodada: rendimento, espera de 24 h, stockVerified até a oferta e o alerta, Copag com validade', async () => {
  const cfg = process.env.HUNTER_CONFIG_DIR; const data = process.env.HUNTER_DATA_DIR;
  const { matchProduct } = await import('../src/match.js');
  const pid = matchProduct({ title: `Pokémon TCG ${coll} Treinador Avançado Copag`, url: '' }, realCatalog).productId;
  assert.ok(pid);
  const cat = structuredClone(realCatalog);
  fs.writeFileSync(path.join(cfg, 'catalog.json'), JSON.stringify(cat));
  fs.writeFileSync(path.join(cfg, 'stores.json'), JSON.stringify({ stores: [
    { id: 'mercadolivre', name: 'Mercado Livre', url: 'https://www.mercadolivre.com.br', platform: 'mercadolivre', kind: 'marketplace', evidence: {} },
    { id: 'vazia', name: 'Loja vazia', url: 'https://vazia.test', platform: 'shopify', kind: 'specialist', evidence: {} },
    { id: 'nunca', name: 'Nunca funcionou', url: 'https://nunca.test', platform: 'shopify', kind: 'specialist', evidence: {} },
    { id: 'falhou', name: 'Já funcionou', url: 'https://falhou.test', platform: 'shopify', kind: 'specialist', evidence: {} },
    { id: 'pend', name: 'Sem domínio', url: null, platform: 'auto', kind: 'specialist', evidence: {} },
  ] }));
  fs.writeFileSync(path.join(cfg, 'watchlist.json'), JSON.stringify({ settings: {}, rules: [{ id: 'alvo-ml', label: 'Alvo ML', mode: 'target', filter: { productId: pid }, maxPrice: 1000 }] }));
  const sevenH = new Date(Date.now() - 7 * 3600e3).toISOString();
  fs.writeFileSync(path.join(data, 'sources.json'), JSON.stringify({
    nunca: { checks: 190, ok: 0, fails: 190, status: 'BLOCKED', reason: 'bloqueio', lastCheck: sevenH },
    falhou: { checks: 50, ok: 30, fails: 10, status: 'BLOCKED', reason: 'bloqueio', lastCheck: sevenH },
  }));
  // captura da loja oficial: me04-etb fresca, me05-etb vencida, me04-box36 fresca (pendente por decisão)
  const now = new Date();
  fs.writeFileSync(path.join(data, 'copag-msrp.json'), JSON.stringify({
    'me04-etb': { msrp: 399.99, source_url: 'https://www.copagloja.com.br/etb-me04/p', confidence: 'OFICIAL', source_timestamp: ago(2, now) },
    'me05-etb': { msrp: 399.99, source_url: 'https://www.copagloja.com.br/etb-me05/p', confidence: 'OFICIAL', source_timestamp: ago(31, now), msrp_updated_at: ago(40, now) },
    'me04-box36': { msrp: 449.99, source_url: 'https://www.copagloja.com.br/box-display-pokemon-me04-caos-ascendente/p', confidence: 'OFICIAL', source_timestamp: ago(1, now) },
  }));
  const requested = [];
  http.setFetch(async (url) => {
    const m = mlFetch(url); if (m) return m;
    const u = new URL(url); requested.push(u.host);
    if (u.pathname === '/robots.txt') return new Response('', { status: 404 });
    if (u.host === 'vazia.test' && u.pathname === '/search/suggest.json') return j({ resources: { results: { products: [] } } });
    if (u.host === 'nunca.test' || u.host === 'falhou.test') return new Response('Just a moment...', { status: 403, headers: { 'content-type': 'text/html' } });
    return j({}, 404);
  });
  const sent = []; const send = { capture: async (msg) => { sent.push(msg); return true; } };
  let s;
  for (let i = 0; i < 3; i++) s = await runOnce({ log: () => {}, send, now: new Date(now.getTime() + i * 60e3) });
  const src = Object.fromEntries(s.sources.map((x) => [x.id, x]));
  assert.equal(src.vazia.status, 'ACTIVE', 'status não muda'); assert.equal(src.vazia.emptyStreak, 3); assert.equal(src.vazia.yield, 'sem_resultado');
  assert.equal(src.nunca.status, 'BLOCKED'); assert.equal(src.nunca.yield, 'nunca_funcionou');
  assert.equal(src.nunca.checks, 190, 'nunca funcionou: 7 h depois ainda espera (teto de 24 h), sem perder contadores');
  assert.ok(!requested.includes('nunca.test'));
  assert.ok(src.falhou.checks >= 51 && requested.includes('falhou.test'), 'já funcionou: teto de 6 h, tentada de novo'); assert.equal(src.falhou.yield, 'falhando');
  assert.equal(src.pend.status, 'PENDING'); assert.equal(src.pend.yield, null);
  assert.equal(src.mercadolivre.yield, 'ok');
  assert.deepEqual(s.coverage.yield, { ok: 1, sem_resultado: 1, sem_match: 0, nunca_funcionou: 1, falhando: 1 });
  for (const k of ['found', 'active', 'blocked', 'error', 'pending', 'unavailable', 'paused']) assert.equal(typeof s.coverage[k], 'number', 'chaves antigas da cobertura');
  const meta = JSON.parse(fs.readFileSync(path.join(data, 'meta.json'), 'utf8'));
  assert.deepEqual(meta.ops.last.stores.yield, s.coverage.yield, 'registro operacional traz o rendimento');
  // ML: stockVerified chega à oferta (state.json e offers.json) e ao alerta
  const mlOffers = s.offers.filter((o) => o.storeId === 'mercadolivre');
  assert.ok(mlOffers.length >= 1 && mlOffers.every((o) => o.stockVerified === false && o.stock === 'IN_STOCK'));
  assert.ok(Object.values(JSON.parse(fs.readFileSync(path.join(data, 'offers.json'), 'utf8'))).filter((o) => o.storeId === 'mercadolivre').every((o) => o.stockVerified === false));
  assert.ok(s.offers.filter((o) => o.storeId !== 'mercadolivre').every((o) => !('stockVerified' in o)), 'outras lojas: sem o campo');
  const alert = sent.find((m) => /PREÇO-ALVO/.test(m.title));
  assert.ok(alert, 'alerta continua saindo (elegibilidade igual)'); assert.match(alert.text, /Estoque: não conferido \(anúncio do Mercado Livre\)/);
  // Copag com validade, na rodada
  const P2 = Object.fromEntries(s.products.map((p) => [p.id, p]));
  if (P2['me04-etb']) { assert.equal(P2['me04-etb'].copagConfirmed, true); assert.equal(P2['me04-etb'].copagReferenceStatus, 'confirmado'); }
  const reg = JSON.parse(fs.readFileSync(path.join(data, 'products.json'), 'utf8'));
  assert.ok(reg[pid], 'produto do ML registrado');
  // produtos que ainda não apareceram em loja não estão no estado: confere pelo resolvedor com o mesmo arquivo
  const seen = JSON.parse(fs.readFileSync(path.join(data, 'copag-msrp.json'), 'utf8'));
  const at = new Date(s.generatedAt);
  assert.equal(runMod.resolveCopag({ id: 'me04-etb', collection: 'me04', type: 'etb' }, cat, seen, at).decision.status, 'confirmado');
  assert.equal(runMod.resolveCopag({ id: 'me05-etb', collection: 'me05', type: 'etb' }, cat, seen, at).decision.status, 'expirado');
  assert.equal(runMod.resolveCopag({ id: 'me04-box36', collection: 'me04', type: 'booster_box', boosters: 36 }, cat, seen, at).decision.status, 'pendente');
  assert.equal(s.totals.copagConfirmed, s.products.filter((p) => p.copagConfirmed).length);
});

fs.rmSync(tmp, { recursive: true, force: true });

// ------------------------------------------------------------------ 11. banco: a página de produto da API aplica a mesma política
if (process.env.TEST_DATABASE_URL) {
  await t('11. PostgreSQL: home/produto da API com a política única (e a view do motor intocada)', async () => {
    process.env.DATABASE_URL = process.env.TEST_DATABASE_URL; process.env.API_DATABASE_URL = process.env.TEST_DATABASE_URL;
    const { pool, tx, close } = await import('../src/db/pg.js');
    const { syncState } = await import('../src/core/sync.js');
    const { importReferences } = await import('../src/core/reference-import.js');
    const { stateLikeFromDb } = await import('../api/_lib/read-db.mjs');
    const { closeApiPool } = await import('../api/_lib/db.mjs');
    const { execFileSync } = await import('node:child_process');
    const pg = await pool();
    await pg.query('DROP SCHEMA IF EXISTS hunter CASCADE');
    execFileSync('node', ['tools/db-migrate.mjs'], { env: process.env, stdio: 'pipe', cwd: root });
    const now = new Date();
    const catalog = { collections: ['me04', 'me05', 'c30', 'sv3'].map((id) => ({ id, name: id, series: 'x' })) };
    const Pr = (id, col, extra = {}) => ({ id, collection: col, collectionName: col, type: 'etb', typeLabel: 'ETB', group: 'ETB', boosters: 9, ...extra });
    const LOJA_ME05 = 'https://www.copagloja.com.br/treinador-avancado-pokemon-me05-escuridao-absoluta/p';
    const LOJA_SV3 = 'https://www.copagloja.com.br/etb-sv3/p';
    // rodada antiga (antes do Lote 5): Instagram gravado como 'manual' verificado; sv3 verificada há 40 dias
    const products = [
      Pr('me05-etb', 'me05', { copagConfirmed: true, msrp: 399.99, copag: { source_url: LOJA_ME05, confidence: 'OFICIAL', source_timestamp: ago(1, now) } }),
      Pr('c30-etb', 'c30', { copagConfirmed: true, msrp: 399.99, copag: { source_url: 'https://www.instagram.com/voltztcg/', confidence: 'OFICIAL', source_timestamp: '2026-10-07', manual: true } }),
      Pr('sv3-etb', 'sv3', { copagConfirmed: true, msrp: 349.99, copag: { source_url: LOJA_SV3, confidence: 'OFICIAL', source_timestamp: ago(40, now) } }),
      Pr('me04-box36', 'me04', { type: 'booster_box', typeLabel: 'Booster Box', boosters: 36 }),
    ];
    const state = { collections: [], products, sources: [{ id: 'a', name: 'a', url: 'https://a.com.br', status: 'ACTIVE' }], reputation: {}, offers: [] };
    await tx((c) => syncState(c, { state, catalog, historyLines: [] }));
    // auditoria: me04-box36 verificada como COPAG_OFFICIAL_CURRENT (fonte copag_loja_catalog)
    await tx((c) => importReferences(c, { import_id: 'teste-lote5', entries: [{ legacy_id: 'me04-box36', reference_kind: 'COPAG_OFFICIAL_CURRENT', value: 449.99, source: 'copag_loja_catalog',
      source_url: 'https://www.copagloja.com.br/box-display-pokemon-me04-caos-ascendente/p', observed_at: ago(1, now), verification_status: 'verified', verified_at: ago(1, now), confidence: 90, evidence_text: 'Price/ListPrice 449.99 no catálogo público (teste)' }] }));
    const legacy = { products: products.map((p) => ({ id: p.id })), offers: [], collections: catalog.collections };
    const st = await stateLikeFromDb(legacy, { now });
    const by = Object.fromEntries(st.products.map((p) => [p.id, p]));
    assert.equal(by['me05-etb'].copagConfirmed, true); assert.equal(by['me05-etb'].msrp, 399.99); assert.equal(by['me05-etb'].copagReferenceStatus, 'confirmado');
    assert.equal(by['c30-etb'].copagConfirmed, false, 'linha antiga do Instagram não confirma'); assert.equal(by['c30-etb'].copagReference, 399.99); assert.equal(by['c30-etb'].copagReferenceStatus, 'pendente');
    assert.equal(by['sv3-etb'].copagConfirmed, false, 'verificada há 40 dias: vencida'); assert.equal(by['sv3-etb'].copagReferenceStatus, 'expirado'); assert.equal(by['sv3-etb'].copagReference, 349.99);
    assert.equal(by['me04-box36'].copagConfirmed, false); assert.equal(by['me04-box36'].copagReference, null, 'auditoria não vira preço Copag no site');
    // mesma decisão que o robô tomaria hoje com as mesmas fontes
    for (const p of products.slice(0, 3)) {
      const e = { ...p.copag, msrp: p.msrp };
      const rob = runMod.resolveCopag(p, { copag: p.id === 'c30-etb' ? { 'c30-etb': e } : {} }, p.id === 'c30-etb' ? {} : { [p.id]: e }, now).decision;
      assert.equal(by[p.id].copagConfirmed, rob.confirmed, p.id); assert.equal(by[p.id].copagReferenceStatus, rob.status, p.id);
    }
    // a view do motor (reference_price_current) NÃO foi mudada neste lote: vencida e auditoria continuam lá (ver docs/copag-referencia.md)
    const cur = (await pg.query(`SELECT p.legacy_id FROM hunter.reference_price_current c JOIN hunter.product p ON p.id = c.product_id WHERE c.reference_kind = 'COPAG_OFFICIAL_CURRENT' ORDER BY 1`)).rows.map((r) => r.legacy_id);
    assert.deepEqual(cur, ['me04-box36', 'me05-etb', 'sv3-etb']);
    await closeApiPool(); await close();
  });
}
console.log(`✓ Dados (Lote 5): ${n} grupos de testes passaram${process.env.TEST_DATABASE_URL ? ' (puro + banco)' : ' (puro; banco pulado sem TEST_DATABASE_URL)'}`);
