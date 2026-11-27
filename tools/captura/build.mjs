#!/usr/bin/env node
// Gera a versão de favorito (javascript:…) do botão "Capturar ofertas" a partir de tools/captura/bookmarklet.js.
import fs from 'node:fs';
const src = fs.readFileSync(new URL('./bookmarklet.js', import.meta.url), 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n');
process.stdout.write('javascript:' + encodeURIComponent(src.trim()) + '\n');
