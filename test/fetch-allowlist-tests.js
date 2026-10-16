// Teste estático: todo `fetch(` em src/ e api/ fora de src/http.js (que tem a guarda de URL) precisa estar nesta lista (arquivo + motivo + quantidade).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const ROOT = new URL('..', import.meta.url).pathname;
const PERMITIDOS = {
  'src/mlauth.js': { n: 1, motivo: 'token OAuth do Mercado Livre (TOKEN_URL fixa)' },
  'src/inbox.js': { n: 1, motivo: 'API do Telegram (host fixo)' },
  'api/_seo.mjs': { n: 1, motivo: 'estado bruto no GitHub (RAW fixa)' },
  'api/pagina.mjs': { n: 1, motivo: 'app.html do próprio host da requisição' },
  'api/_lib/lojas.mjs': { n: 1, motivo: 'fontes de lojas bruto no GitHub (RAW_SOURCES fixa)' },
  'api/_lib/legacy.mjs': { n: 1, motivo: 'fetchJson de URLs derivadas de config' },
  'src/pistas-ofertas.js': { n: 3, motivo: 'fetch injetado (testável): meli.la com assertSafeUrl a cada salto e redirect manual; API do Mercado Livre (host fixo)' },
};

function arquivos(dir) {
  const out = [];
  for (const e of fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = `${dir}/${e.name}`;
    if (e.isDirectory()) out.push(...arquivos(rel));
    else if (/\.(m?js|cjs)$/.test(e.name)) out.push(rel);
  }
  return out;
}

const achados = {};
for (const f of [...arquivos('src'), ...arquivos('api')]) {
  if (f === 'src/http.js') continue;
  const n = fs.readFileSync(path.join(ROOT, f), 'utf8').split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .reduce((s, l) => s + (l.match(/(?<![\w.$])fetch\(/g) || []).length, 0);
  if (n) achados[f] = n;
}

for (const [f, n] of Object.entries(achados)) {
  assert.ok(PERMITIDOS[f], `fetch( novo fora de src/http.js e da lista permitida: ${f} (${n}). Use src/http.js ou registre arquivo e motivo neste teste`);
  assert.ok(n <= PERMITIDOS[f].n, `${f}: ${n} usos de fetch(, permitidos ${PERMITIDOS[f].n}`);
}
for (const f of Object.keys(PERMITIDOS)) assert.ok(achados[f], `${f} não usa mais fetch(: remova da lista permitida`);
console.log('fetch-allowlist-tests ok');
