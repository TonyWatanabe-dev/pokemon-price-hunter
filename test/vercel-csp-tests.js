// CSP da Vercel: diretivas obrigatórias e proibições em script-src/default-src.
import assert from 'node:assert/strict';
import fs from 'node:fs';

const cfg = JSON.parse(fs.readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
const regra = cfg.headers.find(h => h.source.startsWith('/(('));
const csp = regra?.headers.find(h => h.key.toLowerCase() === 'content-security-policy')?.value;
assert.ok(csp, 'vercel.json: CSP ausente');

const dir = Object.fromEntries(csp.split(';').map(s => s.trim()).filter(Boolean).map(s => {
  const [nome, ...vals] = s.split(/\s+/);
  return [nome.toLowerCase(), vals];
}));

for (const d of ['frame-ancestors', 'object-src', 'base-uri', 'form-action']) {
  assert.deepEqual(dir[d], ["'none'"], `CSP: ${d} deve ser 'none'`);
}
for (const d of ['script-src', 'default-src']) {
  assert.ok(dir[d], `CSP: ${d} ausente`);
  assert.ok(!dir[d].includes("'unsafe-eval'"), `CSP: ${d} não pode ter 'unsafe-eval'`);
  assert.ok(!dir[d].includes('*'), `CSP: ${d} não pode ter *`);
}
