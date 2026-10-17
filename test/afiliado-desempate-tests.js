// Desempate do dono (17/10/2026, docs/afiliados.md): com o MESMO total comparável (mesma situação de frete), a oferta
// cujo anúncio do ML tem link de afiliado no mapa fica antes. Nunca acima de oferta mais barata nem de frete conhecido.
// Servidor (offer-rank + affiliates) e página (byTot, OFFER_SORTS.price) com o código real. Sem rede e sem banco.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { byComparableTotal, byComparable, bestComparable, setTiePreference } from '../api/_lib/offer-rank.mjs';
import { afiliadoPreferido, parseAffiliates } from '../api/_lib/affiliates.mjs';

let n = 0;
const t = (name, fn) => { try { fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } };
const ML = (item) => `https://www.mercadolivre.com.br/p/MLB27711554?pdp_filters=item_id%3A${item}`;
const cfg = parseAffiliates({ mercadolivre: { anuncios: { MLB7000000001: 'https://meli.la/aaa' } } });
const of = (id, url, total, shippingKnown = true) => ({ id, url, total, price: total, shippingKnown, stock: 'IN_STOCK' });
const AF = of('z-af', ML('MLB7000000001'), 100);          // id "z..." perderia no desempate por id
const OUT = of('a-loja', 'https://loja.com.br/p', 100);
const ML_SEM = of('b-ml', ML('MLB7000000002'), 100);
const BARATA = of('c-barata', 'https://loja.com.br/q', 99.99);
const SEM_FRETE = of('d-semfrete', ML('MLB7000000001'), 50, false);

t('servidor sem registro: empate segue por id (comportamento antigo)', () => {
  setTiePreference(null);
  assert.deepEqual([AF, OUT, ML_SEM].sort(byComparableTotal).map((o) => o.id), ['a-loja', 'b-ml', 'z-af']);
});

t('servidor com o desempate: afiliado primeiro só no empate', () => {
  setTiePreference(afiliadoPreferido(cfg));
  assert.deepEqual([OUT, ML_SEM, AF].sort(byComparableTotal).map((o) => o.id), ['z-af', 'a-loja', 'b-ml']);
  assert.equal(bestComparable([OUT, AF, ML_SEM])?.id, 'z-af');
  assert.equal(bestComparable([AF, BARATA, OUT])?.id, 'c-barata', 'nunca acima de oferta mais barata');
  assert.equal(bestComparable([SEM_FRETE, OUT])?.id, 'a-loja', 'frete desconhecido continua depois de frete conhecido');
  const pb = byComparable((o) => o.total / 2);
  assert.deepEqual([OUT, AF].sort(pb).map((o) => o.id), ['z-af', 'a-loja'], 'mesmo desempate no modo por booster');
  setTiePreference(() => { throw new Error('x'); });
  assert.deepEqual([AF, OUT].sort(byComparableTotal).map((o) => o.id), ['a-loja', 'z-af'], 'preferência com erro: ignora');
  setTiePreference(null);
});

t('afiliadoPreferido: só anúncio do ML que está no mapa', () => {
  const pref = afiliadoPreferido(cfg);
  assert.equal(pref(AF), true); assert.equal(pref(ML_SEM), false); assert.equal(pref(OUT), false); assert.equal(pref({}), false); assert.equal(pref(null), false);
});

t('rotas que mostram ofertas registram o desempate', () => {
  for (const f of ['api/v1.mjs', 'api/pagina.mjs']) assert.match(fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8'), /\nregistrarDesempate\(\);/, f);
  const vj = JSON.parse(fs.readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
  for (const f of ['api/v1.mjs', 'api/pagina.mjs']) assert.match(vj.functions[f].includeFiles, /config\/affiliates\.json/, `${f} leva a config junto`);
});

// ---- página: código real
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const line = (name) => { const m = html.match(new RegExp(`^(?:const|let) ${name}\\s*=.*$`, 'm')); assert.ok(m, `index.html: ${name} não encontrado`); return m[0]; };
const ctx = { String, Object, URL };
vm.createContext(ctx);
vm.runInContext([line('AFIL'), line('mlItem'), line('afPref'), line('live'), line('shipOk'), line('shipCmp'), line('byTot'), line('OFFER_SORTS'),
  ';globalThis.__t={byTot,OFFER_SORTS,afPref,set(a){AFIL.anuncios=a}};'].join('\n'), ctx);

t('página: byTot e ordem por preço com o mesmo desempate; sem mapa, nada muda', () => {
  const P = ctx.__t;
  assert.deepEqual([AF, OUT].sort(P.byTot).map((o) => o.id), ['a-loja', 'z-af'], 'sem mapa: por id');
  P.set({ MLB7000000001: 'https://meli.la/aaa' });
  assert.equal(P.afPref(AF), 1); assert.equal(P.afPref(OUT), 0); assert.equal(P.afPref(null), 0);
  assert.deepEqual([OUT, ML_SEM, AF].sort(P.byTot).map((o) => o.id), ['z-af', 'a-loja', 'b-ml']);
  assert.deepEqual([AF, BARATA, OUT].sort(P.byTot).map((o) => o.id), ['c-barata', 'z-af', 'a-loja'], 'nunca acima de mais barata');
  assert.deepEqual([OUT, AF, BARATA].sort(P.OFFER_SORTS.price).map((o) => o.id)[0], 'c-barata');
  assert.deepEqual([OUT, AF].sort(P.OFFER_SORTS.price).map((o) => o.id), ['z-af', 'a-loja']);
  assert.deepEqual([OUT, SEM_FRETE].sort(P.OFFER_SORTS.price).map((o) => o.id), ['a-loja', 'd-semfrete'], 'frete conhecido continua antes');
});

console.log(`✓ Desempate de afiliado (17/10): ${n} grupos passaram (só em empate; nunca acima de mais barata)`);
