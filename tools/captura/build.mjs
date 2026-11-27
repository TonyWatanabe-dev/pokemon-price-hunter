#!/usr/bin/env node
// Gera a versão de favorito (javascript:…) do botão "Capturar ofertas": tools/captura/leitor.js (leitura da página, compartilhada
// com a extensão) + tools/captura/bookmarklet.js (painel), dentro de uma função para não vazar nomes na página do dono.
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

const semComentarios = (nome) => fs.readFileSync(new URL(nome, import.meta.url), 'utf8').split('\n').filter((l) => !/^\s*\/\//.test(l)).join('\n').trim();

export function gerarFavorito() {
  return 'javascript:' + encodeURIComponent('(()=>{\n' + semComentarios('./leitor.js') + '\n' + semComentarios('./bookmarklet.js') + '\n})();');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.stdout.write(gerarFavorito() + '\n');
