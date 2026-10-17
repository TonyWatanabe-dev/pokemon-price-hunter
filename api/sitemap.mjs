// /sitemap.xml: páginas públicas, coleções, formatos e todos os produtos com endereço amigável.
import { state, slugs, SITE, colSlug, typeSlug, bestBy } from './_seo.mjs';
import { classify, usable, stateDataAt } from './_lib/freshness.mjs';
export default async function handler(req, res) {
  const fixed = [['', 'hourly', '1.0'], ['oportunidades', 'hourly', '0.9'], ['precos', 'daily', '0.8'], ['pre-vendas', 'daily', '0.7'], ['lojas', 'daily', '0.6'], ['comunidade', 'monthly', '0.5'], ['como-funciona', 'monthly', '0.4'], ['guia/glossario', 'monthly', '0.4'], ['termos', 'monthly', '0.3'], ['privacidade', 'monthly', '0.3']].map(([p, f, pr]) => [`${SITE}/${p}`, f, pr]);
  // Sem dados utilizáveis, a Home mantém canonical/indexabilidade; as demais páginas ficam noindex em pagina.mjs.
  // Não liste no sitemap URLs que a própria página pede para remover do índice.
  let urls = [fixed[0]];
  let lastmod = new Date().toISOString().slice(0, 10);
  let stale = true;
  try {
    const s = await state();
    // Dados antigos: só as páginas fixas (nada de produto/coleção/formato que possa estar desatualizado).
    if (!usable(classify(stateDataAt(s)))) throw new Error('dados desatualizados');
    stale = false;
    urls = fixed;
    lastmod = String(s.generatedAt || '').slice(0, 10) || lastmod; const { of } = slugs(s.products || []);
    const { by: best, n: inStock } = bestBy(s);
    const prods = (s.products || []).filter((p) => p.offerCount > 0);
    // lastmod do produto = última conferência da melhor oferta (source_timestamp/lastValid/firstSeen); sem data válida, o generatedAt.
    // Coleção e formato = a data mais recente entre os seus produtos.
    const iso = (v) => { const t = Date.parse(v || ''); return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : ''; };
    const pmod = (p) => { const o = best[p.id]; return (o && (iso(o.source_timestamp) || iso(o.lastValid?.at) || iso(o.firstSeen))) || lastmod; };
    const maxmod = (list) => list.map(pmod).sort().pop() || lastmod;
    urls = urls.concat((s.collections || []).filter((c) => prods.some((p) => p.collection === c.id)).map((c) => [`${SITE}/colecao/${colSlug(c)}`, 'daily', '0.8', maxmod(prods.filter((p) => p.collection === c.id))]));
    const types = (s.types || []).filter((t) => prods.some((p) => p.type === t.id));
    urls = urls.concat(types.map((t) => [`${SITE}/tipo/${typeSlug(t)}`, 'daily', '0.8', maxmod(prods.filter((p) => p.type === t.id))]));
    // Lote E: /tipo/blister (página que reúne os formatos de blister), só quando há algum deles com produto.
    const bl = types.filter((t) => t.group === 'Blisters' || /^blister/i.test(String(t.id)));
    if (bl.length && !types.some((t) => typeSlug(t) === 'blister')) urls.push([`${SITE}/tipo/blister`, 'daily', '0.8', maxmod(prods.filter((p) => bl.some((t) => t.id === p.type)))]);
    // Produto sem oferta com estoque sai com noindex em /api/pagina: não entra no sitemap.
    urls = urls.concat(prods.filter((p) => inStock[p.id] > 0).map((p) => [`${SITE}/produto/${of[p.id]}`, 'daily', '0.7', pmod(p)]));
  } catch (e) {
    // Dados desatualizados não é erro; qualquer outra exceção depois da checagem é inesperada e fica no log.
    if (!stale) console.error(`sitemap: erro inesperado: ${String(e?.message || e).slice(0, 200)}`);
    /* só as páginas fixas */
  }
  res.setHeader('content-type', 'application/xml; charset=utf-8');
  res.setHeader('cache-control', 'public, max-age=0, s-maxage=3600');
  res.end(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(([u, f, pr, lm]) => `<url><loc>${u}</loc><lastmod>${lm || lastmod}</lastmod><changefreq>${f}</changefreq><priority>${pr}</priority></url>`).join('\n')}\n</urlset>\n`);
}
