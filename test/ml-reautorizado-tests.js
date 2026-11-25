// ML reautorizado pelo dono depois do último bloqueio: a hora da autorização fica no cofre e a renovação a preserva (sem rede).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

process.env.HUNTER_DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'ml-reaut-'));
process.env.ML_CLIENT_ID = '123';
process.env.ML_CLIENT_SECRET = 'segredo-de-teste';
const ml = await import('../src/mlauth.js');
const tok = (n) => new Response(JSON.stringify({ access_token: 'AT' + n, refresh_token: 'RT' + n, expires_in: 1 }), { status: 200 });

// arquivo antigo (sem authorizedAt): a hora do token vale como autorização
fs.writeFileSync(path.join(process.env.HUNTER_DATA_DIR, 'ml-auth.enc'), ml.seal({ access: 'A', refresh: 'R', expiresAt: 0, at: '2026-11-25T10:28:00.000Z' }) + '\n');
assert.equal(ml.authorizedAt(), '2026-11-25T10:28:00.000Z');

// renovação preserva a hora da autorização (não vira a hora da renovação)
let n = 0; globalThis.fetch = async () => tok(++n);
await ml.accessToken();
assert.equal(ml.authorizedAt(), '2026-11-25T10:28:00.000Z');

// nova autorização do dono grava a hora dela; a renovação seguinte mantém
const antes = Date.now();
await ml.exchange('TG-x');
const a = Date.parse(ml.authorizedAt()); assert.ok(a >= antes);
await ml.accessToken();
assert.equal(Date.parse(ml.authorizedAt()), a);

// sem cofre
fs.rmSync(path.join(process.env.HUNTER_DATA_DIR, 'ml-auth.enc'));
assert.equal(ml.authorizedAt(), null);

// o laço de lojas pula a espera só para o ML reautorizado depois do último bloqueio
const src = fs.readFileSync(new URL('../src/run.js', import.meta.url), 'utf8');
assert.match(src, /store\.platform === 'mercadolivre' && \(\(\) => \{ const a = Date\.parse\(mlAuthorizedAt\(\) \|\| ''\); return a > Date\.parse\(src\.lastCheck\); \}\)\(\)/);
assert.match(src, /if \(!reautorizado && Date\.now\(\) - Date\.parse\(src\.lastCheck\) < backoffMs\(src\)\) return;/);
console.log('ml-reautorizado: ok');
