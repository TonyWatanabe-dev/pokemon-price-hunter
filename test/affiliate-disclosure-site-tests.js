// Fase 6 — divulgação de afiliado no site, no lugar do link. Inventário: todo link marcado "sponsored" em index.html
// é uma das três superfícies conhecidas (bloco "Também na Amazon", destino de anúncio do ML via outRel, link geral do
// ML no rodapé); uma superfície nova quebra o teste até ganhar a sua divulgação. O bloco da Amazon traz o aviso
// VISÍVEL junto dos links (fora de .sr) e só quando há link; o ML ativo liga o aviso dos Termos. Decisão do dono
// (15/10/2026): toda superfície com afiliado do ML (cada "Ver oferta" que passa por outRel e o link geral do rodapé)
// leva ao lado o selo "Link de afiliado" com um ⓘ acessível que revela o texto de DIVULGACAO (legenda.js). Roda o
// código real do index.html em sandbox (vm). Sem rede e sem banco.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { DIVULGACAO } from '../src/agents/social/legenda.js';

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

// Selo "Link de afiliado" (ML). NOTA = o texto de DIVULGACAO depois de "Link de afiliado: ", com maiúscula.
const NOTA = DIVULGACAO.replace(/^Link de afiliado: (.)/, (_, c) => c.toUpperCase());

t('5. inventário do selo: todo "Ver oferta" com outRel e o link geral do rodapé levam afilSelo do MESMO destino', () => {
  const usos = [...html.matchAll(/rel="noopener\$\{outRel\(([\w.]+)\)\}"/g)];
  assert.equal(usos.length, 6, 'botões "Ver oferta" (cartão, pódio, oferta da loja, produto, oportunidade, destaque)');
  for (const u of usos) {
    const fim = html.indexOf('</a>', u.index);
    const depois = html.slice(fim, fim + 40);
    assert.ok(depois.startsWith(`</a>\${afilSelo(${u[1]})}`), `selo logo depois do link de ${u[1]}: ${depois}`);
  }
  assert.match(block(/^function footAfil\(\)[\s\S]*?(?=\nloadAfil\(\);)/m), /data-afil>[\s\S]*?<\/a>\$\{afilSelo\(AFIL\.geral\.url,true\)\}/, 'link geral do rodapé com selo');
  assert.equal([...html.matchAll(/\bafilSelo\(/g)].length, usos.length + 1, 'nenhum outro uso do selo');
});

const sctx = { String, Object, Math, URL };
vm.createContext(sctx);
vm.runInContext(`${line('AFIL')}\n${line('AFIL_OK')}\n${line('mlItem')}\n${line('outUrl')}\n${line('afilSelo')}\n;AFIL.anuncios={MLB1234567890:"https://meli.la/2AbCdEf"};globalThis.__s=afilSelo;`, sctx);
const ML_AF = 'https://produto.mercadolivre.com.br/MLB-1234567890-booster-box-_JM';

t('6. selo: só com afiliado do ML; texto visível, ⓘ é botão com rótulo que controla a nota (texto de DIVULGACAO)', () => {
  for (const u of ['https://produto.mercadolivre.com.br/MLB-9999999999-x-_JM', 'https://loja.example/p', '', null]) assert.equal(sctx.__s(u), '', String(u));
  const a = sctx.__s(ML_AF), b = sctx.__s(ML_AF), g = sctx.__s('https://meli.la/1BzQ4PU', true);
  for (const out of [a, g]) {
    assert.equal(texto(out.replace(/<span class="afil-nota"[\s\S]*?<\/span>/, '')).trim(), 'Link de afiliado ⓘ', 'selo visível e curto');
    const btn = out.match(/<button [^>]*>/)[0];
    assert.match(btn, /type="button"/);
    assert.match(btn, /aria-expanded="false"/);
    assert.match(btn, /aria-label="O que é link de afiliado\?"/);
    const id = btn.match(/aria-controls="([^"]+)"/)[1];
    const nota = out.match(new RegExp(`<span class="afil-nota" id="${id}" hidden>([^<]*)</span>`));
    assert.ok(nota, 'nota controlada pelo botão, escondida até abrir');
    assert.equal(nota[1], NOTA);
    assert.match(out, /<span aria-hidden="true">ⓘ<\/span>/, 'o símbolo não é lido; o leitor usa o rótulo');
  }
  assert.notEqual(a.match(/aria-controls="([^"]+)"/)[1], b.match(/aria-controls="([^"]+)"/)[1], 'ids únicos por selo');
  assert.equal(NOTA, 'Podemos receber comissão, sem custo extra para você.');
});

t('7. selo acessível: toque ≥44px, cor de texto do tema, abre/fecha por clique, teclado (botão nativo) e Esc', () => {
  const css = (sel) => { const m = html.match(new RegExp(`^${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\{([^}]*)\\}`, 'm')); assert.ok(m, sel); return m[1]; };
  assert.match(css('.afil-i'), /width:24px;height:24px/);
  assert.match(css('.afil-i::before'), /inset:-10px/, '24px + 2×10px = 44px de toque, como .ra/.deal-fav');
  assert.match(css('.afil-selo'), /color:var\(--muted\)/);
  assert.match(css('.afil-selo'), /z-index:3/, 'acima do link que cobre o cartão');
  assert.match(html, /const afb=t\.closest\("\.afil-i"\);afilFecha\(afb\);if\(afb\)\{[^\n]*setAttribute\("aria-expanded",String\(ab\)\)[^\n]*nt\.hidden=!ab/, 'clique alterna aria-expanded e a nota; clique fora fecha');
  assert.match(html, /addEventListener\("keydown",\(e\)=>\{if\(e\.key!=="Escape"\)return;[^\n]*afilFecha\(\);if\(foco\)b\.focus\(\)/, 'Esc fecha e devolve o foco ao ⓘ');
});

console.log(`✓ Divulgação de afiliado no site (Fase 6): ${n} grupos passaram`);
