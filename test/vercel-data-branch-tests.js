// O ramo `data` (gravado pelo robô a cada ~15 min) não pode gerar deploy na Vercel: cada push virava um preview
// com erro e consumia a cota diária de deploys, travando a publicação da `main`.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const v = JSON.parse(fs.readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
assert.equal(v.git?.deploymentEnabled?.data, false, 'ramo data sem deploy');
assert.notEqual(v.git?.deploymentEnabled?.main, false, 'main continua publicando');
console.log('vercel-data-branch-tests ok');

// O ramo data é órfão (tools/push-data.sh): o vercel.json precisa ir no próprio commit do ramo, senão a Vercel não vê a regra.
const sh = fs.readFileSync(new URL('../tools/push-data.sh', import.meta.url), 'utf8');
assert.match(sh, /"deploymentEnabled": \{ "data": false \}/, 'push-data.sh grava vercel.json no ramo data');
assert.match(sh, /git add data vercel\.json/, 'vercel.json entra no commit do ramo data');
JSON.parse(sh.match(/printf '%s\\n' '(\{.*\})' > vercel\.json/)[1]);
console.log('vercel-data-branch-tests ok (push-data.sh)');
