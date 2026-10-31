// E6-E / D7 (auditoria T4-E): em empate de total comparável, a página do produto (index.html OFFER_SORTS.price /
// bestOffer) escolhe a MESMA oferta que o servidor (api/_lib/offer-rank.mjs byComparableTotal, usado por bestBy, SSR, Home
// e kit): frete conhecido → total → preferência de afiliado → id. Antes faltava o id no fim da página: com anúncios repetidos
// (mesma loja, mesmo preço) o destaque, a nota e o link "Ver oferta" mudavam conforme a ordem de chegada das ofertas.
// Código real dos dois lados; data/state.json versionado + casos sintéticos. Sem rede e sem banco.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { byComparableTotal, setTiePreference } from '../api/_lib/offer-rank.mjs';
import { afiliadoPreferido, parseAffiliates } from '../api/_lib/affiliates.mjs';

let n = 0; const t = (nome, fn) => { try { fn(); n++; } catch (e) { e.message = `${nome}: ${e.message}`; throw e; } };
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const line = (name) => { const m = html.match(new RegExp(`^(?:const|let) ${name}\\s*=.*$`, 'm')); assert.ok(m, `index.html: ${name}`); return m[0]; };
const ctx = { String, Object, URL };
vm.createContext(ctx);
vm.runInContext([line('AFIL'), line('mlItem'), line('afPref'), line('live'), line('shipOk'), line('shipCmp'), line('OFFER_SORTS'), line('bestOffer'),
  ';globalThis.__t={OFFER_SORTS,bestOffer,set(a){AFIL.anuncios=a}};'].join('\n'), ctx);
const app = ctx.__t;
const live = (o) => o.stock === 'IN_STOCK' && !o.stale && !o.anomalous && o.total > 0;
const srvBest = (offs) => offs.filter(live).sort(byComparableTotal)[0];
const perm = (a) => (a.length <= 1 ? [a] : a.flatMap((x, i) => perm([...a.slice(0, i), ...a.slice(i + 1)]).map((r) => [x, ...r])));

const of = (id, total, extra = {}) => ({ id, productId: 'p', storeId: 's' + id, url: 'https://loja.com.br/' + id, price: total, total, shippingKnown: true, stock: 'IN_STOCK', ...extra });
t('sintético: empate de total — a mesma oferta em qualquer ordem de chegada, igual ao servidor', () => {
  setTiePreference(null); app.set({});
  const L = [of('rihappy-2', 79.99), of('rihappy-1', 79.99), of('outra-b', 79.99), of('cara', 90), of('semfrete', 50, { shippingKnown: false })];
  for (const p of perm(L.slice(0, 4))) { assert.equal(app.bestOffer([...p, L[4]]).id, srvBest(L).id, p.map((o) => o.id).join(',')); }
  assert.equal(srvBest(L).id, 'outra-b');
});
t('sintético: com afiliado no mapa, desempate do dono vem antes do id (mesma regra nos dois lados)', () => {
  const ML = (item) => `https://www.mercadolivre.com.br/p/MLB1?pdp_filters=item_id%3A${item}`;
  setTiePreference(afiliadoPreferido(parseAffiliates({ mercadolivre: { anuncios: { MLB7000000001: 'https://meli.la/a' } } }))); app.set({ MLB7000000001: 'https://meli.la/a' });
  const L = [of('a', 100), of('z-af', 100, { url: ML('MLB7000000001') }), of('m', 100, { url: ML('MLB7000000002') })];
  for (const p of perm(L)) assert.equal(app.bestOffer(p).id, 'z-af');
  assert.equal(srvBest(L).id, 'z-af');
  setTiePreference(null); app.set({});
});
t('state real: melhor oferta da página = do servidor em todo produto, com as ofertas em ordem invertida', () => {
  const st = JSON.parse(fs.readFileSync(new URL('../data/state.json', import.meta.url), 'utf8'));
  const by = {}; for (const o of st.offers) (by[o.productId] ||= []).push(o);
  const div = []; let empates = 0;
  for (const [pid, offs] of Object.entries(by)) {
    const s = srvBest(offs); if (!s) continue;
    if (offs.filter(live).filter((o) => o.total === s.total && !!o.shippingKnown === !!s.shippingKnown).length > 1) empates++;
    for (const ord of [offs, [...offs].reverse()]) { const a = app.bestOffer(ord); if (a.id !== s.id) div.push(`${pid}: página ${a.id} × servidor ${s.id}`); }
  }
  assert.deepEqual(div.slice(0, 5), [], `${div.length} divergências`);
  assert.ok(empates >= 1, 'fixture sem empate: o teste não exercitaria o desempate');
});
console.log(`consistencia-d7-desempate: ${n} verificações ok`);
