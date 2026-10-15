// Fase 6 — divulgação de afiliado no site, no lugar do link. Inventário: todo link marcado "sponsored" em index.html
// é uma das três superfícies conhecidas (bloco "Também na Amazon", destino de anúncio do ML via outRel, link geral do
// ML no rodapé); uma superfície nova quebra o teste até ganhar a sua divulgação. O bloco da Amazon traz o aviso
// VISÍVEL junto dos links (fora de .sr) e só quando há link; o ML ativo liga o aviso dos Termos. Roda o código real
// do index.html em sandbox (vm). Sem rede e sem banco.
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
  assert.deepEqual(onde.sort(), ['amazon', 'ml-anuncio', 'ml-geral'], 'superfície de afiliado nova precisa de divulgação e de entrada neste teste');
});

const amz = block(/^const amzWhen=[\s\S]*?^function amzBlock\(pid\)\{[\s\S]*?<\/section>`\}/m);
const ctx = { String, Number, Date, Array };
vm.createContext(ctx);
vm.runInContext(`${line('esc')}\n${line('safeUrl')}\n${line('money')}\n${line('ic')}\nlet AMZ=null;\n${amz}\n;globalThis.__t={amzBlock,set(v){AMZ=v}};`, ctx);
const link = (pid, i) => ({ productId: pid, title: `Box ${i}`, url: `https://www.amazon.com.br/dp/B0HFNSM2T${i}?tag=tcgpricehunter-20`, price: 99.9, seller: 'Amazon.com.br', fulfilledBy: 'amazon', capturedAt: '2026-10-10T20:31:00Z' });

t('2. bloco da Amazon: aviso de afiliado visível, junto dos links, uma vez', () => {
  ctx.__t.set({ links: [link('p1', 1), link('p1', 2), link('p2', 3)] });
  const out = ctx.__t.amzBlock('p1');
  assert.equal((out.match(/rel="noopener nofollow sponsored"/g) || []).length, 2, 'só os links do produto');
  const visivel = texto(out);
  assert.match(visivel, /Links de afiliado: como Associado da Amazon, o TCG Price Hunter recebe por compras qualificadas/);
  assert.match(visivel, /não entram na comparação, no ranking nem na nota/);
  assert.equal((out.match(/data-disclosure/g) || []).length, 1);
  assert.ok(out.indexOf('data-disclosure') > out.lastIndexOf('Ver na Amazon'), 'aviso dentro do bloco, depois dos links');
  assert.ok(out.indexOf('data-disclosure') < out.indexOf('</section>'));
});

t('3. sem link da Amazon para o produto: nem bloco nem aviso', () => {
  ctx.__t.set({ links: [link('p2', 3)] });
  assert.equal(ctx.__t.amzBlock('p1'), '');
  ctx.__t.set({ links: [] });
  assert.equal(ctx.__t.amzBlock('p1'), '');
});

t('4. ML: destino de anúncio só com afiliado sai como sponsored, e o aviso dos Termos depende do mesmo AFIL', () => {
  assert.match(line('outRel'), /outUrl\(u\)!==u\?" nofollow sponsored":""/);
  assert.match(html, /\$\{AFIL\.geral\|\|Object\.keys\(AFIL\.anuncios\)\.length\?" Alguns links do Mercado Livre são links de afiliado/);
  assert.match(block(/^function footAfil\(\)[\s\S]*?(?=\nloadAfil\(\);)/m), /link de afiliado/);
});

console.log(`✓ Divulgação de afiliado no site (Fase 6): ${n} grupos passaram`);
