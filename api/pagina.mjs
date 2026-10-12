import fs from 'node:fs';
import path from 'node:path';
// Todas as páginas públicas passam por aqui: a mesma página do site, já com título, descrição, endereço canônico,
// prévia de compartilhamento, dados estruturados e o conteúdo principal em HTML (para buscadores e prévias que não rodam JavaScript).
// O site carrega por cima e substitui esse conteúdo pela versão interativa.
import { state, slugs, label, live, SITE, colSlug, typeSlug, esc, brl, pct, bestBy, pix } from './_seo.mjs';
import { apiDbEnabled } from './_lib/db.mjs';
import { listOpportunities } from './_lib/read-db.mjs';
import { classify, usable, dbDataAt } from './_lib/freshness.mjs';
import { byComparableTotal, shipKnown } from './_lib/offer-rank.mjs';
// Lote E: guia, perguntas frequentes e glossário como dados (fonte única com o site).
import { GUIA, guiaHTML, faqHTML, glossarioHTML, faqLD, glossarioLD } from './_lib/guia.mjs';
// Frente 7: /lojas (todas as lojas conhecidas, com busca direta) e "Procurar em outras lojas" no produto.
import { lojasFromState, sections as lojaSections, outrasLojas, LOJAS_CFG } from './_lib/lojas.mjs';

let page = { t: 0, html: null };
const isShell = (h) => typeof h === 'string' && h.includes('<div id="view"></div>') && h.includes('id="main"') && h.includes('TCG Price Hunter');
const shell = (h) => (isShell(h) ? h : null);
function readLocal() {
  for (const f of [path.join(process.cwd(), 'index.html'), path.join(process.cwd(), 'public', 'app.html')]) {
    try { return fs.readFileSync(f, 'utf8'); } catch {}
  }
  return null;
}
const noindex = (h) => h.replace(/<link rel="canonical" href="[^"]*">\n?/, '').replace('</head>', '<meta name="robots" content="noindex">\n</head>');
const NAME = 'TCG Price Hunter';
const ld = (o) => `<script type="application/ld+json">${JSON.stringify(o).replace(/</g, '\\u003c')}</script>`;
const crumbs = (items) => ({ '@context': 'https://schema.org', '@type': 'BreadcrumbList', itemListElement: items.map(([n, u], i) => ({ '@type': 'ListItem', position: i + 1, name: n, item: SITE + u })) });
// Frete da oferta em texto (issue #84, mesma leitura do site: index.html shipNote). Só diz "com frete"/"frete grátis"
// quando o frete é conhecido; sem frete informado, o valor é só o preço e o texto avisa "frete a calcular".
const shipTag = (o) => (!shipKnown(o) ? 'frete a calcular' : Number(o.shipping) > 0 ? 'com frete' : 'frete grátis');
const bc = (items) => `<nav class="ssr-bc" aria-label="Caminho">${items.map(([n, u], i) => (i < items.length - 1 ? `<a href="${u}">${esc(n)}</a>` : `<span>${esc(n)}</span>`)).join(' › ')}</nav>`;
// Meta description de até 160 caracteres: monta com as partes na ordem e vai tirando as opcionais (do fim) até caber.
const DESC_MAX = 160;
function fitDesc(required, ...optional) {
  const opt = [...optional];
  let d = [required, ...opt].join('');
  while (d.length > DESC_MAX && opt.length) { opt.pop(); d = [required, ...opt].join(''); }
  return d.length > DESC_MAX ? d.slice(0, DESC_MAX - 1).replace(/\s+\S*$/, '') + '…' : d;
}
const day = (iso) => (iso && !Number.isNaN(Date.parse(iso)) ? new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : '');
const hostOf = (u) => { try { return new URL(u).host.replace(/^www\./, ''); } catch { return ''; } };
// Oferta individual no JSON-LD (dentro do AggregateOffer): preço, loja e disponibilidade; nunca declara frete (#84).
const ldOffer = (o) => ({ '@type': 'Offer', price: o.total, priceCurrency: 'BRL', availability: 'https://schema.org/InStock', ...(o.url ? { url: o.url } : {}), seller: { '@type': 'Organization', name: o.storeName } });

