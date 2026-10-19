// Bloco "Compare também na Liga Pokémon" retirado a pedido do dono (19/10/2026): nada da Liga na página do produto.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
assert.ok(!/ligaBlock|links-liga\.json|pp-liga/.test(html), 'sem bloco da Liga no site');
const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url)));
assert.ok(!/links-liga/.test(pkg.scripts.build), 'build não publica links da Liga');
console.log('sem-liga-tests ok');
