// Loja Pokémon Super (24/10/2026): espelho da Super TCG (os 43 links apontam para supertcg.com.br; 5 de 6 títulos
// amostrados existem na Super TCG com o mesmo link). Registro reversível em config/stores.json (duplicateOf): a loja fica
// pausada, com o mesmo id (histórico por storeId preservado), e a página diz que os preços aparecem pela outra.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalizeLojas } from '../api/_lib/lojas.mjs';
const stores = JSON.parse(fs.readFileSync(new URL('../config/stores.json', import.meta.url), 'utf8')).stores;
const dup = stores.find((s) => s.id === 'lojapokemonsupercom');
assert.ok(dup, 'registro da duplicidade');
assert.equal(dup.enabled, false); assert.equal(dup.duplicateOf, 'supertcgcombr');
assert.equal(dup.id, 'lojapokemonsuper.com'.replace(/[^a-z0-9]/gi, ''), 'mesmo id que a lista de varredura gera: histórico preservado');
assert.ok(fs.readFileSync(new URL('../config/lojas/varredura-outubro.txt', import.meta.url), 'utf8').includes('lojapokemonsuper.com'), 'a linha da varredura fica (reversível)');
assert.equal(stores.filter((s) => s.id === 'lojapokemonsupercom').length, 1);

const sources = {
  supertcgcombr: { name: 'Super TCG', url: 'https://supertcg.com.br', status: 'ACTIVE' },
  lojapokemonsupercom: { name: 'lojapokemonsuper.com', url: 'https://lojapokemonsuper.com', status: 'PAUSED', reason: 'pausada manualmente' },
  outra: { name: 'Outra', url: 'https://outra.com.br', status: 'PAUSED' },
};
const L = normalizeLojas({ sources, stores: [...stores, { id: 'outra', enabled: false }], offers: [] });
const by = Object.fromEntries(L.map((l) => [l.id, l]));
assert.equal(by.lojapokemonsupercom.status, 'pausada');
assert.equal(by.lojapokemonsupercom.duplicateOf, 'supertcgcombr');
assert.match(by.lojapokemonsupercom.reason, /^Mesmo catálogo de Super TCG/);
assert.equal(by.outra.reason, 'Leitura pausada pelo projeto; os preços só aparecem na loja.', 'pausa comum não muda');
assert.equal(by.outra.duplicateOf, undefined);
console.log('loja-duplicada-tests: ok');
