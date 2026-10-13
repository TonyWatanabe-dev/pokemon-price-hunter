// discover.js legado (HUNTER_DISCOVERY=0): sem chave não grava; host já em stores.json e host da IGNORE não entram.
// Tudo offline: fetch simulado via http.setFetch; config/ temporário; BRAVE_API_KEY falsa.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
process.env.HUNTER_DOMAIN_DELAY_MS = '0';
delete process.env.BRAVE_API_KEY;
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'disc-legacy-'));
process.env.HUNTER_CONFIG_DIR = path.join(tmp, 'config'); process.env.HUNTER_DATA_DIR = path.join(tmp, 'data');
fs.mkdirSync(process.env.HUNTER_CONFIG_DIR, { recursive: true }); fs.mkdirSync(process.env.HUNTER_DATA_DIR, { recursive: true });
const storesFile = path.join(process.env.HUNTER_CONFIG_DIR, 'stores.json');
const stores = JSON.stringify({ stores: [{ id: 'conhecida', name: 'Conhecida', url: 'https://www.conhecida.test', platform: 'shopify', kind: 'specialist', evidence: {} }] });
fs.writeFileSync(storesFile, stores);
fs.writeFileSync(path.join(process.env.HUNTER_CONFIG_DIR, 'catalog.json'), JSON.stringify({ collections: [{ id: 'c1', name: 'Caos Ascendente' }], products: [] }));

const http = await import('../src/http.js');
const { discover } = await import('../src/discover.js');
const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { 'content-type': 'application/json' } });
const html = (s, status = 200) => new Response(s, { status, headers: { 'content-type': 'text/html' } });
const requested = [];
http.setFetch(async (url) => {
  const u = new URL(url); requested.push(url);
  if (u.host === 'api.search.brave.com') {
    return json({ web: { results: [
      { url: 'https://www.conhecida.test/produtos/pokemon' },
      { url: 'https://www.mercadolivre.com.br/box' },
      { url: 'https://www.youtube.com/watch?v=1' },
      { url: 'https://nova.test/produtos/pokemon-box' },
    ] } });
  }
  if (u.pathname === '/robots.txt') return html('', 404);
  if (u.host === 'nova.test') {
    if (u.pathname === '/products.json') return json({ products: [] });
    if (u.pathname === '/') return html('<html lang="pt-BR"><body>Pokémon TCG Booster Box R$ 399,90</body></html>');
  }
  return html('', 404);
});
const logs = []; const log = (m) => logs.push(m);

// 1. Sem chave: nada é gravado nem consultado.
{
  const r = await discover({ log });
  assert.deepEqual(r, []);
  assert.equal(requested.length, 0, 'sem chave não faz rede');
  assert.equal(fs.readFileSync(storesFile, 'utf8'), stores, 'stores.json intacto');
  assert.ok(logs.some((l) => /BRAVE_API_KEY/.test(l)));
}

// 2. Com chave falsa: só o host novo entra; conhecido (com www) e IGNORE ficam fora.
{
  process.env.BRAVE_API_KEY = 'chave-falsa';
  const r = await discover({ log });
  delete process.env.BRAVE_API_KEY;
  assert.deepEqual(r.map((s) => s.url), ['https://nova.test']);
  const saved = JSON.parse(fs.readFileSync(storesFile, 'utf8')).stores;
  assert.deepEqual(saved.map((s) => s.id), ['conhecida', 'novatest']);
  assert.equal(saved[1].platform, 'shopify');
  const hosts = new Set(requested.map((u) => new URL(u).host));
  assert.ok(!hosts.has('www.mercadolivre.com.br') && !hosts.has('www.youtube.com') && !hosts.has('www.conhecida.test') && !hosts.has('conhecida.test'), 'hosts conhecido/IGNORE nunca são visitados');
}
console.log('discover-legacy-tests ok');
