// Destino limpo das pistas (17/10/2026): o botão de uma pista nunca leva ao afiliado de quem postou no canal.
// Robô: segue só redirecionamentos até o anúncio e guarda { loja, id, url } sem parâmetro. Site: troca pelo link do
// dono quando existe (ML/Shopee/Amazon) e, senão, usa a URL limpa. Sem rede.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { destinoDeUrl, resolverDestino, destinosPistas, pistasSemDestino, VERSAO } from '../src/pistas-destino.js';
import { parseOutrasLojas, publicAffiliates, loadOutrasLojas } from '../api/_lib/affiliates.mjs';

let n = 0; const t = async (name, fn) => { try { await fn(); } catch (e) { e.message = `${name}: ${e.message}`; throw e; } n++; };
const resp = (status, loc) => ({ status, url: '', headers: { get: (k) => (k === 'location' ? loc : null) }, body: { cancel() {} } });

await t('URL de destino vira anúncio limpo, sem parâmetro de ninguém', () => {
  assert.deepEqual(destinoDeUrl('https://shopee.com.br/Blister-i.464326997.53666400287?sp_atk=1&utm_source=an_999&mmp_pid=x'), { loja: 'shopee', id: '464326997/53666400287', url: 'https://shopee.com.br/product/464326997/53666400287' });
  assert.deepEqual(destinoDeUrl('https://www.amazon.com.br/Pokemon/dp/b0hfnsm2t3/ref=x?tag=outro-20&linkCode=ll1'), { loja: 'amazon', id: 'B0HFNSM2T3', url: 'https://www.amazon.com.br/dp/B0HFNSM2T3' });
  assert.equal(destinoDeUrl('https://www.mercadolivre.com.br/p/MLB27711554?pdp_filters=item_id%3AMLB7513705746&matt_tool=123').url, 'https://produto.mercadolivre.com.br/MLB-7513705746-_JM');
  assert.equal(destinoDeUrl('https://loja.com.br/p/1'), null);
});

await t('link curto: segue só os redirecionamentos até o anúncio', async () => {
  const hops = { 'https://s.shopee.com.br/abc': 'https://shopee.com.br/universal-link/x', 'https://shopee.com.br/universal-link/x': 'https://shopee.com.br/Blister-i.1234.567890?utm_source=an_1' };
  const fetch = async (u, o) => { assert.equal(o.redirect, 'manual'); return resp(302, hops[u]); };
  assert.deepEqual(await resolverDestino('https://s.shopee.com.br/abc', { fetch }), { loja: 'shopee', id: '1234/567890', url: 'https://shopee.com.br/product/1234/567890' });
  assert.ok((await resolverDestino('https://link.amazon/xyz', { fetch: async () => resp(200, null) })).erro, 'sem redirecionamento: erro, nunca o link original');
  assert.ok((await resolverDestino('https://link.amazon/xyz', { fetch: async () => { throw new Error('rede'); } })).erro);
});

await t('rodada: grava destino, usa o id da API quando a pista do ML já foi conferida, respeita o máximo', async () => {
  let calls = 0; const fetch = async () => { calls++; return resp(302, 'https://www.amazon.com.br/dp/B0HFNSM2T3?tag=outro-20'); };
  const store = { a: { url: 'https://link.amazon/1' }, b: { url: 'https://meli.la/x', verificada: { mlb: 'MLB123456789' } }, c: { url: 'https://link.amazon/2', expired: true } };
  const now = new Date('2026-10-17T12:00:00Z');
  await destinosPistas(store, { fetch, now, max: 10 });
  assert.equal(calls, 1, 'só a pista sem id conhecido vai à rede');
  assert.deepEqual(store.a.destino, { at: now.toISOString(), versao: VERSAO, loja: 'amazon', id: 'B0HFNSM2T3', url: 'https://www.amazon.com.br/dp/B0HFNSM2T3' });
  assert.equal(store.b.destino.url, 'https://produto.mercadolivre.com.br/MLB-123456789-_JM');
  assert.equal(store.c.destino, undefined, 'pista vencida não é resolvida');
  assert.equal(pistasSemDestino(store, { now }).length, 0, 'resolvida não volta à fila');
});

await t('config pública: só links do painel (s.shopee / link.amazon), nada montado', () => {
  const o = parseOutrasLojas({ links: { '1234/567890': 'https://s.shopee.com.br/AbC1', 'x/1': 'https://s.shopee.com.br/z', '1/2345': 'https://evil.com/a' } },
    { links: [{ asin: 'B0HFNSM2T3', shortUrl: 'https://link.amazon/B0894sCU8' }, { asin: 'B0XXXXXXX1', shortUrl: 'https://amzn.evil/x' }] });
  assert.deepEqual(o, { shopee: { '1234/567890': 'https://s.shopee.com.br/AbC1' }, amazon: { B0HFNSM2T3: 'https://link.amazon/B0894sCU8' } });
  const real = loadOutrasLojas({ fresh: true });
  assert.equal(Object.keys(real.shopee).length, 45, 'os 45 links da Shopee do dono'); assert.equal(Object.keys(real.amazon).length, 31);
  assert.deepEqual(Object.keys(publicAffiliates()).sort(), ['amazon', 'anuncios', 'geral', 'shopee', 'v']);
});

await t('site: botão da pista = link do dono > anúncio limpo > post do canal; nunca o link de quem postou', () => {
  const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const line = (name) => html.match(new RegExp(`^(?:const|let) ${name}\\s*=.*(?:\\n(?!const |let |function |/\\*).*)*`, 'm'))[0];
  const ctx = {}; vm.createContext(ctx);
  vm.runInContext(`${line('AFIL')}\n${line('AFIL_OK')}\n${line('tipDest')}\n;AFIL={anuncios:{MLB111111111:"https://meli.la/meu"},geral:null,shopee:{"1234/567890":"https://s.shopee.com.br/Meu1"},amazon:{B0HFNSM2T3:"https://link.amazon/Meu2"}};globalThis.__t={tipDest};`, ctx);
  const { tipDest } = ctx.__t;
  const tip = (destino) => ({ url: 'https://s.shopee.com.br/DeOutro', postUrl: 'https://t.me/canal/1', destino });
  assert.equal(tipDest(tip({ loja: 'mercadolivre', id: 'MLB111111111', url: 'https://produto.mercadolivre.com.br/MLB-111111111-_JM' })), 'https://meli.la/meu');
  assert.equal(tipDest(tip({ loja: 'shopee', id: '1234/567890', url: 'https://shopee.com.br/product/1234/567890' })), 'https://s.shopee.com.br/Meu1');
  assert.equal(tipDest(tip({ loja: 'amazon', id: 'B0HFNSM2T3', url: 'https://www.amazon.com.br/dp/B0HFNSM2T3' })), 'https://link.amazon/Meu2');
  assert.equal(tipDest(tip({ loja: 'shopee', id: '9/99999', url: 'https://shopee.com.br/product/9/99999' })), 'https://shopee.com.br/product/9/99999', 'fora do mapa: anúncio limpo');
  assert.equal(tipDest(tip({ at: 'x', erro: 'sem destino' })), 'https://t.me/canal/1', 'sem destino: o post, não o link do afiliado alheio');
  assert.equal(tipDest(tip(undefined)), 'https://t.me/canal/1');
  assert.equal((html.match(/href="\$\{esc\(safeUrl\(t\.url\)\)\}"/g) || []).length, 0, 'nenhum botão de pista usa mais o link do post');
});
console.log(`✓ Destino limpo das pistas: ${n} grupos passaram`);
