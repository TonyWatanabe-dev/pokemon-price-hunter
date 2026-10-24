// Descoberta de lojas, Fase 0 (24/10/2026): validador v2 (busca da loja e sitemap quando a home não basta),
// reconferência dos recusados na v1 e fonte grátis OpenStreetMap com cidade/UF. Tudo offline.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'die0-'));
process.env.HUNTER_CONFIG_DIR = path.join(tmp, 'config'); process.env.HUNTER_DATA_DIR = path.join(tmp, 'data');
fs.mkdirSync(path.join(tmp, 'config/lojas'), { recursive: true }); fs.mkdirSync(path.join(tmp, 'data'), { recursive: true });
fs.writeFileSync(path.join(tmp, 'config/stores.json'), JSON.stringify({ stores: [] }));
const http = await import('../src/http.js');
const { validateHost, buscaDaLoja, VALIDATOR_VERSION, RECONFERIR } = await import('../src/discovery/pipeline.js');
const { parseOsm, ufDe, OSM_QUERY } = await import('../src/discovery/osm.js');
const { runExtras } = await import('../src/discovery/index.js');
const { loadLedger } = await import('../src/discovery/ledger.js');
http.setSleep(async () => {});

// 1. UF e OpenStreetMap
assert.equal(ufDe('SP'), 'SP'); assert.equal(ufDe('São Paulo'), 'SP'); assert.equal(ufDe('Estado do Rio de Janeiro'), 'RJ'); assert.equal(ufDe('Distrito Federal'), 'DF'); assert.equal(ufDe('Narnia'), null);
const osm = parseOsm({ elements: [
  { tags: { name: 'Loja A', shop: 'games', website: 'https://www.lojaa.com.br/', 'addr:city': 'Curitiba', 'addr:state': 'PR' } },
  { tags: { name: 'Loja A filial', shop: 'games', website: 'lojaa.com.br/contato', 'addr:state': 'Paraná' } },
  { tags: { name: 'Insta', shop: 'toys', website: 'https://instagram.com/loja' } },
  { tags: { name: 'Sem site', shop: 'toys', 'addr:state': 'Bahia' } },
] });
assert.equal(osm.comSite.length, 1, 'mesmo site uma vez só'); assert.deepEqual([osm.comSite[0].cidade, osm.comSite[0].uf], ['Curitiba', 'PR']);
assert.equal(osm.semSite, 2, 'Instagram não é loja virtual'); assert.deepEqual(osm.porUf, { PR: 2, BA: 1 });
assert.match(OSM_QUERY, /ISO3166-1"="BR"/); assert.match(OSM_QUERY, /games\|toys/);

// 2. busca da loja pela plataforma
assert.equal(buscaDaLoja('<script src="https://d26lpennugtm8s.cloudfront.net/stores/x/mitiendanube.js">'), '/search/?q=pokemon');
assert.equal(buscaDaLoja('<link href="//cdn.shopify.com/s/x.css">'), '/search?q=pokemon');
assert.equal(buscaDaLoja('<img src="https://cdn.awsli.com.br/x.png">'), '/buscar?q=pokemon');
assert.equal(buscaDaLoja('<html>nada</html>'), null);

// 3. validador v2: home sem Pokémon, busca da loja com booster e preço → aceita
const pages = {
  'https://brinq.test/robots.txt': 'User-agent: *\nAllow: /',
  'https://brinq.test/': '<html lang="pt-BR"><script src="https://cdn.mitiendanube.com/x.js"></script>Bonecas e carrinhos R$ 49,90</html>',
  'https://brinq.test/search/?q=pokemon': '<html>Booster Pokémon TCG Caos Ascendente R$ 29,90</html>',
  'https://semnada.test/robots.txt': 'User-agent: *\nAllow: /',
  'https://semnada.test/': '<html lang="pt-BR">Panelas R$ 10,00</html>',
};
http.setFetch(async (url) => { const body = pages[url]; return { status: body == null ? 404 : 200, ok: body != null, headers: new Map([['content-type', 'text/html']]), url, text: async () => body ?? '', json: async () => ({}) }; });
const v = await validateHost('brinq.test', { platformOf: async () => 'jsonld', productUrls: async () => [] });
assert.equal(v.verdict, 'accepted', JSON.stringify(v)); assert.ok(v.signals.includes('busca da loja'));
const n = await validateHost('semnada.test', { platformOf: async () => 'jsonld', productUrls: async () => [] });
assert.equal(n.reason, 'página inicial não menciona Pokémon');
const sm = await validateHost('semnada.test', { platformOf: async () => 'jsonld', productUrls: async () => ['https://semnada.test/produtos/booster-box-pokemon-36', 'https://semnada.test/produtos/deck-box-magic'] });
assert.ok(sm.signals.includes('sitemap com produto Pokémon'), 'sitemap com produto Pokémon prova');
const so = await validateHost('semnada.test', { platformOf: async () => 'jsonld', productUrls: async () => ['https://semnada.test/produtos/deck-box-magic'] });
assert.equal(so.reason, 'página inicial não menciona Pokémon', 'produto sem "pokemon" no endereço não prova');

// 4. runExtras: reconfere recusados da v1 e valida sites do OSM, gravando cidade/UF
const ledger = loadLedger();
ledger.hosts['velha.test'] = { verdict: 'rejected', reason: 'página inicial não menciona Pokémon', verdictAt: new Date().toISOString(), seenIn: [] };
ledger.hosts['bloq.test'] = { verdict: 'rejected', reason: 'bloqueia robôs', verdictAt: new Date().toISOString(), seenIn: [] };
assert.ok(RECONFERIR.test('página inicial não menciona Pokémon') && !RECONFERIR.test('bloqueia robôs'));
const visto = [];
const validate = async (h) => { visto.push(h); return h === 'velha.test' || h === 'lojaa.com.br' ? { verdict: 'accepted', reason: 'ok', signals: [], platform: 'jsonld' } : { verdict: 'rejected', reason: 'x', signals: [] }; };
const out = await runExtras({ ledger, log: () => {}, now: new Date(), env: {}, validate, osmLoader: async () => ({ fetchedAt: 'x', comSite: osm.comSite, semSite: 2 }) });
assert.deepEqual(visto.sort(), ['lojaa.com.br', 'velha.test'], 'bloqueio não é reconferido');
assert.equal(out.reconferir.aceitas, 1); assert.equal(out.osm.aceitas, 1);
assert.equal(ledger.hosts['velha.test'].validator, VALIDATOR_VERSION);
assert.deepEqual([ledger.hosts['lojaa.com.br'].loc.uf, ledger.hosts['lojaa.com.br'].loc.cidade, ledger.hosts['lojaa.com.br'].loc.fonte], ['PR', 'Curitiba', 'osm']);
const txt = fs.readFileSync(path.join(tmp, 'data/discovery-stores.txt'), 'utf8');
assert.match(txt, /^https:\/\/velha\.test {2}# DIE reconferir/m); assert.match(txt, /^https:\/\/lojaa\.com\.br {2}# DIE osm/m);
// segunda rodada: nada a reconferir de novo (versão gravada) e OSM já validado é respeitado
visto.length = 0;
await runExtras({ ledger, log: () => {}, now: new Date(), env: {}, validate, osmLoader: async () => ({ comSite: osm.comSite }) });
assert.deepEqual(visto, [], 'não repete validação');
// desligado
const off = await runExtras({ ledger, log: () => {}, now: new Date(), env: { HUNTER_DISCOVERY_OSM: '0' }, validate, osmLoader: async () => { throw new Error('não deveria chamar'); } });
assert.equal(off.osm, undefined);
console.log('✓ discovery-fase0: busca da loja, sitemap, reconferência e OpenStreetMap com cidade/UF');
// 5. prazo: sem tempo, nada é conferido (a rodada diária não pode passar do teto do Actions)
{
  const led = loadLedger(); led.hosts['outra.test'] = { verdict: 'rejected', reason: 'sem preço em R$ na página inicial', seenIn: [] };
  let t = 0; const chamado = [];
  const r = await runExtras({ ledger: led, log: () => {}, now: new Date(), env: { DISCOVERY_EXTRAS_SEG: '0' }, validate: async (h) => { chamado.push(h); return { verdict: 'rejected', reason: 'x', signals: [] }; }, osmLoader: async () => { chamado.push('osm'); return null; }, clock: () => t++ });
  assert.deepEqual(chamado, [], 'prazo zero: nenhuma validação nem busca no OSM'); assert.equal(r.reconferir.hosts, 1);
}
console.log('✓ discovery-fase0: prazo das fontes grátis respeitado');
