// Política única do preço Copag (extraída do Lote 5 / PR #20, sem a migration 010): "Copag confirmado" só com fonte
// oficial da Copag (copagloja.com.br / copag.com.br), marcada como oficial, verificada há no máximo 30 dias e do mesmo
// produto (EAN). Paridade robô × API. Sem rede; o grupo de banco só roda com TEST_DATABASE_URL.
// Executado por test/copag-status-tests.js (await import no fim), para não mexer no package.json.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { fileURLToPath } from 'node:url';

process.env.HUNTER_DOMAIN_DELAY_MS = '0';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'copag-policy-'));
const savedEnv = { ...process.env };
process.env.HUNTER_CONFIG_DIR = path.join(tmp, 'config'); process.env.HUNTER_DATA_DIR = path.join(tmp, 'data');
fs.mkdirSync(process.env.HUNTER_CONFIG_DIR, { recursive: true }); fs.mkdirSync(process.env.HUNTER_DATA_DIR, { recursive: true });
delete process.env.DATABASE_URL; delete process.env.TELEGRAM_BOT_TOKEN; delete process.env.NTFY_TOPIC;

const root = fileURLToPath(new URL('..', import.meta.url));
const realCatalog = JSON.parse(fs.readFileSync(path.join(root, 'config/catalog.json'), 'utf8'));

const P = await import('../src/copag-policy.js');
const PA = await import('../api/_lib/copag-policy.mjs');
const { copagStatus } = await import('../src/score.js');
const { referenceRows } = await import('../src/core/mappers.js');
const runMod = await import('../src/run.js');

let n = 0;
const t = async (name, fn) => { try { await fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } };
const DAY = 864e5;
const NOW = new Date('2026-10-09T12:00:00Z');
const ago = (d, base = NOW) => new Date(base.getTime() - d * DAY).toISOString();

// ------------------------------------------------------------------ 3. política Copag (casos de borda)
const pol = (entry, origin = 'catalog', productEan = null, now = NOW) => P.evaluateReference(P.fromRobotEntry(entry, origin), { now, productEan });
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
  assert.equal(pol({ msrp: 10, source_url: 'https://www.copag.com.br/x', confidence: 'OFICIAL', source_timestamp: '2026-09-09' }, 'catalog', null, new Date('2026-10-09T00:00:00Z')).status, 'confirmado');
  assert.equal(pol({ msrp: 10, source_url: 'https://www.copag.com.br/x', confidence: 'OFICIAL', source_timestamp: '2026-09-09' }, 'catalog', null, new Date('2026-10-09T00:00:01Z')).status, 'expirado');
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

