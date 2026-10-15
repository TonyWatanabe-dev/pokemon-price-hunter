#!/usr/bin/env node
// Sonda descartável (#690, cupons) — 2ª rodada: estrutura dos cupons no Promobit (__NEXT_DATA__) e no Cuponomia.
const UA = 'Mozilla/5.0 (compatible; TCGPriceHunterBot/1.0; +https://tcg-price-hunter.vercel.app)';
const nota = (s) => console.log(`::notice::${s.replace(/\n/g, ' ').slice(0, 1800)}`);
const get = async (u) => (await fetch(u, { headers: { 'User-Agent': UA, Accept: 'text/html' }, signal: AbortSignal.timeout(20000) })).text();
// Promobit
const h = await get('https://www.promobit.com.br/cupons/loja/mercado-livre/');
const m = h.match(/<script id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/);
const d = JSON.parse(m[1]);
const achados = [];
(function andar(o, cam) {
  if (Array.isArray(o)) { if (o.length && typeof o[0] === 'object' && o[0] && JSON.stringify(o[0]).match(/coupon|cupom|code/i)) achados.push([cam, o]); o.forEach((x, i) => i < 3 && andar(x, `${cam}[${i}]`)); return; }
  if (o && typeof o === 'object') for (const [k, v] of Object.entries(o)) andar(v, `${cam}.${k}`);
})(d, '');
nota(`promobit arrays: ${achados.map(([c, a]) => `${c}(${a.length})`).join(' ; ').slice(0, 1500)}`);
for (const [c, a] of achados.slice(0, 3)) nota(`promobit ${c} item0: ${JSON.stringify(a[0])}`);
// Cuponomia
const c = await get('https://www.cuponomia.com.br/desconto/mercado-livre');
const i = c.search(/data-[a-z-]*(code|coupon|cupom)/i);
nota(`cuponomia attrs: ${[...new Set([...c.matchAll(/data-([a-z-]+)=/gi)].map((x) => x[1]))].join(',').slice(0, 800)}`);
nota(`cuponomia trecho: ${c.slice(Math.max(0, i - 300), i + 900).replace(/\s+/g, ' ')}`);
