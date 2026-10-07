// /sitemap.xml: páginas públicas e todos os produtos com endereço amigável.
import { state, slugs, SITE } from './_seo.mjs';
export default async function handler(req, res) {
  let urls = ['', 'oportunidades', 'precos', 'pre-vendas', 'lojas', 'como-funciona'].map((p) => `${SITE}/${p}`);
  try { const s = await state(); const { of } = slugs(s.products || []); urls = urls.concat(Object.values(of).map((x) => `${SITE}/produto/${x}`)); } catch { /* só as páginas fixas */ }
  res.setHeader('content-type', 'application/xml; charset=utf-8');
  res.setHeader('cache-control', 'public, max-age=0, s-maxage=3600');
  res.end(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `<url><loc>${u}</loc></url>`).join('\n')}\n</urlset>\n`);
}
