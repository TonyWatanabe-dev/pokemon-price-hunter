// Monte seu kit, medição (docs/monte-seu-kit.md §7). O script do Vercel Web Analytics (0.1.3) só conta página vista na
// carga, em history.pushState e em popstate; a página do kit troca a etapa com replaceState. Este teste roda
// assets/web/kit-v3.js num DOM falso e confere: cada etapa nova vira UMA página vista (a primeira é a automática),
// marcar opção não conta de novo, utm_* ficam no caminho, clique de saída vira /monte-seu-kit/saida/<loja>, eventos
// do funil existem e nenhum dado pessoal (texto do Pokémon favorito) sai para o analytics.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const js = read('assets/web/kit-v3.js');
const html = read('kit.html');

// kit.html carrega a v2, uma vez, antes do script do Vercel (ordem dos defer: o kit troca o caminho antes da página vista automática)
assert.equal((html.match(/kit-v\d+\.js/g) || []).join(), 'kit-v3.js', 'kit.html usa só a kit-v3.js');
assert.equal((html.match(/_vercel\/insights\/script\.js/g) || []).length, 1, 'script do Vercel uma vez só');
assert.ok(html.indexOf('kit-v3.js') < html.indexOf('_vercel/insights/script.js'), 'kit antes do analytics');
assert.ok(fs.existsSync(new URL('../assets/web/kit-v1.js', import.meta.url)), 'v1 continua publicada (cache imutável de HTML antigo)');

function montar({ search = '', api } = {}) {
  const ouvintes = {};
  const app = { innerHTML: '', addEventListener: (t, f) => { (ouvintes[t] = ouvintes[t] || []).push(f); }, querySelector: () => null, querySelectorAll: () => ({ forEach() {} }) };
  const urls = [];
  const loc = { pathname: '/monte-seu-kit', search, href: 'https://x.test/monte-seu-kit' + search };
  const ctx = {
    console, URLSearchParams, Promise, Number, String, JSON, Math, Error,
    document: { getElementById: () => app },
    location: loc,
    history: { replaceState: (_s, _t, u) => { urls.push(u); const [p, q = ''] = u.split('?'); loc.pathname = p; loc.search = q ? '?' + q : ''; } },
    sessionStorage: { getItem: () => null, setItem() {} },
    fetch: (u) => api(u),
  };
  ctx.window = ctx;
  vm.createContext(ctx);
  vm.runInContext(js, ctx);
  const chamadas = [];
  const carregarAnalytics = () => { ctx.window.va = (tipo, dado) => chamadas.push([tipo, JSON.parse(JSON.stringify(dado))]); };
  const fire = (tipo, target) => (ouvintes[tipo] || []).forEach((f) => f({ type: tipo, button: target.button ?? 0, target }));
  const botao = (attrs) => { const b = { dataset: {}, hasAttribute: (n) => n in attrs, getAttribute: (n) => (n in attrs ? attrs[n] : null) }; if ('data-v' in attrs) b.dataset.v = attrs['data-v']; b.closest = (s) => (s === 'button' ? b : null); return b; };
  const link = (attrs, button = 0) => ({ button, getAttribute: (n) => (n in attrs ? attrs[n] : null), closest: (s) => (s === 'a[data-saida]' ? link(attrs, button) : null) });
  return { ctx, app, urls, chamadas, carregarAnalytics, fire, botao, link,
    vistas: () => chamadas.filter((c) => c[0] === 'pageview').map((c) => c[1].path),
    eventos: (n) => chamadas.filter((c) => c[0] === 'event' && (!n || c[1].name === n)).map((c) => c[1].data) };
}
const flush = () => new Promise((r) => setTimeout(r, 0));
const RESP = { modelo: 'primeira-colecao', nomeModelo: 'Primeira coleção', orcamento: 100, subtotal: 60, total: null, fretes: [],
  itens: [{ productId: 'me04-blister3', quantidade: 2, nome: 'Blister', porque: 'Barato', imagem: '', oferta: { storeId: 'Loja X', storeName: 'Loja X', price: 30, url: 'https://loja.test/p' } }], alternativas: [], limitacoes: [] };
const okApi = (u) => Promise.resolve({ ok: true, json: () => Promise.resolve(u.includes('/cesta') ? { dividir: { subtotal: 90, total: null, fretes: [], pedidos: 1 } } : RESP) });

