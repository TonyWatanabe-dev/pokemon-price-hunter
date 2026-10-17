// Sonda de adaptadores: só leitura (workflow sem escrita/secrets), entrada validada e veredito conservador.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { parseLojas, veredito } from '../tools/sonda-adaptadores.mjs';

assert.deepEqual(parseLojas('lifegeek:vtex, metacardscombr:shopify'), [{ id: 'lifegeek', plataforma: 'vtex' }, { id: 'metacardscombr', plataforma: 'shopify' }]);
assert.deepEqual(parseLojas('x:jsonld,../etc:vtex,ok:mercadolivre'), [], 'só vtex/shopify e id simples');
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