// ---- Frente 7: lojas ----
const LOJA_CHIP = { monitorada: ['ok', 'Monitorada'], 'sem-leitura': ['warn', 'Sem leitura automática'], indisponivel: ['warn', 'Sem leitura automática'], marketplace: ['', 'Marketplace'], pausada: ['', 'Pausada'] };
const stamp = (iso) => (iso && !Number.isNaN(Date.parse(iso)) ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '');
// Link externo para a loja: sempre nofollow + noopener, nova aba. Nunca um preço: só o que o robô leu entra em "Onde comprar".
const extA = (url, txt) => `<a href="${esc(url)}" rel="nofollow noopener" target="_blank">${txt}<span class="sr"> (abre em nova aba)</span> ↗</a>`;
function lojaRow(l, oppFilter) {
  const [cls, lbl] = LOJA_CHIP[l.status] || ['', l.status];
  const plat = l.platform && LOJAS_CFG.rotulo[l.platform] ? ` <span class="chip">${esc(LOJAS_CFG.rotulo[l.platform])}</span>` : '';
  const facts = l.status === 'monitorada' ? ` · ${l.offersLive} ${l.offersLive === 1 ? 'oferta' : 'ofertas'} com estoque${l.lastReadAt ? ` · última leitura ${stamp(l.lastReadAt)}` : ''}` : '';
  const go = l.searchUrl ? ` · ${extA(l.searchUrl, l.searchKind === 'busca' ? 'Buscar Pokémon na loja' : 'Abrir a loja')}` : '';
  const opp = oppFilter && l.status === 'monitorada' && l.offersLive > 0 ? ` · <a href="/oportunidades?loja=${encodeURIComponent(l.id)}">Ver ofertas</a>` : '';
  return `<li id="loja-${esc(l.id)}"><b>${esc(l.name)}</b>${plat} <span class="chip ${cls}">${lbl}</span>${facts}${go}${opp}${l.reason ? `<br><small>${esc(l.reason)}</small>` : ''}</li>`;
}
function lojasPage(lojas) {
  const secs = lojaSections(lojas); const n = Object.fromEntries(secs.map(([k, , xs]) => [k, xs.length]));
  const url = '/lojas'; const h1 = 'Lojas de Pokémon TCG no Brasil';
  const title = `Lojas de Pokémon TCG no Brasil: todas as lojas monitoradas | ${NAME}`;
  const desc = fitDesc(`Lojas de Pokémon TCG lacrado que o TCG Price Hunter conhece: ${n.monitoradas} monitoradas agora, ${n['sem-leitura']} sem leitura automática e ${n.marketplaces} marketplaces.`, ' Busca direta em cada uma.');
  const trail = [['Início', '/'], [h1, url]];
  const items = lojas.filter((l) => l.url);
  const json = [{ '@context': 'https://schema.org', '@type': 'ItemList', name: h1, url: SITE + url, numberOfItems: items.length,
    itemListElement: items.map((l, i) => ({ '@type': 'ListItem', position: i + 1, item: { '@type': l.marketplace ? 'Organization' : 'Store', name: l.name, url: l.url } })) }, crumbs(trail)];
  const intro = { monitoradas: 'O robô lê estas lojas a cada 15 min: os preços delas aparecem nas ofertas do site.', 'sem-leitura': 'Lojas que vendem Pokémon TCG, mas que o robô não consegue ler. Nenhum preço aparece aqui: confira na própria loja.', marketplaces: 'Muitos vendedores num site só. O robô não lê os preços; a busca abre no próprio marketplace.', pausadas: 'Leitura pausada pelo projeto. A loja continua no ar; os preços só aparecem nela.' };
  const body = `${bc(trail)}<h1>${esc(h1)}</h1><p>${esc(desc)}</p><p>Preço só aparece quando o robô leu a loja; nas demais, o link leva à busca de Pokémon na própria loja. A compra é sempre na loja.</p>${secs.map(([k, t, xs]) => `<h2 id="${k}">${esc(t)} (${xs.length})</h2><p>${esc(intro[k])}</p>${xs.length ? `<ul class="ssr-lojas">${xs.map((l) => lojaRow(l, true)).join('')}</ul>` : '<p>Nenhuma agora.</p>'}`).join('')}`;
  return { title, desc, url, json, body };
}
// "Procurar em outras lojas" (produto): até 12 links de busca com o nome do produto; marketplaces primeiro. Sem preço.
function outrasLojasHTML(lojas, q) {
  const ls = outrasLojas(lojas, q); if (!ls.length) return '';
  return `<details class="more outras"><summary><h2>Procurar em outras lojas (${ls.length})</h2></summary><p>Preços não lidos pelo Hunter — confira na loja.</p><ul class="ssr-links ssr-lojas">${ls.map((l) => `<li>${extA(l.url, esc(l.name))}</li>`).join('')}</ul></details>`;
}

