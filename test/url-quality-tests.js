// Qualidade de links e identidade de loja: normalização de domínio, URL canônica, sinais de risco
// e consistência loja x ofertas. Tudo offline: nenhuma URL é aberta.
import assert from 'node:assert/strict';
// Funções únicas do projeto: canonicalizeUrl (#78/#130) e normalizeDomain (diretório de lojas).
import { canonicalizeUrl } from '../src/core/offer-key.js';
import { normalizeDomain } from '../api/_lib/stores.mjs';
import { analyzeOfferLink, storeLinkConsistency } from '../src/url-quality.js';
import * as urlQuality from '../src/url-quality.js';

let n = 0;
const test = async (name, fn) => { try { await fn(); n++; } catch (e) { console.error(`✗ ${name}`); throw e; } };

await test('url-quality não tem canonicalização nem normalizeDomain próprios', () => {
  assert.deepEqual(Object.keys(urlQuality).sort(), ['analyzeOfferLink', 'storeLinkConsistency']);
});

await test('normalizeDomain: www, caixa, porta, ponto final e host solto', () => {
  assert.equal(normalizeDomain('https://WWW.Loja.com.br/p/1?x=1'), 'loja.com.br');
  assert.equal(normalizeDomain('https://loja.com.br:8080/p'), 'loja.com.br');
  // regra da main: "algo:" no início é lido como esquema, então host:porta sem esquema não é domínio
  assert.equal(normalizeDomain('loja.com.br:8080'), null);
  assert.equal(normalizeDomain('www.loja.com.br.'), 'loja.com.br');
  assert.equal(normalizeDomain('shop.loja.com.br'), 'shop.loja.com.br');
});

await test('normalizeDomain: entrada inválida vira null', () => {
  for (const bad of [null, undefined, '', '   ', 'localhost', 'http://', 'https://exa mple.com', 'ftp://loja.com.br', 'javascript:alert(1)']) assert.equal(normalizeDomain(bad), null, String(bad));
});

await test('canonicalizeUrl: tira tracking e hash, preserva original e variante', () => {
  const src = 'https://www.loja.com.br/produto/box/?utm_source=x&variant=123&fbclid=abc&gclid=1#reviews';
  const c = canonicalizeUrl(src);
  assert.equal(c.original, src);
  // regra da main: www sai da canônica (mesma página)
  assert.equal(c.canonical, 'https://loja.com.br/produto/box?variant=123');
  assert.notEqual(c.canonical, c.original);
  assert.deepEqual(c.removed.sort(), ['fbclid', 'gclid', 'utm_source']);
});

await test('canonicalizeUrl: ordem da query não muda a canônica; URL limpa não difere', () => {
  const a = canonicalizeUrl('https://loja.com.br/p?b=2&a=1').canonical;
  const b = canonicalizeUrl('https://loja.com.br/p?a=1&b=2').canonical;
  assert.equal(a, b);
  const clean = canonicalizeUrl('https://loja.com.br/p?a=1');
  assert.equal(clean.canonical, clean.original);
  assert.deepEqual(clean.removed, []);
});

await test('canonicalizeUrl: porta padrão, barra final e host em maiúsculas', () => {
  assert.equal(canonicalizeUrl('HTTPS://Loja.com.br:443/p/').canonical, 'https://loja.com.br/p');
  assert.equal(canonicalizeUrl('https://loja.com.br/').canonical, 'https://loja.com.br');
});

await test('http: canônica em https (chave de deduplicação), original preservada e sinal insecure_http', () => {
  // regra da main: http e https da mesma página são a mesma oferta; o link original não é alterado
  const c = canonicalizeUrl('http://loja.com.br/p');
  assert.equal(c.canonical, 'https://loja.com.br/p');
  assert.equal(c.original, 'http://loja.com.br/p');
  const r = analyzeOfferLink('http://loja.com.br/p', 'loja.com.br');
  assert.equal(r.original, 'http://loja.com.br/p');
  assert.deepEqual(r.issues, ['insecure_http']);
});

await test('URL malformada ou de esquema não web não tem canônica', () => {
  for (const bad of ['', 'não é url', '//loja.com.br/p', 'loja.com.br/p', 'https://']) {
    const c = canonicalizeUrl(bad);
    assert.equal(c.canonical, null, bad); assert.equal(c.valid, false, bad);
    const r = analyzeOfferLink(bad);
    assert.equal(r.canonical, null, bad); assert.deepEqual(r.issues, ['malformed'], bad); assert.equal(r.host, null, bad);
  }
  for (const bad of ['javascript:alert(1)', 'data:text/html,x', 'ftp://loja.com.br/p', 'file:///etc/passwd']) {
    assert.equal(canonicalizeUrl(bad).canonical, null, bad);
    assert.deepEqual(analyzeOfferLink(bad).issues, ['unsupported_scheme'], bad);
  }
  assert.deepEqual(analyzeOfferLink(null, 'loja.com.br').issues, ['malformed']);
});

