// PROVA DE CONCEITO (24/10/2026), fora do robô diário: NÃO está registrado em src/adapters/index.js.
// Lojas Tray (FN Games, Universal Geek, Virtual Gift…): o preço não aparece escrito no HTML (é montado por script), então
// o leitor JSON-LD recusa por regra ("preço escrito na página"). Sondas de 24/10 mostraram que as fontes de máquina da
// página nem sempre concordam: na FN Games o JSON-LD traz 58,10 e o dataLayer da Tray 59,90 (provável preço no Pix × preço
// de venda); na Universal Geek o JSON-LD traz 0,00 e o GA4 159,90 (produto esgotado).
// Regra desta prova: o preço é o `priceSell` do dataLayer da Tray (campo da própria plataforma) e só vale quando uma fonte
// independente da mesma página confirma o mesmo valor (GA4 view_item ou JSON-LD). Sem confirmação, preço zero, nome ou link
// que não batem, ou estoque contraditório: não publica, e o motivo sai em .motivo (com os valores, para a decisão humana).
// Usado só pela sonda (tools/sonda-adaptadores.mjs, plataforma "tray"); não grava nada.
import { get } from '../http.js';
import { guard, brl } from './common.js';
import { productUrls, transientPageError } from './jsonld.js';
import { jsonLdNodes } from './parse-limits.js';

const AVAIL = { instock: 'IN_STOCK', outofstock: 'OUT_OF_STOCK', soldout: 'OUT_OF_STOCK', preorder: 'PRE_ORDER', backorder: 'PRE_ORDER', discontinued: 'UNAVAILABLE' };
const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const words = (t) => new Set(norm(t).split(' ').filter((w) => w.length > 1));
/** Todas as palavras do nome (2+) estão no outro texto. */
export function nomeConfere(nome, pagina) { const A = words(nome); const B = words(pagina); if (A.size < 2) return false; for (const w of A) if (!B.has(w)) return false; return true; }
const igual = (a, b) => a != null && b != null && Math.abs(a - b) < 0.005;

/** Objeto JSON que começa no primeiro "{" depois de `ancora` (chaves balanceadas, respeitando strings), já lido; ou null. */
export function objetoApos(html, ancora) {
  const h = String(html || ''); const m = ancora.exec(h); if (!m) return null;
  const ini = h.indexOf('{', m.index + m[0].length - 1); if (ini < 0 || ini - (m.index + m[0].length) > 5) return null;
  let prof = 0; let str = false; let esc = false;
  for (let i = ini; i < h.length && i < ini + 200000; i++) {
    const c = h[i];
    if (str) { if (esc) esc = false; else if (c === '\\') esc = true; else if (c === '"') str = false; continue; }
    if (c === '"') str = true; else if (c === '{') prof++; else if (c === '}' && --prof === 0) { try { const o = JSON.parse(h.slice(ini, i + 1)); return o && typeof o === 'object' ? o : null; } catch { return null; } }
  }
  return null;
}
/** dataLayer da Tray (primeiro objeto de `dataLayer = [{…}]`), ou null. */
export const dataLayerTray = (html) => objetoApos(html, /dataLayer\s*=\s*\[\s*/);
/** Preços do evento GA4 view_item (value e items[].price), em reais. */
export function precosGa4(html) {
  const o = objetoApos(html, /gtag\(\s*['"]event['"]\s*,\s*['"]view_item['"]\s*,\s*/);
  return o ? [o.value, ...[].concat(o.items || []).map((i) => i?.price)].map((v) => brl(v)).filter(Boolean) : [];
}
function produtoLd(html) {
  const { nodes, stats } = jsonLdNodes(html);
  if (stats.tooLarge || stats.tooMany || stats.truncated || stats.tooDeep) return { erro: 'JSON-LD fora dos limites' };
  const ps = nodes.filter((n) => [].concat(n['@type']).some((t) => /^product$/i.test(String(t))));
  if (ps.length > 1) return { erro: 'mais de um Product na página' };
  if (!ps.length) return {};
  const o = [].concat(ps[0].offers || []).find((x) => x && (x.priceCurrency || 'BRL') === 'BRL') || null;
  return { p: ps[0], preco: brl(o?.price ?? null), stock: AVAIL[String(o?.availability || '').split('/').pop().toLowerCase()] || null };
}
const hostDe = (u) => { try { return new URL(u).host.replace(/^www\./, ''); } catch { return null; } };

/** Página de produto Tray → anúncio, ou { motivo }. */
export function lerPaginaTray(html, url) {
  const h = String(html || '');
  const dl = dataLayerTray(h);
  if (!dl || dl.pageCategory !== 'Produto') return { motivo: 'sem dataLayer de produto da Tray' };
  const ld = produtoLd(h); if (ld.erro) return { motivo: ld.erro };
  const nome = String(dl.nameProduct || '').trim();
  const h1 = (h.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || '').replace(/<[^>]+>/g, ' ');
  if (!nome || !(nomeConfere(nome, h1) || nomeConfere(nome, ld.p?.name))) return { motivo: 'nome do produto não bate com a página' };
  if (dl.urlProduct && hostDe(dl.urlProduct) !== hostDe(url)) return { motivo: 'link do produto de outro site' };
  const base = brl(dl.priceSell ?? dl.price ?? null);
  if (!base) return { motivo: 'preço ausente ou zero' };
  const ga4 = precosGa4(h);
  if (!ga4.some((v) => igual(v, base)) && !igual(ld.preco, base)) return { motivo: `preço não confirmado (dataLayer ${base} × JSON-LD ${ld.preco ?? '—'} × GA4 ${ga4.join('/') || '—'})` };
  const doDl = /^(yes|sim|true|1)$/i.test(String(dl.availability)) ? 'IN_STOCK' : /^(no|nao|não|false|0)$/i.test(String(dl.availability)) ? 'OUT_OF_STOCK' : null;
  let stock = doDl || ld.stock || 'UNKNOWN';
  if (doDl && ld.stock && ld.stock !== doDl) stock = 'UNKNOWN'; // dataLayer e JSON-LD discordam: não afirma estoque
  let image = dl.urlImage || [].concat(ld.p?.image || [])[0] || null; if (image && typeof image === 'object') image = image.url || null;
  try { image = image ? new URL(String(image), url).href : null; } catch { image = null; }
  return { title: nome, url, image, price: { pix: null, base }, listPrice: null, stock, availableFrom: null, quantity: null,
    sku: dl.idProduct ? String(dl.idProduct) : (ld.p?.sku ? String(ld.p.sku) : null), ean: ld.p?.gtin13 || ld.p?.gtin || null, seller: null, sourceType: 'store_page' };
}

/** store: { url } · opts: { max }. Páginas do mapa do site (mesmo filtro do leitor JSON-LD); devolve anúncios + .motivos. */
export async function search(store, { max = 20 } = {}) {
  const base = store.url.replace(/\/$/, '');
  const urls = (await productUrls(base, max)).slice(0, max);
  const out = []; const failed = []; const reasons = {}; const motivos = {};
  for (const u of urls) {
    try { await guard(u); const r = await get(u); const l = lerPaginaTray(r.text, r.url || u); if (l.motivo) motivos[l.motivo] = (motivos[l.motivo] || 0) + 1; else out.push(l); }
    catch (e) {
      if (e.blocked && e.status !== 'robots' && e.status !== 'unreachable') throw e;
      if (transientPageError(e)) { failed.push(u); reasons[u] = String(e?.message || 'falha de leitura').slice(0, 120); }
    }
  }
  out.failed = failed; out.failReasons = reasons; out.motivos = motivos; out.paginas = urls.length;
  return out;
}
