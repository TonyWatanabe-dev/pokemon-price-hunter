// Sonda de feeds: resumo de feed RSS/Atom com g:price, workflow só leitura.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resumoFeed, CAMINHOS } from '../tools/sonda-feeds.mjs';

const rss = `<?xml version="1.0"?><rss xmlns:g="http://base.google.com/ns/1.0"><channel>
<item><title>Pokémon TCG Blister Triplo</title><g:price>49.90 BRL</g:price><g:availability>in stock</g:availability></item>
<item><title>Caneca</title><g:price>29.90 BRL</g:price></item><item><title>Sem preço</title></item></channel></rss>`;
assert.deepEqual(resumoFeed(rss), { itens: 3, comPreco: 2, pokemon: 1, comEstoque: 1 });
assert.equal(resumoFeed('<html><body>404</body></html>'), null); assert.equal(resumoFeed('<rss><channel></channel></rss>'), null);
assert.ok(CAMINHOS.every((c) => c.startsWith('/')));
const wf = fs.readFileSync(new URL('../.github/workflows/sonda-feeds.yml', import.meta.url), 'utf8');
assert.match(wf, /permissions:\n  contents: read\n/); assert.doesNotMatch(wf, /\$\{\{\s*secrets\.|git push|contents: write/);
for (const m of wf.matchAll(/uses: ([^\s]+)/g)) assert.match(m[1], /@[0-9a-f]{40}$/);
const tool = fs.readFileSync(new URL('../tools/sonda-feeds.mjs', import.meta.url), 'utf8');
assert.match(tool, /await guard\(url\)/, 'respeita robots.txt'); assert.doesNotMatch(tool, /writeJson|appendJsonl/);
console.log('sonda-feeds-tests: ok');
