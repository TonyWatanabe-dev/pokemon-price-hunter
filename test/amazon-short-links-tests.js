// Links curtos da Amazon (SiteStripe, link.amazon) em config/afiliados/amazon.json: um por item, todos distintos,
// só no host link.amazon. O site segue usando `url` (dp/<ASIN>?tag=...); shortUrl é para os bots dos grupos.
import assert from 'node:assert/strict';
import fs from 'node:fs';

const a = JSON.parse(fs.readFileSync(new URL('../config/afiliados/amazon.json', import.meta.url), 'utf8'));
const curtos = a.links.map((l) => l.shortUrl).filter((u) => u != null);
for (const l of a.links) {
  if (l.shortUrl == null) continue;
  assert.match(l.shortUrl, /^https:\/\/link\.amazon\/[A-Za-z0-9]+$/, `${l.asin}: shortUrl fora do formato da SiteStripe`);
  assert.match(l.url, /^https:\/\/www\.amazon\.com\.br\/dp\/[A-Z0-9]{10}\?tag=/, `${l.asin}: o site continua com a URL completa`);
}
assert.equal(new Set(curtos).size, curtos.length, 'nenhum link curto repetido entre produtos');
console.log(`✓ Links curtos da Amazon: ${curtos.length} de ${a.links.length} itens, todos distintos`);
