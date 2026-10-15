// Issue #84 — cálculo de frete por CEP. O núcleo mora em api/_lib/shipping-calc.mjs (vai no pacote da função da
// Vercel; src/ não vai) e é reexportado aqui. Este arquivo acrescenta só a cotação pelo cliente HTTP do robô
// (request() de src/http.js), para uso fora da API (robô, scripts e testes).
import { request } from './http.js';
import { assertSafeUrl } from './urlguard.js';
import { guard } from './adapters/common.js';

export * from '../api/_lib/shipping-calc.mjs';

// Cotação real na VTEX (orderForms/simulation), pelo cliente HTTP da main. `target` vem do servidor (resolveOffer).
// assertSafeUrl na base e na URL final (request() repete a guarda a cada redirecionamento) e robots.txt (guard).
export async function vtexFetchQuote({ base, itemId, sellerId, quantity, cep }, { timeout = 8000, robots = guard } = {}) {
  const origin = assertSafeUrl(base).origin;
  const url = assertSafeUrl(`${origin}/api/checkout/pub/orderForms/simulation?sc=1`).href;
  await robots(url);
  const r = await request(url, { method: 'POST', accept: 'application/json', timeout, headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ items: [{ id: String(itemId), quantity, seller: String(sellerId ?? '1') }], postalCode: cep, country: 'BRA' }) });
  return r.json();
}
