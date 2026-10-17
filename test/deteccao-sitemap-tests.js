// Detecção do leitor genérico: home sem "Pokémon" ainda vale se o sitemap tiver produto Pokémon lacrado.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const src = fs.readFileSync(new URL('../src/adapters/jsonld.js', import.meta.url), 'utf8');
const det = src.slice(src.indexOf('export async function detect'), src.indexOf('export function transientPageError'));
assert.match(det, /if \(\/pok\[eé\]mon\/i\.test\(html\)\) return true;/, 'home com Pokémon continua bastando');
assert.match(det, /return \(await productUrls\(base, 5\)\)\.length > 0;/, 'sem Pokémon na home: sitemap decide');
assert.match(det, /if \(e\.blocked\) throw e;[\s\S]*if \(e\.blocked\) throw e;/, 'bloqueio (robots/403) continua subindo nos dois passos');
console.log('deteccao-sitemap-tests: ok');