function prodRow(p, o, of, extra = '') {
  return `<li><a href="/produto/${of[p.id]}">${esc(p.collectionName)} · ${esc(label(p))}</a>${o ? ` — <b>${brl(o.total)}${pix(o)}</b> em ${esc(o.storeName)}` : ' — sem estoque agora'}${p.copagConfirmed && p.msrp ? ` · Copag ${brl(p.msrp)}` : ''}${extra}</li>`;
}

function build(t, slug, s, opp = null, lojas = []) {
  if (t === 'lojas') return lojasPage(lojas);
  const { by: SL, of } = slugs(s.products || []);
  const { by: best, n } = bestBy(s);
  const prods = (s.products || []).filter((p) => p.offerCount > 0);
  const cols = (s.collections || []).filter((c) => prods.some((p) => p.collection === c.id));
  const types = (s.types || []).filter((ty) => prods.some((p) => p.type === ty.id));
  const sortP = (a, b) => ((best[b.id] ? 1 : 0) - (best[a.id] ? 1 : 0)) || ((best[b.id]?.discount ?? -9) - (best[a.id]?.discount ?? -9));
  const navLinks = `<h2>Coleções</h2><ul class="ssr-links">${cols.map((c) => `<li><a href="/colecao/${colSlug(c)}">${esc(c.name)}</a></li>`).join('')}</ul><h2>Formatos</h2><ul class="ssr-links">${types.map((ty) => `<li><a href="/tipo/${typeSlug(ty)}">${esc(ty.label)}</a></li>`).join('')}</ul>`;
  const P = Object.fromEntries((s.products || []).map((p) => [p.id, p]));

  if (t === 'produto') {
    const p = (s.products || []).find((x) => x.id === (SL[slug] || slug));
    if (!p) return null;
    // Melhor oferta = a mesma do site (index.html bestOffer, #178) e de _seo.mjs bestBy (#182): frete conhecido (ou grátis)
    // compara pelo total; frete desconhecido nunca vence quem tem frete conhecido; só desconhecidas, vale o menor preço.
    const offers = (s.offers || []).filter((o) => o.productId === p.id && live(o)).sort(byComparableTotal);
    // b0 = "menor total com frete comparável" (regra #84) — fica no texto da página como frase própria.
    // Lote D (decisão do dono): título, descrição e AggregateOffer.lowPrice usam o MENOR PREÇO VISÍVEL na tabela
    // "Onde comprar" (a oferta com estoque mais barata, Pix incluído e sinalizado), para o número bater com o que o
    // leitor vê e o que o Google confere. Nunca se inventa frete: oferta sem frete informado sai "frete a calcular".
    const b0 = offers[0]; const k0 = !!b0 && shipKnown(b0); const name = `${label(p)} ${p.collectionName}`;
    const vis = offers.slice(0, 15);
    const lo = vis.reduce((m, o) => (!m || o.total < m.total ? o : m), null); const kl = !!lo && shipKnown(lo);
    const col = (s.collections || []).find((c) => c.id === p.collection); const ty = (s.types || []).find((x) => x.id === p.type);
    const url = `/produto/${of[p.id]}`;
    const title = `${name} Pokémon TCG${lo ? `: a partir de ${brl(lo.total)}${pix(lo)}${kl ? '' : ' (frete a calcular)'}` : ': preço e lojas'} | ${NAME}`;
    const nLojas = `${offers.length} ${offers.length === 1 ? 'loja' : 'lojas'}`;
    const desc = lo
      ? fitDesc(`${name} (Pokémon TCG lacrado): a partir de ${brl(lo.total)}${pix(lo)} (${shipTag(lo)}) em ${lo.storeName}.`,
        p.copagConfirmed && lo.discount > 0 ? ` ${pct(lo.discount)} abaixo do preço sugerido Copag.` : '', ` Compare ${nLojas} com estoque.`)
      : fitDesc(`${name} (Pokémon TCG lacrado): preço sugerido Copag${p.copagConfirmed ? ` ${brl(p.msrp)}` : ''}, histórico e lojas que vendem no Brasil.`);
    const img = b0?.image || p.image || `${SITE}/og.jpg`;
    const ean = [p.ean, ...offers.map((o) => o.ean)].find((x) => /^\d{13}$/.test(String(x || '')));
    // Último item do caminho = o produto (formato + coleção), não o nome do formato de novo.
    const trail = [['Início', '/'], ...(col ? [[col.name, `/colecao/${colSlug(col)}`]] : []), ...(ty ? [[ty.label, `/tipo/${typeSlug(ty)}`]] : []), [name, url]];
    const json = [{ '@context': 'https://schema.org', '@type': 'Product', name, image: img, description: desc, sku: p.id, category: p.typeLabel, brand: { '@type': 'Brand', name: 'Pokémon TCG' }, ...(ean ? { gtin13: ean } : {}),
      // availability fica em cada Offer listada (as mesmas da tabela), não no AggregateOffer.
      ...(offers.length ? { offers: { '@type': 'AggregateOffer', priceCurrency: 'BRL', lowPrice: lo.total, highPrice: Math.max(...offers.map((o) => o.total)), offerCount: offers.length, offers: vis.map(ldOffer) } } : {}) }, crumbs(trail)];
    const same = prods.filter((x) => x.collection === p.collection && x.id !== p.id).sort(sortP).slice(0, 12);
    const cmpSentence = b0 && lo && b0.id !== lo.id ? ` Menor total com frete comparável: <b>${brl(b0.total)}${pix(b0)}</b> (${shipTag(b0)}) em ${esc(b0.storeName)}.` : '';
    const body = `${bc(trail)}<h1>${esc(name)}</h1>
<p>${lo ? (kl ? `Melhor preço com estoque agora: <b>${brl(lo.total)}${pix(lo)}</b> (${shipTag(lo)}) em ${esc(lo.storeName)}.` : `Menor preço com estoque agora, frete a calcular: <b>${brl(lo.total)}${pix(lo)}</b> em ${esc(lo.storeName)}.`) : 'Nenhuma loja acompanhada tem estoque confirmado deste produto agora.'}${cmpSentence}${p.copagConfirmed && p.msrp ? ` Preço sugerido Copag: ${brl(p.msrp)}${lo && lo.discount > 0 ? ` (${pct(lo.discount)} abaixo)` : ''}.` : ''}${p.boosters ? ` ${p.boosters} boosters${lo ? `, ${brl(lo.total / p.boosters)} por booster` : ''}.` : ''}</p>
${offers.length ? `<h2>Onde comprar</h2><table class="ssr-t"><thead><tr><th>Loja</th><th>Preço</th></tr></thead><tbody>${vis.map((o) => `<tr><td>${esc(o.storeName)}${o.seller && !String(o.storeName).toLowerCase().includes(String(o.seller).toLowerCase()) ? ` (vendido por ${esc(o.seller)})` : ''}</td><td>${brl(o.total)}${pix(o)} (${shipTag(o)})</td></tr>`).join('')}</tbody></table>` : ''}
${outrasLojasHTML(lojas, `${p.collectionName} ${label(p)}`)}
${same.length ? `<h2>Mais de ${esc(p.collectionName)}</h2><ul>${same.map((x) => prodRow(x, best[x.id], of)).join('')}</ul>` : ''}`;
    return { title, desc, url, img, json, body, noindex: !offers.length };
  }
  if (t === 'colecao') {
    const c = cols.find((x) => colSlug(x) === slug); if (!c) return null;
    const list = prods.filter((p) => p.collection === c.id).sort(sortP);
    const low = list.map((p) => best[p.id]?.total).filter(Boolean).sort((a, b) => a - b)[0];
    const kinds = [...new Set(list.map((p) => p.typeLabel))].slice(0, 3).join(', ');
    const url = `/colecao/${colSlug(c)}`;
    const title = `${c.name} Pokémon TCG: preços e promoções | ${NAME}`;
    const desc = fitDesc(`${c.name} Pokémon TCG lacrado: ${list.length} produtos em lojas do Brasil comparados com o preço sugerido Copag${low ? `, a partir de ${brl(low)}` : ''}.`, kinds ? ` Formatos: ${kinds}.` : '', ' Estoque conferido a cada 15 min.');
    const trail = [['Início', '/'], [c.name, url]];
    const json = [{ '@context': 'https://schema.org', '@type': 'CollectionPage', name: `${c.name}: preços de Pokémon TCG lacrado`, url: SITE + url, mainEntity: { '@type': 'ItemList', itemListElement: list.slice(0, 30).map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: `${SITE}/produto/${of[p.id]}`, name: `${label(p)} ${c.name}` })) } }, crumbs(trail)];
    const body = `${bc(trail)}<h1>${esc(c.name)}: preços de Pokémon TCG lacrado</h1><p>${list.length} produtos da coleção ${esc(c.name)} (${esc(c.series || 'Pokémon TCG')}) em lojas brasileiras, comparados com o preço sugerido da Copag. Só conta oferta com estoque.</p><ul>${list.map((p) => prodRow(p, best[p.id], of, best[p.id] && best[p.id].discount > 0 && p.copagConfirmed ? ` (${pct(best[p.id].discount)} abaixo)` : '')).join('')}</ul>${navLinks}`;
    return { title, desc, url, json, body };
  }
  // Lote E: /tipo/blister reúne os formatos de blister (unitário, duplo, triplo, quádruplo) numa página só,
  // com link para cada um. Um formato real com esse slug tem prioridade (nunca houve: os rótulos são "Blister Unitário" etc.).
  const isBlister = (ty) => ty.group === 'Blisters' || /^blister/i.test(String(ty.id));
  if (t === 'tipo' && slug === 'blister' && !types.some((x) => typeSlug(x) === slug)) {
    const subs = types.filter(isBlister); if (!subs.length) return null;
    const ids = new Set(subs.map((x) => x.id));
    const list = prods.filter((p) => ids.has(p.type)).sort(sortP);
    const low = list.map((p) => best[p.id]?.total).filter(Boolean).sort((a, b) => a - b)[0];
    const url = '/tipo/blister';
    const title = `Blister Pokémon TCG: preços e onde comprar mais barato | ${NAME}`;
    const desc = fitDesc(`Blister Pokémon TCG lacrado (unitário, duplo, triplo e quádruplo): ${list.length} produtos em lojas do Brasil comparados com o preço sugerido Copag${low ? `, a partir de ${brl(low)}` : ''}.`, ' Estoque conferido a cada 15 min.');
    const trail = [['Início', '/'], ['Blister', url]];
    const json = [{ '@context': 'https://schema.org', '@type': 'CollectionPage', name: 'Blister Pokémon TCG: preços', url: SITE + url, mainEntity: { '@type': 'ItemList', itemListElement: list.slice(0, 30).map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: `${SITE}/produto/${of[p.id]}`, name: `${label(p)} ${p.collectionName}` })) } }, crumbs(trail)];
    const body = `${bc(trail)}<h1>Blister Pokémon TCG: preços e onde comprar mais barato</h1><p>${list.length} produtos em blister (${subs.map((x) => x.label.toLowerCase()).join(', ')}), de todas as coleções, comparados com o preço sugerido da Copag. Só conta oferta com estoque.</p><h2>Por tipo de blister</h2><ul class="ssr-links">${subs.map((x) => `<li><a href="/tipo/${typeSlug(x)}">${esc(x.label)}</a> (${list.filter((p) => p.type === x.id).length})</li>`).join('')}</ul><h2>Todos os blisters</h2><ul>${list.map((p) => prodRow(p, best[p.id], of)).join('')}</ul>${navLinks}`;
    return { title, desc, url, json, body };
  }
  if (t === 'tipo') {
    const ty = types.find((x) => typeSlug(x) === slug); if (!ty) return null;
    const list = prods.filter((p) => p.type === ty.id).sort(sortP);
    const url = `/tipo/${typeSlug(ty)}`;
    const title = `Preço de ${ty.label} Pokémon TCG no Brasil: todas as coleções | ${NAME}`;
    const desc = fitDesc(`${ty.label} Pokémon TCG lacrado: preço de ${list.length} produtos, de todas as coleções, em lojas do Brasil comparado com o preço sugerido Copag.`, ' Estoque conferido a cada 15 min.');
    const trail = [['Início', '/'], [ty.label, url]];
    const json = [{ '@context': 'https://schema.org', '@type': 'CollectionPage', name: `${ty.label} Pokémon TCG: preços`, url: SITE + url, mainEntity: { '@type': 'ItemList', itemListElement: list.slice(0, 30).map((p, i) => ({ '@type': 'ListItem', position: i + 1, url: `${SITE}/produto/${of[p.id]}`, name: `${label(p)} ${p.collectionName}` })) } }, crumbs(trail)];
    const body = `${bc(trail)}<h1>${esc(ty.label)} Pokémon TCG: preços no Brasil</h1><p>${list.length} produtos neste formato, de todas as coleções, comparados com o preço sugerido da Copag.</p><ul>${list.map((p) => prodRow(p, best[p.id], of)).join('')}</ul>${navLinks}`;
    return { title, desc, url, json, body };
  }
  // Descrições de até 160 caracteres (o que o Google mostra), com as palavras-chave: Pokémon TCG, preço sugerido Copag, formato, coleção.
  const STATIC = {
    home: ['/', `Preço de Pokémon TCG lacrado no Brasil: compare com a Copag | ${NAME}`, 'Comparador de preços de Pokémon TCG lacrado: ETB, booster box, blisters e coleções em lojas do Brasil vs. preço sugerido Copag. Estoque conferido a cada 15 min.', 'Não procure preço. Procure oportunidade.'],
    oportunidades: ['/oportunidades', `Promoções de Pokémon TCG lacrado hoje | ${NAME}`, 'Melhores ofertas de Pokémon TCG lacrado com estoque agora, por produto, com Opportunity Score e comparação com o preço sugerido Copag ou o mercado.', 'Promoções de Pokémon TCG lacrado hoje'],
    produtos: ['/produtos', `Todos os produtos de Pokémon TCG lacrado e seus preços | ${NAME}`, 'Todos os produtos de Pokémon TCG lacrado acompanhados: ETB, booster box, blisters, latas e coleções, com o menor preço em lojas do Brasil por coleção e formato.', 'Todos os produtos de Pokémon TCG lacrado'],
    precos: ['/precos', `Preço sugerido Copag de Pokémon TCG: tabela oficial | ${NAME}`, 'Tabela do preço sugerido Copag de Pokémon TCG por coleção e formato (ETB, booster box, blisters, latas), com fonte e data de cada valor.', 'Preço sugerido Copag de Pokémon TCG'],
    'pre-vendas': ['/pre-vendas', `Pré-venda de Pokémon TCG no Brasil: lançamentos e preços | ${NAME}`, 'Lançamentos de Pokémon TCG em pré-venda nas lojas brasileiras, por coleção e formato, com preço e comparação com o preço sugerido Copag.', 'Pré-vendas de Pokémon TCG'],
    'como-funciona': ['/como-funciona', `Como funciona o comparador e o Opportunity Score | ${NAME}`, 'Como o TCG Price Hunter confere preços, estoque e o preço sugerido Copag de Pokémon TCG, e como calcula o Opportunity Score e a confiança de cada oferta.', 'Como funciona o TCG Price Hunter'],
    glossario: ['/guia/glossario', `Glossário de Pokémon TCG lacrado: booster, blister, ETB, Copag | ${NAME}`, 'Glossário de Pokémon TCG lacrado: booster, booster box, blister, ETB, lata, deck, coleção, Copag, preço sugerido, Pix, Opportunity Score, confiança e pré-venda.', 'Glossário de Pokémon TCG lacrado'],
    termos: ['/termos', `Termos de uso | ${NAME}`, 'Termos de uso do TCG Price Hunter, comparador de preços de Pokémon TCG lacrado: o que o site faz, limites das informações e responsabilidade das lojas.', 'Termos de uso'],
    privacidade: ['/privacidade', `Política de privacidade | ${NAME}`, 'Política de privacidade do TCG Price Hunter (LGPD): quais dados o site guarda, para quê, por quanto tempo e como excluir a conta.', 'Política de privacidade'],
  };
  const st = STATIC[t]; if (!st) return null;
  const [url, title, desc, h1] = st;
  let main = '';
  // 6B.1/6B.2: Home e /oportunidades vêm do Opportunity Engine (banco). Sem banco, nada é estimado nem trocado pelo Deal Score.
  if (t === 'oportunidades' || t === 'home') main = opp?.length ? `<h2>Melhores oportunidades agora</h2><ol>${opp.map((x) => {
    const rc = x.reference_comparison || {}; const pref = of[x.product.id] || x.product.id; const parts = [];
    if (rc.available && rc.position === 'below') parts.push(`${rc.percentage_below.toFixed(1).replace('.', ',')}% abaixo ${rc.reference_kind === 'COPAG_OFFICIAL_CURRENT' ? 'do preço sugerido Copag' : 'da referência de mercado'}`);
    parts.push(`Opportunity Score ${x.opportunity_score}`);
    return `<li><a href="/produto/${esc(pref)}">${esc(x.product.name)}</a> — <b>${brl(x.price)}</b> em ${esc(x.store?.name || '')} (${parts.join(', ')})</li>`; }).join('')}</ol>` : '';
  // Lote C: sem o banco, /oportunidades lista a melhor oferta com estoque de cada produto (state.json, mesma regra bestBy #84),
  // sem nota: é só o fato (preço, loja, frete, Pix e distância do preço sugerido Copag), para a página não sair vazia.
  if (t === 'oportunidades' && !main) {
    const list = Object.values(best).filter((o) => P[o.productId]).sort((a, b) => (b.discount ?? -9) - (a.discount ?? -9));
    main = list.length ? `<h2>Melhores ofertas com estoque agora</h2><p>Lista sem Opportunity Score (o motor de oportunidades está indisponível): a oferta com estoque mais barata de cada produto, pelo menor total com frete comparável.</p><ol>${list.slice(0, 40).map((o) => prodRow(P[o.productId], o, of, ` (${shipTag(o)})${P[o.productId].copagConfirmed && o.discount > 0 ? ` · ${pct(o.discount)} abaixo do preço sugerido Copag` : ''}`)).join('')}</ol>` : '';
  }
  // /precos: todo produto com preço sugerido, agrupado por coleção, dizendo se é o oficial da Copag ou só referência, com fonte e data.
  if (t === 'precos') {
    const withMsrp = (s.products || []).filter((p) => p.msrp > 0);
    const groups = (s.collections || []).map((c) => [c, withMsrp.filter((p) => p.collection === c.id)]).filter(([, l]) => l.length);
    const row = (p) => { const cp = p.copag || {}; const raw = p.copagConfirmed ? cp.source_url : p.copagReferenceUrl || cp.source_url; const src = /^https?:\/\//i.test(String(raw || '')) ? raw : null; const at = cp.msrp_updated_at || cp.source_timestamp || p.lastSeen;
      return `<tr><td><a href="/produto/${of[p.id]}">${esc(label(p))}</a></td><td>${brl(p.msrp)}</td><td>${p.copagConfirmed ? 'Preço sugerido Copag (oficial)' : 'Referência (não confirmada)'}</td><td>${src ? `<a href="${esc(src)}" rel="nofollow noopener">${esc(hostOf(src) || 'fonte')}</a>` : esc(p.copagReference || '—')}</td><td>${esc(day(at) || '—')}</td></tr>`; };
    main = groups.length ? groups.map(([c, l]) => `<h2><a href="/colecao/${colSlug(c)}">${esc(c.name)}</a></h2><table class="ssr-t"><thead><tr><th>Produto</th><th>Preço sugerido</th><th>Tipo</th><th>Fonte</th><th>Data</th></tr></thead><tbody>${l.map(row).join('')}</tbody></table>`).join('') : '<p>Nenhum preço sugerido disponível agora.</p>';
  }
  // melhor oferta de cada produto: a mesma de bestBy (_seo.mjs, issue #84), não o menor total bruto
  if (t === 'produtos') main = `<ul>${Object.values(best).filter((o) => P[o.productId]).map((o) => prodRow(P[o.productId], o, of)).join('')}</ul>`;
  if (t === 'pre-vendas') { const pre = (s.offers || []).filter((o) => o.stock === 'PRE_ORDER' && P[o.productId]); main = pre.length ? `<ul>${pre.slice(0, 30).map((o) => prodRow(P[o.productId], o, of)).join('')}</ul>` : '<p>Nenhuma pré-venda aberta agora.</p>'; }
  // Páginas legais: o texto completo é o do site (index.html renderLegal); aqui vai título, canonical e a introdução.
  if (t === 'termos') main = '<p>Estes termos valem para quem usa o TCG Price Hunter. O site compara preços de lojas brasileiras com o preço sugerido oficial da Copag; as compras são feitas nas lojas, com os termos delas. Confira preço, frete e estoque na loja antes de comprar. O texto completo aparece ao carregar a página.</p>';
  // Lote E: guia completo (uma seção por h2) + perguntas frequentes (FAQPage); glossário (DefinedTermSet).
  if (t === 'como-funciona') main = `<p>${esc(GUIA.intro)}</p>${guiaHTML(GUIA)}${faqHTML(GUIA)}<p>Termos do hobby explicados: <a href="/guia/glossario">glossário de Pokémon TCG lacrado</a>.</p>`;
  if (t === 'glossario') main = `<p>Os termos que aparecem nas ofertas e no guia <a href="/como-funciona">Como funciona</a>, em ordem de uso.</p>${glossarioHTML(GUIA)}`;
  if (t === 'privacidade') main = '<p>Esta política segue a Lei Geral de Proteção de Dados (Lei 13.709/2018). Sem conta, o site não guarda dados pessoais; com conta, guarda e-mail, nome, favoritos e alertas no Firebase, e a exclusão da conta apaga tudo na hora. O texto completo aparece ao carregar a página.</p>';
  const extraLd = t === 'como-funciona' ? [faqLD(GUIA)] : t === 'glossario' ? [glossarioLD(GUIA, SITE)] : [];
  const json = t === 'home' ? [{ '@context': 'https://schema.org', '@type': 'WebSite', name: NAME, alternateName: 'Comparador de preços de Pokémon TCG', url: SITE + '/', inLanguage: 'pt-BR' }, { '@context': 'https://schema.org', '@type': 'Organization', name: NAME, url: SITE + '/', logo: SITE + '/icon-512.png', email: 'contato.tcgpricehunter@gmail.com' }] : [...extraLd, crumbs([['Início', '/'], [h1, url]])];
  // Links internos para coleções e formatos: Home, /precos, /oportunidades e /pre-vendas (página sem lista ainda tem caminho a seguir).
  return { title, desc, url, json, body: `<h1>${esc(h1)}</h1><p>${esc(desc)}</p>${main}${['home', 'precos', 'oportunidades', 'pre-vendas', 'glossario'].includes(t) ? `<p>Navegue por coleção ou formato:</p>${navLinks}` : ''}` };
}

