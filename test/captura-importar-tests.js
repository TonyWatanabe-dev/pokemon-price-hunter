// Importador do botão "Capturar ofertas" (27/11/2026): normaliza ids das três lojas, casa com o catálogo real e filtra.
import assert from 'node:assert/strict';
const { normalizar, selecionar, POR_PRODUTO } = await import('../tools/captura-importar.mjs');
const { loadCatalog } = await import('../src/run.js');
const at = '2026-11-27T20:00:00Z';
assert.equal(normalizar({ loja: 'mercadolivre', id: 'MLB-5551000001', titulo: 'x', preco: 10, capturadoEm: at }).id, 'MLB5551000001');
assert.equal(normalizar({ loja: 'mercadolivre', id: 'MLB55', titulo: 'x', preco: 10, capturadoEm: at }), null, 'id curto');
assert.equal(normalizar({ loja: 'amazon', id: 'B0ABCDEF12', titulo: 'x', preco: 0, capturadoEm: at }), null, 'sem preço');
assert.equal(normalizar({ loja: 'shopee', id: '123456/7890123', titulo: 'x', preco: 9.9, precoDe: 5, capturadoEm: at }).precoDe, null, 'preço "de" menor não vale');
assert.equal(normalizar({ loja: 'outra', id: 'a', titulo: 'x', preco: 1, capturadoEm: at }), null);
const cat = loadCatalog();
const it = (id, titulo, preco, loja = 'mercadolivre') => ({ loja, id, titulo, preco, capturadoEm: at });
const { sel, fora } = selecionar([
  it('MLB5551000001', 'Blister Quádruplo Pokémon TCG Escuridão Absoluta ME05 Copag', 89.9),
  it('MLB5551000001', 'Blister Quádruplo Pokémon TCG Escuridão Absoluta ME05 Copag', 89.9),
  it('MLB5551000002', 'Carta Pokémon Charizard ex avulsa', 50),
  it('MLB5551000003', 'Blister Pokémon sortido ou Triplo', 30),
  ...Array.from({ length: 7 }, (_, i) => it('MLB555100010' + i, 'Blister Quádruplo Pokémon TCG Escuridão Absoluta ME05 Copag', 90 + i)),
], cat);
const ids = sel.map((s) => s.id);
assert.ok(ids.includes('MLB5551000001') && !ids.includes('MLB5551000002') && !ids.includes('MLB5551000003'));
assert.equal(new Set(sel.map((s) => s.productId)).size, 1);
assert.equal(sel.length, POR_PRODUTO, 'até 5 mais baratos por produto e loja');
assert.ok(fora['carta avulsa'] >= 1 || fora['sem produto do catálogo'] >= 1);
console.log('captura-importar-tests: ok');

