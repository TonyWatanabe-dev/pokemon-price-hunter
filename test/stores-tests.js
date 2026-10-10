// Diretório de lojas (api/_lib/stores.mjs): domínio normalizado, HTTPS, loja sem oferta × sem dados recentes, dados desatualizados.
import assert from 'node:assert/strict';
import { normalizeDomain, safeUrl, siteStores, RECENT_HOURS } from '../api/_lib/stores.mjs';

const now = Date.parse('2026-10-10T12:00:00.000Z'); const T = (h) => new Date(now - h * 3600e3).toISOString();

// domínio normalizado
assert.equal(normalizeDomain('https://WWW.Loja.com.br/produto?x=1'), 'loja.com.br');
assert.equal(normalizeDomain('http://loja.com.br:8080/'), 'loja.com.br');
assert.equal(normalizeDomain('loja.com.br'), 'loja.com.br', 'domínio sem esquema');
assert.equal(normalizeDomain('https://loja.com.br./x'), 'loja.com.br', 'ponto final removido');
for (const bad of [null, undefined, '', '   ', 'javascript:alert(1)', 'ftp://x.com', 'localhost', 'https://']) assert.equal(normalizeDomain(bad), null, `inválido: ${bad}`);

// URL segura: só http/https; http sobe para https só com evidência do mesmo domínio em https
assert.equal(safeUrl('javascript:alert(1)'), null);
assert.equal(safeUrl('not a url'), null);
assert.equal(safeUrl(undefined), null);
assert.equal(safeUrl('http://a.com.br/x', new Set(['a.com.br'])), 'https://a.com.br/x');
assert.equal(safeUrl('http://b.com.br/x', new Set(['a.com.br'])), 'http://b.com.br/x', 'sem evidência de HTTPS, o endereço não é alterado');
assert.equal(safeUrl('https://a.com.br/x'), 'https://a.com.br/x');

const offer = (id, storeId, extra = {}) => ({ id, productId: 'p', storeId, storeName: storeId.toUpperCase(), url: `https://${storeId}.com.br/p`, total: 100, stock: 'IN_STOCK', stale: false, anomalous: false, source_timestamp: T(1), ...extra });
const st = {
  sources: [
    { id: 'a', name: 'Loja A', url: 'http://www.a.com.br' },          // http, mas a oferta da mesma loja usa https
    { id: 'b', name: 'Loja B', url: 'https://b.com.br' },             // só ofertas velhas
    { id: 'c', name: 'Loja C', url: 'https://c.com.br' },             // sem ofertas
    { id: 'd', name: 'Loja D', url: 'javascript:alert(1)' },          // link inválido
  ],
  offers: [
    offer('a1', 'a'), offer('a2', 'a', { stock: 'OUT_OF_STOCK', source_timestamp: T(2) }),
    offer('b1', 'b', { source_timestamp: T(RECENT_HOURS + 5) }), offer('b2', 'b', { stale: true }),
    offer('e1', 'e'),                                                 // loja só nas ofertas, sem cadastro em sources
  ],
};
const { items, total } = siteStores(st, { now });
const by = Object.fromEntries(items.map((s) => [s.id, s]));
assert.equal(total, 5);

assert.equal(by.a.domain, 'a.com.br'); assert.equal(by.a.url, 'https://www.a.com.br/', 'http do cadastro sobe para https (a oferta confirma HTTPS no domínio)');
assert.equal(by.a.status, 'com_ofertas'); assert.equal(by.a.offers, 2); assert.equal(by.a.activeOffers, 2); assert.equal(by.a.inStockOffers, 1);
assert.equal(by.a.updatedAt, T(1));

// dados desatualizados ≠ sem ofertas
assert.equal(by.b.status, 'sem_dados_recentes'); assert.equal(by.b.offers, 2); assert.equal(by.b.activeOffers, 0); assert.equal(by.b.inStockOffers, 0);
assert.equal(by.b.updatedAt, T(1), 'última atualização é a leitura mais recente, mesmo marcada stale');
assert.equal(by.c.status, 'sem_ofertas'); assert.equal(by.c.offers, 0); assert.equal(by.c.updatedAt, null, 'sem oferta, sem data inventada');

// link inválido não quebra: sem domínio e sem url
assert.equal(by.d.url, null); assert.equal(by.d.domain, null); assert.equal(by.d.status, 'sem_ofertas');

// loja só com ofertas: domínio vem da própria oferta
assert.equal(by.e.domain, 'e.com.br'); assert.equal(by.e.url, 'https://e.com.br/');

// nada de reputação/nota/ranking de confiabilidade na resposta
const keys = new Set(items.flatMap((s) => Object.keys(s)));
assert.deepEqual([...keys].filter((k) => /rep|score|nota|rank|trust|confi/i.test(k)), []);

// ordem: mais ofertas ativas primeiro, depois nome
assert.deepEqual(items.map((s) => s.id), ['a', 'e', 'b', 'c', 'd']);

// estado vazio
assert.deepEqual(siteStores({}, { now }), { items: [], total: 0 });

console.log('  diretório de lojas: ok');