await t('5. me04-box36: sem trava por nome (captura de outro EAN não confirma; catálogo oficial da loja confirma na API)', async () => {
  assert.equal(P.PENDENTES, undefined, 'não há lista de produtos travados no código');
  assert.ok(!realCatalog.copag['me04-box36'], 'catálogo real sem cadastro para me04-box36');
  const prod = realCatalog.products.find((x) => x.id === 'me04-box36');
  assert.equal(prod.ean, '0196214156098', 'EAN cadastrado (o da página da loja)');
  const URL_BOX = 'https://www.copagloja.com.br/box-display-pokemon-me04-caos-ascendente/p';
  // 1) o anúncio da loja oficial traz o EAN do catálogo público (0196214156081): o matching recusa, então não há captura
  const { matchProduct } = await import('../src/match.js');
  const m = matchProduct({ title: 'Box Display Pokémon ME04 Caos Ascendente', url: URL_BOX, ean: '0196214156081' }, realCatalog);
  assert.equal(m.productId, null); assert.deepEqual(m.why, ['EAN diverge do catálogo']);
  // 2) mesmo que uma captura com esse EAN existisse, ela não é evidência do preço deste produto (nem referência)
  const cap = { msrp: 449.99, source_url: URL_BOX, confidence: 'OFICIAL', source_timestamp: ago(1), msrp_updated_at: ago(1), ean: '0196214156081' };
  const d = pol(cap, 'captura', prod.ean);
  assert.equal(d.status, 'sem_referencia'); assert.equal(d.confirmed, false); assert.equal(d.msrp, null); assert.equal(d.reference, null); assert.match(d.reason, /EAN da fonte diverge/);
  const { resolveCopag } = runMod;
  const r = resolveCopag({ id: 'me04-box36', collection: 'me04', type: 'booster_box', boosters: 36 }, realCatalog, { 'me04-box36': cap }, NOW);
  assert.equal(r.decision.confirmed, false); assert.equal(r.decision.status, 'sem_referencia', 'o resolvedor usa o EAN do catálogo: a captura nem é candidata');
  assert.equal(r.copag.msrp, null, 'o estado não mostra o preço de outro produto'); assert.equal(r.decision.reference, null);
  // 3) a regra é genérica: qualquer produto com captura de EAN divergente; com o EAN certo (ou sem EAN na fonte), vale como os demais
  assert.equal(pol({ ...cap, ean: '7896214156000' }, 'captura', '7896214156999').status, 'sem_referencia');
  assert.equal(pol({ ...cap, ean: '0196214156098' }, 'captura', prod.ean).status, 'confirmado', 'EAN igual (zeros à esquerda ignorados)');
  assert.equal(pol({ ...cap, ean: '196214156098' }, 'captura', prod.ean).status, 'confirmado');
  // 4) liberação por evidência: cadastro manual do responsável com URL oficial da Copag, verificado
  assert.equal(pol({ msrp: 449.99, source_url: 'https://www.copag.com.br/tabela-oficial', confidence: 'OFICIAL', manual: true, source_timestamp: ago(1) }, 'catalog', prod.ean).status, 'confirmado');
  // 5) API: a linha da auditoria (copag_loja_catalog = catálogo público da loja Copag, verificada há 1 dia, URL da loja,
  //    sem EAN importado) é evidência oficial com as MESMAS exigências: confirma. O robô não lê essa fonte (só o banco).
  const api = PA.decideCopagFromRows([
    { id: 1, value: 449.99, source: 'copag_loja_catalog', source_url: URL_BOX, verification_status: 'verified', verified_at: ago(1), reference_scope: 'current' },
  ], { now: NOW, productEan: prod.ean });
  assert.equal(api.status, 'confirmado'); assert.equal(api.confirmed, true); assert.equal(api.msrp, 449.99); assert.equal(api.row.id, 1);
});

