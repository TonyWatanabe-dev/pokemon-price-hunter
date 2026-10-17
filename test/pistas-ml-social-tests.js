// meli.la de divulgador cai na página /social/<perfil>; o produto divulgado é o 1º link de produto do HTML.
import assert from 'node:assert/strict';
import { resolverLink, destaqueSocial, ehPaginaSocial } from '../src/pistas-ofertas.js';

const SOC = 'https://www.mercadolivre.com.br/social/fulano?matt_word=fulano&ref=XYZ';
const html = (first) => `<html><a href="https://www.mercadolivre.com.br/assinaturas/melimais#x">x</a><a href="${first}">destaque</a><a href="${first}">.</a>
<a href="https://www.mercadolivre.com.br/outro-produto/p/MLB69118860?matt_event_ts=1">outro</a></html>`;
assert.equal(ehPaginaSocial(SOC), true); assert.equal(ehPaginaSocial('https://www.mercadolivre.com.br/p/MLB1234567'), false);
assert.deepEqual(destaqueSocial(html('https://www.mercadolivre.com.br/etb-caos/p/MLB79396525?pdp_filters=item_id%3AMLB5244238225&amp;matt=1')), { mlb: 'MLB5244238225', catalogo: 'MLB79396525' });
assert.deepEqual(destaqueSocial(html('https://www.mercadolivre.com.br/blister/p/MLB69735015?matt_event_ts=1&amp;x')), { mlb: null, catalogo: 'MLB69735015' });
assert.deepEqual(destaqueSocial('<html>nada</html>'), { mlb: null, catalogo: null });

const resp = (status, { loc, body, url } = {}) => ({ status, ok: status >= 200 && status < 300, url: url || '', headers: { get: (k) => (k === 'location' ? loc : null) }, text: async () => body, body: { cancel() {} } });
const fetch = async (u) => (u.startsWith('https://meli.la/') ? resp(301, { loc: SOC }) : resp(200, { body: html('https://www.mercadolivre.com.br/etb/p/MLB74743849?matt=1'), url: u }));
const r = await resolverLink('https://meli.la/2NLw6r6', { fetch });
assert.equal(r.erro, null); assert.equal(r.mlb, null); assert.equal(r.catalogo, 'MLB74743849');
console.log('pistas-ml-social-tests: ok');
