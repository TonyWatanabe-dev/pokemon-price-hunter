// Validade da cotação de frete reaproveitada (offline, fetch simulado): só dentro do TTL (padrão 24 h), sempre com a
// data da cotação original; vencida ou ausente, o frete fica desconhecido — e isso não vira queda de preço.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
process.env.HUNTER_DOMAIN_DELAY_MS = '0';
process.env.HUNTER_TIPS = '0';
for (const k of ['GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'GITHUB_SHA', 'GITHUB_EVENT_NAME', 'HUNTER_CEP', 'HUNTER_BUDGET_MIN', 'HUNTER_SHIPPING_TTL_H']) delete process.env[k];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hunter-frete-'));
process.env.HUNTER_CONFIG_DIR = path.join(tmp, 'config'); process.env.HUNTER_DATA_DIR = path.join(tmp, 'data');
fs.mkdirSync(process.env.HUNTER_CONFIG_DIR, { recursive: true });
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
fs.copyFileSync(path.join(root, 'config/catalog.json'), path.join(tmp, 'config/catalog.json'));
fs.writeFileSync(path.join(tmp, 'config/stores.json'), JSON.stringify({ stores: [
  { id: 'vt', name: 'Loja VTEX', url: 'https://vt.test', platform: 'vtex', kind: 'specialist', evidence: {} },
] }));
fs.writeFileSync(path.join(tmp, 'config/watchlist.json'), JSON.stringify({ settings: { cep: null }, rules: [
  { id: 'w', label: 'Vigia ME05', mode: 'target', filter: { productId: 'me05-box36' }, maxPrice: 1 },
] }));

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const html = (s, status = 200) => new Response(s, { status, headers: { 'content-type': 'text/html' } });
const http = await import('../src/http.js');
const vt = { sim: 'ok', c: false };
const vtItem = (name, link, id, price, qty) => ({ productName: name, link, items: [{ itemId: id, name: 'u', sellers: [{ sellerId: '1', sellerName: 'Loja VTEX', commertialOffer: { Price: price, ListPrice: price, AvailableQuantity: qty } }] }] });
http.setFetch(async (url) => {
  const u = new URL(url);
  if (u.pathname === '/robots.txt') return html('', 404);
  if (u.host === 'vt.test') {
    if (u.pathname.includes('simulation')) return vt.sim === '500' ? html('erro', 500) : json({ logisticsInfo: [{ slas: [{ price: 1990 }] }] });
    if (u.pathname.startsWith('/api/catalog_system')) return json(u.searchParams.get('ft') === 'pokemon' ? [
      vtItem('Box Display Pokémon ME05 Escuridão Absoluta 36 Boosters Copag', 'https://vt.test/me05-display/p', '1', 449.9, 5),
      ...(vt.c ? [vtItem('Pokémon Blister Triplo Caos Ascendente Copag', 'https://vt.test/me04-blister3/p', '3', 59.9, 2)] : []),
    ] : []);
  }
  return html('', 404);
});

