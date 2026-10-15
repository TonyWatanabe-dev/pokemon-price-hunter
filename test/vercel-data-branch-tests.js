// O ramo `data` (gravado pelo robô a cada ~15 min) não pode gerar deploy na Vercel: cada push virava um preview
// com erro e consumia a cota diária de deploys, travando a publicação da `main`.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const v = JSON.parse(fs.readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
assert.equal(v.git?.deploymentEnabled?.data, false, 'ramo data sem deploy');
assert.notEqual(v.git?.deploymentEnabled?.main, false, 'main continua publicando');
console.log('vercel-data-branch-tests ok');
