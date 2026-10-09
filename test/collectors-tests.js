// Lote 7 — coletores: falha passageira não vira remoção, reposição ou queda falsa (offline, fetch simulado).
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
process.env.HUNTER_DOMAIN_DELAY_MS = '0';
process.env.HUNTER_TIPS = '0';
for (const k of ['GITHUB_RUN_ID', 'GITHUB_RUN_ATTEMPT', 'GITHUB_SHA', 'GITHUB_EVENT_NAME', 'HUNTER_CEP', 'HUNTER_BUDGET_MIN']) delete process.env[k];
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hunter-col-'));
process.env.HUNTER_CONFIG_DIR = path.join(tmp, 'config'); process.env.HUNTER_DATA_DIR = path.join(tmp, 'data');
fs.mkdirSync(process.env.HUNTER_CONFIG_DIR, { recursive: true });
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
fs.copyFileSync(path.join(root, 'config/catalog.json'), path.join(tmp, 'config/catalog.json'));
fs.writeFileSync(path.join(tmp, 'config/stores.json'), JSON.stringify({ stores: [
  { id: 'vt', name: 'Loja VTEX', url: 'https://vt.test', platform: 'vtex', kind: 'specialist', evidence: {} },
  { id: 'ld', name: 'Loja JSON-LD', url: 'https://ld.test', platform: 'jsonld', kind: 'specialist', evidence: {} },
] }));
// Qualquer produto que volta ao estoque alerta; produto vigiado alerta queda.
fs.writeFileSync(path.join(tmp, 'config/watchlist.json'), JSON.stringify({ settings: { cep: null }, rules: [
  { id: 'rs', label: 'Voltou ao estoque', filter: {}, restock: true },
  { id: 'w', label: 'Vigia ME05', mode: 'target', filter: { productId: 'me05-box36' }, maxPrice: 1 },
] }));

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const html = (s, status = 200) => new Response(s, { status, headers: { 'content-type': 'text/html' } });
const http = await import('../src/http.js');

// ---- loja VTEX simulada
const vt = { down: false, sim: 'ok', a: { price: 449.9, qty: 5 }, b: { price: 289.9, qty: 0 }, c: null };
const vtItem = (name, link, id, x) => ({ productName: name, link, items: [{ itemId: id, name: 'u', sellers: [{ sellerId: '1', sellerName: 'Loja VTEX', commertialOffer: { Price: x.price, ListPrice: x.price, AvailableQuantity: x.qty } }] }] });
// ---- loja JSON-LD simulada: P1 (box), P2 (página sem produto, depois vira produto), P3 (blister que depois some: 404)
const brl = (v) => Number(v).toFixed(2).replace('.', ',');
const page = (name, price) => html(`<html><head><script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'Product', name, offers: { '@type': 'Offer', price, priceCurrency: 'BRL', availability: 'https://schema.org/InStock' } })}</script></head><body><h1>${name}</h1><p>R$ ${brl(price)}</p>${'x'.repeat(40000)}</body></html>`);
const P1 = '/pokemon-booster-box-caos-ascendente-36'; const P2 = '/pokemon-box-colecao-novidade'; const P3 = '/pokemon-blister-triplo-escuridao';
const ld = { down: false, p1: 'ok', p2: 'irrelevante', p3: 'ok', hits: {} };
http.setFetch(async (url) => {
  const u = new URL(url);
  if (u.pathname === '/robots.txt') return html('', 404);
  if (u.host === 'ld.test') {
    ld.hits[u.pathname] = (ld.hits[u.pathname] || 0) + 1;
    if (ld.down) return html('erro', 503);
    if (u.pathname === '/sitemap.xml') return html('<urlset>' + [P1, P2, P3].map((p) => `<url><loc>https://ld.test${p}</loc></url>`).join('') + '</urlset>');
    if (u.pathname === P1) {
      if (ld.p1 === 'timeout') throw Object.assign(new Error('aborted'), { name: 'AbortError' });
      return ld.p1 === '503' ? html('erro', 503) : page('Pokémon Booster Box Caos Ascendente 36 boosters Copag', '359.90');
    }
    if (u.pathname === P2) return ld.p2 === 'irrelevante' ? html('<title>Em breve</title><p>Página em construção</p>') : page('Pokémon Blister Quádruplo Caos Ascendente Copag', '54.90');
    if (u.pathname === P3) return ld.p3 === '404' ? html('não encontrado', 404) : page('Pokémon Blister Triplo Escuridão Absoluta Copag', '39.90');
  }
  if (u.host === 'vt.test') {
    if (vt.down) return html('erro', 503);
    if (u.pathname.includes('simulation')) return vt.sim === '500' ? html('erro', 500) : json({ logisticsInfo: [{ slas: vt.sim === 'vazio' ? [] : [{ price: 1990 }, { price: 2590 }] }] });
    if (u.pathname.startsWith('/api/catalog_system')) return json(u.searchParams.get('ft') === 'pokemon' ? [
      vtItem('Box Display Pokémon ME05 Escuridão Absoluta 36 Boosters Copag', 'https://vt.test/me05-display/p', '1', vt.a),
      vtItem('Box Treinador Avançado Caos Ascendente Copag', 'https://vt.test/me04-etb/p', '2', vt.b),
      ...(vt.c ? [vtItem('Pokémon Blister Triplo Caos Ascendente Copag', 'https://vt.test/me04-blister3/p', '3', vt.c)] : []),
    ] : []);
  }
  return html('', 404);
});

