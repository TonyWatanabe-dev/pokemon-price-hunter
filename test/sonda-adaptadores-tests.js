// Sonda de adaptadores: só leitura (workflow sem escrita/secrets), entrada validada e veredito conservador.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseLojas, veredito } from '../tools/sonda-adaptadores.mjs';

assert.deepEqual(parseLojas('lifegeek:vtex, metacardscombr:shopify'), [{ id: 'lifegeek', plataforma: 'vtex' }, { id: 'metacardscombr', plataforma: 'shopify' }]);
assert.deepEqual(parseLojas('x:jsonld,../etc:vtex,ok:mercadolivre'), [], 'só vtex/shopify/woocommerce e id simples');
assert.equal(parseLojas('lojaw:woocommerce').length, 1);
assert.equal(veredito({ atual: { casados: 27 }, sonda: { validos: 40, casados: 27 } }), 'passa');
assert.equal(veredito({ atual: { casados: 27 }, sonda: { validos: 40, casados: 20 } }), 'pior');
assert.equal(veredito({ atual: { casados: null }, sonda: { validos: 0, casados: 0 } }), 'sem_anuncios');
assert.equal(veredito({ atual: {}, sonda: { erro: 'HTTP 403', validos: 0 } }), 'falhou');

const wf = fs.readFileSync(new URL('../.github/workflows/sonda-adaptadores.yml', import.meta.url), 'utf8');
assert.match(wf, /permissions:\n  contents: read\n/);
assert.doesNotMatch(wf, /\$\{\{\s*secrets\.|git push|contents: write/);
for (const m of wf.matchAll(/uses: ([^\s]+)/g)) assert.match(m[1], /@[0-9a-f]{40}$/, `ação fixada por SHA: ${m[1]}`);
const tool = fs.readFileSync(new URL('../tools/sonda-adaptadores.mjs', import.meta.url), 'utf8');
assert.doesNotMatch(tool, /writeJson|appendJsonl|db-sync|pg\b/, 'não grava dados');
console.log('sonda-adaptadores-tests: ok');

// Amostra de triagem: inválido mostra o 1º motivo; válido sem produto mostra o motivo do casamento; limite por tipo.
{
  const { amostra, textoAmostra } = await import('../tools/sonda-adaptadores.mjs');
  const catalog = JSON.parse(fs.readFileSync(new URL('../config/catalog.json', import.meta.url), 'utf8')); catalog.products ||= []; catalog.copag ||= {};
  const store = { id: 'lojax', url: 'https://lojax.com.br' };
  const ok = (title, extra = {}) => ({ storeId: 'lojax', title, url: 'https://lojax.com.br/p/' + encodeURIComponent(title), price: { base: 99.9 }, stock: 'IN_STOCK', sourceType: 'json_ld', ...extra });
  const raw = [ok('Camiseta Pikachu Algodão'), ok('Sleeve Pokémon 65 unidades'), ok('Booster Avulso', { url: 'https://outra.com/p/1' })];
  const a = amostra(raw, store, catalog);
  assert.equal(a.invalidos.length, 1);
  assert.match(a.invalidos[0], /^Booster Avulso — link fora do domínio da loja/);
  assert.equal(a.naoCasados.length, 2);
  assert.ok(a.naoCasados.every((x) => / — \S/.test(x)), 'cada não casado traz um motivo');
  const muitos = Array.from({ length: 20 }, (_, i) => ok('Camiseta ' + i));
  assert.equal(amostra(muitos, store, catalog).naoCasados.length, 6, 'no máximo 6 por tipo');
  assert.equal(textoAmostra(null), '');
  assert.match(textoAmostra(a), /inválidos: Booster Avulso.*não casaram: /);
  console.log('sonda-adaptadores-tests (amostra): ok');
}
