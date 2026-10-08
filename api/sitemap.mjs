// /sitemap.xml: páginas públicas, coleções, formatos e todos os produtos com endereço amigável.
import { state, slugs, SITE, colSlug, typeSlug } from './_seo.mjs';
export default async function handler(req, res) {
  let urls = [['', 'hourly', '1.0'], ['oportunidades', 'hourly', '0.9'], ['produtos', 'hourly', '0.9'], ['precos', 'daily', '0.8'], ['pre-vendas', 'daily', '0.7'], ['como-funciona', 'monthly', '0.4']].map(([p, f, pr]) => [`${SITE}/${p}`, f, pr]);
  let lastmod = new Date().toISOString().slice(0, 10);
  try {
    const s = await state(); lastmod = String(s.generatedAt || '').slice(0, 10) || lastmod; const { of } = slugs(s.products || []);
    const prods = (s.products || []).filter((p) => p.offerCount > 0);
    urls = urls.concat((s.collections || []).filter((c) => prods.some((p) => p.collection === c.id)).map((c) => [`${SITE}/colecao/${colSlug(c)}`, 'daily', '0.8']));
    urls = urls.concat((s.types || []).filter((t) => prods.some((p) => p.type === t.id)).map((t) => [`${SITE}/tipo/${typeSlug(t)}`, 'daily', '0.8']));
    urls = urls.concat(prods.map((p) => [`${SITE}/produto/${of[p.id]}`, 'daily', '0.7']));
  } catch { /* só as páginas fixas */ }
  res.setHeader('content-type', 'application/xml; charset=utf-8');
  res.setHeader('cache-control', 'public, max-age=0, s-maxage=3600');
  res.end(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map(([u, f, pr]) => `<url><loc>${u}</loc><lastmod>${lastmod}</lastmod><changefreq>${f}</changefreq><priority>${pr}</priority></url>`).join('\n')}\n</urlset>\n`);
}