await t('5b. os 11 produtos confirmados só pelo Instagram ficam pendentes, sem exceção automática', async () => {
  const ONZE = ['c30-colecao_fichario', 'c30-etb', 'c30-blister3', 'c30-combo', 'c30-combo6', 'c30-minilata', 'c30-colecao', 'c30-colecao_miniatura',
    'c30-colecao_ex-greninja', 'c30-colecao_ex-estampas', 'c30-colecao_ex-sylveon'];
  const { resolveCopag } = runMod;
  const { msrpKeys } = await import('../src/match.js');
  const isInsta = (c) => /instagram\.com/i.test(c?.source_url || '') && c?.confidence === 'OFICIAL';
  for (const id of ONZE) {
    const p = { id, collection: 'c30', type: id.slice(4).split('-')[0] };
    const key = msrpKeys(p).find((k) => realCatalog.copag[k]);
    const c = realCatalog.copag[key];
    assert.ok(isInsta(c), `${id}: cadastro real (${key}) é do Instagram`);
    // com qualquer data (inclusive verificação de hoje), sem captura da loja oficial: pendente, valor só como referência
    for (const when of [NOW, new Date(Date.parse(c.source_timestamp || '2026-10-07') + DAY)]) {
      const d = resolveCopag(p, { ...realCatalog, copag: { [key]: { ...c, source_timestamp: when.toISOString() } } }, {}, when).decision;
      assert.equal(d.confirmed, false, id); assert.equal(d.status, 'pendente', id); assert.match(d.reason, /fora do domínio oficial/, id); assert.equal(d.reference, c.msrp, id);
    }
    // a linha gravada no banco também não confirma pela API
    const api = PA.decideCopagFromRows([{ id: 1, value: c.msrp, source: 'manual', source_url: c.source_url, verification_status: 'verified', verified_at: NOW.toISOString(), reference_scope: 'community' }], { now: NOW });
    assert.equal(api.confirmed, false, id);
  }
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
await t('7. paridade: robô (catálogo/captura) e API (linhas gravadas pelo robô) decidem igual', async () => {
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
    { name: 'me04-box36 capturada com EAN divergente', id: 'me04-box36', p: { id: 'me04-box36', collection: 'me04', type: 'booster_box', boosters: 36, ean: '0196214156098' }, seen: { 'me04-box36': { msrp: 449.99, source_url: 'https://www.copagloja.com.br/box-display-pokemon-me04-caos-ascendente/p', confidence: 'OFICIAL', source_timestamp: ago(1, T0), ean: '0196214156081' } } },
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
      const api = PA.decideCopagFromRows(rows, { now: T1 });
      // o robô pode ter mais candidatos que o banco (o banco só guarda o escolhido); a decisão sobre o preço é a mesma
      assert.deepEqual(pick(api), pick(robot), `${c.name} (+${later} dias)`);
      compared++;
    }
  }
  assert.equal(compared, 48);
  // o mesmo código nos dois lados (src reexporta api/_lib), e uma constante só de validade (a do motor, references.mjs)
  const R = await import('../api/_lib/references.mjs');
  assert.equal(P.evaluateReference, PA.evaluateReference); assert.equal(PA.VALIDADE_DIAS, 30); assert.equal(PA.VALIDADE_DIAS, R.COPAG_MAX_AGE_DAYS);
  assert.equal(PA.copagExpired, R.copagExpired, 'a política usa a mesma conta de validade do motor');
  for (const d of [29.99, 30, 30.0001, 31]) {
    const v = new Date(NOW.getTime() - d * DAY).toISOString();
    assert.equal(PA.evaluateReference({ value: 10, source_url: LOJA, official: true, verifiedAt: v }, { now: NOW }).status === 'expirado',
      R.resolveCurrentReference({ copag: { reference_kind: 'COPAG_OFFICIAL_CURRENT', verification_status: 'verified', value: 10, verified_at: v }, asOf: NOW }).kind !== 'COPAG_OFFICIAL_CURRENT', `${d} dias: política = motor`);
  }
  // linhas antigas já gravadas no banco (cadastro do Instagram como 'manual' verificado): a API não confirma, como o robô
  const old = PA.decideCopagFromRows([{ id: 9, value: 230.99, source: 'manual', source_url: 'https://www.instagram.com/voltztcg/', verification_status: 'verified', verified_at: '2026-10-07T00:00:00Z', reference_scope: 'community' }], { now: NOW });
  const rob = runMod.resolveCopag({ id: 'c30-colecao_fichario', collection: 'c30', type: 'colecao_fichario' }, realCatalog, {}, NOW).decision;
  assert.deepEqual(pick(old), pick(rob));
  // histórico nunca entra; verificada vence pendente da mesma fonte só se valer
  assert.equal(PA.decideCopagFromRows([{ id: 1, value: 319.99, source: 'copag_loja', source_url: LOJA, verification_status: 'verified', verified_at: ago(1), reference_scope: 'historical' }], { now: NOW }).status, 'sem_referencia');
});

