// Kit completo com acessórios (kit-v7.js): a API diz quais acessórios o modelo pede; a página escolhe o mais barato de cada
// um na lista curada (/data/afiliados-acessorios.json), desconta do orçamento antes de pedir os lacrados, tira o último
// acessório se nenhum lacrado couber, mostra data da leitura e frete a calcular. "Proteger" = kit só de acessórios.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import vm from 'node:vm';

const js = fs.readFileSync(new URL('../assets/web/kit-v7.js', import.meta.url), 'utf8');
const flush = () => new Promise((r) => setTimeout(r, 0));
const ACC = { itens: [
  { loja: 'amazon', id: 'S1', kit: 'sleeve', title: 'Sleeve barato', price: 11.39, url: 'https://link.amazon/a', capturedAt: '2026-10-31T13:07:04-03:00' },
  { loja: 'shopee', id: 'S2', kit: 'sleeve', title: 'Sleeve caro', price: 90, url: 'https://s.shopee.com.br/b', capturedAt: '2026-10-31T13:00:00-03:00' },
  { loja: 'mercadolivre', id: 'F1', kit: 'fichario', title: 'Fichário 9 bolsos', price: 78.9, url: 'https://meli.la/c', capturedAt: '2026-10-31T13:10:00-03:00' },
  { loja: 'amazon', id: 'T1', kit: 'toploader', title: 'Toploader 25', price: 55.84, url: 'https://link.amazon/d', capturedAt: '2026-10-31T13:10:00-03:00' },
  { loja: 'amazon', id: 'D1', kit: 'deck_box', title: 'Deck box 100+', price: 29.9, url: 'https://link.amazon/e', capturedAt: '2026-10-31T13:10:00-03:00' },
  { loja: 'amazon', id: 'X', kit: 'sleeve', title: 'sem link', price: 1, url: 'http://inseguro', capturedAt: '2026-10-31T13:10:00-03:00' },
] };
const item = (preco) => ({ productId: 'me04-blister3', quantidade: 1, nome: 'Blister', porque: 'abrir', imagem: '', oferta: { storeId: 'Loja X', storeName: 'Loja X', price: preco, url: 'https://loja.test/p' } });

// Acionando o resultado pelo clique, como a pessoa faz.
async function clicar(R, opts) {
  const ouvintes = {}; const app = { innerHTML: '', addEventListener: (t, f) => { (ouvintes[t] = ouvintes[t] || []).push(f); }, querySelector: () => null, querySelectorAll: () => ({ forEach() {} }) };
  const pedidos = [];
  const fetch = (u) => {
    if (u.startsWith('/data/')) return Promise.resolve(opts.accOk === false ? { ok: false } : { ok: true, json: () => Promise.resolve(ACC) });
    const orc = Number(new URL('https://x.test' + u).searchParams.get('orcamento')); pedidos.push(orc);
    const body = opts.proteger ? { modelo: 'proteger', nomeModelo: 'Proteger minhas cartas', acessorios: ['sleeve', 'toploader', 'fichario', 'deck_box'], itens: [], alternativas: [], limitacoes: [] }
      : { modelo: 'primeira_colecao', nomeModelo: 'Minha primeira coleção', acessorios: ['sleeve', 'fichario'], orcamento: orc, itens: orc >= opts.cabe ? [item(opts.cabe)] : [], subtotal: orc >= opts.cabe ? opts.cabe : 0, total: opts.total ?? null, fretes: [], alternativas: [], limitacoes: [] };
    return Promise.resolve({ ok: true, json: () => Promise.resolve(body) });
  };
  const ctx = { console, URLSearchParams, Promise, Number, String, JSON, Math, Error, Date, document: { getElementById: () => app },
    location: { pathname: '/monte-seu-kit', search: '' }, history: { replaceState() {} }, sessionStorage: { getItem: () => JSON.stringify(R), setItem() {} }, fetch };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(js, ctx);
  const botao = (attrs) => { const b = { dataset: {}, hasAttribute: (n) => n in attrs, getAttribute: (n) => (n in attrs ? attrs[n] : null) }; if ('data-v' in attrs) b.dataset.v = attrs['data-v']; b.closest = (s) => (s === 'button' ? b : null); return b; };
  const fire = (attrs) => (ouvintes.click || []).forEach((f) => f({ type: 'click', target: botao(attrs) }));
  if (opts.proteger) fire({ 'data-v': 'proteger' });
  else { fire({ 'data-v': R.objetivo }); for (let i = 0; i < 4; i++) fire({ 'data-avancar': '' }); }
  for (let i = 0; i < 6; i++) await flush();
  return { h: app.innerHTML, pedidos, fire };
}