// Host de onde buscar app.html: só o do SITE ou o do próprio deploy (a Vercel informa VERCEL_URL/VERCEL_BRANCH_URL/
// VERCEL_PROJECT_PRODUCTION_URL). Qualquer outro Host/X-Forwarded-Host (inclusive outro *.vercel.app, que qualquer um
// registra) cai no host do SITE: evita SSRF e envenenar o cache do módulo com página de terceiros.
export function pickFetchHost(headers = {}, env = process.env) {
  const raw = String(headers['x-forwarded-host'] || headers.host || '').split(',')[0].trim().toLowerCase();
  const own = new URL(SITE).host;
  const allowed = new Set([own, ...['VERCEL_URL', 'VERCEL_BRANCH_URL', 'VERCEL_PROJECT_PRODUCTION_URL']
    .map((k) => String(env[k] || '').trim().toLowerCase()).filter(Boolean)]);
  return allowed.has(raw) ? raw : own;
}

export default async function handler(req, res) {
  const q = new URL(req.url, SITE).searchParams; const t = q.get('t') || 'home'; const slug = decodeURIComponent(q.get('slug') || '');
  // Host vem do cabeçalho da requisição: só busca app.html em host conhecido (evita SSRF por Host forjado).
  const host = pickFetchHost(req.headers);
  if (!page.html) page = { t: Date.now(), html: shell(readLocal()) };
  if (!page.html) {
    try { const r = await fetch(`https://${host}/app.html`); const h = r.ok ? shell(await r.text()) : null; if (h) page = { t: Date.now(), html: h }; } catch {}
  }
  if (!page.html) { res.setHeader('Cache-Control', 'no-store'); res.statusCode = 302; res.setHeader('Location', '/app.html'); return res.end(); }
  let html = page.html; let status = 200;
  try {
    let opp = null;
    // Lote 2: oportunidades só com o banco em dia; preços no HTML só com o state.json em dia (até 90 min).
    // Fora disso, vai a página sem o conteúdo pré-renderizado: o site carrega e mostra o aviso de dados desatualizados.
    if ((t === 'oportunidades' || t === 'home') && apiDbEnabled()) { try { if (usable(classify(await dbDataAt()))) opp = (await listOpportunities({ page: 1, limit: t === 'home' ? 15 : 20 })).items; } catch { opp = null; } }
    const s = await state();
    if (!usable(classify(s?.generatedAt))) throw new Error('dados desatualizados');
    // Frente 7: lojas conhecidas (sources do state.json; sem ele, sources.json) só para /lojas e para o bloco do produto.
    let lojas = [];
    if (t === 'lojas' || t === 'produto') { try { lojas = await lojasFromState(s); } catch { lojas = []; } }
    const m = build(t, slug, s, opp, lojas);
    if (!m) { status = 404; html = noindex(html); }
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
      // Produto sem nenhuma oferta com estoque é página vazia: fica fora do índice (o endereço continua abrindo).
      if (m.noindex) html = html.replace('</head>', '<meta name="robots" content="noindex">\n</head>');
    }
  } catch {
    // Sem dados em dia: devolve a página normal, o site carrega sozinho. Como o HTML base traz título e canonical da Home,
    // qualquer outra rota sairia como duplicata da Home: nela, tira o canonical e pede noindex. A Home mantém o dela.
    if (t !== 'home') html = noindex(html);
  }
  res.statusCode = status;
  res.setHeader('content-type', 'text/html; charset=utf-8');
  res.setHeader('cache-control', 'public, max-age=0, s-maxage=600, stale-while-revalidate=3600');
  res.end(html);
}
