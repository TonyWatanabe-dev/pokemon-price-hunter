// CSP sem 'unsafe-inline' em script-src (17/10/2026): todo script inline executável que chega ao navegador
// (HTML servido = index.html depois do slim do build/api/pagina.mjs) tem o hash sha256 listado na CSP, e nenhum
// atributo de evento inline (onerror=, onclick=…) sobra no HTML, nos templates do site nem nas páginas da API.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { slim } from '../api/_lib/slim.mjs';

const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const vj = JSON.parse(read('vercel.json'));
const csp = vj.headers.flatMap((h) => h.headers).find((h) => h.key === 'Content-Security-Policy').value;
const scriptSrc = csp.split(';').map((d) => d.trim()).find((d) => d.startsWith('script-src ')).split(/\s+/).slice(1);
assert.ok(!scriptSrc.includes("'unsafe-inline'"), "script-src sem 'unsafe-inline'");
assert.ok(!scriptSrc.includes("'unsafe-eval'") && !scriptSrc.includes("'unsafe-hashes'"));

const servido = slim(read('index.html')).html;
assert.ok(!/<script>\n"use strict";/.test(servido), 'o script principal sai do HTML (arquivo externo com hash)');
const inline = [...servido.matchAll(/<script(?![^>]*\bsrc=)(?![^>]*type="application\/ld\+json")[^>]*>([\s\S]*?)<\/script>/g)].map((m) => m[1]);
assert.ok(inline.length >= 1, 'achou os scripts inline pequenos');
const hashes = new Set(scriptSrc.filter((x) => x.startsWith("'sha256-")).map((x) => x.slice(8, -1)));
for (const c of inline) {
  const h = crypto.createHash('sha256').update(c, 'utf8').digest('base64');
  assert.ok(hashes.has(h), `script inline sem hash na CSP (mudou o texto? atualize o vercel.json): ${c.slice(0, 60)} → 'sha256-${h}'`);
}
assert.equal(hashes.size, inline.length, 'nenhum hash sobrando na CSP');

const EVENTO = /\son(?:error|load|click|change|input|submit|keydown|keyup|mouseover|focus|blur)\s*=\s*["']/i;
for (const f of ['index.html', 'api/ml-callback.mjs', 'api/pagina.mjs']) assert.doesNotMatch(read(f), EVENTO, `${f}: atributo de evento inline (bloqueado pela CSP)`);
assert.match(read('index.html'), /document\.addEventListener\("error",\(e\)=>\{const t=e\.target;if\(!\(t instanceof HTMLImageElement\)\|\|!t\.dataset\.err\)return;/, 'imagem quebrada tratada por um ouvinte só (data-err)');
console.log(`✓ CSP sem 'unsafe-inline': ${inline.length} scripts inline com hash, sem atributos de evento`);
