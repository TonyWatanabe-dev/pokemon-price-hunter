// copagCheck com fetch simulado (http.setFetch): sem rede; config/ temporário. Cobre cada status do relatório.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
process.env.HUNTER_DOMAIN_DELAY_MS = '0';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'copag-check-'));
process.env.HUNTER_CONFIG_DIR = tmp;
const http = await import('../src/http.js');
const { copagCheck } = await import('../src/copag-check.js');

let n = 0;
async function t(name, fn) { try { await fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } }
const page = (price) => `<html><head><title>Box Pokémon</title><script type="application/ld+json">${JSON.stringify({ '@context': 'https://schema.org', '@type': 'Product', name: 'Box Pokémon', url: '/produto/p', offers: price == null ? {} : { '@type': 'Offer', price, priceCurrency: 'BRL', availability: 'https://schema.org/InStock' } })}</script></head><body><h1>Box Pokémon</h1>${price == null ? '' : `<p>R$ ${String(price).replace('.', ',')}</p>`}</body></html>`;
const U = (h) => `https://${h}.copagloja.com.br/produto/p`;
const body = { 'ok.copagloja.com.br': page('399.99'), 'div.copagloja.com.br': page('429.90'), 'vazio.copagloja.com.br': page(null) };
const hits = [];
http.setFetch(async (url) => {
  const host = new URL(url).host; hits.push(host);
  if (host === 'off.copagloja.com.br') return { ok: false, status: 503, headers: new Map(), text: async () => 'indisponível' };
  return { ok: true, status: 200, headers: new Map(), text: async () => body[host] ?? '' };
});
const file = path.join(tmp, 'catalog.json');
const copag = {
  ok: { msrp: 399.99, source_url: U('ok'), confidence: 'OFICIAL' },
  div: { msrp: 399.99, source_url: U('div'), confidence: 'OFICIAL' },
  vazio: { msrp: 399.99, source_url: U('vazio'), confidence: 'OFICIAL' },
  off: { msrp: 399.99, source_url: U('off'), confidence: 'OFICIAL' },
  man: { msrp: 299.9, source_url: U('man'), confidence: 'OFICIAL', manual: true },
  cat: { msrp: 199.9, source_url: U('cat'), confidence: 'CATALOGO_COPAG' },
  semfonte: { msrp: 100, confidence: 'OFICIAL' },
};
fs.writeFileSync(file, JSON.stringify({ copag }));
const logs = [];
const report = await copagCheck({ log: (l) => logs.push(l) });
const by = Object.fromEntries(report.map((r) => [r.id, r]));
const saved = JSON.parse(fs.readFileSync(file, 'utf8')).copag;

await t('1. página igual ao cadastro: OK e last_check com matches', () => {
  assert.deepEqual([by.ok.status, by.ok.msrp, by.ok.pagePrice], ['OK', 399.99, 399.99]);
  assert.equal(saved.ok.last_check.matches, true); assert.equal(saved.ok.last_check.pagePrice, 399.99);
});
await t('2. página divergente: REVISAR, msrp oficial intacto', () => {
  assert.deepEqual([by.div.status, by.div.pagePrice], ['REVISAR', 429.9]);
  assert.equal(saved.div.msrp, 399.99); assert.equal(saved.div.last_check.matches, false);
});
await t('3. seen === null: REVISAR sem preço, igual a divergência (comportamento atual)', () => {
  assert.equal(by.vazio.status, 'REVISAR'); assert.equal(by.vazio.pagePrice, null);
  assert.equal(saved.vazio.last_check.pagePrice, null); assert.equal(saved.vazio.last_check.matches, false);
});
await t('4. fonte indisponível: FONTE INDISPONÍVEL com erro, sem last_check', () => {
  assert.equal(by.off.status, 'FONTE INDISPONÍVEL'); assert.ok(by.off.error);
  assert.equal(saved.off.last_check, undefined);
});
await t('5. manual: MANUAL sem buscar a fonte', () => {
  assert.deepEqual([by.man.status, by.man.msrp], ['MANUAL', 299.9]);
  assert.ok(!hits.some((h) => h.startsWith('man.')));
});
await t('6. catálogo de terceiros e sem fonte: CATÁLOGO / NÃO CONFIRMADO, sem busca', () => {
  assert.equal(by.cat.status, 'NÃO CONFIRMADO'); assert.equal(by.semfonte.status, 'NÃO CONFIRMADO');
  assert.ok(!hits.some((h) => h.startsWith('cat.')));
});
await t('7. log: linha por status (sem NÃO CONFIRMADO) e contagem final', () => {
  assert.ok(logs.some((l) => l.startsWith('div: REVISAR (página 429.9 × cadastro 399.99)')));
  assert.ok(logs.some((l) => l === 'man: MANUAL'));
  assert.ok(!logs.some((l) => l.startsWith('cat:')));
  assert.equal(logs.at(-1), '2 produtos sem preço Copag confirmado.');
});
await t('8. relatório cobre todos os produtos e catalog.json é regravado', () => {
  assert.equal(report.length, 7); assert.equal(saved.man.manual, true);
});
fs.rmSync(tmp, { recursive: true, force: true });
console.log(`copag-check-tests: ${n} ok`);
