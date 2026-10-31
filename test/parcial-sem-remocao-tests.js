// Leitura parcial (teto de páginas) não prova remoção — caso Ri Happy (VTEX, 1.800+ anúncios, teto de 500): a oferta que
// ficou além do teto numa rodada não sai como "removed"; fica como não confirmada por até AUSENCIA_PARCIAL_H horas.
// runOnce com fetch simulado e dados em pasta temporária; nenhuma rede real nem banco.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
process.env.HUNTER_DOMAIN_DELAY_MS ??= '0';
const http = await import('../src/http.js');
http.setSleep(async () => {});
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const NOMES = { a: 'Box Display Pokémon ME05 Escuridão Absoluta 36 Boosters Copag', b: 'Pokémon TCG Elite Trainer Box ME03 Equilíbrio Perfeito Copag' };
const prod = (slug, nome, qty = 0) => ({ productName: nome, linkText: slug, items: [{ itemId: slug, name: 'x', sellers: [{ sellerId: '1', sellerName: 'Loja', sellerDefault: true, commertialOffer: { Price: 449.9, AvailableQuantity: qty } }] }] });
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
async function cenario(host, corpo) {
  const keep = Object.fromEntries(['HUNTER_CONFIG_DIR', 'HUNTER_DATA_DIR', 'HUNTER_TIPS', 'HUNTER_CEP', 'HUNTER_BUDGET_MIN'].map((k) => [k, process.env[k]]));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hunter-parcial-'));
  try {
    process.env.HUNTER_CONFIG_DIR = path.join(tmp, 'config'); process.env.HUNTER_DATA_DIR = path.join(tmp, 'data'); process.env.HUNTER_TIPS = '0';
    delete process.env.HUNTER_CEP; delete process.env.HUNTER_BUDGET_MIN;
    fs.mkdirSync(process.env.HUNTER_CONFIG_DIR, { recursive: true }); fs.mkdirSync(process.env.HUNTER_DATA_DIR, { recursive: true });
    fs.copyFileSync(path.join(root, 'config/catalog.json'), path.join(tmp, 'config/catalog.json'));
    const id = host.split('.')[0];
    fs.writeFileSync(path.join(tmp, 'config/stores.json'), JSON.stringify({ stores: [{ id, name: id, url: `https://${host}`, platform: 'vtex', kind: 'specialist', evidence: {} }] }));
    fs.writeFileSync(path.join(tmp, 'config/watchlist.json'), JSON.stringify({ settings: { cep: null }, rules: [] }));
    const read = (f) => JSON.parse(fs.readFileSync(path.join(tmp, 'data', f), 'utf8'));
    const hist = () => fs.readFileSync(path.join(tmp, 'data/history.jsonl'), 'utf8').split('\n').filter(Boolean).map((x) => JSON.parse(x));
    const oferta = (slug) => Object.values(read('offers.json')).find((o) => o.storeId === id && o.url === `https://${host}/${slug}/p`);
    const src = () => read('sources.json')[id];
    const t0 = Date.parse('2026-10-20T12:00:00Z');
    const rodada = async (lista, horas) => { rotas[host] = lista; await runOnce({ log: () => {}, send: { capture: async () => true }, now: new Date(t0 + horas * 3600e3) }); };
    await corpo({ rodada, oferta, src, hist });
  } finally {
    for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}
const muitos = (...extras) => [...extras, ...Array.from({ length: 600 }, (_, i) => filler(i))]; // 600+: teto de 10 páginas

let n = 0;
await cenario('parcial.test', async ({ rodada, oferta, src, hist }) => {
  // rodada 1: os dois produtos Pokémon aparecem (a esgotado, b em estoque); leitura parcial
  await rodada(() => muitos(prod('box-me05', NOMES.a, 0), prod('etb-me03', NOMES.b, 3)), 0);
  assert.match(src().partial, /teto de 10 páginas/);
  const a1 = oferta('box-me05'); assert.ok(a1 && !a1.stale && a1.stock === 'OUT_OF_STOCK');
  // rodada 2 (1 h depois): a API reordena e o esgotado cai além do teto
  await rodada(() => [...muitos(prod('etb-me03', NOMES.b, 3)), prod('box-me05', NOMES.a, 0)], 1); // posição 601: não lida
  const a2 = oferta('box-me05');
  assert.ok(a2, 'a oferta ausente continua no estado');
  assert.equal(a2.stale, true); assert.equal(a2.stock, 'UNKNOWN', 'fica como não confirmada');
  assert.equal(a2.lastValid.stock, 'OUT_OF_STOCK', 'guarda a última leitura válida');
  assert.equal(a2.ausenteDesde, new Date(Date.parse('2026-10-20T13:00:00Z')).toISOString(), 'marca desde quando está ausente');
  assert.equal(hist().filter((h) => h.event === 'removed' && h.offerId === a1.id).length, 0, 'sem evento removed');
  assert.equal(src().ausentesParcial, 1);
  // rodada 3 (2 h): volta igual → sem "removed", sem linha nova de histórico (mesma leitura válida), sem marca de ausência
  const linhas = hist().filter((h) => h.offerId === a1.id).length;
  await rodada(() => muitos(prod('box-me05', NOMES.a, 0), prod('etb-me03', NOMES.b, 3)), 2);
  const a3 = oferta('box-me05');
  assert.ok(!a3.stale && a3.stock === 'OUT_OF_STOCK' && a3.ausenteDesde === undefined, 'voltou como leitura normal');
  assert.equal(hist().filter((h) => h.offerId === a1.id).length, linhas, 'esgotado → ausente → esgotado não gera histórico');
  assert.equal(a3.firstSeen, a1.firstSeen, 'não vira oferta nova');
  // rodada 4 (3 h) some de novo; rodada 5 (28 h) ainda ausente: passou de 24 h desde a primeira ausência → removed
  await rodada(() => muitos(prod('etb-me03', NOMES.b, 3)), 3);
  assert.equal(oferta('box-me05').ausenteDesde, new Date(Date.parse('2026-10-20T15:00:00Z')).toISOString());
  await rodada(() => muitos(prod('etb-me03', NOMES.b, 3)), 20);
  assert.ok(oferta('box-me05')?.stale, 'ainda dentro das 24 h (17 h ausente)');
  await rodada(() => muitos(prod('etb-me03', NOMES.b, 3)), 28);
  assert.equal(oferta('box-me05'), undefined, 'ausente há 25 h: sai');
  assert.equal(hist().filter((h) => h.event === 'removed' && h.offerId === a1.id).length, 1, 'um único removed, no fim do prazo');
  n++;
});

await cenario('completa.test', async ({ rodada, oferta, src, hist }) => {
  // Leitura completa (menos de 500): o comportamento de sempre — o que sumiu sai como removed na hora.
  const poucos = (...extras) => [...extras, ...Array.from({ length: 30 }, (_, i) => filler(i))];
  await rodada(() => poucos(prod('box-me05', NOMES.a, 0), prod('etb-me03', NOMES.b, 3)), 0);
  assert.equal(src().partial, undefined);
  const a1 = oferta('box-me05');
  await rodada(() => poucos(prod('etb-me03', NOMES.b, 3)), 1);
  assert.equal(oferta('box-me05'), undefined, 'leitura completa: removida');
  assert.equal(hist().filter((h) => h.event === 'removed' && h.offerId === a1.id).length, 1);
  assert.equal(src().ausentesParcial, undefined);
  n++;
});
console.log(`✓ leitura parcial sem remoção: ${n} cenários passaram`);
