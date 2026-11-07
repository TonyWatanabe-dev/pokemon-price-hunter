// Campanha Black Friday nos grupos (pedido do dono em 02/11/2026): prioridade, validade, legenda, arte e foto.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { LINKS, candidatosCampanha, cartaAvulsa, fotoDoAnuncio, lerCampanha, lerCatalogo, seladoComPrecoBom } from '../src/agents/social/blackfriday.js';
import { candidatosWhatsApp } from '../tools/social-whatsapp.mjs';
import { gerarCard } from '../tools/social-telegram-piloto.mjs';
import { planejar, REGRAS_WHATSAPP } from '../src/agents/social/auto.js';
import { legendaWhatsApp } from '../src/agents/social/whatsapp.js';
import { parseAffiliates } from '../api/_lib/affiliates.mjs';
import { parseListing, productIdOf } from '../src/match.js';

const CAP = '2026-11-02T19:00:00.000Z';
const NOW = Date.parse(CAP) + 2 * 3600e3;
let seq = 1000000;
const of = (titulo, preco, blackFriday = false) => { const item = `MLB${++seq}`; return { item, titulo, preco, desconto: 30, blackFriday, link: `https://meli.la/${item.slice(3)}x` }; };
// Títulos reais da leitura de 02/11; o catálogo é o real (config/catalog.json), o state é sintético.
const A = of('Blister Quádruplo Pokémon Me04 Caos Ascendente', 39.9, true);              // selado, abaixo do Copag
const B = of('Booster Quádruplo Escuridão Absoluta Português', 50, true);                 // selado, abaixo do Copag
const C = of('Pokémon ME04 Caos Ascendente Blister Quádruplo Toxel 4 Boosters copag', 47.24); // mesmo produto de A, mais caro
const D = of('Pokemon - TCG Blister Unitário Caos Ascendente', 19, true);                 // "36% OFF", mas acima do Copag (13,99)
const E = of('Carta Pokémon Fuecoco Ex Coleção 30 Anos', 24.65, true);                    // carta avulsa
const F = of('Kit 50 Cartas Pokémon Original Copag Lote Com 5 Brilhantes', 29.92, true);   // lote de cartas
const G = of('Pokémon Tcg 30 Anos Mini Booster Box Etb - Inglês Copag', 505.07);          // importado, 40% abaixo do site
const H = of('Sleeves Pokémon Básico Transparente 100 Unidades 65x90mm Central', 16.42, true); // acessório
const camp = { capturedAt: CAP, ofertas: [H, G, F, E, D, C, B, A] };
const state = {
  products: [{ id: 'me04-blister4', msrp: 55.99 }, { id: 'me05-blister4', msrp: 55.99 }, { id: 'c30-etb-en' }, { id: 'me04-blister1', msrp: 13.99 }, { id: 'c30-colecao_ex-fuecoco', msrp: 160.99 }],
  offers: [{ productId: 'c30-etb-en', price: 841.39, stock: 'IN_STOCK' }],
};

let n = 0; const t = (nome, fn) => { try { fn(); n++; } catch (e) { e.message = `[${nome}] ${e.message}`; throw e; } };
const ta = async (nome, fn) => { try { await fn(); n++; } catch (e) { e.message = `[${nome}] ${e.message}`; throw e; } };

t('só selado original com preço bom: carta, lote, acessório e "desconto" acima do Copag ficam de fora', () => {
  const r = candidatosCampanha(camp, { now: NOW, state });
  assert.deepEqual(r.map((c) => c.itemMl), [A.item, B.item, G.item], 'BF primeiro (maior economia), um anúncio por produto');
  assert.deepEqual(r.map((c) => c.oferta.productId), ['me04-blister4', 'me05-blister4', 'c30-etb-en']);
  assert.deepEqual(r.map((c) => c.tema), ['blackfriday', 'blackfriday', null]);
  assert.ok(cartaAvulsa(E.titulo) && cartaAvulsa('Card Pokémon Pikachu') && !cartaAvulsa('Cartas Pokémon Coleção Escuridão Absoluta Treinador Avançado'));
  assert.equal(seladoComPrecoBom({ ...G, preco: 820 }, { catalog: lerCatalogo(), products: state.products, offers: state.offers }), null, 'sem Copag: precisa de 5% abaixo do site');
});

