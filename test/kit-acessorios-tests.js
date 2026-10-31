// Kit completo com acessórios (kit-v4.js): a API diz quais acessórios o modelo pede; a página escolhe o mais barato de cada
// um na lista curada (/data/afiliados-acessorios.json), desconta do orçamento antes de pedir os lacrados, tira o último
// acessório se nenhum lacrado couber, mostra data da leitura e frete a calcular. "Proteger" = kit só de acessórios.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import vm from 'node:vm';

const js = fs.readFileSync(new URL('../assets/web/kit-v4.js', import.meta.url), 'utf8');
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
  assert.match(r.h, /Kit completo: <b>R\$ 130,29<\/b> de R\$ 150,00/, 'lacrado 40 + 11,39 + 78,90');
  assert.match(r.h, /Frete: a calcular na loja/, 'acessório sem frete conhecido: nunca total com frete');
  assert.doesNotMatch(r.h, /passou do orçamento/); }

{ const r = await clicar({ objetivo: 'colecionar', orcamento: '100', idioma: 'pt' }, { cabe: 40 });
  assert.deepEqual(r.pedidos, [100, 9.71, 88.61], 'sleeve + fichário (90,29) deixam 9,71: nenhum lacrado cabe; tira o fichário e pede com 88,61');
  assert.match(r.h, /Sleeve barato/); assert.doesNotMatch(r.h, /Fichário 9 bolsos<\/div>/);
  assert.match(r.h, /Não couberam no orçamento: fichário \(a partir de R\$ 78,90\)/); }

{ const r = await clicar({ objetivo: 'colecionar', orcamento: '150', idioma: 'pt' }, { cabe: 40, accOk: false, total: 55 });
  assert.deepEqual(r.pedidos, [150], 'lista indisponível: kit só com lacrados, uma chamada');
  assert.doesNotMatch(r.h, /Acessórios para completar/); }

{ const r = await clicar({}, { proteger: true });
  assert.match(r.h, /Proteger minhas cartas/); assert.match(r.h, /Sleeve barato/); assert.match(r.h, /Toploader 25/); assert.match(r.h, /Deck box 100\+/); assert.match(r.h, /Fichário 9 bolsos/);
  assert.match(r.h, /Kit completo: <b>R\$ 176,03<\/b>/); assert.doesNotMatch(r.h, /Sua cesta está vazia/); }

console.log('✓ kit-acessorios: kit completo com acessórios da lista curada, orçamento do kit inteiro, proteger só com acessórios');
