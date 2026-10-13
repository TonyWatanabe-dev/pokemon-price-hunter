// Cabeçalhos de segurança da Vercel: lê o vercel.json e falha se algum sumir.
import assert from 'node:assert/strict';
import fs from 'node:fs';

const cfg = JSON.parse(fs.readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'));
const regra = cfg.headers.find(h => h.source.startsWith('/(('));
assert.ok(regra, 'vercel.json: regra global de cabeçalhos ausente');
const hdr = Object.fromEntries(regra.headers.map(h => [h.key.toLowerCase(), h.value]));

assert.equal(hdr['x-content-type-options'], 'nosniff', 'X-Content-Type-Options deve ser nosniff');
assert.equal(hdr['x-frame-options'], 'DENY', 'X-Frame-Options deve ser DENY');
assert.ok(hdr['referrer-policy'], 'Referrer-Policy ausente');
assert.ok(hdr['permissions-policy'], 'Permissions-Policy ausente');
assert.ok(hdr['content-security-policy'], 'Content-Security-Policy ausente');