// 1. Carga: caminho da 1ª etapa com utm_* (fbclid fora), sem página vista manual (a automática conta), fila só com evento.
{
  const k = montar({ search: '?utm_source=tiktok&utm_campaign=kit&fbclid=abc', api: okApi });
  assert.equal(k.urls[0], '/monte-seu-kit/objetivo?utm_source=tiktok&utm_campaign=kit', 'utm_* preservados, fbclid descartado');
  const fila = JSON.parse(JSON.stringify(k.ctx.vaq.map((a) => [a[0], a[1] && a[1].name])));
  assert.deepEqual(fila, [['event', 'kit_step']], 'antes do script do Vercel: nenhuma página vista enfileirada (evita contar a 1ª etapa duas vezes)');
  k.carregarAnalytics();

  // 2. Marcar opção re-renderiza a mesma etapa: não conta. Avançar conta a etapa nova uma vez.
  k.fire('click', k.botao({ 'data-v': 'colecionar' }));
  assert.deepEqual(k.vistas(), [], 'marcar opção não é página nova');
  k.fire('click', k.botao({ 'data-avancar': '' }));
  assert.deepEqual(k.vistas(), ['/monte-seu-kit/orcamento']);
  assert.equal(k.urls.at(-1), '/monte-seu-kit/orcamento?utm_source=tiktok&utm_campaign=kit', 'utm_* seguem nas etapas');
  k.fire('click', k.botao({ 'data-v': '100' })); k.fire('click', k.botao({ 'data-avancar': '' }));
  k.fire('click', k.botao({ 'data-voltar': '' }));
  assert.deepEqual(k.vistas(), ['/monte-seu-kit/orcamento', '/monte-seu-kit/idioma', '/monte-seu-kit/orcamento'], 'voltar também é uma etapa vista');
  k.fire('click', k.botao({ 'data-avancar': '' }));
  k.fire('click', k.botao({ 'data-v': 'pt' })); k.fire('click', k.botao({ 'data-avancar': '' }));
  k.fire('input', { id: 'fav', value: 'Pikachu da Maria' });
  k.fire('click', k.botao({ 'data-avancar': '' }));
  await flush(); await flush();
  const v = k.vistas();
  assert.deepEqual(v.slice(-2), ['/monte-seu-kit/favorito', '/monte-seu-kit/resultado/primeira-colecao'], '"resultado" (carregando) não conta; conta o kit mostrado');
  assert.equal(v.filter((p) => p === '/monte-seu-kit/resultado').length, 0);
  assert.deepEqual(k.eventos('kit_result'), [{ modelo: 'primeira-colecao', itens: 1, objetivo: 'colecionar', idioma: 'pt', faixa: '100', favorito: true }]);
  assert.deepEqual(k.eventos('kit_step').map((d) => d.etapa), ['orcamento', 'idioma', 'orcamento', 'idioma', 'favorito', 'resultado', 'resultado/primeira-colecao']);

  // 3. Item alterado e clique de saída (esquerdo e do meio; direito não conta).
  k.fire('click', k.botao({ 'data-mais': '0' }));
  assert.deepEqual(k.eventos('kit_item'), [{ acao: 'mais', modelo: 'primeira-colecao', itens: 1 }]);
  await flush(); await flush();
  assert.match(k.app.innerHTML, /data-saida="Loja X" data-pid="me04-blister3" data-preco="30"/, 'link de saída carrega loja, produto e preço exibido');
  const a = { 'data-saida': 'Loja X', 'data-pid': 'me04-blister3', 'data-preco': '30' };
  k.fire('click', k.link(a)); k.fire('auxclick', k.link(a, 1)); k.fire('auxclick', k.link(a, 2));
  assert.deepEqual(k.vistas().filter((p) => p.includes('/saida/')), ['/monte-seu-kit/saida/loja-x', '/monte-seu-kit/saida/loja-x']);
  assert.deepEqual(k.eventos('kit_click_store')[0], { loja: 'loja-x', produto: 'me04-blister3', preco: 30, modelo: 'primeira-colecao' });

  // 4. Refazer volta à 1ª etapa e conta.
  k.fire('click', k.botao({ 'data-refazer': '' }));
  assert.equal(k.eventos('kit_restart').length, 1);
  assert.equal(k.vistas().at(-1), '/monte-seu-kit/objetivo');

  // 5. Privacidade: o texto do favorito nunca sai para o analytics.
  assert.doesNotMatch(JSON.stringify(k.chamadas) + JSON.stringify(k.ctx.vaq), /Pikachu|Maria/, 'sem texto livre no analytics');
}

// 6. Falha da API: página vista resultado/erro; sem utm na URL, caminho limpo.
{
  const k = montar({ api: () => Promise.reject(new Error('rede')) });
  assert.equal(k.urls[0], '/monte-seu-kit/objetivo');
  k.carregarAnalytics();
  k.fire('click', k.botao({ 'data-v': 'proteger' }));   // "proteger" pula direto para o resultado
  await flush(); await flush();
  assert.deepEqual(k.vistas(), ['/monte-seu-kit/resultado/erro']);
  assert.match(k.app.innerHTML, /Não deu para montar o kit agora/);
}

// 7. Script do Vercel ausente (bloqueador): nada quebra e nenhuma página vista manual é enfileirada.
{
  const k = montar({ api: okApi });
  k.fire('click', k.botao({ 'data-v': 'jogar' })); k.fire('click', k.botao({ 'data-avancar': '' }));
  assert.ok(k.ctx.vaq.every((x) => x[0] === 'event'), 'sem o script, só eventos na fila');
}
console.log('✓ kit-medicao: funil por página vista (replaceState), utm_*, saída por loja, eventos e sem dado pessoal');
