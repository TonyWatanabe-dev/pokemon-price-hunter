// Correções de site que dependem da #920 (auditoria UX/SEO/a11y, 25/10/2026):
//  1. /produto, /colecao e /tipo com slug que não existe: 404 + noindex já existiam, mas o HTML vinha com o título da Home
//     e #view vazio. Agora reaproveita a tela do endereço desconhecido (#904): título, NAO_ENCONTRADA e data-notfound.
//     No app, "Produto não encontrado" e "Página não encontrada" (coleção/formato) viram <h1> (a página não fica sem h1).
//  2. Busca, conta, favoritos, alertas e configurações (casca app.html, X-Robots-Tag noindex) traziam o canonical da Home:
//     o app tira o canonical nessas telas (e no 404); páginas com SSR mantêm o delas.
//  3. F4: contador c-hit, aviso "chegou no seu preço" e o selo do alerta só afirmam o preço com dado em dia (mesma
//     checagem de setAlert: freshState(S).status === "atual").
// Sem rede: state.json sintético no fetch simulado; trechos reais do index.html rodam num sandbox (node:vm).
import assert from 'node:assert/strict';
import fs from 'node:fs'; import path from 'node:path'; import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let n = 0;
const t = async (name, fn) => { try { await fn(); n++; } catch (e) { e.message = `${name}: ${e.message}`; throw e; } };

const now = new Date().toISOString();
const state = {
  generatedAt: now, dataAt: now,
  collections: [{ id: 'ca', name: 'Coleção Única', series: 'Teste' }],
  types: [{ id: 'etb', label: 'Treinador Avançado (ETB)' }],
  products: [{ id: 'ca-etb', collection: 'ca', collectionName: 'Coleção Única', type: 'etb', typeLabel: 'Treinador Avançado (ETB)', name: 'ETB Coleção Única', offerCount: 1 }],
  offers: [{ id: '1', productId: 'ca-etb', storeId: 's1', storeName: 'Loja 1', url: 'https://loja1.test/p', price: 399.9, total: 399.9, stock: 'IN_STOCK', stale: false, anomalous: false, priceKind: 'cash', firstSeen: now }],
};
delete process.env.DATABASE_URL; delete process.env.API_DATABASE_URL;
globalThis.fetch = async (u) => (/state\.json/.test(String(u)) ? new Response(JSON.stringify(state), { status: 200, headers: { 'content-type': 'application/json' } }) : new Response('offline', { status: 503 }));
const { default: pagina, NAO_ENCONTRADA } = await import('../api/pagina.mjs');
const { slugs, colSlug } = await import('../api/_seo.mjs');
const { of } = slugs(state.products);
const get = async (qs) => { let body = ''; const res = { statusCode: 200, setHeader() {}, end(b) { body = String(b ?? ''); return this; } };
  await pagina({ url: `/api/pagina?${qs}`, headers: {} }, res); return { status: res.statusCode, body }; };
const title = (h) => (h.match(/<title>([^<]*)<\/title>/) || [])[1];
const telaNaoEncontrada = `<div id="view" data-notfound><div class="ssr">${NAO_ENCONTRADA}</div></div>`;

