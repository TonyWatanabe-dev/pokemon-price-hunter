// #690 — links curtos de afiliado (meli.la) → id MLB do anúncio → prioridade e link no post. Offline (fetch falso).
import assert from 'node:assert/strict';
import { lerLinks, idDoLink, comLinksSociais } from '../src/agents/social/afiliados-links.js';
import { linkDe } from '../tools/social-telegram-piloto.mjs';

let n = 0;
const t = async (name, fn) => { try { await fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } };
const res = (status, { location, body = '' } = {}) => ({ status, ok: status >= 200 && status < 300, headers: { get: (h) => (h === 'location' ? location : null) }, text: async () => body });
const fake = (mapa) => { const calls = []; const f = async (url) => { calls.push(url); return mapa[url] ?? res(404); }; f.calls = calls; return f; };

await t('1. config: 44 links únicos (18 de 14/10 + 26 de 24/10), só meli.la', () => {
  const l = lerLinks(); assert.equal(l.length, 44); assert.equal(new Set(l).size, l.length, 'sem repetido'); assert.ok(l.every((x) => x.startsWith('https://meli.la/')));
});

await t('2. segue redirecionamentos até o anúncio (pdp_filters ou /MLB-), ou lê o id no HTML', async () => {
  const f = fake({
    'https://meli.la/a': res(301, { location: 'https://www.mercadolivre.com.br/social/x?ref=1' }),
    'https://www.mercadolivre.com.br/social/x?ref=1': res(302, { location: 'https://www.mercadolivre.com.br/p/MLB74773271?pdp_filters=item_id%3AMLB4937682001' }),
    'https://meli.la/b': res(301, { location: 'https://produto.mercadolivre.com.br/MLB-1234567890-box-_JM' }),
    'https://meli.la/c': res(200, { body: '<script>{"item_id":"MLB5555555555"}</script>' }),
  });
  assert.equal(await idDoLink('https://meli.la/a', f), 'MLB4937682001');
  assert.equal(await idDoLink('https://meli.la/b', f), 'MLB1234567890');
  assert.equal(await idDoLink('https://meli.la/c', f), 'MLB5555555555');
  assert.equal(await idDoLink('https://meli.la/zz', f), null, '404: sem id');
  assert.equal(await idDoLink('https://meli.la/a', async () => { throw new Error('rede'); }), null);
});

await t('3. mapa: link curto vira afiliado do anúncio; não sobrescreve configurado; oferta do anúncio usa o link', async () => {
  const f = fake({ 'https://meli.la/a': res(301, { location: 'https://produto.mercadolivre.com.br/MLB-1234567890-x' }), 'https://meli.la/b': res(301, { location: 'https://produto.mercadolivre.com.br/MLB-999999999-y' }) });
  const af = await comLinksSociais({ anuncios: { MLB999999999: 'https://meli.la/ja' } }, f, { links: ['https://meli.la/a', 'https://meli.la/b'] });
  assert.equal(af.anuncios.MLB1234567890, 'https://meli.la/a'); assert.equal(af.anuncios.MLB999999999, 'https://meli.la/ja');
  assert.deepEqual(linkDe({ url: 'https://www.mercadolivre.com.br/p/MLB1?pdp_filters=item_id%3AMLB1234567890' }, af), { link: 'https://meli.la/a', afiliado: true });
});

console.log(`✓ Links de afiliado sociais (#690): ${n} grupos passaram`);
