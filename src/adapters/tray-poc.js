// PROVA DE CONCEITO (24/10/2026), fora do robô diário: NÃO está registrado em src/adapters/index.js.
// Lojas Tray (FN Games, Universal Geek, Virtual Gift…): a página de produto traz JSON-LD Product com preço, mas o preço
// não aparece escrito no HTML (é montado por script), e o leitor JSON-LD recusa por regra ("preço escrito na página").
// Aqui o preço do JSON-LD só vale quando uma SEGUNDA fonte da mesma página confirma o mesmo valor: o dataLayer da Tray
// ({ idProduct, nameProduct, …preço }) ou o evento GA4 view_item ({ value, items[].price }). Sem confirmação, preço zero,
// nome que não bate com o título da página ou estoque contraditório: a página não publica (motivo em .motivo).
// Usado só pela sonda (tools/sonda-adaptadores.mjs, plataforma "tray"); não grava nada.
import { get } from '../http.js';
import { guard, brl } from './common.js';
import { productUrls, transientPageError } from './jsonld.js';
import { jsonLdNodes } from './parse-limits.js';

const AVAIL = { instock: 'IN_STOCK', outofstock: 'OUT_OF_STOCK', soldout: 'OUT_OF_STOCK', preorder: 'PRE_ORDER', backorder: 'PRE_ORDER', discontinued: 'UNAVAILABLE' };
const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
const words = (t) => new Set(norm(t).split(' ').filter((w) => w.length > 1));
/** O nome do Product precisa estar contido no título/h1 da página (tema que injeta outro produto não passa). */
export function nomeConfere(nome, pagina) { const A = words(nome); const B = words(pagina); if (A.size < 2) return false; for (const w of A) if (!B.has(w)) return false; return true; }

/** Preços citados por fontes de máquina da própria página (dataLayer da Tray e GA4 view_item), em reais. */
export function precosSecundarios(html) {
  const h = String(html || ''); const out = [];
  const dl = h.match(/dataLayer\s*=\s*\[\s*(\{[\s\S]*?\})\s*\]/)?.[1];
  if (dl) { try { const o = JSON.parse(dl); for (const [k, v] of Object.entries(o)) if (/price|preco|valor/i.test(k)) { const n = brl(v); if (n) out.push(n); } } catch { /* dataLayer fora do formato: sem confirmação */ } }
  const vi = h.match(/gtag\(\s*['"]event['"]\s*,\s*['"]view_item['"]\s*,\s*(\{[\s\S]*?\})\s*\)/)?.[1];
  if (vi) { try { const o = JSON.parse(vi); const vs = [o.value, ...[].concat(o.items || []).map((i) => i?.price)]; for (const v of vs) { const n = brl(v); if (n) out.push(n); } } catch { /* idem */ } }
  return out;
}

/** Página de produto Tray → anúncio, ou { motivo } quando não dá para confiar. */
export function lerPaginaTray(html, url) {
  const h = String(html || '');
  const { nodes, stats } = jsonLdNodes(h);
  if (stats.tooLarge || stats.tooMany || stats.truncated || stats.tooDeep) return { motivo: 'JSON-LD fora dos limites' };
  const prods = nodes.filter((n) => [].concat(n['@type']).some((t) => /^product$/i.test(String(t))));
  if (prods.length !== 1) return { motivo: prods.length ? 'mais de um Product na página' : 'sem Product no JSON-LD' };
  const p = prods[0];
  const titulo = (h.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || '').replace(/<[^>]+>/g, ' ') + ' ' + (h.match(/<title\b[^>]*>([^<]*)<\/title>/i)?.[1] || '');
  if (!nomeConfere(p.name, titulo)) return { motivo: 'nome do Product não bate com o título da página' };
  const o = [].concat(p.offers || []).find((x) => x && (x.priceCurrency || 'BRL') === 'BRL');
  const preco = brl(o ? o.price ?? null : null);
  if (!preco) return { motivo: 'preço ausente ou zero' };
  const sec = precosSecundarios(h);
  if (!sec.length) return { motivo: 'sem segunda fonte de preço na página' };
  if (!sec.some((v) => Math.abs(v - preco) < 0.005)) return { motivo: `preço não confirmado (JSON-LD ${preco} × ${sec.join('/')})` };
  let stock = AVAIL[String(o.availability || '').split('/').pop().toLowerCase()] || 'UNKNOWN';
  const txt = h.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ');
  if (stock === 'IN_STOCK' && /\b(produto esgotado|indispon[ií]vel no momento)\b/i.test(txt)) stock = 'UNKNOWN'; // contradição: não afirma estoque
  const id = String(p.sku || h.match(/"idProduct"\s*:\s*"?(\d+)/)?.[1] || '').trim() || null;
  let image = [].concat(p.image || [])[0]; if (image && typeof image === 'object') image = image.url || null;
  try { image = image ? new URL(String(image), url).href : null; } catch { image = null; }
  return { title: String(p.name).trim(), url, image, price: { pix: null, base: preco }, listPrice: null, stock, availableFrom: null, quantity: null, sku: id, ean: p.gtin13 || p.gtin || null, seller: null, sourceType: 'json_ld' };
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
