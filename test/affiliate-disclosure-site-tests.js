// Divulgação de afiliado no site. Regra do dono (17/10/2026, docs/afiliados.md): no site o link de afiliado é tratado
// como link normal, SEM etiqueta junto do link (nada de selo "Link de afiliado", ⓘ ou aviso dentro do bloco da Amazon).
// A divulgação fica GERAL: rodapé (com a frase exigida do Programa de Associados da Amazon) e Termos. Continua valendo
// o inventário: todo link marcado "sponsored" (atributo invisível, exigido para link pago) é uma das três superfícies
// conhecidas. Roda o código real do index.html em sandbox (vm). Sem rede e sem banco.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } };
const line = (name) => { const m = html.match(new RegExp(`^(?:const|let) ${name}\\s*=.*$`, 'm')); assert.ok(m, `index.html: ${name} não encontrado`); return m[0]; };
const block = (re) => { const m = html.match(re); assert.ok(m, `index.html: ${re} não encontrado`); return m[0]; };
const semSr = (s) => s.replace(/<span class="sr">[\s\S]*?<\/span>/g, '');
const texto = (s) => semSr(s).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

t('1. inventário: "sponsored" só nas três superfícies conhecidas', () => {
  const codigo = html.split('\n').filter((l) => /sponsored/.test(l) && !/^\s*\/\*/.test(l));
  const onde = codigo.map((l) => (/^const outRel=/.test(l) ? 'ml-anuncio' : /Ver na Amazon/.test(l) ? 'amazon' : /data-afil/.test(l) ? 'ml-geral' : `desconhecida: ${l.slice(0, 80)}`));
  assert.deepEqual(onde.sort(), ['amazon', 'ml-anuncio', 'ml-geral'], 'superfície de afiliado nova precisa de entrada neste teste');
});

const amz = block(/^const amzWhen=[\s\S]*?^function amzBlock\(pid\)\{[\s\S]*?<\/section>`\}/m);
const ctx = { String, Number, Date, Array };
vm.createContext(ctx);
vm.runInContext(`${line('esc')}\n${line('safeUrl')}\n${line('money')}\n${line('ic')}\nlet AMZ=null;\n${amz}\n;globalThis.__t={amzBlock,set(v){AMZ=v}};`, ctx);
const link = (pid, i) => ({ productId: pid, title: `Box ${i}`, url: `https://www.amazon.com.br/dp/B0HFNSM2T${i}?tag=tcgpricehunter-20`, price: 99.9, seller: 'Amazon.com.br', fulfilledBy: 'amazon', capturedAt: '2026-10-10T20:31:00Z' });

t('2. bloco da Amazon: links com rel sponsored, sem etiqueta de afiliado visível', () => {
  ctx.__t.set({ links: [link('p1', 1), link('p1', 2), link('p2', 3)] });
  const out = ctx.__t.amzBlock('p1');
  assert.equal((out.match(/rel="noopener nofollow sponsored"/g) || []).length, 2, 'só os links do produto');
  assert.doesNotMatch(texto(out), /afiliad/i, 'nenhuma etiqueta de afiliado no bloco');
  assert.doesNotMatch(out, /data-disclosure/);
});

t('3. sem link da Amazon para o produto: nada de bloco', () => {
  ctx.__t.set({ links: [link('p2', 3)] });
  assert.equal(ctx.__t.amzBlock('p1'), '');
  ctx.__t.set({ links: [] });
  assert.equal(ctx.__t.amzBlock('p1'), '');
});

t('4. ML: destino com afiliado sai como sponsored (invisível); rodapé geral sem rótulo de afiliado', () => {
  assert.match(line('outRel'), /outUrl\(u\)!==u\?" nofollow sponsored":""/);
  const foot = block(/^function footAfil\(\)[\s\S]*?(?=\nloadAfil\(\);)/m);
  assert.match(foot, /rel="noopener nofollow sponsored" data-afil>/);
  assert.doesNotMatch(foot, /afiliad/i);
});

t('5. nenhuma etiqueta de afiliado por link em lugar nenhum do site', () => {
  for (const re of [/afilSelo/, /afil-selo/, /afil-i\b/, /afil-nota/, /data-afil-selo/, />Link de afiliado</, /O que é link de afiliado\?/]) assert.doesNotMatch(html, re, String(re));
});

t('6. divulgação geral: rodapé com a frase da Amazon e a regra de desempate; Termos sempre', () => {
  const foot = block(/<footer class="foot">[\s\S]*?<\/footer>/);
  assert.match(foot, /Como Associado da Amazon, o TCG Price Hunter recebe por compras qualificadas\./);
  assert.match(foot, /Mercado Livre e Shopee também são de afiliado/);
  assert.match(foot, /Em empate de preço, a oferta com o nosso link aparece primeiro; ela nunca passa na frente de uma oferta mais barata\./);
  const termos = block(/<h3>4\. Compras são feitas com as lojas<\/h3>[\s\S]*?<h3>5\./);
  assert.doesNotMatch(termos, /\$\{AFIL/, 'aviso dos Termos não depende de ter link carregado');
  assert.match(termos, /Esses links não levam etiqueta no site e funcionam como qualquer outro\./);
  assert.match(termos, /Em empate de preço total, a oferta com o nosso link aparece primeiro; ela nunca passa na frente de uma oferta mais barata/);
  assert.match(termos, /Como Associado da Amazon, o TCG Price Hunter recebe por compras qualificadas/);
});

console.log(`✓ Divulgação de afiliado no site (regra 17/10: sem etiqueta, aviso geral): ${n} grupos passaram`);
