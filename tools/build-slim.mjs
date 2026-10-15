#!/usr/bin/env node
// Build (Lote F): gera public/assets/web/app-<hash>.css/.js e o public/app.html enxuto a partir do index.html.
// Uso: node tools/build-slim.mjs [--entrada index.html] [--saida public]
import fs from 'node:fs';
import path from 'node:path';
import { slim } from '../api/_lib/slim.mjs';

export function main(argv = process.argv.slice(2), log = console.log) {
  const a = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
  const entrada = a('--entrada', 'index.html'); const saida = a('--saida', 'public');
  const html = fs.readFileSync(entrada, 'utf8');
  const r = slim(html);
  fs.mkdirSync(path.join(saida, 'assets', 'web'), { recursive: true });
  for (const f of r.arquivos) fs.writeFileSync(path.join(saida, 'assets', 'web', f.nome), f.conteudo);
  fs.writeFileSync(path.join(saida, 'app.html'), r.html);
  log(`app.html ${Math.round(html.length / 1024)} KB → ${Math.round(r.html.length / 1024)} KB; ${r.arquivos.map((f) => `${f.nome} ${Math.round(f.conteudo.length / 1024)} KB`).join(', ') || 'nada a extrair'}`);
  return 0;
}
if (process.argv[1]?.endsWith('build-slim.mjs')) process.exitCode = main();
