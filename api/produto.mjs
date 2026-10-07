// /produto/<slug>: devolve a mesma página do site, com título, descrição, prévia (Open Graph) e dados estruturados do produto.
import { state, slugs, label, live, SITE } from './_seo.mjs';
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const brl = (v) => v == null ? '' : 'R$ ' + v.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
let page = { t: 0, html: null };
export default async function handler(req, res) {
  const slug = decodeURIComponent(new URL(req.url, SITE).searchParams.get('slug') || '');
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  if (!page.html || Date.now() - page.t > 10 * 60e3) { const r = await fetch(`https://${host}/index.html`); page = { t: Date.now(), html: await r.text() }; }
  let html = page.html; let status = 200;
  try {
    const s = await state(); const { by, of } = slugs(s.products || []);
    const p = (s.products || []).find((x) => x.id === (by[slug] || slug));
    if (!p) status = 404;
    else {
      const offers = (s.offers || []).filter((o) => o.productId === p.id && live(o)).sort((a, b) => a.total - b.total);
      const best = offers[0]; const name = `${p.collectionName} ${label(p)}`;
      const url = `${SITE}/produto/${of[p.id]}`;
      const title = `${name}${best ? ` por ${brl(best.total)}` : ''} | TCG Price Hunter`;
      const desc = best
        ? `${name} (Pokémon TCG lacrado, Copag): menor preço ${brl(best.total)} em ${best.storeName}${p.copagConfirmed && best.discount > 0 ? `, ${(best.discount * 100).toFixed(1).replace('.', ',')}% abaixo do preço sugerido Copag (${brl(p.msrp)})` : ''}. Compare ${offers.length} ${offers.length === 1 ? 'loja' : 'lojas'} com estoque confirmado.`
        : `${name} (Pokémon TCG lacrado, Copag): compare preços nas lojas do Brasil com o preço sugerido oficial da Copag${p.copagConfirmed ? ` (${brl(p.msrp)})` : ''}.`;
      const img = best?.image || p.image || `${SITE}/og.jpg`;
      const ean = [p.ean, ...offers.map((o) => o.ean)].find((x) => /^\d{13}$/.test(String(x || '')));
      const ld = { '@context': 'https://schema.org', '@type': 'Product', name, image: img, description: desc, sku: p.id, category: p.typeLabel, brand: { '@type': 'Brand', name: 'Pokémon TCG' }, ...(ean ? { gtin13: ean } : {}),
        offers: offers.length ? { '@type': 'AggregateOffer', priceCurrency: 'BRL', lowPrice: offers[0].total, highPrice: offers[offers.length - 1].total, offerCount: offers.length, availability: 'https://schema.org/InStock' } : undefined };
      html = html
        .replace(/<title>[^<]*<\/title>/, `<title>${esc(title)}</title>`)
        .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${esc(desc)}">`)
        .replace(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${esc(title)}">`)
        .replace(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${esc(desc)}">`)
        .replace(/<meta property="og:image" content="[^"]*">/, `<meta property="og:image" content="${esc(img)}">`)
        .replace(/<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${esc(url)}">`)
        .replace('</head>', `<link rel="canonical" href="${esc(url)}">\n<script type="application/ld+json">${JSON.stringify(ld).replace(/</g, '\\u003c')}</script>\n</head>`);
    }
  } catch { /* sem dados: devolve a página normal, o site carrega sozinho */ }
  res.statusCode = status;
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.setHeader('cache-control', 'public, max-age=0, s-maxage=600, stale-while-revalidate=3600');
  res.end(html);
}
