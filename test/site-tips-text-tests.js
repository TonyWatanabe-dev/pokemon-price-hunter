// Busca do site (issue #563): /api/v1/site/ofertas?busca=... devolve as pistas sem o texto bruto do canal
// (TIP_DROP), mas o filtro por palavra que só aparece no texto continua funcionando. Sem rede e sem banco.
import assert from 'node:assert/strict';
import { tipHits } from '../api/_lib/site.mjs';
import { setLegacyLoader } from '../api/_lib/legacy.mjs';

const now = Date.now(); const T = (h) => new Date(now - h * 3600e3).toISOString();
const tip = { key: 'tg:1', id: 't1', source: 'Telegram x', title: 'ETB barata', text: 'corre que acabou de baixar o zygarde', raw: '<b>bruto</b>', html: '<p>x</p>', media: ['m'], entities: [{ k: 1 }],
  collectionName: 'Escuridão Absoluta', productId: 'me05-etb', price: 330, discount: 0.17, postedAt: T(3), url: 'https://t.me/x/1' };
const st = () => ({
  generatedAt: T(0), coverage: { stores: 1 }, totals: { offers: 0 },
  collections: [{ id: 'me05', name: 'Escuridão Absoluta', series: 'Megaevolução', aliases: [] }],
  types: [{ id: 'etb', label: 'Treinador Avançado (ETB)', group: 'ETB' }],
  products: [{ id: 'me05-etb', collection: 'me05', collectionName: 'Escuridão Absoluta', type: 'etb', typeLabel: 'Treinador Avançado (ETB)', group: 'ETB', boosters: 9, firstSeen: T(48), copagConfirmed: false, msrp: null, offerCount: 0 }],
  offers: [], activity: [], sources: [],
  tips: [tip, { ...tip, key: 'tg:2', id: 't2', title: 'Outra', text: 'nada a ver', postedAt: T(4) }, { ...tip, key: 'tg:3', id: 't3', expired: true }],
});

const t = async (name, fn) => { try { await fn(); } catch (e) { e.message = `${name}: ${e.message}`; throw e; } };

await t('tipHits: palavra só do texto acha a pista, mas a resposta não leva o texto', () => {
  const r = tipHits(st(), 'Zygarde');
  assert.deepEqual(r.map((x) => x.id), ['t1']);
  for (const k of ['text', 'raw', 'html', 'media', 'entities']) assert.equal(k in r[0], false, `campo ${k} vazou`);
  assert.equal(r[0].title, 'ETB barata'); assert.equal(r[0].price, 330); assert.equal(r[0].url, 'https://t.me/x/1');
});

await t('tipHits: comportamento normal inalterado (título, várias palavras, expiradas fora, sem termo)', () => {
  assert.deepEqual(tipHits(st(), 'etb barata').map((x) => x.id), ['t1']);
  assert.deepEqual(tipHits(st(), 'ESCURIDAO absoluta').map((x) => x.id), ['t1', 't2']);
  assert.deepEqual(tipHits(st(), 'zygarde inexistente'), []);
  assert.deepEqual(tipHits(st(), '   '), []);
  assert.equal(st().tips[0].text, 'corre que acabou de baixar o zygarde', 'estado de origem não é alterado');
});

await t('endpoint: /api/v1/site/ofertas?busca= devolve a pista sem text', async () => {
  setLegacyLoader(async () => st());
  delete process.env.API_DATABASE_URL;
  const { default: api } = await import('../api/v1.mjs');
  const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } };
  await api({ url: '/api/v1/site/ofertas?busca=zygarde', method: 'GET' }, res);
  assert.equal(res.statusCode, 200);
  const j = JSON.parse(res.body);
  assert.deepEqual(j.tips.map((x) => x.id), ['t1']);
  assert.equal(j.tips[0].text, undefined, 'pista sem texto bruto');
  assert.ok(!res.body.includes('acabou de baixar'), 'texto bruto não aparece em nenhum lugar da resposta');
});

console.log('site-tips-text-tests: ok');
