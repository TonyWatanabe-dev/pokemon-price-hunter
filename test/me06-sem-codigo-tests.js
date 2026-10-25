// E6-M (25/10/2026): "Reinado Delta" (ME06) está fora de config/catalog.json. A #922 impede o fallback da série
// ("megaevolucao" → me01) quando o título traz o código ME06; sem o código, o anúncio real "Combo de Boosters - Megaevolução
// Reinado Delta" (moxland, ramo data 8f28f68c, lido às 16:00 já com o matcher novo) continuava em me01-combo.
// Regra: o nome de uma coleção conhecida fora do catálogo (FORA_DO_CATALOGO, lista fechada em src/match.js) tem o mesmo efeito
// do código: sem coleção, sem produto. Sem similaridade textual: "Megaevolução Delta" ou "Megaevolução Reinado" não disparam.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import * as M from '../src/match.js';
const { matchProduct, detectCollection, normalize } = M;
const FORA_DO_CATALOGO = M.FORA_DO_CATALOGO || [];

const catalog = JSON.parse(fs.readFileSync(new URL('../config/catalog.json', import.meta.url), 'utf8'));
catalog.products ||= []; catalog.copag ||= {};
catalog.refs = JSON.parse(fs.readFileSync(new URL('../config/refs-copag.json', import.meta.url), 'utf8'))?.refs || {};
const m = (title) => matchProduct({ title }, catalog);
let n = 0; const t = (name, fn) => { fn(); n++; };
const semProduto = (title) => {
  const r = m(title);
  assert.equal(r.productId, null, title);
  assert.equal(r.parsed.collection, null, title);
  assert.notEqual(r.productId?.startsWith('me01'), true, title);
};

t('1. título real sem código: não cai em me01-combo', () => {
  semProduto('Combo de Boosters - Megaevolução Reinado Delta');
  assert.deepEqual(detectCollection(normalize('Combo de Boosters - Megaevolução Reinado Delta'), catalog.collections), { id: null });
});

t('2. com e sem ME06: sem produto nos dois casos', () => {
  for (const title of ['Combo Booster Box Pokémon Reinado Delta Megaevolução ME06 - 18 Pacotes', // real (gorupa)
    'Booster Box Pokémon Megaevolução - Reinado Delta (ME06) 36 Boosters',
    'Booster Box Pokémon Megaevolução Reinado Delta 36 Boosters',
    'Treinador Avançado Pokémon Megaevolução Reinado Delta',
    'Blister Triplo Pokémon Megaevolução Reinado Delta']) semProduto(title);
});

t('3. variantes de escrita: hífen, maiúsculas, espaço duplo, sem acento', () => {
  for (const title of ['Combo de Boosters - Megaevolução Reinado-Delta', 'COMBO DE BOOSTERS - MEGAEVOLUÇÃO REINADO DELTA',
    'Combo de Boosters - Megaevolução Reinado  Delta', 'Combo de Boosters - Megaevolucao Reinado Delta',
    'Booster Box Pokémon Mega Evolução Reinado-Delta 36 Boosters', 'Combo de Boosters Pokémon Megaevolucao ReinadoDelta']) semProduto(title);
});

t('4. ME01 de verdade e as outras coleções da série não mudam', () => {
  for (const [title, esperado] of Object.entries({
    'Combo de Boosters Pokémon Megaevolução': 'me01-combo',
    'Booster Box Mega Evolução ME01 36 Boosters': 'me01-box36',
    'Treinador Avançado Pokémon Megaevolução ME01': 'me01-etb',
    'Pokémon Treinador Avançado Megaevolução': 'me01-etb',
    'Pokémon Lata Megaevolução Original': 'me01-lata',
    'Treinador Avançado Pokémon Fogo Fantasmagórico': 'me02-etb',
    'Blister Triplo Pokémon Heróis Excelsos': 'me02_5-blister3',
    'Booster Box Pokémon Equilíbrio Perfeito 36 Boosters': 'me03-box36',
    'Treinador Avançado Pokémon Caos Ascendente': 'me04-etb',
    'Combo de Boosters Pokémon Escuridão Absoluta': 'me05-combo',
    'Treinador Avançado Pokémon Reinado Arrepiante': 'swsh6-etb', // "Reinado" de outra coleção do catálogo
  })) assert.equal(m(title).productId, esperado, title);
});

t('5. sem semelhança: "Megaevolução" + palavra genérica parecida não vira ME06 nem fica sem produto', () => {
  for (const title of ['Combo de Boosters Pokémon Megaevolução Delta', 'Combo de Boosters Pokémon Megaevolução Reinado',
    'Combo de Boosters Pokémon Megaevolução Oferta']) assert.equal(m(title).productId, 'me01-combo', title);
  for (const title of ['Combo de Boosters Pokémon Megaevolução Delta', 'Combo de Boosters Pokémon Megaevolução Reinado'])
    assert.notEqual(m(title).productId, null, title);
});

t('6. lista fechada e documentada: só Reinado Delta, e nenhuma entrada está no catálogo', () => {
  assert.ok(Object.isFrozen(M.FORA_DO_CATALOGO), 'FORA_DO_CATALOGO exportada e congelada');
  assert.deepEqual(FORA_DO_CATALOGO.map((c) => c.id), ['me06']);
  const ids = new Set(catalog.collections.map((c) => c.id));
  const aliases = catalog.collections.flatMap((c) => [...(c.aliases || []), ...(c.fallbackAliases || [])]);
  for (const c of FORA_DO_CATALOGO) {
    assert.equal(ids.has(c.id), false, `${c.id} entrou no catálogo: retire de FORA_DO_CATALOGO`);
    assert.equal(aliases.some((a) => c.re.test(a)), false, c.nome);
  }
});

console.log(`me06-sem-codigo-tests: ok (${n} grupos)`);
