import fs from 'node:fs';
import path from 'node:path';
// Todas as páginas públicas passam por aqui: a mesma página do site, já com título, descrição, endereço canônico,
// prévia de compartilhamento, dados estruturados e o conteúdo principal em HTML (para buscadores e prévias que não rodam JavaScript).
// O site carrega por cima e substitui esse conteúdo pela versão interativa.
import { state, slugs, label, live, SITE, colSlug, typeSlug, esc, brl, pct, bestBy, pix } from './_seo.mjs';

let page = { t: 0, html: null };
const isShell = (h) => typeof h === 'string' && h.includes('<div id="view"></div>') && h.includes('id="main"') && h.includes('TCG Price Hunter');
const shell = (h) => (isShell(h) ? h : null);
function readLocal() {
  for (const f of [path.join(process.cwd(), 'index.html'), path.join(process.cwd(), 'public', 'app.html')]) {
    try { return fs.readFileSync(f, 'utf8'); } catch {}
  }
  return null;
}
const NAME = 'TCG Price Hunter';
const ld = (o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>`;
const crumbs = (items) => ({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: items.map(([n, u], i) => ({ '@type': 'ListItem', position: i + 1, name: n, item: SITE + u })) });
const bc = (items) => `<nav class="ssr-bc" aria-label="Caminho">${items.map(([n, u], i) => (i < items.length - 1 ? `<a href="${u}">${esc(n)}</a>` : `<span>${esc(n)}</span>`)).join(' › ')}</nav>`;

function prodRow(p, o, of, extra = '') {
  return `<li><a href="/produto/${of[p.id]}">${esc(p.collectionName)} · ${esc(label(p))}</a>${o ? ` — <b>${brl(o.total)}${pix(o)}</b> em ${esc(o.storeName)}` : ' — sem estoque agora'}${p.copagConfirmed && p.msrp ? ` · Copag ${brl(p.msrp)}` : ''}${extra}</li>`;
}

function build(t, slug, s) {
  const { by: SL, of } = slugs(s.products || []);
  const { by: best, n } = bestBy(s);
  const prods = (s.products || []).filter((p) => p.offerCount > 0);
  const cols = (s.collections || []).filter((c) => prods.some((p) => p.collection === c.id));
  const types = (s.types || []).filter((ty) => prods.some((p) => p.type === ty.id));
  const sortP = (a, b) => ((best[b.id] ? 1 : 0) - (best[a.id] ? 1 : 0)) || ((best[b.id]?.discount ?? -9) - (best[a.id]?.discount ?? -9));
  const navLinks = `<h2>Coleções</h2><ul class="ssr-links">${cols.map((c) => `<li><a href="/colecao/${colSlug(c)}">${esc(c.name)}</a></li>`).join('')}</ul><h2>Formatos</h2><ul class="ssr-links">${types.map((ty) => `<li><a href="/tipo/${typeSlug(ty)}">${esc(ty.label)}</a></li>`).join('')}</ul>`;
  const opps = (s.offers || []).filter((o) => live(o) && o.dealScore != null && o.discount > 0 && o.confirmed !== false).sort((a, b) => b.dealScore - a.dealScore);
  const seen = new Set(); const topOpp = opps.filter((o) => !seen.has(o.productId) && seen.add(o.productId)).slice(0, 12);
  const P = Object.fromEntries((s.products || []).map((p) => [p.id, p]));

  if (t === 'produto') {
    const p = (s.products || []).find((x) => x.id === (SL[slug] || slug));
    if (!p) return null;
    const offers = (s.offers || []).filter((o) => o.productId === p.id && live(o)).sort((a, b) => a.total - b.total);
    const b0 = offers[0]; const name = `${label(p)} ${p.collectionName}`;
    const col = (s.collections || []).find((c) => c.id === p.collection); const ty = (s.types || []).find((x) => x.id === p.type);
    const url = `/produto/${of[p.id]}`;
    const title = `${name} Pokémon TCG${b0 ? `: a partir de ${brl(b0.total)}${pix(b0)}` : ': preço e lojas'} | ${NAME}`;
    const desc = b0
      ? `${name} (Pokémon TCG lacrado, Copag): menor preço ${brl(b0.total)}${pix(b0)} em ${b0.storeName}${p.copagConfirmed && b0.discount > 0 ? `, ${pct(b0.discount)} abaixo do preço sugerido Copag (${brl(p.msrp)})` : ''}. Compare ${offers.length} ${offers.length === 1 ? 'loja' : 'lojas'} com estoque.`
      : `${name} (Pokémon TCG lacrado, Copag): preço sugerido${p.copagConfirmed ? ` ${brl(p.msrp)}` : ''}, histórico e lojas que vendem no Brasil.`;
    const img = b0?.image || p.image || `${SITE}/og.jpg`;
    const ean = [p.ean, ...offers.map((o) => o.ean)].find((x) => /^\d{13}$/.test(String(x || '')));
    const trail = [['Início', '/'], ...(col ? [[col.name, `/colecao/${colSlug(col)}`]] : []), ...(ty ? [[ty.label, `/tipo/${typeSlug(ty)}`]] : []), [label(p), url]];
    const json = [{ '@context': 'https://schema.org', '@type': 'Product', name, image: img, description: desc, sku: p.id, category: p.typeLabel, brand: { '@type': 'Brand', name: 'Pokémon TCG' }, ...(ean ? { gtin13: ean } : {}),
      ...(offers.length ? { offers: { '@type': 'AggregateOffer', priceCurrency: 'BRL', lowPrice: offers[0].total, highPrice: offers[offers.length - 1].total, offerCount: offers.length, availability: 'https://schema.org/InStock' } } : {}) }, crumbs(trail)];
    const same = prods.filter((x) => x.collection === p.collection && x.id !== p.id).sort(sortP).slice(0, 12);
    const body = `${bc(trail)}<h1>${esc(name)}</h1>
<p>${b0 ? `Menor preço com estoque agora: <b>${brl(b0.total)}${pix(b0)}</b> em ${esc(b0.storeName)}.` : 'Nenhuma loja acompanhada tem este produto em estoque agora.'}${p.copagConfirmed && p.msrp ? ` Preço sugerido Copag: ${brl(p.msrp)}${b0 && b0.discount > 0 ? ` (${pct(b0.discount)} abaixo)` : ''}.` : ''}${p.boosters ? ` ${p.boosters} boosters${b0 ? `, ${brl(b0.total / p.boosters)} por booster` : ''}.` : ''}</p>
${offers.length ? `<h2>Onde comprar</h2><table class="ssr-t"><thead><tr><th>Loja</th><th>Preço</th></tr></thead><tbody>${offers.slice(0, 15).map((o) => `<tr><td>${esc(o.storeName)}${o.seller && !String(o.storeName).toLowerCase().includes(String(o.seller).toLowerCase()) ? ` (vendido por ${esc(o.seller)})` : ''}</td><td>${brl(o.total)}${pix(o)}</td></tr>`).join('')}</tbody></table>` : ''}
${same.length ? `<h2>Mais de ${esc(p.collectionName)}</h2><ul>${same.map((x) => prodRow(x, best[x.id], of)).join('')}</ul>` : ''}`;
    return { title, desc, url, img, json, body };
  }
  if (t === 'colecao') {
    const c = cols.find((x) => colSlug(x) === slug); if (!c) return null;
    const list = prods.filter((p) => p.collection === c.id).sort(sortP);
    const low = list.map((p) => best[p.id]?.total).filter(Boolean).sort((a, b) => a - b)[0];
    const kinds = [...new Set(list.map((p) => p.typeLabel))].slice(0, 3).join(', ');
    const url = `/colecao/${colSlug(c)}`;
    const title = `${c.name} Pokémon TCG: preços e promoções | ${NAME}`;
    const desc = `Preços de ${c.name} (Pokémon TCG lacrado, Copag) em lojas do Brasil: ${list.length} produtos comparados com o preço sugerido Copag${low ? `, a partir de ${brl(low)}` : ''}. Estoque conferido a cada 15 minutos.`;
    const trail = [['Início', '/'], [c.name, url]];
    const json = [{ '@context': 'https://schema.org', '@type': 'CollectionPage', name: `${c.name}: preços de Pokémon TCG lacrado`, url: SITE + url, mainEntity: { '@type': 'ItemList', itemListElement: list.slice(0, 30).map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: `${SITE}/produto/${of[p.id]}`, name: `${label(p)} ${c.name}` })) } }, crumbs(trail)];
    const body = `${bc(trail)}<h1>${esc(c.name)}: preços de Pokémon TCG lacrado</h1><p>${list.length} produtos da coleção ${esc(c.name)} (${esc(c.series || 'Pokémon TCG')}) em lojas brasileiras, comparados com o preço sugerido da Copag. Só conta oferta com estoque.</p><ul>${list.map((p) => prodRow(p, best[p.id], of, best[p.id] && best[p.id].discount > 0 && p.copagConfirmed ? ` (${pct(best[p.id].discount)} abaixo)` : '')).join('')}</ul>${navLinks}`;
    return { title, desc, url, json, body };
  }
  if (t === 'tipo') {
    const ty = types.find((x) => typeSlug(x) === slug); if (!ty) return null;
    const list = prods.filter((p) => p.type === ty.id).sort(sortP);
    const url = `/tipo/${typeSlug(ty)}`;
    const title = `Preço de ${ty.label} Pokémon TCG no Brasil: todas as coleções | ${NAME}`;
    const desc = `${ty.label} de Pokémon TCG lacrado: compare o preço de ${list.length} produtos em lojas do Brasil com o preço sugerido da Copag. Estoque conferido a cada 15 minutos.`;
    const trail = [['Início', '/'], [ty.label, url]];
    const json = [{ '@context': 'https://schema.org', '@type': 'CollectionPage', name: `${ty.label} Pokémon TCG: preços`, url: SITE + url, mainEntity: { '@type': 'ItemList', itemListElement: list.slice(0, 30).map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: `${SITE}/produto/${of[p.id]}`, name: `${label(p)} ${p.collectionName}` })) } }, crumbs(trail)];
    const body = `${bc(trail)}<h1>${esc(ty.label)} Pokémon TCG: preços no Brasil</h1><p>${list.length} produtos neste formato, de todas as coleções, comparados com o preço sugerido da Copag.</p><ul>${list.map((p) => prodRow(p, best[p.id], of)).join('')}</ul>${navLinks}`;
    return { title, desc, url, json, body };
  }
  const STATIC = {
    home: ['/', `Preço de Pokémon TCG lacrado no Brasil: compare com a Copag | ${NAME}`, 'Comparador de preços de Pokémon TCG lacrado: ETB, booster box, blisters e coleções em lojas do Brasil, comparados com o preço sugerido oficial da Copag. Estoque conferido a cada 15 minutos.', 'Não procure preço. Procure oportunidade.'],
    oportunidades: ['/oportunidades', `Promoções de Pokémon TCG lacrado hoje | ${NAME}`, 'As melhores promoções de Pokémon TCG lacrado agora: ofertas abaixo do preço sugerido da Copag, com estoque confirmado e nota de oportunidade.', 'Promoções de Pokémon TCG lacrado hoje'],
    precos: ['/precos', `Preço sugerido Copag de Pokémon TCG: tabela oficial | ${NAME}`, 'Tabela com o preço sugerido da Copag para ETB, booster box, blisters, latas e coleções de Pokémon TCG, com fonte e data.', 'Preço sugerido Copag de Pokémon TCG'],
    'pre-vendas': ['/pre-vendas', `Pré-venda de Pokémon TCG no Brasil: lançamentos e preços | ${NAME}`, 'Lançamentos de Pokémon TCG em pré-venda nas lojas brasileiras, com preço e comparação com o preço sugerido da Copag.', 'Pré-vendas de Pokémon TCG'],
    'como-funciona': ['/como-funciona', `Como funciona o comparador e o Deal Score | ${NAME}`, 'Como o TCG Price Hunter confere preços, estoque e o preço sugerido da Copag, e como a nota de oportunidade (Deal Score) é calculada.', 'Como funciona o TCG Price Hunter'],
  };
  const st = STATIC[t]; if (!st) return null;
  const [url, title, desc, h1] = st;
  let main = '';
  if (t === 'home' || t === 'oportunidades') main = topOpp.length ? `<h2>Melhores oportunidades agora</h2><ol>${topOpp.map((o) => prodRow(P[o.productId], o, of, ` (${pct(o.discount)} abaixo da Copag, Deal Score ${o.dealScore})`)).join('')}</ol>` : '';
  if (t === 'precos') main = `<table class="ssr-t"><thead><tr><th>Produto</th><th>Preço sugerido</th></tr></thead><tbody>${(s.products || []).filter((p) => p.copagConfirmed && p.msrp).map((p) => `<tr><td><a href="/produto/${of[p.id]}">${esc(p.collectionName)} · ${esc(label(p))}</a></td><td>${brl(p.msrp)}</td></tr>`).join('')}</tbody></table>`;
  if (t === 'pre-vendas') { const pre = (s.offers || []).filter((o) => o.stock === 'PRE_ORDER' && P[o.productId]); main = pre.length ? `<ul>${pre.slice(0, 30).map((o) => prodRow(P[o.productId], o, of)).join('')}</ul>` : '<p>Nenhuma pré-venda aberta agora.</p>'; }
  const json = t === 'home' ? [{ '@context': 'https://schema.org', '@type': 'WebSite', name: NAME, alternateName: 'Comparador de preços de Pokémon TCG', url: SITE + '/', inLanguage: 'pt-BR' }, { '@context': 'https://schema.org', '@type': 'Organization', name: NAME, url: SITE + '/', logo: SITE + '/icon-512.png', email: 'contato.tcgpricehunter@gmail.com' }] : [crumbs([['Início', '/'], [h1, url]])];
  return { title, desc, url, json, body: `<h1>${esc(h1)}</h1><p>${esc(desc)}</p>${main}${t === 'home' || t === 'precos' ? navLinks : ''}` };
}

export default async function handler(req, res) {
  const q = new URL(req.url, SITE).searchParams; const t = q.get('t') || 'home'; const slug = decodeURIComponent(q.get('slug') || '');
  const host = req.headers['x-forwarded-host'] || req.headers.host;
  if (!page.html) page = { t: Date.now(), html: shell(readLocal()) };
  if (!page.html) {
    try { const r = await fetch(`https://${host}/app.html`); const h = r.ok ? shell(await r.text()) : null; if (h) page = { t: Date.now(), html: h }; } catch {}
  }
  if (!page.html) { res.setHeader('Cache-Control', 'no-store'); res.statusCode = 302; res.setHeader('Location', '/app.html'); return res.end(); }
  let html = page.html; let status = 200;
  try {
    const s = await state(); const m = build(t, slug, s);
    if (!m) { status = 404; html = html.replace(/<link rel="canonical" href="[^"]*">\n?/, '').replace('</head>', '<meta name="robots" content="noindex">\n</head>'); }
    else {
      const url = SITE + m.url;
      html = html
        .replace(/<title>[^<]*<\/title>/, `<title>${esc(m.title)}</title>`)
        .replace(/<meta name="description" content="[^"]*">/, `<meta name="description" content="${esc(m.desc)}">`)
        .replace(/<meta property="og:title" content="[^"]*">/, `<meta property="og:title" content="${esc(m.title)}">`)
        .replace(/<meta property="og:description" content="[^"]*">/, `<meta property="og:description" content="${esc(m.desc)}">`)
        .replace(/<meta property="og:url" content="[^"]*">/, `<meta property="og:url" content="${esc(url)}">`)
        .replace(/<link rel="canonical" href="[^"]*">/, `<link rel="canonical" href="${esc(url)}">`)
        .replace('</head>', `${m.json.map(ld).join('\n')}\n</head>`)
        .replace('<div id="view"></div>', `<div id="view"><div class="ssr">${m.body}</div></div>`);
      if (m.img) html = html.replace(/<meta property="og:image" content="[^"]*">/, `<meta property="og:image" content="${esc(m.img)}">`);
    }
  } catch { /* sem dados: devolve a página normal, o site carrega sozinho */ }
  res.statusCode = status;
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.setHeader('cache-control', 'public, max-age=0, s-maxage=600, stale-while-revalidate=3600');
  res.end(html);
}
