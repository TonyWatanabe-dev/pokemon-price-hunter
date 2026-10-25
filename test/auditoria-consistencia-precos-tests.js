// Auditoria de consistência de preços entre superfícies (T4-E, 25/10/2026). Trava regras que JÁ estão corretas:
//  1. Com o state.json real versionado (data/state.json), a melhor oferta de cada produto é a MESMA oferta nas páginas do
//     servidor (api/_seo.mjs bestBy), no resumo da Home da API (api/_lib/home.mjs slimHome) e no Monte seu kit
//     (api/_lib/kit.mjs melhoresOfertas): mesmo id, preço, Pix e frete (regra #84, offer-rank.mjs).
//  2. A mesma oportunidade (resposta de /api/v1/oportunidades) sai com o mesmo preço, o mesmo selo "no Pix" e a mesma nota
//     no SSR da Home/oportunidades (api/pagina.mjs oppItem) e no Top 10 dos grupos (src/agents/social/top.js itensDaApi);
//     o % do post arredonda para baixo e nunca passa o % do site.
// Sem rede, banco ou relógio real.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { bestBy } from '../api/_seo.mjs';
import { slimHome } from '../api/_lib/home.mjs';
import { melhoresOfertas } from '../api/_lib/kit.mjs';
import { oppItem } from '../api/pagina.mjs';
import { itensDaApi } from '../src/agents/social/top.js';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let n = 0;
const t = (nome, fn) => { try { fn(); n++; } catch (e) { e.message = `${nome}: ${e.message}`; throw e; } };

// ---- 1. melhor oferta: servidor × Home da API × kit, com dados reais
const st = JSON.parse(fs.readFileSync(path.join(raiz, 'data/state.json'), 'utf8'));
const { by } = bestBy(st);
const kit = melhoresOfertas(st.offers);
const home = slimHome(st, { now: Date.parse(st.dataAt ?? st.generatedAt) });
const homeOff = new Map(home.offers.map((o) => [o.id, o]));
const ids = Object.keys(by);
t('state real tem produtos com oferta em estoque', () => assert.ok(ids.length >= 20, `só ${ids.length} produtos com estoque no fixture`));
t('mesma melhor oferta no servidor, na Home da API e no kit', () => {
  const div = [];
  for (const pid of ids) {
    const b = by[pid]; const k = kit.get(pid); const h = homeOff.get(b.id);
    if (!k || k.id !== b.id) div.push(`${pid}: servidor ${b.id} × kit ${k?.id}`);
    if (!h) { div.push(`${pid}: oferta ${b.id} fora do resumo da Home`); continue; }
    if (h.price !== b.price || h.total !== b.total || (h.priceKind === 'pix') !== (b.priceKind === 'pix') || !!h.shippingKnown !== (b.shippingKnown === true))
      div.push(`${pid}: Home leva preço/total/Pix/frete diferente do servidor`);
  }
  assert.deepEqual(div, []);
  assert.equal([...kit.keys()].filter((pid) => !by[pid]).length, 0, 'kit não tem produto que o servidor considera sem estoque');
});
t('frete desconhecido nunca vira frete conhecido na Home', () => {
  for (const pid of ids) { const b = by[pid]; if (b.shippingKnown !== true) assert.notEqual(homeOff.get(b.id).shippingKnown, true, pid); }
});

// ---- 2. oportunidade: SSR × Top 10
const API = JSON.parse(fs.readFileSync(path.join(raiz, 'test/fixtures/oportunidades-top.json'), 'utf8'));
const AGORA = Date.parse(API.meta.updated_at) + 10 * 6e4;
const top = itensDaApi(API, 'top10', AGORA);
const brl = (v) => 'R$ ' + Number(v).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
t('fixture válido para o Top 10', () => { assert.equal(top.erro, undefined); assert.equal(top.itens.length, 10); });
t('mesmo preço, selo Pix e nota no site (SSR) e no Top 10', () => {
  top.itens.forEach((i, k) => {
    const x = API.data[k]; const li = oppItem(x, x.product.id);
    assert.equal(i.id, x.product.id, `ordem ${k + 1}`);
    assert.equal(i.preco, x.price);
    const selo = x.offer?.price_kind === 'pix';
    assert.equal(i.pix, selo, `${i.id}: Pix no post`);
    assert.ok(li.includes(`<b>${brl(x.price)}${selo ? ' no Pix' : ''}</b>`), `${i.id}: preço/Pix no SSR`);
    assert.equal(i.score, x.opportunity_score);
    assert.ok(li.includes(`Opportunity Score ${x.opportunity_score}`), `${i.id}: nota no SSR`);
  });
});
t('% do post arredonda para baixo e nunca passa o % do site', () => {
  let comPct = 0;
  top.itens.forEach((i, k) => {
    const x = API.data[k]; const m = oppItem(x, x.product.id).match(/([\d,]+)% abaixo/);
    if (i.pct == null) return; comPct++;
    assert.ok(m, `${i.id}: SSR sem % e post com %`);
    const site = Number(m[1].replace(',', '.'));
    assert.equal(Math.floor(i.pct), Math.floor(x.reference_comparison.percentage_below));
    assert.ok(Math.floor(i.pct) <= site, `${i.id}: post ${Math.floor(i.pct)}% > site ${site}%`);
  });
  assert.ok(comPct >= 5, 'fixture precisa ter itens com % abaixo da referência');
});

console.log(`✓ Auditoria de consistência de preços: ${n} verificações passaram`);
