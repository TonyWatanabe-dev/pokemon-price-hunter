// Card com compra direta no Mercado Livre (pedido do dono, 20/11/2026): botão "Comprar no Mercado Livre" com o link de
// afiliado do anúncio (mapa AFIL.anuncios) + "Comparar ofertas" para a página do produto, sem passar por ela para comprar.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
let ok = 0; const t = (n, f) => { f(); ok++; };
const line = (start) => { const i = html.indexOf(start); assert.ok(i >= 0, start); return html.slice(i, html.indexOf('\n', i)); };

const code = [line('const AFIL_OK='), line('const mlItem='), line('const live='), line('const afilML='), line('function mlDireto(')].join('\n');
const ML = (id) => `https://produto.mercadolivre.com.br/MLB-${id}-x-_JM`;
const off = (id, url, total, x = {}) => ({ id, productId: 'p', url, total, stock: 'IN_STOCK', ...x });
function run(OFF, anuncios) {
  const ctx = { OFF, AFIL: { anuncios }, URL }; vm.createContext(ctx); vm.runInContext(code + ';globalThis.f=mlDireto;', ctx); return ctx.f;
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
t('card: dois botões, compra direta no ML com rel de afiliado e "Comparar ofertas" para a página do produto', () => {
  const fn = html.slice(html.indexOf('function dealCard('), html.indexOf('const pocket=dealCard;'));
  assert.match(fn, /<a class="deal-cta" href="\$\{esc\(safeUrl\(outUrl\(ml\.url\)\)\)\}" target="_blank" rel="noopener\$\{outRel\(ml\.url\)\}"[^>]*>Comprar no Mercado Livre/);
  assert.match(fn, /<a class="deal-cmp" href="\$\{href\}#ondecomprar" data-p="\$\{esc\(p\.id\)\}" data-hash="ondecomprar">Comparar ofertas/);
  assert.match(fn, /live\(o\)\?mlDireto\(p\.id,o\):null/, 'só com oferta viva');
  assert.match(html, /\.deal-cmp\{[^}]*min-height:44px/, 'alvo de toque ≥ 44px');
});
console.log(`✓ Card com compra direta no Mercado Livre: ${ok} grupos passaram`);
