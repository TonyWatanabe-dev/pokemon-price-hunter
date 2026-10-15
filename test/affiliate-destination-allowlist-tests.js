// Fase 6 — allowlist de domínios de destino dos links de afiliado. Todos os links configurados (site, rascunhos
// sociais, links curtos dos posts e "Também na Amazon") apontam só para domínios aprovados do programa, em https,
// sem credenciais nem porta; e o link curto (meli.la) só vira link do anúncio quando a página que informa o id é do
// Mercado Livre. Só lê os arquivos de config; não altera nenhum link. Offline: sem rede, banco ou secrets.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { validDestination, parseAffiliates } from '../api/_lib/affiliates.mjs';
import { validarLink, loadConfig } from '../src/agents/social/afiliados.js';
import { lerLinks, idDoLink, destinoPermitido } from '../src/agents/social/afiliados-links.js';

let n = 0;
const t = async (name, fn) => { try { await fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } };
const ler = (f) => JSON.parse(fs.readFileSync(new URL(`../config/${f}`, import.meta.url), 'utf8'));
const host = (u) => new URL(u).hostname.toLowerCase();
const seguro = (u) => { const x = new URL(u); return x.protocol === 'https:' && !x.username && !x.password && !x.port; };

await t('1. site (config/affiliates.json): anúncios e link geral só em domínio do Mercado Livre', () => {
  const raw = ler('affiliates.json'); const cfg = parseAffiliates(raw);
  assert.deepEqual(cfg.rejeitados, [], 'nenhuma entrada fora da allowlist');
  for (const u of [...Object.values(cfg.anuncios), raw.mercadolivre?.geral?.url].filter(Boolean)) assert.equal(validDestination(u), u, u);
});

await t('2. rascunhos sociais (config/social-afiliados.json): host exato por marketplace', () => {
  const cfg = loadConfig();
  for (const [mk, e] of Object.entries(cfg.links)) assert.equal(validarLink(e.url, mk), e.url, `${mk}: ${e.url}`);
});

await t('3. links curtos dos posts (config/social-afiliados-links.json): todos meli.la, https, nenhum descartado', () => {
  const raw = ler('social-afiliados-links.json').links; const ok = lerLinks();
  assert.equal(ok.length, new Set(raw).size, 'nenhum link do arquivo cai fora da allowlist');
  for (const u of ok) assert.ok(seguro(u) && host(u) === 'meli.la', u);
});

await t('4. "Também na Amazon" (config/afiliados/amazon.json): só www.amazon.com.br/dp/<ASIN> com a tag declarada', () => {
  const a = ler('afiliados/amazon.json'); const links = (a.links || []).map((l) => l.url);
  assert.ok(links.length > 0);
  for (const u of links) {
    const x = new URL(u);
    assert.ok(seguro(u) && x.hostname === 'www.amazon.com.br' && /^\/dp\/[A-Z0-9]{10}$/.test(x.pathname), u);
    assert.deepEqual([...x.searchParams.keys()], ['tag'], `só o parâmetro aprovado: ${u}`);
    assert.equal(x.searchParams.get('tag'), a.tag, u);
  }
});

await t('5. destinoPermitido: Mercado Livre em https; o resto não', () => {
  for (const u of ['https://meli.la/x', 'https://www.mercadolivre.com.br/p/MLB1', 'https://produto.mercadolivre.com.br/MLB-1-x',
    'https://mercadolivre.com/sec/abc', 'https://www.mercadolibre.com/x']) assert.equal(destinoPermitido(u), true, u);
  for (const u of ['http://meli.la/x', 'https://meli.la.evil.test/x', 'https://evil.test/mercadolivre.com.br', 'https://u:p@meli.la/x',
    'https://meli.la:8443/x', 'https://mercadolivre.com.br.evil.test/x', 'nada', null]) assert.equal(destinoPermitido(u), false, String(u));
});

const res = (status, { location, body = '' } = {}) => ({ status, ok: status >= 200 && status < 300, headers: { get: (h) => (h === 'location' ? location : null) }, text: async () => body });
const fake = (mapa) => async (url) => mapa[url] ?? res(404);

await t('6. link curto que termina fora do Mercado Livre não vira link do anúncio', async () => {
  const f = fake({
    'https://meli.la/fora': res(301, { location: 'https://evil.test/promo' }),
    'https://evil.test/promo': res(200, { body: '{"item_id":"MLB1234567890"}' }),
    'https://meli.la/http': res(301, { location: 'http://www.mercadolivre.com.br/social/x' }),
    'http://www.mercadolivre.com.br/social/x': res(200, { body: '{"item_id":"MLB1234567890"}' }),
    'https://meli.la/volta': res(301, { location: 'https://evil.test/r' }),
    'https://evil.test/r': res(301, { location: 'https://produto.mercadolivre.com.br/MLB-1234567890-box-_JM' }),
    'https://meli.la/ok': res(200, { body: '<script>{"item_id":"MLB5555555555"}</script>' }),
  });
  assert.equal(await idDoLink('https://meli.la/fora', f), null, 'id lido em página de outro site');
  assert.equal(await idDoLink('https://meli.la/http', f), null, 'página sem https');
  assert.equal(await idDoLink('https://meli.la/volta', f), 'MLB1234567890', 'destino final é o anúncio no ML');
  assert.equal(await idDoLink('https://meli.la/ok', f), 'MLB5555555555', 'página do próprio meli.la continua valendo');
});

console.log(`✓ Allowlist de destino dos links de afiliado (Fase 6): ${n} grupos passaram`);
