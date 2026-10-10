// Cobertura direta de src/robots.js (respeito ao robots.txt) e src/distrust.js (janela de desconfiança de lojas).
// Sem rede: fetch falso via setFetch; dados em pasta temporária. O comportamento atual é a especificação.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

// Antes de carregar http.js/db.js: sem espera entre pedidos e sem tocar em data/ do repositório.
process.env.HUNTER_DOMAIN_DELAY_MS = '0';
const prevDataDir = process.env.HUNTER_DATA_DIR;
const tmpData = fs.mkdtempSync(path.join(os.tmpdir(), 'robots-distrust-'));
process.env.HUNTER_DATA_DIR = tmpData;

const { setFetch, userAgent } = await import('../src/http.js');
const { parseRobots, check, allowed, _resetRobots } = await import('../src/robots.js');
const { loadDistrust, trustedPoint, DATA_VERSION } = await import('../src/distrust.js');

let n = 0; const t = async (name, fn) => { try { await fn(); n++; } catch (e) { e.message = `${name}: ${e.message}`; throw e; } };
const token = userAgent.split('/')[0];   // "PokeHunterBR" (produto do UA)

// Servidor falso: host → { status, body } ou função que lança; conta pedidos por URL.
let sites = {}; const hits = [];
setFetch(async (url, opts) => {
  hits.push({ url, ua: opts?.headers?.['user-agent'] });
  const site = sites[new URL(url).host];
  if (typeof site === 'function') return site(url);
  if (!site) throw new Error('host sem resposta no teste: ' + url);
  return new Response(site.body ?? '', { status: site.status ?? 200, headers: { 'content-type': 'text/plain' } });
});
const robots = (host, body, status = 200) => { sites[host] = { body, status }; };
const hitsOf = (host) => hits.filter((h) => new URL(h.url).host === host).length;

