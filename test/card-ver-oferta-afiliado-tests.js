// "Ver oferta" sempre no link de afiliado do dono (pedidos de 20/11/2026): o botão do card abre direto a oferta com o link
// dele; "Comparar ofertas" fica abaixo, para a página do produto. No clique, o destino é recalculado (config que chegou depois).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
let ok = 0; const t = (n, f) => { f(); ok++; };
const line = (start) => { const i = html.indexOf(start); assert.ok(i >= 0, start); return html.slice(i, html.indexOf('\n', i)); };

const code = [line('const AFIL_OK='), line('const mlItem='), line('const live='), line('const afilML='), line('const comAfil='), line('function mlDireto('), line('const ofertaAfil=')].join('\n');
const ML = (id) => `https://produto.mercadolivre.com.br/MLB-${id}-x-_JM`;
const off = (id, url, total, x = {}) => ({ id, productId: 'p', url, total, stock: 'IN_STOCK', ...x });
function run(OFF, anuncios) {
  const ctx = { OFF, AFIL: { anuncios }, URL }; vm.createContext(ctx); vm.runInContext(code + ';globalThis.f=mlDireto;globalThis.g=ofertaAfil;', ctx); return Object.assign(ctx.f, { g: ctx.g });
}
const AF = { MLB111111111: 'https://meli.la/a1', MLB222222222: 'https://meli.la/a2' };

t('escolhe o anúncio ML com link do dono mais barato e disponível', () => {
  const amz = off('amz', 'https://link.amazon/x', 40);
  const a = off('a', ML('111111111'), 60); const b = off('b', ML('222222222'), 55); const semLink = off('c', ML('333333333'), 50);
  const sem = off('d', ML('222222222'), 45, { stock: 'OUT_OF_STOCK' });
  assert.equal(run([amz, a, b, semLink, sem], AF)('p', amz).id, 'b');
});
t('sem anúncio ML com link do dono: nada (card mantém "Ver oferta")', () => {
  assert.equal(run([off('c', ML('333333333'), 50)], AF)('p', null), null);
  assert.equal(run([off('a', ML('111111111'), 50, { stale: true })], AF)('p', null), null, 'leitura antiga não conta');
});
t('empate com a melhor oferta do card: usa a própria oferta (preço não repete no botão)', () => {
  const a = off('a', ML('111111111'), 50); const copia = { ...a };
  assert.equal(run([copia], AF)('p', a), a);
});
t('Ver oferta: oferta mostrada quando já leva o link do dono (ML no mapa, Amazon, Shopee); senão o ML dele mais barato', () => {
  const amz = off('amz', 'https://link.amazon/x', 40); const shp = off('shp', 'https://s.shopee.com.br/Ab1', 41);
  const mlLink = off('a', ML('111111111'), 60); const mlSem = off('c', ML('333333333'), 38);
  const f = run([amz, shp, mlLink, mlSem], AF);
  assert.equal(f.g('p', amz), amz); assert.equal(f.g('p', shp), shp); assert.equal(f.g('p', mlLink), mlLink);
  assert.equal(f.g('p', mlSem), mlLink, 'ML sem link do dono: vai para o anúncio ML com link dele');
  assert.equal(run([mlSem], AF).g('p', mlSem), mlSem, 'sem nenhuma oferta com link: mantém a oferta mostrada');
});
t('card: "Ver oferta" com link de afiliado e "Comparar ofertas" abaixo, para a página do produto', () => {
  const fn = html.slice(html.indexOf('function dealCard('), html.indexOf('/* "Ver oferta" sempre no link'));
  assert.match(fn, /<a class="deal-cta" href="\$\{esc\(safeUrl\(outUrl\(best\.url\)\)\)\}" target="_blank" rel="noopener\$\{outRel\(best\.url\)\}"[^>]*>Ver oferta/);
  assert.match(fn, /live\(o\)\?ofertaAfil\(p\.id,o\):o/, 'só com oferta viva');
  assert.ok(!/Comprar no Mercado Livre/.test(fn), 'um botão só');
  assert.ok(fn.indexOf('class="deal-cta"') < fn.indexOf('class="deal-cmp"'), 'comparador abaixo do botão');
  assert.match(fn, /<a class="deal-cmp" href="\$\{href\}#ondecomprar" data-p="\$\{esc\(p\.id\)\}" data-hash="ondecomprar">/);
  assert.match(html, /\.deal-cmp\{[^}]*min-height:44px/, 'alvo de toque ≥ 44px');
});
t('clique: destino recalculado com a config de afiliado; config a caminho: espera (até 2,5 s) e abre o destino resolvido', () => {
  const fn = html.slice(html.indexOf('function afilClick('), html.indexOf('\n/*', html.indexOf('function afilClick(')));
  assert.match(fn, /const f=safeUrl\(outUrl\(u\)\);if\(f!==u&&f!=="#"\)\{a\.setAttribute\("href",f\)/);
  assert.match(fn, /Promise\.race\(\[AFIL_PRONTO,[^\]]*\]\)\.then\(\(\)=>\{const d=safeUrl\(outUrl\(u\)\);window\.open\([^)]*"noopener"\)/);
  assert.match(html, /const stb=t\.closest\("\[data-store\]"\);if\(stb\)\{afilClick\(stb,e\);/);
  assert.match(html, /const AFIL_PRONTO=loadAfil\(\)\.finally\(\(\)=>\{AFIL_LIDO=true\}\)/);
});
console.log(`✓ Card "Ver oferta" no link de afiliado: ${ok} grupos passaram`);
