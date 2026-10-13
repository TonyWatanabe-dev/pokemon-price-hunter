// Sitemap usa o último state bom se o fetch falhar dentro do frescor. Sem cache (ou com cache velho), só a Home
// permanece indexável; as outras páginas fixas e dinâmicas recebem noindex e não devem aparecer no sitemap.
// Sem rede: fetch simulado, cada cenário num processo separado (o cache de state() é do módulo).
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const NOW = Date.parse('2026-10-12T18:00:00.000Z');
const T = new Date(NOW - 5 * 6e4).toISOString();
const prod = (id, col, colName, type, typeLabel) => ({ id, collection: col, collectionName: colName, type, typeLabel, boosters: 0, variant: '', offerCount: 1 });
const off = (id, productId, total) => ({ id, productId, storeId: 's', storeName: 'Loja', total, price: total, shipping: 0, stock: 'IN_STOCK', url: 'https://x/' + id, firstSeen: T, source_timestamp: T });
const mk = (generatedAt, extra = []) => ({
  generatedAt, products: [prod('e1', 'c1', 'Alfa', 'etb', 'Treinador Avançado (ETB)'), ...extra.map(([id]) => prod(id, 'c1', 'Alfa', 'etb', 'Treinador Avançado (ETB)'))],
  offers: [off('a', 'e1', 350), ...extra.map(([id, total]) => off('o' + id, id, total))],
  collections: [{ id: 'c1', name: 'Alfa', series: 'S', aliases: [], products: 1 }],
  types: [{ id: 'etb', label: 'Treinador Avançado (ETB)', group: 'ETB', products: 1 }],
});

// steps: [{ at: minutos depois de NOW, resp: { status, state } | 'rede' }]. Cada passo avança o relógio e gera o sitemap.
function run(steps) {
  const script = `let now = ${NOW}; const realNow = Date.now; Date.now = () => now;
    const steps = JSON.parse(process.argv[1]); let calls = 0, step = null;
    globalThis.fetch = async () => { calls++;
      if (step.resp === 'rede') throw new TypeError('fetch failed');
      return new Response(JSON.stringify(step.resp.state ?? {}), { status: step.resp.status }); };
    const { default: sm } = await import(${JSON.stringify(pathToFileURL(path.join(root, 'api/sitemap.mjs')).href)});
    const out = [];
    for (step of steps) {
      now = ${NOW} + step.at * 6e4; const before = calls;
      const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } };
      await sm({}, res); out.push({ body: res.body, headers: res.headers, fetched: calls - before });
    }
    Date.now = realNow; console.log(JSON.stringify(out));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script, JSON.stringify(steps)],
    { cwd: root, encoding: 'utf8', maxBuffer: 16 * 1024 * 1024, env: { ...process.env, API_DATABASE_URL: '' } });
  if (r.status !== 0) throw new Error(`falha ao gerar o sitemap (status ${r.status}): ${r.stderr}`);
  return JSON.parse(r.stdout.trim().split('\n').pop());
}
const locs = (xml) => [...xml.matchAll(/<loc>([^<]*)<\/loc>/g)].map((m) => m[1]);
const FIXAS = 1; // apenas a Home permanece indexável quando não há dados utilizáveis
const dinamicas = (xml) => locs(xml).filter((u) => /\/(colecao|tipo|produto)\//.test(u));

let n = 0;
const t = (name, fn) => { fn(); n++; console.log('  ok', name); };
console.log('sitemap-falha-tests');

const ok = { status: 200, state: mk(T) };
t('1. primeiro fetch ok e segundo 503: sitemap segue com coleções, formatos e produtos', () => {
  const [a, b] = run([{ at: 0, resp: ok }, { at: 11, resp: { status: 503 } }]);
  assert.equal(a.fetched, 1); assert.equal(b.fetched, 1, 'passado o cache de 10 min, tenta buscar de novo');
  assert.ok(dinamicas(a.body).some((u) => u.includes('/colecao/alfa')) && dinamicas(a.body).some((u) => u.includes('/produto/')));
  assert.equal(b.body, a.body, 'mesmo sitemap do último state bom');
  assert.deepEqual(b.headers, a.headers);
});

t('2. erro de rede depois de um fetch ok: também usa o último state bom', () => {
  const [a, b] = run([{ at: 0, resp: ok }, { at: 11, resp: 'rede' }]);
  assert.equal(b.fetched, 1); assert.equal(b.body, a.body);
});

t('3. sem cache: 503 e erro de rede mantêm somente a Home indexável', () => {
  for (const resp of [{ status: 503 }, 'rede']) {
    const [a] = run([{ at: 0, resp }]);
    assert.equal(locs(a.body).length, FIXAS); assert.deepEqual(dinamicas(a.body), []);
    assert.equal(a.headers['cache-control'], 'public, max-age=0, s-maxage=3600');
  }
});

t('4. cache fora do frescor (dados velhos) não é servido: somente a Home permanece no sitemap', () => {
  const [a, b] = run([{ at: 0, resp: ok }, { at: 120, resp: { status: 503 } }]);
  assert.ok(dinamicas(a.body).length > 0);
  assert.equal(locs(b.body).length, FIXAS); assert.deepEqual(dinamicas(b.body), []);
});

t('5. depois da falha, o próximo fetch ok volta a valer (e a falha não renova o cache)', () => {
  const novo = { status: 200, state: mk(new Date(NOW + 10 * 6e4).toISOString(), [['e2', 300]]) };
  const [a, b, c, d] = run([{ at: 0, resp: ok }, { at: 11, resp: { status: 503 } }, { at: 12, resp: novo }, { at: 13, resp: novo }]);
  assert.equal(b.body, a.body);
  assert.equal(c.fetched, 1, 'a falha não conta como fetch novo: tenta de novo na requisição seguinte');
  assert.ok(locs(c.body).length === locs(a.body).length + 1, 'produto novo do state novo');
  assert.equal(d.fetched, 0, 'state novo em cache por 10 min');
});

t('6. caminho feliz inalterado: cache de 10 min sem fetch novo', () => {
  const [a, b] = run([{ at: 0, resp: ok }, { at: 5, resp: { status: 503 } }]);
  assert.equal(b.fetched, 0); assert.equal(b.body, a.body);
});

console.log(`sitemap-falha-tests: ${n} ok`);
