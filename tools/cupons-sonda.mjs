#!/usr/bin/env node
// Sonda descartável (#690, cupons): mede como cada site de cupons expõe os cupons do Mercado Livre, sem guardar nada.
// Respeita robots.txt (User-agent *). Emite ::notice:: para leitura via API de anotações.
const UA = 'Mozilla/5.0 (compatible; TCGPriceHunterBot/1.0; +https://tcg-price-hunter.vercel.app)';
const ALVOS = [
  'https://www.cuponomia.com.br/desconto/mercado-livre',
  'https://www.pelando.com.br/cupons-de-descontos/mercado-livre',
  'https://www.meliuz.com.br/desconto/cupom-mercado-livre',
  'https://www.promobit.com.br/cupons/loja/mercado-livre/',
  'https://www.melhorescartoes.com.br/tag/mercado-livre',
  'https://passageirodeprimeira.com/tag/mercado-livre/',
  'https://www.mercadolivre.com.br/cupons',
];
const nota = (s) => console.log(`::notice::${s.replace(/\n/g, ' ').slice(0, 900)}`);
async function bloqueado(u) {
  const { origin, pathname } = new URL(u);
  try {
    const r = await fetch(`${origin}/robots.txt`, { headers: { 'User-Agent': UA }, signal: AbortSignal.timeout(15000) });
    if (!r.ok) return false;
    let ativo = false; const dis = [];
    for (const l of (await r.text()).split('\n')) {
      const [k, ...v] = l.split(':'); const val = v.join(':').trim();
      if (/^user-agent$/i.test(k.trim())) ativo = val === '*';
      else if (ativo && /^disallow$/i.test(k.trim()) && val) dis.push(val);
    }
    return dis.find((d) => pathname.startsWith(d.replace(/\*.*$/, ''))) || false;
  } catch { return false; }
}
for (const u of ALVOS) {
  const host = new URL(u).host;
  const b = await bloqueado(u);
  if (b) { nota(`${host} | robots BLOQUEIA (${b})`); continue; }
  try {
    const r = await fetch(u, { headers: { 'User-Agent': UA, Accept: 'text/html' }, signal: AbortSignal.timeout(20000) });
    const h = await r.text();
    const codigos = [...new Set([...h.matchAll(/(?:c[óo]digo|cupom)[^A-Z0-9]{1,40}([A-Z][A-Z0-9]{4,19})\b/g)].map((m) => m[1]))].slice(0, 8);
    const validade = [...h.matchAll(/(?:v[áa]lid[oa]|expira|termina)[^<]{0,30}?(\d{1,2}\/\d{1,2}(?:\/\d{2,4})?)/gi)].length;
    const ld = (h.match(/application\/ld\+json/g) || []).length;
    nota(`${host} | HTTP ${r.status} | ${h.length}b | next=${h.includes('__NEXT_DATA__')} ld=${ld} | menções cupom=${(h.match(/cupom/gi) || []).length} | datas validade=${validade} | códigos: ${codigos.join(',') || '-'}`);
  } catch (e) { nota(`${host} | ERRO ${String(e.message || e).slice(0, 120)}`); }
  await new Promise((r) => setTimeout(r, 2000));
}