await test('analyzeOfferLink: link limpo da própria loja (e subdomínio) não tem sinais', () => {
  assert.deepEqual(analyzeOfferLink('https://www.loja.com.br/p/box', 'loja.com.br').issues, []);
  assert.deepEqual(analyzeOfferLink('https://m.loja.com.br/p/box', 'https://www.loja.com.br').issues, []);
  assert.deepEqual(analyzeOfferLink('https://qualquer.com/p', null).issues, [], 'sem domínio da loja nada a comparar');
});

await test('analyzeOfferLink: http, credenciais, IP e punycode', () => {
  assert.ok(analyzeOfferLink('http://loja.com.br/p', 'loja.com.br').issues.includes('insecure_http'));
  assert.ok(analyzeOfferLink('https://user:pw@loja.com.br/p', 'loja.com.br').issues.includes('credentials_in_url'));
  assert.ok(analyzeOfferLink('https://192.168.0.10/p').issues.includes('ip_host'));
  assert.ok(analyzeOfferLink('https://[::1]/p').issues.includes('ip_host'));
  assert.ok(analyzeOfferLink('https://xn--80ak6aa92e.com/p').issues.includes('punycode_host'));
});

await test('analyzeOfferLink: domínios parecidos são sinalizados, subdomínio legítimo não', () => {
  for (const fake of ['https://loja-br.com.br/p', 'https://lojaa.com.br/p', 'https://loja.com/p', 'https://lo-ja.com.br/p']) {
    const i = analyzeOfferLink(fake, 'loja.com.br').issues;
    assert.ok(i.includes('host_mismatch') && i.includes('lookalike_domain'), fake);
  }
  const unrelated = analyzeOfferLink('https://outramarca.com.br/p', 'loja.com.br').issues;
  assert.ok(unrelated.includes('host_mismatch') && !unrelated.includes('lookalike_domain'));
  assert.ok(analyzeOfferLink('https://loja.com.br.evil.com/p', 'loja.com.br').issues.includes('host_mismatch'), 'domínio da loja como prefixo de outro');
});

await test('analyzeOfferLink: parâmetro de redirecionamento para outro host, sem seguir', () => {
  const evil = analyzeOfferLink('https://loja.com.br/out?url=https%3A%2F%2Foutro.com%2Fx', 'loja.com.br');
  assert.ok(evil.issues.includes('redirect_param'));
  const same = analyzeOfferLink('https://loja.com.br/login?next=https%3A%2F%2Fwww.loja.com.br%2Fp', 'loja.com.br');
  assert.ok(!same.issues.includes('redirect_param'));
  const relative = analyzeOfferLink('https://loja.com.br/login?next=%2Fcarrinho', 'loja.com.br');
  assert.ok(!relative.issues.includes('redirect_param'));
});

await test('analyzeOfferLink: tracking sozinho não é problema, só aparece em removed', () => {
  const r = analyzeOfferLink('https://loja.com.br/p?utm_medium=cpc&ref=abc', 'loja.com.br');
  assert.deepEqual(r.issues, []);
  assert.deepEqual(r.removed.sort(), ['ref', 'utm_medium']);
  assert.equal(r.host, 'loja.com.br');
});

await test('storeLinkConsistency: evidência observada, sem inventar confiança', () => {
  const store = { id: 'loja', domain: 'loja.com.br' };
  const ok = [1, 2, 3].map((i) => ({ url: `https://www.loja.com.br/p/${i}?utm_source=x` }));
  assert.equal(storeLinkConsistency(store, ok).verdict, 'consistent');
  assert.equal(storeLinkConsistency(store, ok.slice(0, 2)).verdict, 'insufficient', 'amostra pequena não conclui');
  assert.equal(storeLinkConsistency(store, []).verdict, 'insufficient');
  const mixed = storeLinkConsistency(store, [...ok, { url: 'https://loja-br.com/p/9' }, { url: 'lixo' }]);
  assert.equal(mixed.verdict, 'inconsistent');
  assert.deepEqual([mixed.matching, mixed.other, mixed.invalid, mixed.total], [3, 1, 1, 5]);
  assert.deepEqual(mixed.otherHosts, { 'loja-br.com': 1 });
  assert.equal(storeLinkConsistency({ id: 'x' }, ok).verdict, 'no_domain');
  assert.equal(storeLinkConsistency({ url: 'https://www.loja.com.br' }, ok).verdict, 'consistent', 'usa url se não houver domain');
});

console.log(`url-quality-tests: ${n} ok`);