// Gravação (api/_lib/affiliates.mjs → gravarCaptura) numa pasta de config temporária.
{
  const fs = await import('node:fs'); const os = await import('node:os'); const path = await import('node:path');
  const { gravarCaptura } = await import('../api/_lib/affiliates.mjs');
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'cap-')); fs.mkdirSync(path.join(dir, 'afiliados'));
  fs.writeFileSync(path.join(dir, 'affiliates.json'), JSON.stringify({ mercadolivre: { anuncios: { MLB5551000001: 'https://meli.la/abc' } } }));
  fs.writeFileSync(path.join(dir, 'afiliados', 'shopee.json'), JSON.stringify({ links: { '111111/222222': 'https://s.shopee.com.br/AbC123' } }));
  fs.writeFileSync(path.join(dir, 'afiliados', 'amazon.json'), JSON.stringify({ links: [{ asin: 'B0ABCDEF12', productId: 'p', title: 't', price: 1, shortUrl: 'https://link.amazon/x1', capturedAt: '2026-11-01T00:00:00Z' }] }));
  const s = (loja, id) => ({ loja, id, titulo: 'T', preco: 10, precoDe: null, vendedor: null, freteGratis: false, capturadoEm: at, productId: 'p1' });
  const r = gravarCaptura([s('mercadolivre', 'MLB5551000001'), s('mercadolivre', 'MLB5551000009'), s('shopee', '111111/222222'), s('shopee', '111111/999999'), s('amazon', 'B0ABCDEF12'), s('amazon', 'B0NOVO0001')], { dir });
  assert.deepEqual(r.gravados, { mercadolivre: 1, shopee: 1, amazon: 1 });
  assert.deepEqual(Object.fromEntries(Object.entries(r.semLink).map(([k, v]) => [k, v.length])), { mercadolivre: 1, shopee: 1, amazon: 1 });
  const ml = JSON.parse(fs.readFileSync(path.join(dir, 'afiliados', 'ml-ofertas.json'), 'utf8'));
  assert.equal(ml.ofertas[0].item, 'MLB5551000001');
  const le = JSON.parse(fs.readFileSync(path.join(dir, 'afiliados', 'ml-leituras.json'), 'utf8'));
  assert.deepEqual(le.ofertas.map((x) => [x.item, x.url]), [['MLB5551000001', 'https://meli.la/abc']], 'captura do ML também vai para a fila do WhatsApp, com o link do mapa');
  const am = JSON.parse(fs.readFileSync(path.join(dir, 'afiliados', 'amazon.json'), 'utf8'));
  assert.equal(am.links[0].price, 10); assert.equal(am.links[0].shortUrl, 'https://link.amazon/x1', 'link do dono preservado');
  console.log('captura-importar-tests: gravação ok');
}

// Kits e preço fora da curva (lote real de 27/11/2026).
{
  const L = (id, t, p) => ({ loja: 'mercadolivre', id, titulo: t, preco: p, capturadoEm: at });
  const { sel } = selecionar([
    L('MLB6661000001', 'Kit 2x Blister Triplo Pokémon Reinado Delta - Me06 Copag', 83),
    L('MLB6661000002', 'Caixa Lacrada Pokémon 12 Blister Quadruplo Reinado Delta', 1799),
    L('MLB6661000003', 'Blister Triplo Pokémon Reinado Delta Me06 Copag', 49),
    L('MLB6661000004', 'Blister Triplo Pokémon Reinado Delta Me06 Copag Spritzee', 52),
    L('MLB6661000005', 'Blister Triplo Pokémon Reinado Delta Me06', 50),
    L('MLB6661000006', 'Blister Triplo Pokémon Reinado Delta Me06 Original', 529),
  ], cat);
  assert.deepEqual(sel.map((s) => s.id).sort(), ['MLB6661000003', 'MLB6661000004', 'MLB6661000005'], 'sem kit, caixa de vários e preço fora da curva');
  console.log('captura-importar-tests: kits e outliers ok');
}

// Teto por formato vale também para grupo de 1 oferta (revisão da PR #1069).
{
  const { tetoDe } = await import('../tools/captura-importar.mjs');
  assert.equal(tetoDe('me06-blister3'), 250); assert.equal(tetoDe('sv9-etb-en'), 900); assert.equal(tetoDe('me06-box36'), 1620); assert.equal(tetoDe('c30-booster'), 120);
  const L = (id, t, p) => ({ loja: 'mercadolivre', id, titulo: t, preco: p, capturadoEm: at });
  const { sel } = selecionar([L('MLB6662000001', 'Box Pokémon TCG Treinador Avançado ME 6 Reinado Delta', 1999)], cat);
  assert.equal(sel.length, 0, 'ETB a R$ 1.999 sozinho no grupo não passa');
  const { sel: s2 } = selecionar([L('MLB6662000002', 'Box Pokémon TCG Treinador Avançado ME 6 Reinado Delta', 399)], cat);
  assert.equal(s2.length, 1, 'ETB a preço normal passa');
  console.log('captura-importar-tests: teto por formato ok');
}
