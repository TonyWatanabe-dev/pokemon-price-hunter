// Medição sem plano pago: /entrar/<origem> e /ir/<canal>/<origem> viram páginas vistas no Vercel Analytics gratuito.
// /ir só conta e segue para o convite oficial (WhatsApp ou Telegram), sem script inline e fora do índice.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { GRUPOS } from '../api/_lib/grupos.mjs';

const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const vj = JSON.parse(read('vercel.json'));
const rw = (s) => vj.rewrites.find((r) => r.source === s)?.destination;
assert.equal(rw('/entrar/:origem'), '/entrar.html');
assert.equal(rw('/ir/:destino/:origem'), '/ir.html');
assert.match(JSON.parse(read('package.json')).scripts.build, /\bir\.html\b/, 'build copia ir.html');

const ir = read('ir.html'); const js = read('assets/web/ir-v1.js'); const ent = read('assets/web/entrar-v3.js');
for (const l of ir.match(/https:\/\/(?:chat\.whatsapp\.com|t\.me)\/[^"]+/g)) assert.ok(Object.values(GRUPOS).includes(l), `convite ${l} oficial`);
assert.ok(ir.includes(`data-wa="${GRUPOS.whatsapp}"`) && ir.includes(`data-tg="${GRUPOS.telegram}"`));
assert.doesNotMatch(ir.replace(/<script[^>]*\ssrc="[^"]+"[^>]*><\/script>/g, ''), /<script/i, 'sem script inline (CSP)');
assert.match(ir, /src="\/_vercel\/insights\/script\.js"/, 'conta a página vista');
assert.match(ir, /noindex, nofollow/);
assert.match(js, /location\.replace\(destino\)/);
assert.match(js, /canal === 'telegram' \? a\.dataset\.tg : a\.dataset\.wa/, 'só os dois convites oficiais');
// origem só com [a-z0-9-]: nada do endereço vai parar em outro lugar além da contagem
assert.match(ent, /\[a-z0-9-\]\{1,40\}/);
assert.match(ent, /a\.href = '\/ir\/' \+ a\.dataset\.canal \+ '\/' \+ origem/);
assert.match(read('index.html'), /de qual anúncio ou rede a visita veio e quantas pessoas tocaram para entrar no grupo/, 'privacidade explica a contagem');
console.log('✓ /entrar/<origem> e /ir: contagem gratuita e convites oficiais');