// ------------------------------------------------------------------ 1. 404 de produto/coleção/formato
for (const [nome, qs] of [['produto', 't=produto&slug=nao-existe-xyz'], ['coleção', 't=colecao&slug=nao-existe-xyz'], ['formato', 't=tipo&slug=nao-existe-xyz'], ['slug malformado', 't=produto&slug=%E0%A4%A']]) {
  await t(`${nome} inexistente: 404, noindex, sem canonical, título e tela de "Página não encontrada"`, async () => {
    const pg = await get(qs);
    assert.equal(pg.status, 404);
    assert.match(pg.body, /<meta name="robots" content="noindex">/);
    assert.doesNotMatch(pg.body, /rel="canonical"/);
    assert.equal(title(pg.body), 'Página não encontrada | TCG Price Hunter');
    assert.ok(pg.body.includes(telaNaoEncontrada), 'NAO_ENCONTRADA com data-notfound em #view');
    assert.doesNotMatch(pg.body, /application\/ld\+json/, 'sem dados estruturados');
  });
}
await t('mesma tela do endereço desconhecido (#904), sem lógica duplicada', async () => {
  const a = await get('t=nao-encontrada'); const b = await get('t=produto&slug=nao-existe-xyz');
  assert.equal(a.status, 404); assert.equal(a.body, b.body);
});
await t('produto, coleção e Home que existem continuam com 200, título próprio e canonical', async () => {
  const p = await get(`t=produto&slug=${encodeURIComponent(of['ca-etb'])}`);
  assert.equal(p.status, 200); assert.doesNotMatch(p.body, /data-notfound/); assert.notEqual(title(p.body), 'Página não encontrada | TCG Price Hunter');
  assert.match(p.body, /<link rel="canonical" href="https:\/\/tcgpricehunter\.com\.br\/produto\//);
  const c = await get(`t=colecao&slug=${colSlug(state.collections[0])}`);
  assert.equal(c.status, 200); assert.doesNotMatch(c.body, /data-notfound/);
  const h = await get('t=home');
  assert.equal(h.status, 200); assert.match(h.body, /<link rel="canonical" href="https:\/\/tcgpricehunter\.com\.br\/">/);
});

const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
await t('app: telas de produto e de coleção/formato não encontrados têm <h1>', () => {
  assert.match(html, /<h1>Produto não encontrado<\/h1>/); assert.doesNotMatch(html, /<h3>Produto não encontrado<\/h3>/);
  assert.match(html, /<h1>Página não encontrada<\/h1><p>Essa coleção ou formato/);
});

// ------------------------------------------------------------------ 2. canonical da casca
const cut = (a, b) => { const i = html.indexOf(a); const j = html.indexOf(b, i); assert.ok(i > 0 && j > i, `trecho ${a}`); return html.slice(i, j); };
await t('casca: busca, conta, favoritos, alertas, configurações e 404 sem canonical; demais telas mantêm', () => {
  const code = cut('const PRIVATE=', '\n', 0) + '\n' + cut('const SEM_CANON=', 'function renderNotFound(){');
  for (const [v, fica] of [['busca', false], ['conta', false], ['favoritos', false], ['alertas', false], ['configuracoes', false], ['notfound', false],
    ['deals', true], ['produto', true], ['colecao', true], ['tipo', true], ['oportunidades', true], ['lojas', true], ['guia', true]]) {
    let link = { removed: false, remove() { this.removed = true; } };
    const ctx = { view: v, document: { querySelector: (s) => (s === 'link[rel="canonical"]' && !link.removed ? link : null) } };
    vm.createContext(ctx); vm.runInContext(code, ctx); ctx.canonSync(); ctx.canonSync();
    assert.equal(link.removed, !fica, `${v}: canonical ${fica ? 'mantido' : 'removido'}`);
  }
  assert.match(cut('function render(){', '\n}'), /canonSync\(\)/, 'render() chama canonSync');
});
await t('casca: toda rota do app.html com X-Robots-Tag noindex (vercel.json) perde o canonical no app', () => {
  const vj = JSON.parse(fs.readFileSync(path.join(root, 'vercel.json'), 'utf8'));
  const rw = vj.rewrites.find((r) => r.destination === '/app.html');
  assert.ok(rw, 'rewrite para /app.html');
  const rotas = rw.source.match(/^\/\(([^)]+)\)$/)[1].split('|');
  const routes = vm.runInNewContext(`(${cut('const ROUTES=', ';\n').slice('const ROUTES='.length)})`);
  const sem = vm.runInNewContext(`const PRIVATE=${cut('const PRIVATE=', ';\n').slice('const PRIVATE='.length)};${cut('const SEM_CANON=', ';\n')};[...SEM_CANON]`);
  const xrt = vj.headers.filter((h) => h.headers.some((x) => x.key === 'X-Robots-Tag' && /noindex/.test(x.value))).map((h) => h.source).join(' ');
  for (const r of rotas) {
    assert.ok(xrt.includes(r), `${r} com X-Robots-Tag noindex`);
    assert.ok(sem.includes(routes[r]), `${r} → view ${routes[r]} sem canonical`);
  }
});

// ------------------------------------------------------------------ 3. F4: "chegou no seu preço" só com dado em dia
const f4code = cut('const precoEmDia=', 'const authPending=') + cut('function alertBox(pid){', '\n/* Páginas privadas');
function sandboxF4(status) {
  const ctx = {
    S: {}, freshState: () => ({ status }),
    alertsL: () => [{ p: 'p1', v: 50 }], alertOf: (pid) => (pid === 'p1' ? { p: 'p1', v: 50 } : null), bestLive: () => ({ total: 40, storeName: 'Loja' }),
    money: (v) => `R$ ${v}`, pixTxt: () => '', esc: (s) => String(s), storeTxt: (o) => o.storeName, ic: (k) => `[${k}]`,
  };
  vm.createContext(ctx); vm.runInContext(f4code + ';this.hits=hits;', ctx); return ctx;
}
await t('F4: com dado em dia, alerta no preço conta, avisa e mostra "Chegou no seu preço"', () => {
  const c = sandboxF4('atual');
  assert.equal(c.hits().length, 1);
  const box = c.alertBox('p1'); assert.match(box, /Chegou no seu preço/); assert.match(box, /class="alertbox hit"/);
});
for (const status of ['atrasado', 'desatualizado', 'indisponivel']) {
  await t(`F4: dado ${status} não afirma o preço (sem contador, aviso nem selo); alvo e menor preço seguem visíveis`, () => {
    const c = sandboxF4(status);
    assert.equal(c.hits().length, 0, 'c-hit, toast e "no seu preço" da conta usam hits()');
    const box = c.alertBox('p1');
    assert.doesNotMatch(box, /Chegou no seu preço/); assert.doesNotMatch(box, /alertbox hit/); assert.doesNotMatch(box, /bell-ringing/);
    assert.match(box, /Seu alvo: <b>R\$ 50<\/b>/);
  });
}
await t('F4: contador, aviso e conta passam por hits(); setAlert segue com a mesma checagem', () => {
  assert.match(html, /const n=S&&u\?hits\(\)\.length:0;document\.querySelectorAll\("\.c-hit"\)/);
  assert.match(html, /if\(n&&!ACC\.told\)\{ACC\.told=true;toast\(/);
  assert.match(html, /const nf=favs\(\)\.length,na=alertsL\(\)\.length,nh=hits\(\)\.length;/);
  assert.match(html, /const precoEmDia=\(\)=>freshState\(S\)\.status==="atual";/);
  assert.match(html, /toast\(o&&o\.total<=v\?\(freshState\(S\)\.status==="atual"\?"Alerta criado: já tem loja nesse preço"/);
});

console.log(`site-pos-920: ${n} testes ok`);