// ------------------------------------------------------------------ 8. fontes do banco: catálogo oficial da loja Copag
// 'copag_loja_catalog' é o catálogo público da própria loja Copag (copagloja.com.br), gravado por tools/db-import-references.mjs
// a partir da auditoria. É fonte oficial com as MESMAS exigências das outras (URL do domínio Copag, linha verificada, verificação
// há no máximo 30 dias, EAN coerente quando houver) — não é barrada pelo nome. Mesma lista da migration 010 (PR #185).
await t('8. banco: catálogo oficial da loja Copag vale com as mesmas exigências; nada mais é relaxado', () => {
  assert.deepEqual([...PA.DB_OFFICIAL_SOURCES].sort(), ['copag_loja', 'copag_loja_catalog', 'manual']);
  assert.equal(P.DB_OFFICIAL_SOURCES, PA.DB_OFFICIAL_SOURCES, 'src reexporta a mesma lista (sem lista própria)');
  // o SQL da home traz exatamente as fontes candidatas da política (sem lista divergente)
  const sql = fs.readFileSync(path.join(root, 'api/_lib/read-db.mjs'), 'utf8').match(/r\.source IN \(([^)]*)\)/);
  assert.deepEqual(sql[1].split(',').map((s) => s.trim().replace(/'/g, '')).sort(), [...PA.DB_SOURCES].sort());
  const api = (rows, opts = {}) => PA.decideCopagFromRows(rows, { now: NOW, ...opts });
  const URL_BL3 = 'https://www.copagloja.com.br/blister-triplo-pokemon-me05-escuridao-absoluta/p';
  const URL_BOX = 'https://www.copagloja.com.br/box-display-pokemon-me04-caos-ascendente/p';
  const row = (extra = {}) => ({ id: 1, value: 42.99, source: 'copag_loja_catalog', source_url: URL_BL3, verification_status: 'verified', verified_at: ago(1), reference_scope: 'current', ...extra });
  // catálogo oficial (me05-blister3 e me04-box36 da auditoria): URL da loja, verificado há 1 dia → confirmado
  let d = api([row()]);
  assert.equal(d.status, 'confirmado'); assert.equal(d.confirmed, true); assert.equal(d.msrp, 42.99); assert.equal(d.row.source, 'copag_loja_catalog');
  assert.equal(api([row({ value: 449.99, source_url: URL_BOX })], { productEan: '0196214156098' }).status, 'confirmado', 'me04-box36 (linha sem EAN importado)');
  assert.equal(api([row({ verified_at: ago(30) })]).status, 'confirmado', 'exatamente 30 dias');
  // catálogo com URL fora da Copag → recusa (só referência)
  for (const u of ['https://www.instagram.com/voltztcg/', 'https://blog.test/catalogo', 'https://copagloja.com.br.golpe.test/x']) {
    d = api([row({ source_url: u })]);
    assert.equal(d.confirmed, false, u); assert.equal(d.status, 'pendente', u); assert.match(d.reason, /fora do domínio oficial/, u); assert.equal(d.msrp, null, u);
  }
  assert.equal(api([row({ source_url: 'https://www.mercadolivre.com.br/loja/copag' })]).status, 'sem_referencia', 'marketplace no catálogo: nem referência');
  assert.equal(api([row({ source_url: null })]).status, 'pendente', 'catálogo sem URL');
  // catálogo vencido (> 30 dias) → recusa (expirado, valor só como referência)
  d = api([row({ verified_at: ago(31) })]);
  assert.equal(d.status, 'expirado'); assert.equal(d.confirmed, false); assert.equal(d.reference, 42.99); assert.equal(d.msrp, null);
  assert.equal(api([row({ verified_at: new Date(NOW.getTime() - 30 * DAY - 1).toISOString() })]).status, 'expirado', '1 ms depois dos 30 dias');
  assert.equal(api([row({ verified_at: null })]).status, 'pendente', 'catálogo sem data de verificação');
  // catálogo não verificado (pendente na auditoria, confiança média) → não confirma
  d = api([row({ verification_status: 'pending', verified_at: null })]);
  assert.equal(d.confirmed, false); assert.equal(d.status, 'pendente'); assert.match(d.reason, /não marcada como oficial/);
  assert.equal(api([row({ verification_status: 'pending' })]).confirmed, false, 'pendente com data recente continua pendente');
  assert.equal(api([row({ verification_status: 'rejected' })]).status, 'sem_referencia', 'rejeitada nem entra');
  // fonte desconhecida (ou de contexto, como o blog) com URL da Copag, verificada → recusa: só as fontes da lista valem
  for (const source of ['copag_blog', 'desconhecida', 'internet', '', null]) {
    assert.equal(api([row({ source })]).confirmed, false, String(source));
  }
  assert.equal(api([row({ source: 'copag_blog' })]).status, 'sem_referencia', 'blog (preço de lançamento) não entra na home');
  assert.equal(api([row({ source: 'internet' })]).status, 'pendente', 'internet: só referência, nunca oficial');
  // manual com URL da Copag recente → aceita; manual do Instagram → recusa
  assert.equal(api([row({ source: 'manual', source_url: 'https://www.copag.com.br/tabela', reference_scope: 'community' })]).status, 'confirmado');
  d = api([row({ source: 'manual', source_url: 'https://www.instagram.com/voltztcg/', value: 399.99, reference_scope: 'community' })]);
  assert.equal(d.confirmed, false); assert.equal(d.status, 'pendente'); assert.match(d.reason, /fora do domínio oficial/); assert.equal(d.reference, 399.99);
  // EAN divergente (quando a linha traz EAN e o produto tem cadastro) → recusa, nem como referência; EAN igual ou ausente vale
  d = api([row({ value: 449.99, source_url: URL_BOX, ean: '0196214156081' })], { productEan: '0196214156098' });
  assert.equal(d.confirmed, false); assert.equal(d.status, 'sem_referencia'); assert.equal(d.reference, null);
  assert.equal(api([row({ ean: '0196214156098' })], { productEan: '196214156098' }).status, 'confirmado', 'EAN igual (zeros à esquerda ignorados)');
  assert.equal(api([row({ ean: '0196214156081' })]).status, 'confirmado', 'produto sem EAN cadastrado: nada a comparar');
  // ordem: a loja (captura) e o manual vêm antes do catálogo; o catálogo vem antes de 'internet'
  const loja = row({ id: 2, source: 'copag_loja', value: 44.99, verified_at: ago(2) });
  const net = row({ id: 3, source: 'internet', value: 39.99, verification_status: 'pending', verified_at: null, reference_scope: 'community' });
  assert.equal(api([row(), loja]).row.id, 2, 'copag_loja antes do catálogo');
  assert.equal(api([net, row()]).row.id, 1, 'catálogo antes de internet');
  assert.equal(api([row({ verified_at: ago(40) }), net]).status, 'expirado', 'catálogo vencido ainda é a referência preferida (oficial vencida)');
  // a decisão da API é a mesma da política pura (evaluateReference) sobre a mesma evidência
  assert.equal(PA.evaluateReference({ value: 42.99, source_url: URL_BL3, official: true, verifiedAt: ago(1) }, { now: NOW }).status, api([row()]).status);
});

// ------------------------------------------------------------------ 9. resolvedor com o arquivo de capturas (validade na rodada)
await t('9. resolvedor: captura fresca confirma, vencida vira referência, EAN de outro produto nem entra', () => {
  const cat = structuredClone(realCatalog);
  const seen = {
    'me04-etb': { msrp: 399.99, source_url: 'https://www.copagloja.com.br/etb-me04/p', confidence: 'OFICIAL', source_timestamp: ago(2) },
    'me05-etb': { msrp: 399.99, source_url: 'https://www.copagloja.com.br/etb-me05/p', confidence: 'OFICIAL', source_timestamp: ago(31), msrp_updated_at: ago(40) },
    'me04-box36': { msrp: 449.99, source_url: 'https://www.copagloja.com.br/box-display-pokemon-me04-caos-ascendente/p', confidence: 'OFICIAL', source_timestamp: ago(1), ean: '0196214156081' },
  };
  assert.equal(runMod.resolveCopag({ id: 'me04-etb', collection: 'me04', type: 'etb' }, cat, seen, NOW).decision.status, 'confirmado');
  const me05 = runMod.resolveCopag({ id: 'me05-etb', collection: 'me05', type: 'etb' }, cat, seen, NOW).decision;
  assert.equal(me05.status, 'expirado'); assert.equal(me05.reference, 399.99); assert.equal(me05.msrp, null);
  const box = runMod.resolveCopag({ id: 'me04-box36', collection: 'me04', type: 'booster_box', boosters: 36 }, cat, seen, NOW).decision;
  assert.equal(box.confirmed, false); assert.equal(box.status, 'sem_referencia');
  // copagStatus (score.js) segue a mesma regra, com o momento explícito
  assert.equal(copagStatus({ copag: seen['me05-etb'] }, { now: NOW, origin: 'captura' }).status, 'expirado');
});

fs.rmSync(tmp, { recursive: true, force: true });

// ------------------------------------------------------------------ 10. banco: a home da API aplica a mesma política
// Sem a migration 010 (PR #185): só a home (stateLikeFromDb) muda; a view do motor (reference_price_current) fica como na main.
if (savedEnv.TEST_DATABASE_URL) {
  await t('10. PostgreSQL: home da API com a mesma política do robô', async () => {
    process.env.DATABASE_URL = savedEnv.TEST_DATABASE_URL; process.env.API_DATABASE_URL = savedEnv.TEST_DATABASE_URL;
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
    // rodada antiga (antes desta política): Instagram gravado como 'manual' verificado; sv3 verificada há 40 dias
    const products = [
      Pr('me05-etb', 'me05', { copagConfirmed: true, msrp: 399.99, copag: { source_url: LOJA_ME05, confidence: 'OFICIAL', source_timestamp: ago(1, now) } }),
      Pr('c30-etb', 'c30', { copagConfirmed: true, msrp: 399.99, copag: { source_url: 'https://www.instagram.com/voltztcg/', confidence: 'OFICIAL', source_timestamp: '2026-10-07', manual: true } }),
      Pr('sv3-etb', 'sv3', { copagConfirmed: true, msrp: 349.99, copag: { source_url: LOJA_SV3, confidence: 'OFICIAL', source_timestamp: ago(40, now) } }),
      Pr('me04-box36', 'me04', { type: 'booster_box', typeLabel: 'Booster Box', boosters: 36 }),
    ];
    const state = { collections: [], products, sources: [{ id: 'a', name: 'a', url: 'https://a.com.br', status: 'ACTIVE' }], reputation: {}, offers: [] };
    await tx((c) => syncState(c, { state, catalog, historyLines: [] }));
    // auditoria: me04-box36 verificada como COPAG_OFFICIAL_CURRENT (fonte copag_loja_catalog)
    await tx((c) => importReferences(c, { import_id: 'teste-politica-copag', entries: [{ legacy_id: 'me04-box36', reference_kind: 'COPAG_OFFICIAL_CURRENT', value: 449.99, source: 'copag_loja_catalog',
      source_url: 'https://www.copagloja.com.br/box-display-pokemon-me04-caos-ascendente/p', observed_at: ago(1, now), verification_status: 'verified', verified_at: ago(1, now), confidence: 90, evidence_text: 'Price/ListPrice 449.99 no catálogo público (teste)' }] }));
    const legacy = { products: products.map((p) => ({ id: p.id })), offers: [], collections: catalog.collections };
    const st = await stateLikeFromDb(legacy, { now });
    const by = Object.fromEntries(st.products.map((p) => [p.id, p]));
    assert.equal(by['me05-etb'].copagConfirmed, true); assert.equal(by['me05-etb'].msrp, 399.99); assert.equal(by['me05-etb'].copagReferenceStatus, 'confirmado');
    assert.equal(by['c30-etb'].copagConfirmed, false, 'linha antiga do Instagram não confirma'); assert.equal(by['c30-etb'].copagReference, 399.99); assert.equal(by['c30-etb'].copagReferenceStatus, 'pendente');
    assert.equal(by['sv3-etb'].copagConfirmed, false, 'verificada há 40 dias: vencida'); assert.equal(by['sv3-etb'].copagReferenceStatus, 'expirado'); assert.equal(by['sv3-etb'].copagReference, 349.99);
    // catálogo oficial da loja Copag (auditoria), verificado há 1 dia com URL da loja: confirma na home, como a 010 no motor
    assert.equal(by['me04-box36'].copagConfirmed, true, 'copag_loja_catalog verificado e recente confirma'); assert.equal(by['me04-box36'].msrp, 449.99);
    assert.equal(by['me04-box36'].copagReferenceStatus, 'confirmado');
    // mesma decisão que o robô tomaria hoje com as mesmas fontes
    for (const p of products.slice(0, 3)) {
      const e = { ...p.copag, msrp: p.msrp };
      const rob = runMod.resolveCopag(p, { copag: p.id === 'c30-etb' ? { 'c30-etb': e } : {} }, p.id === 'c30-etb' ? {} : { [p.id]: e }, now).decision;
      assert.equal(by[p.id].copagConfirmed, rob.confirmed, p.id); assert.equal(by[p.id].copagReferenceStatus, rob.status, p.id);
    }
    // nenhuma linha some: a auditoria e a vencida continuam gravadas
    assert.equal(Number((await pg.query(`SELECT count(*) FROM hunter.reference_price r JOIN hunter.product p ON p.id = r.product_id WHERE p.legacy_id IN ('me04-box36', 'sv3-etb') AND r.verification_status = 'verified'`)).rows[0].count), 2);
    await closeApiPool(); await close();
  });
}
for (const k of ['DATABASE_URL', 'API_DATABASE_URL', 'HUNTER_CONFIG_DIR', 'HUNTER_DATA_DIR', 'HUNTER_DOMAIN_DELAY_MS', 'TELEGRAM_BOT_TOKEN', 'NTFY_TOPIC']) {
  if (savedEnv[k] === undefined) delete process.env[k]; else process.env[k] = savedEnv[k];
}
console.log(`✓ Política Copag: ${n} grupos de testes passaram${savedEnv.TEST_DATABASE_URL ? ' (puro + banco)' : ' (puro; banco pulado sem TEST_DATABASE_URL)'}`);
