// Foto própria do produto (config/fotos-produto.json → /assets/web/produto-*) vence a foto da oferta nos cards do site
// (photo() do index.html), na prévia da página (fotoDe() em api/pagina.mjs) e no kit (api/_lib/kit.mjs). Caso: card de
// oportunidade do ETB 30 anos mostrava a foto da oferta da Ri Happy (conteúdo espalhado), não a da caixa (31/10/2026).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { fotoDe } from '../api/pagina.mjs';

const read = (f) => fs.readFileSync(new URL('../' + f, import.meta.url), 'utf8');
const html = read('index.html');
const ini = html.indexOf('function photo(p,o,cls="photo",eager=false){');
const fim = html.indexOf('\nfunction ', ini + 10);
assert.ok(ini > 0 && fim > ini, 'photo() no index.html');
const ctx = vm.createContext({ g: () => ({ c: '#000' }), CATW: { x: { i: 'i' } }, catOf: () => 'x', ic: () => '', esc: (s) => String(s) });
vm.runInContext(html.slice(ini, fim), ctx);
const src = (p, o) => (ctx.photo(p, o).match(/src="([^"]+)"/) || [])[1] || null;

const PROPRIA = 'https://tcgpricehunter.com.br/assets/web/produto-c30-etb-v1.webp';
const LOJA = 'https://rihappy.vteximg.com.br/arquivos/ids/10166918/etb.jpg';
assert.equal(src({ id: 'c30-etb', image: PROPRIA }, { image: LOJA }), PROPRIA, 'card: foto própria vence a da oferta');
assert.equal(src({ id: 'me05-etb', image: 'https://copagloja.vteximg.com.br/x.png' }, { image: LOJA }), LOJA, 'card: sem foto própria, segue a da oferta (como antes)');
assert.equal(src({ id: 'p', image: null }, { image: 'http://loja.example/a.jpg' }), 'https://loja.example/a.jpg', 'http → https continua');

assert.equal(fotoDe({ image: PROPRIA }, { image: LOJA }), PROPRIA, 'og:image: foto própria vence');
assert.equal(fotoDe({ image: 'https://x/p.png' }, { image: LOJA }), LOJA, 'og:image: sem foto própria, a da melhor oferta');
assert.equal(fotoDe({ image: 'https://x/p.png' }, null), 'https://x/p.png', 'og:image: sem oferta, a do produto');

const kit = read('api/_lib/kit.mjs');
assert.equal((kit.match(/FOTO_PROPRIA\.test\(/g) || []).length, 2, 'kit: itens e alternativas usam a foto própria primeiro');
console.log('✓ foto-propria-card: card, og:image e kit preferem a foto própria do produto');
