// Frescor por oferta: reaproveitar leitura antiga (falha da fonte) nunca renova o horário nem inventa estoque.
// Puro (sem rede e sem banco): staleCopy / lastValidOf do robô + mapeamento para o banco.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import vm from 'node:vm';
import { classify, usable } from '../api/_lib/freshness.mjs';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hunter-offfresh-'));
process.env.HUNTER_CONFIG_DIR = path.join(tmp, 'config'); process.env.HUNTER_DATA_DIR = path.join(tmp, 'data');
const { staleCopy, lastValidOf } = await import('../src/run.js');
const { offersRows } = await import('../src/core/mappers.js');

const NOW = Date.parse('2026-10-09T18:00:00.000Z');
const ago = (min) => new Date(NOW - min * 6e4).toISOString();
const live = { id: 'o1', productId: 'me05-etb', storeId: 'loja', title: 'ETB', url: 'https://loja/etb', price: 300, total: 300, shipping: null,
  shippingKnown: false, stock: 'IN_STOCK', matchConfidence: 0.9, confirmed: true, stale: false, source_timestamp: ago(45), firstSeen: ago(5000) };
const row = (o) => offersRows([o])[0];
let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } };

t('1. falha da fonte: a cópia antiga mantém o horário da última leitura e vira estoque desconhecido', () => {
  const s = staleCopy(live);
  assert.equal(s.source_timestamp, live.source_timestamp, 'horário não é renovado');
  assert.equal(s.stale, true); assert.equal(s.stock, 'UNKNOWN');
  assert.deepEqual({ stock: s.lastValid.stock, total: s.lastValid.total, at: s.lastValid.at }, { stock: 'IN_STOCK', total: 300, at: live.source_timestamp });
});

t('2. falhas seguidas: nem horário nem lastValid mudam', () => {
  const s2 = staleCopy(staleCopy(live));
  assert.equal(s2.source_timestamp, live.source_timestamp);
  assert.equal(s2.lastValid.stock, 'IN_STOCK'); assert.equal(s2.lastValid.at, live.source_timestamp);
  assert.equal(lastValidOf(s2).stock, 'IN_STOCK', 'base de comparação é a leitura válida, não a falha');
  assert.equal(lastValidOf(staleCopy({ ...live, stale: true })), null, 'stale antiga sem lastValid: sem base');
});

t('3. banco: oferta reaproveitada vai como pending, estoque unknown e last_seen_at antigo', () => {
  const a = row(live); const s = row(staleCopy(live));
  assert.equal(a.status, 'active'); assert.equal(a.stock_status, 'in_stock');
  assert.equal(s.status, 'pending'); assert.equal(s.stock_status, 'unknown');
  assert.equal(s.last_seen_at, a.last_seen_at, 'last_seen_at não avança ao reaproveitar');
  assert.equal(new Date(s.last_seen_at).toISOString(), live.source_timestamp);
});

t('4. frescor derivado do horário da oferta: reaproveitada vai envelhecendo pelos limites configurados', () => {
  const s = staleCopy(live);
  assert.equal(classify(s.source_timestamp, NOW).status, 'atrasado');
  assert.equal(classify(s.source_timestamp, NOW + 60 * 6e4).status, 'desatualizado', '1 h depois, sem leitura nova, o mesmo horário já está desatualizado');
  assert.ok(usable(classify(s.source_timestamp, NOW)) && !usable(classify(s.source_timestamp, NOW + 60 * 6e4)));
  assert.equal(classify(s.source_timestamp, NOW + 25 * 60 * 6e4).status, 'indisponivel');
});

t('5. sem horário válido: desconhecido, nunca "atual"', () => {
  const r = row({ ...live, source_timestamp: null });
  assert.equal(r.last_seen_at, null);
  assert.equal(classify(r.last_seen_at, NOW).status, 'indisponivel');
});

// ------------------------------------------------------------------ interface (estados-ui 4): produto só com oferta stale
// Roda dealCard e renderProduct reais do index.html num sandbox (mesma montagem de search-product-flow-tests.js).
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const cut = (a, b) => { const i = html.indexOf(a); const j = html.indexOf(b, i); assert.ok(i > 0 && j > i, `trecho ${a}`); return html.slice(i, j); };
const cutFn = (a) => { const i = html.indexOf(a); assert.ok(i > 0, `função ${a}`); const j = html.indexOf('\n}\n', i); assert.ok(j > i, `fim de ${a}`); return html.slice(i, j + 3); };
const line = (prefix) => { const l = html.split('\n').find((x) => x.startsWith(prefix)); assert.ok(l, `linha ${prefix}`); return l; };
const text = (h) => h.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
const uiCode = [
  ...['const esc=', 'const money=', 'const pct=', 'const ago=', 'const safeUrl=', 'function stockChip', 'const live=', 'const nrm=', 'const thirdParty=',
    'const storeTxt=', 'const pixTag=', 'const pixTxt=', 'const label=', 'const shipNote=', 'const byTot=', 'const bestLive=',
    'let AFIL=', 'const AFIL_OK=', 'const mlItem=', 'const outUrl=', 'const outRel=', 'const afPref='].map(line),
  cut('const readKnown=', 'const shipNote='),
  cut('function scoreChip', 'function storeOffer'),
  cut('const BAND_UI=', 'const RARITY='),
  cut('function scoreMeter', 'function dealCard'), cutFn('function dealCard'),
  cut('let curPid=null;', 'function openProduct'),
  cutFn('function storeOffer'), cutFn('function renderProduct'), cut('/* "Também na Amazon"', '/* Conta: login'),
  line('let PENDING_HASH='), line('function hashScroll'),
].join('\n');
const isoAgo = (min) => new Date(Date.now() - min * 6e4).toISOString();
const PROD = { id: 'me05-etb', collection: 'me05', collectionName: 'Fogo Fantasmagórico', type: 'etb', typeLabel: 'Elite Trainer Box', group: 'Caixas', boosters: 9, copagConfirmed: false };
const uiOff = (id, x) => ({ id, productId: PROD.id, storeId: 's-' + id, storeName: 'Loja ' + id.toUpperCase(), seller: 'Loja ' + id.toUpperCase(), stock: 'IN_STOCK',
  price: 300, total: 300, shipping: null, shippingKnown: false, url: 'https://loja.example/' + id, source_timestamp: isoAgo(60), ...x });