const { runOnce } = await import('../src/run.js');
const sent = []; const send = { capture: async (m) => { sent.push(m); return true; } };
const quiet = () => {};
const readData = (f) => JSON.parse(fs.readFileSync(path.join(process.env.HUNTER_DATA_DIR, f), 'utf8'));
const histRows = () => fs.readFileSync(path.join(process.env.HUNTER_DATA_DIR, 'history.jsonl'), 'utf8').trim().split('\n').filter(Boolean).map((l) => JSON.parse(l));
const at = (min) => new Date(Date.parse('2026-10-06T10:00:00Z') + min * 60e3);
const offerOf = (s, pid) => s.offers.find((o) => o.storeId === 'vt' && o.productId === pid);

// ===== Item 2: reposição falsa — em estoque → falha → recuperação
let s = await runOnce({ log: quiet, send, now: at(0) });
const A = offerOf(s, 'me05-box36'); const B = offerOf(s, 'me04-etb');
assert.ok(A && A.stock === 'IN_STOCK' && B && B.stock === 'OUT_OF_STOCK', 'leitura inicial');
const sent0 = sent.length;

vt.down = true;
s = await runOnce({ log: quiet, send, now: at(15) });
assert.equal(s.sources.find((x) => x.id === 'vt').status, 'ERROR');
{ const o = readData('offers.json')[A.id];
  assert.ok(o.stale && o.stock === 'UNKNOWN', 'falha: oferta fica como estoque não confirmado');
  assert.deepEqual({ stock: o.lastValid.stock, total: o.lastValid.total }, { stock: 'IN_STOCK', total: 449.9 }, 'guarda a última leitura válida');
  assert.equal(readData('offers.json')[B.id].lastValid.stock, 'OUT_OF_STOCK'); }
// segunda falha seguida: lastValid continua o da leitura válida (não o "UNKNOWN" da falha)
s = await runOnce({ log: quiet, send, now: at(30) });
assert.equal(readData('offers.json')[A.id].lastValid.stock, 'IN_STOCK', 'falhas seguidas não sobrescrevem a última leitura válida');

vt.down = false; vt.b.qty = 3; // A segue igual; B volta de verdade ao estoque
s = await runOnce({ log: quiet, send, now: at(45) });
{ const a = offerOf(s, 'me05-box36'); const b = offerOf(s, 'me04-etb');
  assert.ok(!a.stale && a.stock === 'IN_STOCK' && !('lastValid' in a), 'recuperada: leitura nova, sem resto da falha');
  assert.ok(!b.stale && b.stock === 'IN_STOCK');
  const novos = sent.slice(sent0);
  assert.ok(!novos.some((m) => /RESTOCK/.test(m.title) && /ESCURID/i.test(m.text)), 'em estoque → falha → em estoque: nenhuma reposição falsa');
  assert.ok(!novos.some((m) => /QUEDA/.test(m.title)), 'sem queda falsa');
  assert.equal(novos.filter((m) => /RESTOCK/.test(m.title)).length, 1, 'sem estoque → falha → em estoque: a reposição real continua avisada');
  const act = s.activity.filter((e) => e.t === at(45).toISOString());
  assert.deepEqual(act.map((e) => [e.offerId, e.type]), [[b.id, 'restock']], 'atividade: só a reposição real');
  // histórico consistente: A tem uma linha só (leitura inicial), sem linha "UNKNOWN" nem repetida na volta
  const hA = histRows().filter((r) => r.offerId === a.id);
  assert.equal(hA.length, 1, 'histórico de A sem linha da falha nem duplicada: ' + JSON.stringify(hA));
  const hB = histRows().filter((r) => r.offerId === b.id).map((r) => r.stock);
  assert.deepEqual(hB, ['OUT_OF_STOCK', 'IN_STOCK'], 'histórico de B: só leituras válidas'); }