try {
  // ---------- robots.js: parser ----------
  await t('parse: diretivas e User-agent sem diferenciar maiúsculas; comentários e linhas soltas ignorados', () => {
    const rules = parseRobots('# topo\nUSER-AGENT: *\nDISALLOW: /a # comentário\nallow: /a/b\nSitemap: https://x/s.xml\nCrawl-delay: 5\n');
    assert.deepEqual(rules.map((r) => [r.allow, r.path]), [[false, '/a'], [true, '/a/b']]);
  });
  await t('parse: regra antes de qualquer User-agent é ignorada; Disallow vazio não vira regra', () => {
    assert.deepEqual(parseRobots('Disallow: /\nUser-agent: *\nDisallow:\n'), []);
  });
  await t('parse: corpo vazio, HTML ou lixo → nenhuma regra', () => {
    for (const body of ['', '\n\n', '<html><body>404</body></html>', 'qualquer coisa sem dois-pontos', '\u0000\u0001']) assert.deepEqual(parseRobots(body), []);
  });
  await t('parse: CRLF e várias linhas User-agent seguidas formam um grupo só', () => {
    const rules = parseRobots('User-agent: outro\r\nUser-agent: *\r\nDisallow: /x\r\n');
    assert.deepEqual(rules.map((r) => r.path), ['/x']);
  });
  await t('parse: grupo do nosso robô (sem diferenciar maiúsculas) substitui o "*"', () => {
    const txt = `User-agent: *\nDisallow: /\n\nUser-agent: ${token.toUpperCase()}\nDisallow: /privado\n`;
    assert.deepEqual(parseRobots(txt).map((r) => r.path), ['/privado']);
  });
  await t('parse: grupo de outro robô é ignorado; vale o "*"', () => {
    const txt = 'User-agent: Googlebot\nAllow: /\n\nUser-agent: *\nDisallow: /loja\n';
    assert.deepEqual(parseRobots(txt).map((r) => [r.allow, r.path]), [[false, '/loja']]);
  });
  await t('parse: vários grupos do nosso robô somam regras', () => {
    const txt = `User-agent: ${token}\nDisallow: /a\n\nUser-agent: *\nDisallow: /\n\nUser-agent: ${token}\nDisallow: /b\n`;
    assert.deepEqual(parseRobots(txt).map((r) => r.path), ['/a', '/b']);
  });
  await t('parse: sem grupo nosso nem "*" → nenhuma regra', () => {
    assert.deepEqual(parseRobots('User-agent: Bingbot\nDisallow: /\n'), []);
  });

  // ---------- robots.js: check()/allowed() com fetch falso ----------
  _resetRobots(); hits.length = 0;
  await t('busca /robots.txt na origem com o UA honesto do robô', async () => {
    robots('ua.test', '');
    assert.equal(await allowed('https://ua.test/produto'), true);
    assert.equal(hits[0].url, 'https://ua.test/robots.txt'); assert.equal(hits[0].ua, userAgent);
  });
  await t('Disallow bloqueia o prefixo; resto liberado', async () => {
    robots('d.test', 'User-agent: *\nDisallow: /checkout\n');
    assert.deepEqual(await check('https://d.test/checkout'), { ok: false, why: 'robots' });
    assert.deepEqual(await check('https://d.test/checkout/passo-2'), { ok: false, why: 'robots' });
    assert.deepEqual(await check('https://d.test/checkoutx'), { ok: false, why: 'robots' }, 'prefixo, não segmento');
    assert.deepEqual(await check('https://d.test/produto/checkout'), { ok: true }, 'só casa no início do caminho');
    assert.deepEqual(await check('https://d.test/'), { ok: true });
  });
  await t('Allow mais específico (mais longo) vence Disallow mais curto, e vice-versa', async () => {
    robots('p.test', 'User-agent: *\nDisallow: /loja\nAllow: /loja/pokemon\nDisallow: /loja/pokemon/admin\n');
    assert.equal(await allowed('https://p.test/loja/outros'), false);
    assert.equal(await allowed('https://p.test/loja/pokemon/box'), true);
    assert.equal(await allowed('https://p.test/loja/pokemon/admin/x'), false);
  });
  await t('empate de tamanho entre Allow e Disallow → Allow (menos restritivo, padrão Google)', async () => {
    robots('tie.test', 'User-agent: *\nDisallow: /pagina\nAllow: /pagina\n');
    assert.equal(await allowed('https://tie.test/pagina'), true);
    robots('tie2.test', 'User-agent: *\nAllow: /pagina\nDisallow: /pagina\n');
    assert.equal(await allowed('https://tie2.test/pagina'), true, 'ordem no arquivo não importa');
  });
  await t('Disallow: / com Allow específico', async () => {
    robots('root.test', 'User-agent: *\nDisallow: /\nAllow: /produtos/\n');
    assert.equal(await allowed('https://root.test/produtos/x'), true);
    assert.equal(await allowed('https://root.test/carrinho'), false);
    assert.equal(await allowed('https://root.test/'), false);
  });
  await t('grupo do nosso robô vale no check(): "*" proibindo tudo não se aplica', async () => {
    robots('mine.test', `User-agent: *\nDisallow: /\n\nUser-agent: ${token}\nDisallow: /admin\n`);
    assert.equal(await allowed('https://mine.test/produto'), true);
    assert.equal(await allowed('https://mine.test/admin'), false);
  });
  await t('grupo de outro robô liberando tudo não libera o nosso', async () => {
    robots('other.test', 'User-agent: Googlebot\nAllow: /\n\nUser-agent: *\nDisallow: /\n');
    assert.equal(await allowed('https://other.test/produto'), false);
  });
  await t('curinga * no meio e no fim', async () => {
    robots('wc.test', 'User-agent: *\nDisallow: /*bloqueado\nDisallow: /busca*ordem=\n');
    assert.equal(await allowed('https://wc.test/pokemon-box-bloqueado'), false);
    assert.equal(await allowed('https://wc.test/a/b/bloqueado/c'), false);
    assert.equal(await allowed('https://wc.test/busca?q=x&ordem=preco'), false, 'consulta (?) entra na comparação');
    assert.equal(await allowed('https://wc.test/busca?q=x'), true);
  });
  await t('âncora $ no fim: só o caminho exato', async () => {
    robots('end.test', 'User-agent: *\nDisallow: /*.pdf$\nDisallow: /exato$\n');
    assert.equal(await allowed('https://end.test/docs/a.pdf'), false);
    assert.equal(await allowed('https://end.test/docs/a.pdf?v=1'), true);
    assert.equal(await allowed('https://end.test/exato'), false);
    assert.equal(await allowed('https://end.test/exato/mais'), true);
  });
  await t('caracteres especiais de regex na regra são literais (., ?, +, parênteses)', async () => {
    robots('lit.test', 'User-agent: *\nDisallow: /a.b\nDisallow: /p?x=1\nDisallow: /c+(d)\n');
    assert.equal(await allowed('https://lit.test/a.b'), false);
    assert.equal(await allowed('https://lit.test/aXb'), true, '. não é curinga');
    assert.equal(await allowed('https://lit.test/p?x=1'), false);
    assert.equal(await allowed('https://lit.test/px=1'), true, '? não é opcional');
    assert.equal(await allowed('https://lit.test/c+(d)'), false);
  });
  await t('caminho diferencia maiúsculas de minúsculas (diretiva não)', async () => {
    robots('case.test', 'User-agent: *\nDISALLOW: /Admin\n');
    assert.equal(await allowed('https://case.test/Admin'), false);
    assert.equal(await allowed('https://case.test/admin'), true);
  });
  await t('regra com acento bloqueia a URL percent-encoded equivalente (correção RFC 9309 §2.2.2)', async () => {
    robots('acento.test', 'User-agent: *\nDisallow: /coleção\nAllow: /coleção/pública\n');
    assert.equal(await allowed('https://acento.test/coleção/x'), false);
    assert.equal(await allowed('https://acento.test/cole%C3%A7%C3%A3o/x'), false);
    assert.equal(await allowed('https://acento.test/coleção/pública/y'), true, 'precedência continua pela regra mais longa');
    assert.equal(await allowed('https://acento.test/colecao'), true);
  });
  await t('robots.txt ausente (404/410) → liberado', async () => {
    robots('r404.test', 'Not found', 404); robots('r410.test', '', 410);
    assert.deepEqual(await check('https://r404.test/qualquer'), { ok: true });
    assert.deepEqual(await check('https://r410.test/qualquer'), { ok: true });
  });
  await t('robots.txt indisponível (5xx) → não rastreia (unreachable)', async () => {
    for (const [h, s] of [['r500.test', 500], ['r503.test', 503]]) { robots(h, 'erro', s); assert.deepEqual(await check(`https://${h}/x`), { ok: false, why: 'unreachable' }); }
  });
  await t('timeout e erro de rede ao ler robots.txt → não rastreia (unreachable)', async () => {
    sites['tmo.test'] = () => { const e = new Error('abort'); e.name = 'AbortError'; throw e; };
    sites['net.test'] = () => { throw new TypeError('fetch failed'); };
    assert.deepEqual(await check('https://tmo.test/x'), { ok: false, why: 'unreachable' });
    assert.deepEqual(await check('https://net.test/x'), { ok: false, why: 'unreachable' });
  });
  await t('robots.txt barrado (401/403/429 ou desafio anti-robô) → não rastreia (blocked)', async () => {
    for (const [h, s] of [['r401.test', 401], ['r403.test', 403], ['r429.test', 429]]) { robots(h, '', s); assert.deepEqual(await check(`https://${h}/x`), { ok: false, why: 'blocked' }); }
    robots('chl.test', '<html><title>Just a moment...</title></html>');
    assert.deepEqual(await check('https://chl.test/x'), { ok: false, why: 'blocked' });
  });
  await t('corpo vazio ou malformado com 200 → liberado', async () => {
    robots('empty.test', ''); robots('junk.test', '<<<>>>\nsem regras válidas');
    assert.equal(await allowed('https://empty.test/x'), true);
    assert.equal(await allowed('https://junk.test/x'), true);
  });
  await t('cache por origem: um pedido por host, também para falhas; outra origem pede de novo', async () => {
    robots('cache.test', 'User-agent: *\nDisallow: /a\n'); robots('cache.test:8080', '');
    const before = hitsOf('cache.test');
    await allowed('https://cache.test/a'); await allowed('https://cache.test/b'); await allowed('https://cache.test/c?x=1');
    assert.equal(hitsOf('cache.test') - before, 1, 'um robots.txt para a origem');
    robots('cache.test', 'User-agent: *\nDisallow: /\n');   // mudou no servidor, mas vale o cache
    assert.equal(await allowed('https://cache.test/b'), true);
    assert.equal(await allowed('https://cache.test:8080/a'), true, 'porta diferente = outra origem');
    assert.equal(hitsOf('cache.test:8080'), 1);
    const r500 = hitsOf('r500.test'); await check('https://r500.test/y');
    assert.equal(hitsOf('r500.test'), r500, 'falha também fica em cache (continua conservador)');
  });
  await t('cache de pedidos simultâneos: uma busca só', async () => {
    robots('par.test', 'User-agent: *\nDisallow: /x\n');
    const rs = await Promise.all(['/x', '/y', '/x/1', '/z'].map((p) => allowed('https://par.test' + p)));
    assert.deepEqual(rs, [false, true, false, true]); assert.equal(hitsOf('par.test'), 1);
  });
  await t('_resetRobots limpa o cache', async () => {
    _resetRobots(); await allowed('https://cache.test/b');
    assert.equal(await allowed('https://cache.test/b'), false, 'releu o robots.txt novo');
  });

  // ---------- distrust.js ----------
  const meta = () => JSON.parse(fs.readFileSync(path.join(tmpData, 'meta.json'), 'utf8'));
  const sources = { a: { platform: 'jsonld' }, b: { platform: 'shopify' }, c: { platform: 'vtex' } };
  const prev = {
    o1: { storeId: 'ld', sourceType: 'json_ld' }, o2: { storeId: 'og', sourceType: 'open_graph' }, o3: { storeId: 'md', sourceType: 'microdata' },
    o4: { storeId: 'sp', sourceType: 'store_page' }, o5: { storeId: 'mkt', sourceType: 'store_api', sellerKind: 'marketplace', seller: 'X', storeName: 'X' },
    o6: { storeId: 'sel', sourceType: 'store_api', sellerKind: 'store', seller: 'Outro', storeName: 'Loja' },
    o7: { storeId: 'ok', sourceType: 'store_api', sellerKind: 'store', seller: 'Loja', storeName: 'Loja' },
    o8: { storeId: 'ok2', sourceType: 'store_api', sellerKind: 'store' }, o9: { storeId: 'ok3', sourceType: 'official_api' },
    o10: { storeId: 'nokind', sourceType: 'store_api' },
  };
  await t('distrust: sem meta.json calcula lojas suspeitas, ordena, grava e marca fresh', () => {
    fs.writeFileSync(path.join(tmpData, 'meta.json'), JSON.stringify({ outro: 1, ops: { x: 1 } }));
    const d = loadDistrust({ sources, prev, T: '2026-10-08T12:34:56.000Z' });
    assert.deepEqual(d, { stores: ['a', 'ld', 'md', 'mkt', 'nokind', 'og', 'sel', 'sp'], until: '2026-10-08', fresh: true });
    assert.deepEqual(meta(), { outro: 1, ops: { x: 1 }, dataVersion: DATA_VERSION, distrust: { stores: d.stores, until: '2026-10-08' } }, 'preserva outras chaves');
  });
  await t('distrust: com meta atual reaproveita a janela gravada (não recalcula) e fresh=false', () => {
    const d = loadDistrust({ sources: { z: { platform: 'jsonld' } }, prev: {}, T: '2027-01-01T00:00:00Z' });
    assert.deepEqual(d, { stores: ['a', 'ld', 'md', 'mkt', 'nokind', 'og', 'sel', 'sp'], until: '2026-10-08', fresh: false });
  });
  await t('distrust: entradas vazias e meta.json ausente → janela vazia até o dia de T', () => {
    fs.rmSync(path.join(tmpData, 'meta.json'));
    assert.deepEqual(loadDistrust({ sources: {}, prev: {}, T: '2026-10-09T00:00:00Z' }), { stores: [], until: '2026-10-09', fresh: true });
    assert.deepEqual(meta().distrust, { stores: [], until: '2026-10-09' });
  });
  await t('distrust: meta de versão antiga ou sem distrust → recalcula; meta corrompido também', () => {
    fs.writeFileSync(path.join(tmpData, 'meta.json'), JSON.stringify({ dataVersion: DATA_VERSION - 1, distrust: { stores: ['velha'], until: '2020-01-01' } }));
    assert.deepEqual(loadDistrust({ sources: { a: { platform: 'jsonld' } }, prev: {}, T: '2026-10-10T00:00:00Z' }), { stores: ['a'], until: '2026-10-10', fresh: true });
    fs.writeFileSync(path.join(tmpData, 'meta.json'), JSON.stringify({ dataVersion: DATA_VERSION }));
    assert.equal(loadDistrust({ sources: {}, prev: {}, T: '2026-10-10T00:00:00Z' }).fresh, true);
    fs.writeFileSync(path.join(tmpData, 'meta.json'), '{ lixo');
    assert.deepEqual(loadDistrust({ sources: {}, prev: { o: { storeId: 's', sourceType: 'json_ld' } }, T: '2026-10-11T00:00:00Z' }), { stores: ['s'], until: '2026-10-11', fresh: true });
    assert.equal(meta().dataVersion, DATA_VERSION);
  });
  await t('distrust: loja repetida aparece uma vez', () => {
    fs.rmSync(path.join(tmpData, 'meta.json'));
    const d = loadDistrust({ sources: { s: { platform: 'jsonld' } }, prev: { a: { storeId: 's', sourceType: 'json_ld' }, b: { storeId: 's', sourceType: 'open_graph' } }, T: '2026-10-08T00:00:00Z' });
    assert.deepEqual(d.stores, ['s']);
  });

  const dist = { stores: ['velha'], until: '2026-10-07' };
  await t('trustedPoint: sem janela (null/undefined) tudo vale', () => {
    assert.equal(trustedPoint(null, 'velha', '2020-01-01'), true); assert.equal(trustedPoint(undefined, 'velha', '2020-01-01'), true);
  });
  await t('trustedPoint: loja fora da lista (ou desconhecida) sempre vale', () => {
    assert.equal(trustedPoint(dist, 'nova', '2026-10-01'), true); assert.equal(trustedPoint(dist, undefined, '2026-10-01'), true);
    assert.equal(trustedPoint({ stores: [], until: '2026-10-07' }, 'velha', '2026-10-01'), true);
  });
  await t('trustedPoint: limites da janela — até o dia da correção (inclusive) não vale; dia seguinte vale', () => {
    assert.equal(trustedPoint(dist, 'velha', '2026-10-06'), false);
    assert.equal(trustedPoint(dist, 'velha', '2026-10-07'), false, 'dia da correção ainda desconfiado');
    assert.equal(trustedPoint(dist, 'velha', '2026-10-07T23:59:59Z'), false, 'só o dia conta, não a hora');
    assert.equal(trustedPoint(dist, 'velha', '2026-10-08'), true);
    assert.equal(trustedPoint(dist, 'velha', '2026-10-08T00:00:00Z'), true);
  });
  await t('trustedPoint: comparação é textual (AAAA-MM-DD) — formato inválido segue a ordem das strings', () => {
    // Comportamento atual documentado: não há validação de formato.
    assert.equal(trustedPoint(dist, 'velha', ''), false);
    assert.equal(trustedPoint(dist, 'velha', null), true, '"null" > "2026-..." textualmente');
    assert.equal(trustedPoint(dist, 'velha', 'lixo'), true);
    assert.equal(trustedPoint(dist, 'velha', 1760000000000), false, 'timestamp numérico vira "1760000000" < "2026-..."');
  });
  await t('trustedPoint: integra com loadDistrust (janela real)', () => {
    fs.rmSync(path.join(tmpData, 'meta.json'));
    const d = loadDistrust({ sources: {}, prev: { o: { storeId: 'ld', sourceType: 'json_ld' } }, T: '2026-10-08T15:00:00Z' });
    assert.equal(trustedPoint(d, 'ld', '2026-10-08'), false); assert.equal(trustedPoint(d, 'ld', '2026-10-09'), true); assert.equal(trustedPoint(d, 'x', '2026-10-01'), true);
  });
} finally {
  if (prevDataDir === undefined) delete process.env.HUNTER_DATA_DIR; else process.env.HUNTER_DATA_DIR = prevDataDir;
  fs.rmSync(tmpData, { recursive: true, force: true });
}

console.log(`✓ robots.txt e janela de desconfiança: ${n} grupos de testes passaram`);
