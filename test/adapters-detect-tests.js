// detect() dos três adaptadores (Shopify, VTEX e JSON-LD) com fetch simulado (nenhuma requisição real às lojas).
// 429 relança (bloqueio real); 401/403 na rota de teste = não é essa plataforma (false); HTML onde se esperava JSON = false;
// JSON válido = true.
import assert from 'node:assert/strict';
process.env.HUNTER_DOMAIN_DELAY_MS = '0';
const http = await import('../src/http.js');
const shopify = await import('../src/adapters/shopify.js');
const vtex = await import('../src/adapters/vtex.js');
const jsonld = await import('../src/adapters/jsonld.js');

let n = 0; const t = async (name, fn) => { try { await fn(); n++; } catch (e) { e.message = `[${name}] ${e.message}`; throw e; } };
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const html = (s, status = 200) => new Response(s, { status, headers: { 'content-type': 'text/html' } });

let respond = () => html('', 404);
http.setFetch(async (url) => {
  const u = new URL(url);
  if (u.pathname === '/robots.txt') return html('', 404);
  return respond(u);
});
let k = 0; const host = () => `https://detect-${++k}.test`;
const failure = async (p) => { try { await p; } catch (e) { return e; } return assert.fail('devia falhar'); };

const cases = [
  ['Shopify', shopify, { products: [] }],
  ['VTEX', vtex, []],
];
for (const [nome, ad, ok] of cases) {
  await t(`${nome}: JSON válido retorna true`, async () => {
    respond = () => json(ok);
    assert.equal(await ad.detect(host()), true);
  });
  await t(`${nome}: 429 relança`, async () => {
    respond = () => html('', 429);
    const e = await failure(ad.detect(host()));
    assert.equal(e.blocked, true); assert.equal(e.status, 429);
  });
  for (const status of [401, 403]) {
    await t(`${nome}: ${status} retorna false`, async () => {
      respond = () => html('', status);
      assert.equal(await ad.detect(host()), false);
    });
  }
  await t(`${nome}: HTML retorna false`, async () => {
    respond = () => html('<html><body>Página inicial</body></html>');
    assert.equal(await ad.detect(host()), false);
  });
}

await t('JSON-LD: página que cita Pokémon retorna true', async () => {
  respond = () => html('<html><body>Cartas Pokémon</body></html>');
  assert.equal(await jsonld.detect(host()), true);
});
await t('JSON-LD: HTML sem Pokémon retorna false', async () => {
  respond = () => html('<html><body>Loja de roupas</body></html>');
  assert.equal(await jsonld.detect(host()), false);
});
await t('JSON-LD: 429 relança', async () => {
  respond = () => html('', 429);
  const e = await failure(jsonld.detect(host()));
  assert.equal(e.blocked, true); assert.equal(e.status, 429);
});
await t('JSON-LD: 404 retorna false', async () => {
  respond = () => html('', 404);
  assert.equal(await jsonld.detect(host()), false);
});

console.log(`adapters-detect: ${n} ok`);
