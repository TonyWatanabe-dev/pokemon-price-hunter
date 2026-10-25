// Remoção de produto (#897) em rodadas reais (runOnce) — testes de CARACTERIZAÇÃO do comportamento atual de src/run.js
// (nada em src muda). Complementa test/pagina-erro-tests.js com: contador zerado por leitura normal no meio da sequência,
// falha de rede intercalada, telemetria pagesGone/pagesGoneConfirmed rodada a rodada, bloqueio 403 (nunca evidência) e a
// semântica de loja com 1+ casado (a regra das 2 rodadas só existe na proteção de "zero casados"). Fetch simulado; dados
// em pasta temporária; nenhuma rede real nem banco.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
process.env.HUNTER_DOMAIN_DELAY_MS ??= '0';
const http = await import('../src/http.js');
http.setSleep(async () => {});
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const ld = (o) => `<script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', ...o })}</script>`;
const produto = (p, nome) => `<!doctype html><html><head><title>${nome} - Loja</title><meta property="og:type" content="product">${ld({ '@type': 'Product', name: nome, url: p, offers: { '@type': 'Offer', price: 449.9, priceCurrency: 'BRL', availability: 'https://schema.org/InStock' } })}</head><body><h1>${nome}</h1><span>R$ 449,90</span></body></html>`;
const ERRO = `<!doctype html><html><head><title></title>${ld({ '@graph': [{ '@type': 'Product', name: 'Jogo Dobble', url: '/produtos/vitrine-1/', offers: { '@type': 'Offer', price: 69.99, priceCurrency: 'BRL' } }] })}</head><body><h1>Erro - 404</h1><p>A página que você procura não existe.</p></body></html>`;
const NOMES = { a: 'Box Display Pokémon ME05 Escuridão Absoluta 36 Boosters Copag', b: 'Pokémon TCG Elite Trainer Box ME03 Equilíbrio Perfeito Copag' };
const PATHS = { a: '/produtos/pokemon-box-me05-booster/', b: '/produtos/pokemon-etb-me03/' };

const rotas = {};
http.setFetch(async (url) => {
  const u = new URL(url); const r = rotas[u.host] || {};
  if (u.pathname === '/robots.txt') return new Response('', { status: 404 });
  const f = r[u.pathname]; if (!f) return new Response('não achei', { status: 404 });
  return f();
});
const resp = (s, status = 200) => new Response(s, { status, headers: { 'content-type': 'text/html' } });
const { runOnce } = await import('../src/run.js');