t('falha fechada, validade e kill switch', () => {
  assert.equal(candidatosCampanha(camp, { now: NOW }).length, 0, 'sem state.json não sai nada');
  assert.equal(candidatosCampanha(camp, { now: Date.parse(CAP) + 25 * 3600e3, state }).length, 0);
  assert.equal(candidatosCampanha(camp, { now: Date.parse(CAP) - 3600e3, state }).length, 0, 'leitura no futuro');
  assert.equal(candidatosCampanha(camp, { now: NOW, state, env: { SOCIAL_BLACKFRIDAY: '0' } }).length, 0);
  assert.equal(candidatosCampanha({ ...camp, validadeHoras: 48 }, { now: Date.parse(CAP) + 40 * 3600e3, state }).length, 3, 'validade do arquivo');
  assert.equal(candidatosCampanha({ ...camp, validadeHoras: 500 }, { now: Date.parse(CAP) + 80 * 3600e3, state }).length, 0, 'teto de 72 h');
  assert.equal(candidatosCampanha({ capturedAt: CAP, ofertas: [{ ...A, link: 'https://evil.example/x' }] }, { now: NOW, state }).length, 0, 'link fora do meli.la');
  // capturedAt por linha (releitura parcial de 07/11): a linha velha vence sozinha, a relida continua
  const velha = new Date(Date.parse(CAP) - 20 * 3600e3).toISOString();
  const mista = { capturedAt: CAP, ofertas: [{ ...A, capturedAt: velha }, B] };
  assert.deepEqual(candidatosCampanha(mista, { now: Date.parse(CAP) + 6 * 3600e3, state }).map((x) => x.preco), [50], 'A (lida há 26 h) saiu, B ficou');
  assert.match(candidatosCampanha({ capturedAt: CAP, ofertas: [{ ...A, capturedAt: velha }] }, { now: Date.parse(CAP), state })[0].item.texto, new RegExp(new Date(velha).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' }).replace('/', '\\/')), 'legenda usa a hora da linha');
});

t('legenda: selo BF, preço, referência Copag/site, data da leitura e link de afiliado; sem "% OFF" do vendedor', () => {
  const [bf, , imp] = candidatosCampanha(camp, { now: NOW, state });
  const w = legendaWhatsApp(bf.item.texto);
  assert.match(w, /BLACK FRIDAY/);
  assert.match(w, /R\$ 39,90/);
  assert.match(w, /Abaixo do preço sugerido Copag \(R\$ 55,99\)/);
  assert.match(w, /Preço lido em 02\/11; pode ter mudado/);
  assert.match(w, new RegExp(A.link.replace(/\./g, '\\.')));
  assert.doesNotMatch(w, /% OFF/);
  assert.doesNotMatch(imp.item.texto, /BLACK FRIDAY/);
  assert.match(imp.item.texto, /Abaixo do menor preço das outras lojas \(R\$ 841,39\)/);
  assert.match(imp.item.texto, /🇺🇸/, 'importado leva a bandeira do idioma');
});

t('WhatsApp: BF na frente da fila do robô', () => {
  const lista = candidatosWhatsApp(state, { now: NOW, env: { SOCIAL_EXTERNAS: '0' }, campanha: camp });
  assert.deepEqual(lista.slice(0, 2).map((c) => c.itemMl), [A.item, B.item]);
  const p = planejar(lista, [], { now: Date.parse('2026-11-02T22:00:00Z'), regras: REGRAS_WHATSAPP });
  assert.equal(p.enviar[0].itemMl, A.item, 'a primeira mensagem é a Black Friday de maior economia');
});

t('config real (planilha do dono de 06/11): link de afiliado por loja, produto do site, nenhuma carta avulsa', () => {
  const c = lerCampanha();
  assert.ok(c && Array.isArray(c.ofertas) && c.ofertas.length >= 30);
  assert.ok(c.ofertas.every((o) => LINKS[o.loja]?.test(o.link)), 'link de afiliado do dono da própria loja');
  assert.equal(new Set(c.ofertas.map((o) => o.link)).size, c.ofertas.length, 'um registro por anúncio');
  assert.ok(c.ofertas.every((o) => typeof o.titulo === 'string' && o.preco > 0 && (o.de == null || o.de > o.preco) && typeof o.blackFriday === 'boolean' && typeof o.pix === 'boolean'));
  const aff = parseAffiliates(JSON.parse(fs.readFileSync(new URL('../config/affiliates.json', import.meta.url), 'utf8')));
  assert.ok(c.ofertas.filter((o) => o.item).every((o) => o.loja === 'mercadolivre' && /^MLB\d+$/.test(o.item) && aff.anuncios[o.item] === o.link), 'item do ML = anúncio do link no mapa do site');
  const cat = lerCatalogo(); const noCatalogo = (id) => id.startsWith('avulsos-') || cat.products.some((p) => p.id === id) || cat.collections.some((col) => id.startsWith(`${col.id}-`));
  const comId = c.ofertas.filter((o) => o.productId); const ids = new Set(comId.map((o) => o.productId));
  assert.ok(comId.length >= 20 && comId.every((o) => noCatalogo(o.productId)), 'productId manual é de uma coleção do catálogo');
  assert.ok(c.ofertas.every((o) => !cartaAvulsa(o.titulo) && !/\b(sleeves?|pasta|toploader|folhas|lotes?)\b/i.test(o.titulo)), 'só selado');
  const generoso = { products: [...ids].map((id) => ({ id, msrp: 1e6, image: 'https://img/x.jpg' })), offers: [] };
  const r = candidatosCampanha(c, { now: Date.parse(c.capturedAt) + 3600e3, state: generoso });
  assert.ok(r.length >= 15 && r.every((x) => x.foto && x.oferta.productId), `${r.length}`);
  assert.deepEqual([...new Set(r.map((x) => x.loja))].sort(), ['amazon', 'mercadolivre', 'shopee']);
});

await ta('foto do anúncio: og:image só de mlstatic', async () => {
  const pagina = (img) => async () => ({ ok: true, text: async () => `<meta property="og:image" content="${img}">` });
  assert.equal(await fotoDoAnuncio('MLB123456789', pagina('https://http2.mlstatic.com/D_NQ_NP_1-O.jpg')), 'https://http2.mlstatic.com/D_NQ_NP_1-O.jpg');
  assert.equal(await fotoDoAnuncio('MLB123456789', pagina('https://evil.example/a.jpg')), null);
  assert.equal(await fotoDoAnuncio('xx', pagina('https://http2.mlstatic.com/a.jpg')), null);
  assert.equal(await fotoDoAnuncio('MLB123456789', async () => { throw new Error('rede'); }), null);
});

await ta('card: gerarCard repassa --tema blackfriday ao script', async () => {
  let args = null;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-'));
  const saida = path.join(dir, 'c.jpg');
  const run = (_py, a) => { args = a; fs.writeFileSync(saida, 'x'); return { status: 0 }; };
  const fetchFn = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) });
  await gerarCard('https://http2.mlstatic.com/a.jpg', saida, fetchFn, run, null, dir, { tema: 'blackfriday' });
  assert.deepEqual(args.slice(-2), ['--tema', 'blackfriday']);
  await gerarCard('https://http2.mlstatic.com/a.jpg', saida, fetchFn, run, null, dir);
  assert.ok(!args.includes('--tema'), 'sem tema: card normal');
});