{ const r = await clicar({ objetivo: 'colecionar', orcamento: '150', idioma: 'pt' }, { cabe: 40 });
  assert.deepEqual(r.pedidos, [150, 59.71], '1ª chamada com o orçamento todo; 2ª descontando sleeve 11,39 + fichário 78,90');
  assert.match(r.h, /Acessórios para completar/); assert.match(r.h, /Sleeve barato/); assert.doesNotMatch(r.h, /Sleeve caro|sem link/, 'mais barato de cada; link não-https fora');
  assert.match(r.h, /Fichário 9 bolsos/); assert.match(r.h, /rel="sponsored nofollow noopener"/); assert.match(r.h, /preço lido em 31\/10/);
  assert.match(r.h, /Total do kit<\/div><div class=\"big\">R\$ 130,29<\/div><div class=\"w\">de R\$ 150,00 · 3 lojas/, 'lacrado 40 + 11,39 + 78,90'); assert.match(r.h, /Sobram R\$ 19,71/); assert.match(r.h, /Lacrados · 1 item<\/span><b>R\$ 40,00/); assert.match(r.h, /Acessórios · 2 itens<\/span><b>R\$ 90,29/);
  assert.match(r.h, /Frete: a calcular na loja/, 'acessório sem frete conhecido: nunca total com frete');
  assert.doesNotMatch(r.h, /Passou R\$/); }

{ const r = await clicar({ objetivo: 'colecionar', orcamento: '100', idioma: 'pt' }, { cabe: 40 });
  assert.deepEqual(r.pedidos, [100, 9.71, 88.61], 'sleeve + fichário (90,29) deixam 9,71: nenhum lacrado cabe; tira o fichário e pede com 88,61');
  assert.match(r.h, /Sleeve barato/); assert.doesNotMatch(r.h, /Fichário 9 bolsos<\/div>/);
  assert.match(r.h, /Não couberam no orçamento: fichário \(a partir de R\$ 78,90\)/); }

{ const r = await clicar({ objetivo: 'colecionar', orcamento: '150', idioma: 'pt' }, { cabe: 40, accOk: false, total: 55 });
  assert.deepEqual(r.pedidos, [150], 'lista indisponível: kit só com lacrados, uma chamada');
  assert.doesNotMatch(r.h, /Acessórios para completar/); }

{ const r = await clicar({}, { proteger: true });
  assert.match(r.h, /Proteger minhas cartas/); assert.match(r.h, /Sleeve barato/); assert.match(r.h, /Toploader 25/); assert.match(r.h, /Deck box 100\+/); assert.match(r.h, /Fichário 9 bolsos/);
  assert.match(r.h, /<div class=\"big\">R\$ 176,03<\/div>/); assert.doesNotMatch(r.h, /Sua cesta está vazia/); }

// orçamento a partir de R$ 300: acessório das marcas de TCG (o mais barato entre elas), sem marca de TCG cai no mais barato
{ ACC.itens.push({ loja: 'amazon', id: 'S3', kit: 'sleeve', marca: 'Dragon Shield', title: 'Dragon Shield Matte', price: 94.9, url: 'https://link.amazon/f', capturedAt: '2026-10-31T13:10:00-03:00' });
  const r = await clicar({ objetivo: 'colecionar', orcamento: '2000', idioma: 'pt' }, { cabe: 40 });
  assert.match(r.h, /Dragon Shield Matte/); assert.doesNotMatch(r.h, /Sleeve barato/); assert.match(r.h, /Fichário 9 bolsos/, 'fichário sem marca de TCG na lista: o mais barato');
  assert.deepEqual(r.pedidos, [2000, 1826.2], '2000 − (94,90 + 78,90)');
  const b = await clicar({ objetivo: 'colecionar', orcamento: '150', idioma: 'pt' }, { cabe: 40 });
  assert.match(b.h, /Sleeve barato/, 'abaixo de R$ 300: o mais barato'); ACC.itens.pop(); }

// v6: link compartilhado abre direto no resultado (sem o favorito) e o resultado oferece WhatsApp, copiar e imprimir
{ const r = await clicar({ objetivo: 'colecionar', orcamento: '150', idioma: 'pt', favorito: 'Pikachu' }, { cabe: 40 });
  assert.match(r.h, /wa\.me\/\?text=[^"]*objetivo%3Dcolecionar%26orcamento%3D150%26idioma%3Dpt"/); assert.doesNotMatch(r.h, /wa\.me[^"]*Pikachu/, 'favorito fora do link');
  assert.match(r.h, /data-copiar/); assert.match(r.h, /data-imprimir/); assert.match(r.h, /Próximos passos/); assert.match(r.h, /<span>Favorito: Pikachu<\/span>/); }

{ // link compartilhado: abre direto no resultado com as respostas do link
  const app = { innerHTML: '', addEventListener() {}, querySelector: () => null, querySelectorAll: () => ({ forEach() {} }) }; const pedidos = [];
  const ctx = { console, URLSearchParams, Promise, Number, String, JSON, Math, Error, Date, document: { getElementById: () => app }, location: { pathname: '/monte-seu-kit', search: '?objetivo=jogar&orcamento=500&idioma=en' },
    history: { replaceState() {} }, sessionStorage: { getItem: () => null, setItem() {} },
    fetch: (u) => { if (u.startsWith('/data/')) return Promise.resolve({ ok: false }); pedidos.push(u); return Promise.resolve({ ok: true, json: () => Promise.resolve({ modelo: 'jogar', nomeModelo: 'Quero aprender a jogar', itens: [item(90)], subtotal: 90, total: null, fretes: [], alternativas: [], limitacoes: [] }) }); } };
  ctx.window = ctx; vm.createContext(ctx); vm.runInContext(js, ctx); for (let i = 0; i < 6; i++) await flush();
  assert.match(pedidos[0], /objetivo=jogar&orcamento=500&idioma=en/); assert.match(app.innerHTML, /Quero aprender a jogar/);
  const bad = { ...ctx, location: { pathname: '/monte-seu-kit', search: '?objetivo=hack&orcamento=500' } }; bad.window = bad; const app2 = { ...app, innerHTML: '' }; bad.document = { getElementById: () => app2 };
  vm.createContext(bad); vm.runInContext(js, bad); assert.match(app2.innerHTML, /Pergunta 1 de 4/, 'objetivo inválido: começa o questionário'); }

console.log('✓ kit-acessorios: kit completo com acessórios da lista curada, orçamento do kit inteiro, proteger só com acessórios');
