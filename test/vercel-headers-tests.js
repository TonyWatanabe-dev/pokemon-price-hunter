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

// HSTS de 1 ano com subdomínios, sem preload (#578).
assert.equal(hdr['strict-transport-security'], 'max-age=31536000; includeSubDomains',
  'Strict-Transport-Security deve ser max-age=31536000; includeSubDomains');
assert.ok(!/preload/i.test(hdr['strict-transport-security']), 'HSTS não deve ter preload');

// Permissions-Policy: inclui browsing-topics e não bloqueia recurso usado pelo index.html.
const pp = Object.fromEntries(hdr['permissions-policy'].split(',').map(d => d.trim().split('=')));
assert.equal(pp['browsing-topics'], '()', 'Permissions-Policy deve ter browsing-topics=()');
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const usos = { camera: /getUserMedia/, microphone: /getUserMedia/, geolocation: /\bgeolocation\b/,
  payment: /PaymentRequest/, usb: /navigator\.usb/, 'browsing-topics': /browsingTopics/ };
for (const [rec, re] of Object.entries(usos)) {
  if (pp[rec] === '()') assert.ok(!re.test(html), `index.html usa ${rec}, bloqueado pela Permissions-Policy`);
}