// sucesso → falha → sucesso com o mesmo preço: nenhuma queda, nenhuma linha nova
const sent1 = sent.length; const h1 = histRows().length;
vt.down = true; await runOnce({ log: quiet, send, now: at(60) });
vt.down = false; s = await runOnce({ log: quiet, send, now: at(75) });
assert.equal(sent.length, sent1, 'sucesso → falha → sucesso: nenhum alerta');
assert.equal(histRows().length, h1, 'sucesso → falha → sucesso: histórico sem linhas novas');
assert.ok(offerOf(s, 'me05-box36').confirmed !== false, 'preço igual segue confirmado');

// ===== Item 1: JSON-LD — falha de leitura da página não remove a oferta; 404 remove; irrelevante é relida depois de 24 h
const ldOf = (s, pid) => s.offers.find((o) => o.storeId === 'ld' && o.productId === pid);
const L1 = ldOf(s, 'me04-box36'); const L3 = ldOf(s, 'me05-blister3');
assert.ok(L1 && L1.stock === 'IN_STOCK' && L3, 'JSON-LD: produtos lidos');
assert.ok(!s.offers.some((o) => o.storeId === 'ld' && /novidade/.test(o.url)), 'página sem produto não vira oferta');
assert.equal(ld.hits[P2], 1, 'página irrelevante lida uma vez');
const sentLd = sent.length;
ld.p1 = 'timeout'; ld.p3 = '404';
s = await runOnce({ log: quiet, send, now: at(90) });
{ assert.equal(s.sources.find((x) => x.id === 'ld').status, 'ACTIVE', 'uma página falhar não derruba a loja');
  const o = ldOf(s, 'me04-box36');
  assert.ok(o && o.stale && o.stock === 'UNKNOWN', 'timeout: oferta preservada como estoque não confirmado (não removida, não esgotada)');
  assert.equal(o.lastValid.stock, 'IN_STOCK');
  assert.ok(!ldOf(s, 'me05-blister3'), '404: produto não existe mais, oferta sai');
  const rows = histRows().filter((r) => r.t === at(90).toISOString());
  assert.ok(rows.some((r) => r.offerId === L3.id && r.event === 'removed'), '404 registra remoção');
  assert.ok(!rows.some((r) => r.offerId === L1.id), 'falha passageira não registra remoção nem esgotado');
  assert.ok(readData('url-cache.json').ld.relevant.includes('https://ld.test' + P1), 'página que falhou continua relevante (relida na próxima rodada)'); }
ld.p1 = '503';
s = await runOnce({ log: quiet, send, now: at(105) });
assert.ok(ldOf(s, 'me04-box36')?.stale, '5xx: oferta continua preservada');
ld.p1 = 'ok';
s = await runOnce({ log: quiet, send, now: at(120) });
{ const o = ldOf(s, 'me04-box36');
  assert.ok(o && !o.stale && o.stock === 'IN_STOCK' && o.total === 359.9, 'recuperação: oferta volta ao vivo');
  assert.equal(sent.length, sentLd, 'falha → recuperação: nenhum alerta (sem reposição nem queda falsa)');
  assert.ok(!histRows().some((r) => r.offerId === L1.id && r.t !== at(0).toISOString()), 'histórico da oferta sem linhas da falha nem da volta');
  assert.ok(!s.activity.some((e) => e.offerId === L1.id), 'atividade sem evento falso'); }
assert.equal(ld.hits[P2], 1, 'página irrelevante não é relida antes de 24 h');
// 25 h depois: a página irrelevante volta a ser lida (e agora é produto)
ld.p2 = 'produto';
s = await runOnce({ log: quiet, send, now: at(25 * 60) });
assert.equal(ld.hits[P2], 2, 'página irrelevante relida depois de 24 h');
assert.ok(ldOf(s, 'me04-blister4'), 'página que virou produto entra');
// todas as páginas fora do ar (5xx): nenhuma oferta removida, todas como estoque não confirmado
ld.down = true;
s = await runOnce({ log: quiet, send, now: at(25 * 60 + 15) });
assert.ok(ldOf(s, 'me04-box36')?.stale && ldOf(s, 'me04-blister4')?.stale, 'site fora do ar: ofertas preservadas como não confirmadas');
assert.ok(!histRows().some((r) => r.t === at(25 * 60 + 15).toISOString() && r.event === 'removed'), 'site fora do ar: nenhuma remoção');
ld.down = false;

// ===== Item 3: frete VTEX — simulação que falha não vira queda; último frete conhecido fica, com a data
const H = 27 * 60; const sent3 = sent.length; const h3 = histRows().length;
process.env.HUNTER_CEP = '01310-100';
s = await runOnce({ log: quiet, send, now: at(H) });
{ const a = offerOf(s, 'me05-box36');
  assert.deepEqual([a.shipping, a.shippingKnown, a.total, a.shippingAt, a.shippingError], [19.9, true, 469.8, at(H).toISOString(), null], 'frete simulado com a data da leitura'); }