// Arte real (só quando há Python com Pillow): o tema gera JPEG 1080x1080, inclusive com foto sem fundo branco.
const py = spawnSync(process.env.SOCIAL_PYTHON || 'python3', ['-c', 'import PIL'], { encoding: 'utf8' });
if (py.status === 0) {
  t('social-card.py --tema blackfriday (recorte e moldura)', () => {
    const script = fileURLToPath(new URL('../tools/social-card.py', import.meta.url));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bfcard-'));
    const amb = path.join(dir, 'amb.png');
    spawnSync(process.env.SOCIAL_PYTHON || 'python3', ['-c', `from PIL import Image; Image.new('RGB',(400,300),(90,140,200)).save(${JSON.stringify(amb)})`]);
    for (const foto of [fileURLToPath(new URL('../assets/social/produtos/c30-colecao_ex-greninja.webp', import.meta.url)), amb]) {
      const saida = path.join(dir, `${path.basename(foto)}.jpg`);
      const r = spawnSync(process.env.SOCIAL_PYTHON || 'python3', [script, '--foto', foto, '--saida', saida, '--tema', 'blackfriday'], { encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
      const b = fs.readFileSync(saida);
      assert.equal(b[0], 0xff); assert.equal(b[1], 0xd8);
    }
  });
}

console.log(`social-blackfriday: ${n} testes ok`);
