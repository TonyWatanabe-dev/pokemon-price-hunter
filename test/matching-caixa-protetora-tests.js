// Caixa/capa protetora é acessório, não o produto que ela protege (27/11/2026): na captura das buscas do ML apareceu
// "Caixa Protetora De Etb Pokémon Trainer Box 30 Anos" a R$ 68, que casava com o ETB (sugerido R$ 399,99) e virava uma
// falsa economia de 83% no site e no grupo.
import assert from 'node:assert/strict';
import { matchProduct } from '../src/match.js';
import { loadCatalog } from '../src/run.js';

const catalog = await loadCatalog();
const m = (t) => matchProduct({ title: t }, catalog);
let n = 0; const t = async (nome, fn) => { try { await fn(); n++; } catch (e) { e.message = `[${nome}] ${e.message}`; throw e; } };

await t('protetor de ETB/box não casa com produto lacrado', () => {
  for (const titulo of [
    'Caixa Protetora De Etb Pokémon Trainer Box 30 Anos Português',
    'Capa Protetora Para Booster Box Pokémon Escuridão Absoluta',
    'Cápsula Protetora Para Blister Triplo Pokémon',
  ]) {
    const r = m(titulo);
    assert.equal(r.productId, null, `${titulo} → ${r.productId}`);
  }
});

await t('o produto de verdade continua casando', () => {
  const etb = m('Box Treinador Avançado Pokémon TCG Celebração 30 Anos');
  assert.equal(etb.productId, 'c30-etb'); assert.ok(etb.confidence >= 0.8);
  const bl = m('Blister Triplo Pokémon TCG Reinado Delta - Spritzee');
  assert.equal(bl.productId, 'me06-blister3'); assert.ok(bl.confidence >= 0.8);
});

await t('nenhuma oferta publicada hoje é caixa protetora', async () => {
  const fs = await import('node:fs');
  for (const arq of ['config/afiliados/ml-ofertas.json', 'config/afiliados/shopee-ofertas.json']) {
    const doc = JSON.parse(fs.readFileSync(new URL('../' + arq, import.meta.url), 'utf8'));
    for (const o of doc.ofertas) assert.doesNotMatch(o.title, /(caixa|capa|c[áa]psula) protetora/i, `${arq}: ${o.title}`);
  }
  const am = JSON.parse(fs.readFileSync(new URL('../config/afiliados/amazon.json', import.meta.url), 'utf8'));
  for (const l of am.links) assert.doesNotMatch(l.title, /(caixa|capa|c[áa]psula) protetora/i, l.asin);
});

console.log(`✓ matching caixa protetora: ${n} grupos passaram`);