function ui(OFF, prod = PROD) {
  const slots = { '#view': { innerHTML: '' } };
  const ctx = {
    console, S: { collections: [], products: [prod], reputation: { lojas: {} } }, OFF, P: { [prod.id]: prod }, SLUG: {}, F: { q: '' }, view: 'produto', CHANGED: new Set(), HIST: {}, REFNOTE: 'ref',
    STOCK: { IN_STOCK: ['ok', 'Em estoque'], OUT_OF_STOCK: ['bad', 'Sem estoque'], PRE_ORDER: ['warn', 'Pré-venda'], UNKNOWN: ['', 'Estoque desconhecido'] },
    $: (sel) => slots[sel] || null, ic: (id) => `<i data-ic="${id}"></i>`, dial: () => '', g: () => ({ c: '#000', icon: 'x' }), catOf: () => 'caixa', catChip: () => '',
    isFav: () => false, raBadge: () => '', photo: () => '<div class="photo"></div>', liveTips: () => [], tipCard: () => '',
    refOf: (p) => (p.copagConfirmed ? { v: p.msrp } : null), discOf: () => null,
    colHref: () => '', typeHref: () => '', favBtn: () => '', alertBox: () => '', scoreBlock: () => '', searchBox: () => '', drawHist() {}, loadHist() {}, loadPpOpp() {}, outrasLojasBlock: () => '',
    document: { title: '', getElementById: () => null },
  };
  vm.createContext(ctx);
  vm.runInContext(uiCode + '\n;globalThis.__t={dealCard,renderProduct,staleOnly};', ctx);
  return { ...ctx.__t, detail: (pid) => { ctx.__t.renderProduct(pid); return slots['#view'].innerHTML; } };
}

t('6. card sem oferta viva e só leitura antiga: diz há quanto tempo, não "Nenhuma loja com oferta agora"', () => {
  const s = ui([uiOff('a', { stale: true, stock: 'UNKNOWN', source_timestamp: isoAgo(5 * 60) }), uiOff('b', { stale: true, stock: 'UNKNOWN', source_timestamp: isoAgo(3 * 60) })]);
  const card = text(s.dealCard({ p: PROD, o: null, n: 0 }, { plain: true }));
  assert.match(card, /Última leitura há 3 h/, 'usa a leitura mais recente');
  assert.match(card, /Leitura antiga/);
  assert.doesNotMatch(card, /Nenhuma loja com oferta agora|Sem oferta agora/);
  const comRef = text(ui([uiOff('a', { stale: true, source_timestamp: isoAgo(90) })], { ...PROD, copagConfirmed: true, msrp: 349.9 }).dealCard({ p: { ...PROD, copagConfirmed: true, msrp: 349.9 }, o: null, n: 0 }));
  assert.match(comRef, /Última leitura há 2 h · Copag R\$/, 'com referência Copag, mantém o valor de referência');
  const semData = text(ui([uiOff('a', { stale: true, source_timestamp: null })]).dealCard({ p: PROD, o: null, n: 0 }));
  assert.match(semData, /Última leitura em data desconhecida/, 'sem horário válido não inventa idade');
});

t('7. card: sem nenhuma oferta, ou com leitura recente, mantém o texto atual', () => {
  assert.match(text(ui([]).dealCard({ p: PROD, o: null, n: 0 })), /Nenhuma loja com oferta agora/);
  const misto = ui([uiOff('a', { stale: true }), uiOff('b', { stock: 'OUT_OF_STOCK' })]);
  assert.equal(misto.staleOnly([uiOff('a', { stale: true }), uiOff('b', { stock: 'OUT_OF_STOCK' })]), null, 'leitura recente sem estoque não é "só leitura antiga"');
  assert.match(text(misto.dealCard({ p: PROD, o: null, n: 0 })), /Nenhuma loja com oferta agora/);
  const st = uiOff('a', { stale: true, stock: 'UNKNOWN' });
  assert.match(text(ui([st]).dealCard({ p: PROD, o: st, n: 0 })), /Leitura antiga/, 'card com a própria oferta stale avisa no selo, não "Sem estoque"');
});

t('8. página do produto só com oferta stale: aviso de leitura antiga com horário e loja', () => {
  const page = text(ui([uiOff('a', { stale: true, stock: 'UNKNOWN', source_timestamp: isoAgo(26 * 60) })]).detail(PROD.id));
  assert.match(page, /Leitura antiga Última leitura há 1 d, em Loja A\. Preço e estoque podem ter mudado/);
  assert.doesNotMatch(page, /Nenhuma loja confirma estoque neste momento/);
  const vivo = text(ui([uiOff('a', { stale: true }), uiOff('b', {})]).detail(PROD.id));
  assert.match(vivo, /Melhor preço com estoque|Menor preço com estoque/, 'com oferta viva a caixa de compra não muda');
  const fora = text(ui([uiOff('a', { stock: 'OUT_OF_STOCK' })]).detail(PROD.id));
  assert.match(fora, /Sem estoque confirmado agora Nenhuma loja confirma estoque neste momento/, 'leitura recente sem estoque mantém o texto atual');
});

console.log(`offer-freshness-tests: ${n} ok`);