/** Cenário isolado: loja JSON-LD `host` com as páginas `itens` (a/b); estado[x] = 'ok' | 'erro' | '404' | 'rede' | '403'. */
async function cenario(host, itens, corpo) {
  const keep = Object.fromEntries(['HUNTER_CONFIG_DIR', 'HUNTER_DATA_DIR', 'HUNTER_TIPS', 'HUNTER_CEP', 'HUNTER_BUDGET_MIN'].map((k) => [k, process.env[k]]));
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hunter-remocao-'));
  try {
    process.env.HUNTER_CONFIG_DIR = path.join(tmp, 'config'); process.env.HUNTER_DATA_DIR = path.join(tmp, 'data'); process.env.HUNTER_TIPS = '0';
    delete process.env.HUNTER_CEP; delete process.env.HUNTER_BUDGET_MIN;
    fs.mkdirSync(process.env.HUNTER_CONFIG_DIR, { recursive: true }); fs.mkdirSync(process.env.HUNTER_DATA_DIR, { recursive: true });
    fs.copyFileSync(path.join(root, 'config/catalog.json'), path.join(tmp, 'config/catalog.json'));
    const id = host.split('.')[0];
    fs.writeFileSync(path.join(tmp, 'config/stores.json'), JSON.stringify({ stores: [{ id, name: id, url: `https://${host}`, platform: 'jsonld', kind: 'specialist', evidence: {} }] }));
    fs.writeFileSync(path.join(tmp, 'config/watchlist.json'), JSON.stringify({ settings: { cep: null }, rules: [] }));
    const estado = Object.fromEntries(itens.map((x) => [x, 'ok']));
    rotas[host] = { '/sitemap.xml': () => new Response(`<urlset>${itens.map((x) => `<url><loc>https://${host}${PATHS[x]}</loc></url>`).join('')}</urlset>`, { status: 200, headers: { 'content-type': 'application/xml' } }) };
    for (const x of itens) {
      rotas[host][PATHS[x]] = () => {
        const e = estado[x];
        if (e === 'ok') return resp(produto(PATHS[x], NOMES[x]));
        if (e === 'erro') return resp(ERRO);
        if (e === '404') return resp('não existe', 404);
        if (e === '403') return resp('bloqueado', 403);
        throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ETIMEDOUT' } });
      };
    }
    const read = (f) => JSON.parse(fs.readFileSync(path.join(tmp, 'data', f), 'utf8'));
    const hist = () => fs.readFileSync(path.join(tmp, 'data/history.jsonl'), 'utf8').split('\n').filter(Boolean).map((x) => JSON.parse(x));
    const oferta = (x) => Object.values(read('offers.json')).find((o) => o.storeId === id && o.url === `https://${host}${PATHS[x]}`);
    const src = () => read('sources.json')[id];
    const cont = (x) => read('url-cache.json')[id]?.removidas?.[`https://${host}${PATHS[x]}`]?.n;
    const t0 = Date.parse('2026-10-24T12:00:00Z'); let i = 0;
    const rodada = async (mudancas = {}) => { Object.assign(estado, mudancas); await runOnce({ log: () => {}, send: { capture: async () => true }, now: new Date(t0 + (i++) * 3600e3) }); };
    await corpo({ rodada, oferta, src, cont, hist });
  } finally {
    for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}

// 1) Loja com zero casados: leitura normal no meio zera o contador; telemetria acompanha cada rodada.
await cenario('zera.test', ['a'], async ({ rodada, oferta, src, cont, hist }) => {
  await rodada(); assert.equal(oferta('a')?.stale, false); const id = oferta('a').id;
  assert.equal(src().pagesGone, 0); assert.equal(src().pagesGoneConfirmed, 0);
  await rodada({ a: 'erro' }); assert.equal(oferta('a')?.stale, true, '1ª evidência: protegida'); assert.equal(cont('a'), 1);
  assert.deepEqual([src().pagesGone, src().pagesGoneConfirmed], [1, 0]);
  await rodada({ a: 'ok' }); assert.equal(oferta('a')?.stale, false, 'leitura normal: oferta volta'); assert.equal(cont('a'), undefined, 'leitura normal zera');
  assert.deepEqual([src().pagesGone, src().pagesGoneConfirmed], [0, 0]);
  await rodada({ a: '404' }); assert.equal(oferta('a')?.stale, true, 'evidência depois do zero: só protege'); assert.equal(cont('a'), 1);
  assert.equal(hist().filter((h) => h.offerId === id && h.event === 'removed').length, 0, 'nada removido até aqui');
  await rodada({ a: '404' }); assert.equal(oferta('a'), undefined, '2ª evidência seguida remove');
  assert.deepEqual([src().pagesGone, src().pagesGoneConfirmed], [1, 1]);
  assert.equal(hist().filter((h) => h.offerId === id && h.event === 'removed').length, 1);
  assert.ok(hist().some((h) => h.offerId === id && h.event !== 'removed'), 'histórico anterior preservado');
  assert.equal(src().reason, null, 'sem oferta protegida restante: a loja não registra "zero casados"');
});

// 2) Falha de rede depois da 1ª evidência: não soma nem zera (a sequência evidência → falha → evidência já está em
// test/pagina-erro-tests.js com 503; aqui é timeout de rede, que derruba a rodada da loja inteira).
await cenario('rede.test', ['a'], async ({ rodada, oferta, cont, src }) => {
  await rodada(); await rodada({ a: 'erro' }); assert.equal(cont('a'), 1);
  // Todas as páginas planejadas falharam: a loja vira ERROR (backoff); a oferta segue lá como não confirmada.
  await rodada({ a: 'rede' }); assert.equal(oferta('a')?.stale, true); assert.equal(cont('a'), 1, 'falha não soma nem zera'); assert.equal(src().status, 'ERROR');
});

// 3) Loja com 1+ casado: a página de um produto que dá 404 sai NA PRIMEIRA rodada (caminho de remoção anterior à #897;
// a regra das 2 rodadas só segura ofertas na proteção de "zero casados"). Caracterização — ver relatório T-A, achado A2.
await cenario('casado.test', ['a', 'b'], async ({ rodada, oferta, src, cont, hist }) => {
  await rodada(); assert.ok(oferta('a') && oferta('b'), 'as duas casam'); const id = oferta('b').id;
  await rodada({ b: '404' });
  assert.ok(oferta('a') && oferta('a').stale === false);
  assert.equal(oferta('b'), undefined, 'com 1+ casado, uma rodada de 404 já remove (comportamento atual)');
  assert.equal(hist().filter((h) => h.offerId === id && h.event === 'removed').length, 1);
  assert.equal(cont('b'), 1, 'o contador ainda registra a 1ª evidência'); assert.equal(src().pagesGoneConfirmed, 0);
  // e o produto que volta reaparece (a página com evidência pendente é relida na rodada seguinte)
  await rodada({ b: 'ok' }); assert.equal(oferta('b')?.stale, false, 'voltou'); assert.equal(cont('b'), undefined);
});

// 4) 403 numa página: a loja é BLOQUEADA na rodada; nada vira evidência, o contador fica como estava e a oferta não sai.
await cenario('bloq.test', ['a'], async ({ rodada, oferta, src, cont }) => {
  await rodada(); await rodada({ a: 'erro' }); assert.equal(cont('a'), 1);
  await rodada({ a: '403' });
  assert.equal(src().status, 'BLOCKED'); assert.ok(oferta('a'), 'oferta continua'); assert.equal(cont('a'), 1, '403 não soma nem zera');
});
console.log('remocao-rodadas-tests: ok');