const { runOnce, shippingQuoteReuse, shippingTtlMs } = await import('../src/run.js');
const { recordActivity } = await import('../src/activity.js');
const sent = []; const send = { capture: async (m) => { sent.push(m); return true; } };
const quiet = () => {};
const histRows = () => fs.readFileSync(path.join(process.env.HUNTER_DATA_DIR, 'history.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
const at = (min) => new Date(Date.parse('2026-10-06T10:00:00Z') + min * 60e3);
const offerOf = (s, pid) => s.offers.find((o) => o.storeId === 'vt' && o.productId === pid);
const view = (o) => [o.shipping, o.shippingKnown, o.total, o.shippingAt, o.shippingSource ?? null];
let n = 0; const t = async (name, fn) => { try { await fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } };

// ---------------------------------------------------------------- regra pura
await t('shippingQuoteReuse: dentro da validade, com a data original', () => {
  const old = { shippingKnown: true, shipping: 19.9, shippingAt: '2026-10-06T10:00:00.000Z' };
  assert.deepEqual(shippingQuoteReuse(old, at(23 * 60)), { shipping: 19.9, shippingAt: '2026-10-06T10:00:00.000Z' });
  assert.equal(shippingQuoteReuse(old, at(24 * 60 + 1)), null, 'vencida (24 h + 1 min)');
  assert.equal(shippingQuoteReuse({ ...old, shippingAt: null }, at(10)), null, 'sem data da cotação: não reaproveita');
  assert.equal(shippingQuoteReuse({ ...old, shippingAt: 'lixo' }, at(10)), null, 'data inválida: não reaproveita');
  assert.equal(shippingQuoteReuse({ ...old, shippingAt: '2026-10-07T10:00:00Z' }, at(10)), null, 'data no futuro: não reaproveita');
  assert.equal(shippingQuoteReuse({ shippingKnown: false, shipping: null }, at(10)), null, 'sem frete conhecido');
  assert.equal(shippingQuoteReuse(null, at(10)), null, 'sem oferta anterior');
  assert.equal(shippingQuoteReuse({ ...old, shipping: 0 }, at(10))?.shipping, 0, 'frete grátis cotado também vale');
});
await t('TTL configurável por HUNTER_SHIPPING_TTL_H (padrão 24 h; inválido volta ao padrão)', () => {
  assert.equal(shippingTtlMs(), 24 * 3600e3);
  process.env.HUNTER_SHIPPING_TTL_H = '6'; assert.equal(shippingTtlMs(), 6 * 3600e3);
  process.env.HUNTER_SHIPPING_TTL_H = 'abc'; assert.equal(shippingTtlMs(), 24 * 3600e3);
  process.env.HUNTER_SHIPPING_TTL_H = '0'; assert.equal(shippingTtlMs(), 24 * 3600e3);
  delete process.env.HUNTER_SHIPPING_TTL_H;
});

// ---------------------------------------------------------------- rodadas reais (fetch simulado)
process.env.HUNTER_CEP = '01310-100';
let s;
await t('cotação recente: frete simulado, data da leitura, origem "simulacao"', async () => {
  s = await runOnce({ log: quiet, send, now: at(0) });
  s = await runOnce({ log: quiet, send, now: at(15) }); // 2ª rodada confirma a oferta
  assert.deepEqual(view(offerOf(s, 'me05-box36')), [19.9, true, 469.8, at(15).toISOString(), 'simulacao']);
});
const sent0 = sent.length; const h0 = histRows().length;
await t('simulação falha dentro da validade: reaproveita com a data ORIGINAL (não renova)', async () => {
  vt.sim = '500';
  s = await runOnce({ log: quiet, send, now: at(15 + 120) });
  assert.deepEqual(view(offerOf(s, 'me05-box36')), [19.9, true, 469.8, at(15).toISOString(), 'anterior']);
  s = await runOnce({ log: quiet, send, now: at(15 + 23 * 60) }); // falhas seguidas: a data continua a da cotação
  assert.deepEqual(view(offerOf(s, 'me05-box36')), [19.9, true, 469.8, at(15).toISOString(), 'anterior']);
  assert.match(offerOf(s, 'me05-box36').shippingError, /HTTP 500/);
});
await t('cotação vencida (mais de 24 h desde a cotação original): frete desconhecido', async () => {
  s = await runOnce({ log: quiet, send, now: at(15 + 24 * 60 + 15) });
  const a = offerOf(s, 'me05-box36');
  assert.deepEqual(view(a), [null, false, 449.9, null, null]);
  assert.match(a.shippingError, /HTTP 500/, 'motivo continua registrado');
});
await t('sem cotação anterior: frete desconhecido (nunca inventado)', async () => {
  vt.c = true;
  s = await runOnce({ log: quiet, send, now: at(15 + 24 * 60 + 30) });
  assert.deepEqual(view(offerOf(s, 'me04-blister3')), [null, false, 59.9, null, null]);
});
await t('frete vencido não vira queda: sem alerta, sem queda na atividade, sem preço pendente', async () => {
  const a = offerOf(s, 'me05-box36');
  assert.ok(a.confirmed !== false, 'total caiu só pelo frete: não fica pendente de queda');
  assert.ok(!sent.slice(sent0).some((m) => /QUEDA/.test(m.title)), 'nenhum alerta de queda');
  assert.ok(!s.activity.some((e) => e.type === 'drop' && e.offerId === a.id), 'nenhuma queda na atividade');
  assert.ok(histRows().slice(h0).some((r) => r.offerId === a.id && r.total === 449.9 && r.shipping == null), 'o histórico registra o total sem frete, marcado como frete desconhecido');
});
await t('simulação volta: cotação nova com data nova', async () => {
  vt.sim = 'ok';
  s = await runOnce({ log: quiet, send, now: at(15 + 25 * 60) });
  assert.deepEqual(view(offerOf(s, 'me05-box36')), [19.9, true, 469.8, at(15 + 25 * 60).toISOString(), 'simulacao']);
});
await t('TTL menor também vale na rodada', async () => {
  process.env.HUNTER_SHIPPING_TTL_H = '1'; vt.sim = '500';
  s = await runOnce({ log: quiet, send, now: at(15 + 25 * 60 + 30) });
  assert.equal(offerOf(s, 'me05-box36').shippingSource, 'anterior', '30 min: dentro de 1 h');
  s = await runOnce({ log: quiet, send, now: at(15 + 25 * 60 + 75) });
  assert.equal(offerOf(s, 'me05-box36').shippingKnown, false, '75 min: vencida com TTL de 1 h');
  delete process.env.HUNTER_SHIPPING_TTL_H; vt.sim = 'ok';
});

// ---------------------------------------------------------------- atividade montada do histórico (primeira vez)
await t('atividade a partir do histórico: total que cai só porque o frete ficou desconhecido não é queda', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'hunter-frete-act-')); const old = process.env.HUNTER_DATA_DIR;
  process.env.HUNTER_DATA_DIR = dir;
  const T0 = Date.now() - 3 * 3600e3; const iso = (m) => new Date(T0 + m * 60e3).toISOString();
  const row = (m, extra) => JSON.stringify({ t: iso(m), offerId: 'o1', productId: 'me05-box36', storeId: 'vt', price: 449.9, stock: 'IN_STOCK', ...extra });
  fs.writeFileSync(path.join(dir, 'history.jsonl'), [row(0, { shipping: 19.9, total: 469.8 }), row(15, { shipping: null, total: 449.9 }), row(30, { shipping: 19.9, total: 469.8 }), row(45, { price: 419.9, shipping: 19.9, total: 439.8 })].join('\n') + '\n');
  const products = { 'me05-box36': { id: 'me05-box36', msrp: 499.9 } };
  const offers = { o1: { id: 'o1', productId: 'me05-box36', storeId: 'vt', stock: 'IN_STOCK', total: 439.8, shippingKnown: true } };
  const act = recordActivity({ T: iso(60), offers, prev: offers, products, newLowest: new Map(), storeNames: { vt: 'Loja VTEX' } });
  process.env.HUNTER_DATA_DIR = old;
  const drops = act.filter((e) => e.type === 'drop').map((e) => [e.from, e.to]);
  assert.deepEqual(drops, [[469.8, 439.8]], 'só a queda real (com frete nos dois lados); 469,80 → 449,90 sem frete não conta');
});

console.log(`✓ Validade da cotação de frete: ${n} grupos passaram`);
