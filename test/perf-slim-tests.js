// Lote F passo 2: CSS e JS grandes saem da casca por arquivo com hash; build e SSR geram o mesmo nome.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { slim, MIN_BYTES } from '../api/_lib/slim.mjs';
import { main } from '../tools/build-slim.mjs';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const r = slim(html);
assert.equal(r.arquivos.length, 2, 'CSS e JS principal extraídos');
const css = r.arquivos.find((f) => f.nome.endsWith('.css')); const js = r.arquivos.find((f) => f.nome.endsWith('.js'));
assert.match(css.nome, /^app-[0-9a-f]{12}\.css$/); assert.match(js.nome, /^app-[0-9a-f]{12}\.js$/);
assert.ok(r.html.length < 60 * 1024, `casca enxuta: ${Math.round(r.html.length / 1024)} KB`);
// volta exatamente ao original trocando as referências pelo conteúdo
const volta = r.html.replace(`<link rel="stylesheet" href="/assets/web/${css.nome}">`, () => `<style>\n${css.conteudo}</style>`)
  .replace(`<script src="/assets/web/${js.nome}"></script>`, () => `<script>\n${js.conteudo}</script>`);
assert.equal(volta, html, 'nada além das duas trocas');
// determinístico e idempotente (SSR reaplica sobre o app.html já enxuto)
assert.deepEqual(slim(html).arquivos.map((f) => f.nome), r.arquivos.map((f) => f.nome));
assert.equal(slim(r.html).html, r.html); assert.equal(slim(r.html).arquivos.length, 0);
// casca do SSR continua válida (api/pagina.mjs: isShell)
for (const k of ['<div id="view"></div>', 'id="main"', 'TCG Price Hunter', '</head>']) assert.ok(r.html.includes(k), k);
// bloco pequeno fica inline
assert.equal(slim('<style>\na{}</style><script>\n"use strict";x()</script>').arquivos.length, 0);
assert.ok(MIN_BYTES >= 1024);
// build grava os arquivos e o app.html
const out = fs.mkdtempSync(path.join(os.tmpdir(), 'slim-'));
assert.equal(main(['--saida', out], () => {}), 0);
assert.equal(fs.readFileSync(path.join(out, 'app.html'), 'utf8'), r.html);
assert.equal(fs.readFileSync(path.join(out, 'assets/web', js.nome), 'utf8'), js.conteudo);
// cache imutável cobre /assets/web
const h = JSON.parse(fs.readFileSync(new URL('../vercel.json', import.meta.url), 'utf8')).headers.find((x) => x.source === '/assets/web/(.*)');
assert.ok(h, 'header de cache de /assets/web');
console.log('perf-slim-tests ok');