vt.sim = '500'; vt.c = { price: 59.9, qty: 2 }; // simulação fora do ar; C aparece sem nenhum frete conhecido antes
s = await runOnce({ log: quiet, send, now: at(H + 15) });
{ const a = offerOf(s, 'me05-box36'); const c = offerOf(s, 'me04-blister3');
  assert.deepEqual([a.shipping, a.shippingKnown, a.total, a.shippingAt], [19.9, true, 469.8, at(H).toISOString()], 'simulação falhou: mantém o último frete conhecido com a data dele');
  assert.match(a.shippingError, /HTTP 500/, 'motivo da falha registrado');
  assert.ok(a.confirmed !== false, 'total igual: segue confirmado (sem queda pendente)');
  assert.deepEqual([c.shipping, c.shippingKnown, c.total, c.shippingAt], [null, false, 59.9, null], 'sem frete conhecido: fica desconhecido (nunca inventa)');
  assert.match(c.shippingError, /HTTP 500/); }
vt.sim = 'vazio';
s = await runOnce({ log: quiet, send, now: at(H + 30) });
{ const a = offerOf(s, 'me05-box36');
  assert.deepEqual([a.shipping, a.total, a.shippingAt], [19.9, 469.8, at(H).toISOString()]);
  assert.match(a.shippingError, /sem opção de entrega/, 'simulação sem opção de entrega: motivo registrado'); }
vt.sim = 'ok';
s = await runOnce({ log: quiet, send, now: at(H + 45) });
{ const a = offerOf(s, 'me05-box36'); const c = offerOf(s, 'me04-blister3');
  assert.deepEqual([a.shipping, a.shippingAt, a.shippingError], [19.9, at(H + 45).toISOString(), null], 'simulação de volta: data nova, sem erro');
  assert.deepEqual([c.shipping, c.shippingKnown, c.total], [19.9, true, 79.8], 'frete passou a ser conhecido: total sobe'); }
assert.ok(!sent.slice(sent3).some((m) => /QUEDA/.test(m.title)), 'frete: nenhum alerta de queda');
assert.ok(!s.activity.some((e) => e.type === 'drop' && Date.parse(e.t) >= at(H).getTime()), 'frete: nenhuma queda na atividade');
assert.ok(!histRows().slice(h3).some((r) => r.offerId === offerOf(s, 'me05-box36').id && r.total !== 469.8), 'histórico de A sem total sem frete');
// sem CEP configurado o frete deixa de ser simulado (desconhecido): o total cai, o preço não — não é queda
delete process.env.HUNTER_CEP; const sent4 = sent.length;
for (const m of [60, 75, 90]) s = await runOnce({ log: quiet, send, now: at(H + m) });
{ const a = offerOf(s, 'me05-box36');
  assert.deepEqual([a.shipping, a.shippingKnown, a.total], [null, false, 449.9], 'sem CEP: frete desconhecido, total sem frete');
  assert.ok(a.confirmed !== false, 'sem CEP: não fica pendente de queda');
  assert.ok(!sent.slice(sent4).some((m) => /QUEDA/.test(m.title)), 'frete que sumiu: nenhum alerta de queda');
  assert.ok(!s.activity.some((e) => e.type === 'drop' && e.offerId === a.id), 'frete que sumiu: nenhuma queda na atividade'); }

// ===== Item 4 (parte da rodada): a fonte guarda quando trouxe anúncios pela última vez e o registro da rodada leva
// as fontes vigiadas (o vigia avisa quando a fonte historicamente ativa zera ou fica bloqueada 2×)
{ const last = s.generatedAt; vt.down = true; await runOnce({ log: quiet, send, now: at(H + 105) }); vt.down = false;
  const src = readData('sources.json').vt;
  assert.equal(src.status, 'ERROR'); assert.equal(src.lastNonEmpty, last, 'falha não apaga a última rodada com anúncios');
  const meta = readData('meta.json');
  assert.ok(meta.ops.last.watched && typeof meta.ops.last.watched === 'object', 'registro da rodada traz as fontes vigiadas');
  const { watchedSummary } = await import('../src/opstate.js');
  assert.deepEqual(watchedSummary({ mercadolivre: { ...src, name: 'Mercado Livre' } }).mercadolivre, { name: 'Mercado Livre', status: 'ERROR', listings: src.listings, lastNonEmpty: last }); }

console.log('OK — coletores (lote 7)');
