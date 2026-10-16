// /grupos (link da bio de Instagram/TikTok) redireciona para o grupo do WhatsApp, sem cache permanente.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const v = JSON.parse(readFileSync('vercel.json', 'utf8'));
for (const s of ['/grupos', '/grupo', '/zap']) {
  const r = (v.redirects ?? []).find((x) => x.source === s);
  assert.ok(r, `falta redirect ${s}`);
  assert.match(r.destination, /^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9]{20,24}$/);
  assert.equal(r.permanent, false, 'temporário: o convite pode mudar');
}
console.log('grupos-whatsapp-tests: ok');
