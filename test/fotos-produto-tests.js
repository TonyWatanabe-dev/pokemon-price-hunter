// Foto fixa por produto (config/fotos-produto.json): vence a foto da primeira loja que casou (caso ETB 30 anos, 31/10).
// runOnce com fetch simulado e dados em pasta temporária; nenhuma rede real nem banco.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
process.env.HUNTER_DOMAIN_DELAY_MS ??= '0';
const http = await import('../src/http.js');
http.setSleep(async () => {});
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const NOMES = { a: 'Box Display Pokémon ME05 Escuridão Absoluta 36 Boosters Copag', b: 'Pokémon TCG Elite Trainer Box ME03 Equilíbrio Perfeito Copag' };
const prod = (slug, nome, qty = 0) => ({ productName: nome, linkText: slug, items: [{ itemId: slug, name: 'x', images: [{ imageUrl: `https://loja.example/${slug}.jpg` }], sellers: [{ sellerId: '1', sellerName: 'Loja', sellerDefault: true, commertialOffer: { Price: 449.9, AvailableQuantity: qty } }] }] });
const filler = (i) => prod(`boneco-${i}`, `Boneco de vinil ${i}`, 1);

const rotas = {};
http.setFetch(async (url) => {
  const u = new URL(url); const r = rotas[u.host];
  if (u.pathname === '/robots.txt' || !r) return new Response('', { status: 404 });
  if (u.pathname !== '/api/catalog_system/pub/products/search') return new Response('', { status: 404 });
  const ft = u.searchParams.get('ft'); const from = Number(u.searchParams.get('_from')); const to = Number(u.searchParams.get('_to'));
  const lista = ft === 'pokemon' ? r() : [];
  return new Response(JSON.stringify(lista.slice(from, to + 1)), { status: 200, headers: { 'content-type': 'application/json' } });
});
const { runOnce } = await import('../src/run.js');

/** Loja VTEX `host`; `lista()` devolve todos os anúncios da busca "pokemon" (com mais de 500, a leitura é parcial). */
async function cenario(host, corpo, fotos = null) {
  const keep = Object.fromEntries(['HUNTER_CONFIG_DIR', 'HUNTER_DATA_DIR', 'HUNTER_TIPS', 'HUNTER_CEP', 'HUNTER_BUDGET_MIN'].map((k) => [k, process.env[k]]));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hunter-fotos-'));
  try {
    process.env.HUNTER_CONFIG_DIR = path.join(tmp, 'config'); process.env.HUNTER_DATA_DIR = path.join(tmp, 'data'); process.env.HUNTER_TIPS = '0';
    delete process.env.HUNTER_CEP; delete process.env.HUNTER_BUDGET_MIN;
    fs.mkdirSync(process.env.HUNTER_CONFIG_DIR, { recursive: true }); fs.mkdirSync(process.env.HUNTER_DATA_DIR, { recursive: true });
    fs.copyFileSync(path.join(root, 'config/catalog.json'), path.join(tmp, 'config/catalog.json'));
    const id = host.split('.')[0];
    fs.writeFileSync(path.join(tmp, 'config/stores.json'), JSON.stringify({ stores: [{ id, name: id, url: `https://${host}`, platform: 'vtex', kind: 'specialist', evidence: {} }] }));
    if (fotos) fs.writeFileSync(path.join(tmp, 'config/fotos-produto.json'), JSON.stringify({ fotos }));
    fs.writeFileSync(path.join(tmp, 'config/watchlist.json'), JSON.stringify({ settings: { cep: null }, rules: [] }));
    const read = (f) => JSON.parse(fs.readFileSync(path.join(tmp, 'data', f), 'utf8'));
    const hist = () => fs.readFileSync(path.join(tmp, 'data/history.jsonl'), 'utf8').split('\n').filter(Boolean).map((x) => JSON.parse(x));
    const oferta = (slug) => Object.values(read('offers.json')).find((o) => o.storeId === id && o.url === `https://${host}/${slug}/p`);
    const src = () => read('sources.json')[id];
    const produto = (pid) => read('products.json')[pid];
    const t0 = Date.parse('2026-10-20T12:00:00Z');
    const rodada = async (lista, horas) => { rotas[host] = lista; await runOnce({ log: () => {}, send: { capture: async () => true }, now: new Date(t0 + horas * 3600e3) }); };
    await corpo({ rodada, oferta, src, hist, produto, read });
  } finally {
    for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
const FOTO = 'https://tcgpricehunter.com.br/assets/web/produtos/x-v1.webp';
let n = 0;
await cenario('foto.test', async ({ rodada, oferta, produto, read }) => {
  await rodada(() => [prod('box-me05', NOMES.a, 3), prod('etb-me03', NOMES.b, 3)], 0);
  const pa = oferta('box-me05').productId; const pb = oferta('etb-me03').productId;
  assert.equal(produto(pa).image, FOTO, 'produto com foto fixa usa a foto do arquivo');
  assert.equal(pa, 'me05-box36'); assert.equal(pb, 'me03-etb');
  assert.equal(produto(pb).image, 'https://loja.example/etb-me03.jpg', 'foto fixa sem https é ignorada: segue a da loja');
  assert.equal(produto('produto-que-nao-existe'), undefined, 'não cria produto');
  assert.equal(oferta('box-me05').image, 'https://loja.example/box-me05.jpg', 'a oferta guarda a foto da loja');
  const st = read('state.json'); assert.equal(st.products.find((p) => p.id === pa).image, FOTO, 'state.json (site) usa a foto fixa');
  await rodada(() => [prod('box-me05', NOMES.a, 3), prod('etb-me03', NOMES.b, 3)], 1);
  assert.equal(produto(pa).image, FOTO, 'continua na rodada seguinte');
  n++;
}, { 'me05-box36': FOTO, 'me03-etb': 'http://loja.example/inseguro.jpg', 'produto-que-nao-existe': FOTO });
console.log(`✓ fotos-produto: ${n} cenário passou`);
