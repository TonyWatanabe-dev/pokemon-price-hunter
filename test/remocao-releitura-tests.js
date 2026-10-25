// PROPOSTA PÓS-BURN-IN (A1/A3): passa só com a mudança em src/run.js desta branch; falha na main.
// Remoção de produto (#897) em rodadas reais (runOnce) — testes de CARACTERIZAÇÃO do comportamento atual de src/run.js
// (nada em src muda). Complementa test/pagina-erro-tests.js com: contador zerado por leitura normal no meio da sequência,
// falha de rede intercalada, telemetria pagesGone/pagesGoneConfirmed rodada a rodada, bloqueio 403 (nunca evidência) e a
// semântica de loja com 1+ casado (a regra das 2 rodadas só existe na proteção de "zero casados"). Fetch simulado; dados
// em pasta temporária; nenhuma rede real nem banco.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
process.env.HUNTER_DOMAIN_DELAY_MS ??= '0';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const http = await import(path.join(root, 'src/http.js'));
http.setSleep(async () => {});

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
const { runOnce } = await import(path.join(root, 'src/run.js'));

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
    const estado = Object.fromEntries(itens.map((x) => [x, 'ok'])); const fora = new Set();
    rotas[host] = { '/sitemap.xml': () => new Response(`<urlset>${itens.filter((x) => !fora.has(x)).map((x) => `<url><loc>https://${host}${PATHS[x]}</loc><lastmod>2026-09-29T14:29:18Z</lastmod></url>`).join('')}</urlset>`, { status: 200, headers: { 'content-type': 'application/xml' } }) };
    for (const x of itens) {
      rotas[host][PATHS[x]] = () => {
        const e = estado[x];
        if (e === 'ok') return resp(produto(PATHS[x], NOMES[x]));
        if (e === 'erro') return resp(ERRO);
        if (e === '404') return resp('não existe', 404);
        if (e === '403') return resp('bloqueado', 403);
        if (e === 'semsinal') return resp('<html><head><title>Loja</title></head><body><h1>Ops!</h1></body></html>');
        throw Object.assign(new TypeError('fetch failed'), { cause: { code: 'ETIMEDOUT' } });
      };
    }
    const read = (f) => JSON.parse(fs.readFileSync(path.join(tmp, 'data', f), 'utf8'));
    const hist = () => fs.readFileSync(path.join(tmp, 'data/history.jsonl'), 'utf8').split('\n').filter(Boolean).map((x) => JSON.parse(x));
    const oferta = (x) => Object.values(read('offers.json')).find((o) => o.storeId === id && o.url === `https://${host}${PATHS[x]}`);
    const src = () => read('sources.json')[id];
    const cont = (x) => read('url-cache.json')[id]?.removidas?.[`https://${host}${PATHS[x]}`]?.n;
    const t0 = Date.now() - 5 * 864e5; let i = 0; // sitemap (cache.at usa o relógio real) é revarrido em toda rodada
    const pula = (h) => { i += h; };
    const rodada = async (mudancas = {}) => { Object.assign(estado, mudancas); await runOnce({ log: () => {}, send: { capture: async () => true }, now: new Date(t0 + (i++) * 3600e3) }); };
    await corpo({ rodada, oferta, src, cont, hist, fora, pula });
  } finally {
    for (const [k, v] of Object.entries(keep)) { if (v === undefined) delete process.env[k]; else process.env[k] = v; }
    fs.rmSync(tmp, { recursive: true, force: true });
  }
}


// PROPOSTA (falha no código atual — NÃO vai para a suíte). Achado A1: oferta stale cuja página saiu de cache.relevant e
// tem lastmod do sitemap anterior à última leitura nunca é relida (filtro de retry em src/run.js), então nunca junta
// evidência. Caso real BQD: 29 ofertas, lastmod 2026-09-29, visitedAt 2026-10-24T15:15 (ramo data ccb926e).
let falhas = 0;
const caso = async (nome, fn) => { try { await fn(); console.log('PASSOU', nome); } catch (e) { falhas++; console.log('FALHOU', nome, '-', e.message.split('\n')[0]); } };
await caso('A1 lastmod antigo', () => cenario('lastmod.test', ['a'], async ({ rodada, oferta, pula }) => {
  await rodada(); assert.equal(oferta('a')?.stale, false);
  await rodada({ a: 'semsinal' }); assert.equal(oferta('a')?.stale, true, 'página sem produto e sem sinal: protegida (sai de relevant)');
  pula(25); await rodada({ a: 'erro' }); await rodada(); await rodada(); await rodada();
  assert.equal(oferta('a'), undefined, 'esperado: página relida após 24 h, 2 evidências, oferta removida');
}));
// Achado A3: URL da oferta que sai do sitemap (caso Gato Gingado) tem o contador podado a cada rodada e nunca confirma.
await caso('A3 fora do sitemap', () => cenario('sitemap.test', ['a'], async ({ rodada, oferta, fora, cont, pula }) => {
  await rodada(); assert.equal(oferta('a')?.stale, false);
  fora.add('a'); pula(25); for (let k = 0; k < 3; k++) { await rodada(k ? {} : { a: '404' }); console.log('  A3 rodada', k, 'stale', oferta('a')?.stale, 'cont', cont('a')); }
  assert.equal(oferta('a'), undefined, `esperado: 404 em 2 rodadas remove (contador atual: ${cont('a')})`);
}));
console.log('falhas', falhas);
if (falhas) process.exit(1);
