// Divulgação de afiliado no site. Regra do dono (17/10/2026, docs/afiliados.md): no site o link de afiliado é tratado
// como link normal, SEM etiqueta junto do link (nada de selo "Link de afiliado", ⓘ ou aviso dentro do bloco da Amazon).
// A divulgação fica GERAL: rodapé (com a frase exigida do Programa de Associados da Amazon) e Termos. Continua valendo
// o inventário: todo link marcado "sponsored" (atributo invisível, exigido para link pago) é uma das superfícies
// conhecidas (ML anúncio, ML geral, Amazon e, desde 17/10, Shopee). Roda o código real do index.html em sandbox (vm). Sem rede e sem banco.
process.env.SITE_SO_PARCEIROS = '0';   // site só com parceiros (07/11/2026): este teste cobre o comportamento com todas as lojas (modo desligado); o modo ligado é test/so-parceiros-ui-tests.js
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

t('1. inventário: "sponsored" só nas superfícies conhecidas', () => {
  const codigo = html.split('\n').filter((l) => /sponsored/.test(l) && !/^\s*\/\*/.test(l));
  const onde = codigo.map((l) => (/^const outRel=/.test(l) ? 'ml-anuncio' : /data-afil/.test(l) ? 'ml-geral' : `desconhecida: ${l.slice(0, 80)}`));
  assert.deepEqual(onde.sort(), ['ml-anuncio', 'ml-geral'], 'superfície de afiliado nova precisa de entrada neste teste');
});

t('2/3. blocos "Também na Amazon/Shopee" saíram do SPA (07/11/2026); links manuais usam o mesmo outRel sponsored', () => {
  assert.doesNotMatch(html, /function amzBlock|function shpBlock|function amzRow|function shpRow/);
  assert.match(line('outRel'), /link\\\.amazon\|s\\\.shopee\\\.com\\\.br/);
});

t('4. ML: destino com afiliado sai como sponsored (invisível); rodapé geral sem rótulo de afiliado', () => {
  assert.match(line('outRel'), /outUrl\(u\)!==u\|\|/);
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
  assert.match(foot, /Os links para Mercado Livre, Amazon e Shopee são de afiliado/);
  assert.match(foot, /A ordem das ofertas segue o preço, não a comissão\./);
  const termos = block(/<h3>4\. Compras são feitas com as lojas<\/h3>[\s\S]*?<h3>5\./);
  assert.doesNotMatch(termos, /\$\{AFIL/, 'aviso dos Termos não depende de ter link carregado');
  assert.match(termos, /Esses links não levam etiqueta no site e funcionam como qualquer outro\./);
  assert.match(termos, /Em empate de preço total, a oferta com o nosso link aparece primeiro; ela nunca passa na frente de uma oferta mais barata/);
  assert.match(termos, /Como Associado da Amazon, o TCG Price Hunter recebe por compras qualificadas/);
});

console.log(`✓ Divulgação de afiliado no site (regra 17/10: sem etiqueta, aviso geral): ${n} grupos passaram`);
