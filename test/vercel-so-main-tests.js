// Cota da Vercel (plano Hobby, ~100 deploys/dia): cada push em branch de trabalho criava um preview e, em 17/10,
// a cota acabou e os merges #805–#810 ficaram sem deploy. Só a main publica; as demais branches não geram deploy.
// Regra da Vercel: com várias regras casando, basta uma ser true para publicar (main casa "main" e "**").
// "**" porque "*" do minimatch não atravessa "/" (social/x, fix/y).
import assert from 'node:assert/strict';
import fs from 'node:fs';
const de = JSON.parse(fs.readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')).git?.deploymentEnabled;
assert.equal(de?.main, true, 'main publica');
assert.equal(de?.['**'], false, 'demais branches (inclusive com /) sem deploy');
assert.equal(de?.data, false, 'ramo data sem deploy');
assert.deepEqual(Object.entries(de).filter(([, v]) => v === true).map(([k]) => k), ['main'], 'só main tem true');
console.log('✓ Vercel: só a main gera deploy');
