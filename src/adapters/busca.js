// PROVA DE CONCEITO (24/10/2026), fora do robô diário: NÃO está registrado em src/adapters/index.js.
// Leitor pela página de busca da própria loja, para lojas cujo mapa do site não lista os produtos (Kalunga: mapa com
// 1.061 links e 0 produtos). Caminho: página de busca (robots.txt conferido pelo guard) → links de produto do mesmo
// site → página de produto lida pelo mesmo parseProductPage do leitor JSON-LD (preço escrito na página, estoque do
// JSON-LD, sem preço de vitrine). Quem decide se é Pokémon/Copag continua sendo o matching (src/match.js).
// Usado só pela sonda (tools/sonda-adaptadores.mjs, plataforma "busca"); não grava nada.
import { get } from '../http.js';
import { guard } from './common.js';
import { parseProductPage, transientPageError } from './jsonld.js';

// Caminho de página de produto: /prod/<slug>/<id> (Kalunga), /produto(s)/, /p/, /products/.
const PRODUCT_PATH = /^\/(?:prod|produtos?|products?|p)\/[^?#]+/i;
// O link precisa falar de Pokémon no próprio caminho: a busca costuma trazer vitrine de outros produtos.
const POKE = /pok[eé]mon/i;

/** Links de produto do mesmo site citados na página de busca, sem repetição, na ordem em que aparecem. */
export function linksDaBusca(html, base, max = 20) {
  let host; try { host = new URL(base).host.replace(/^www\./, ''); } catch { return []; }
  const out = [];
  for (const [, href] of String(html || '').matchAll(/<a\b[^>]*\bhref=["']([^"'#]+)["']/gi)) {
    let u; try { u = new URL(href.replace(/&amp;/g, '&'), base); } catch { continue; }
    if (!/^https?:$/.test(u.protocol) || u.host.replace(/^www\./, '') !== host) continue;
    let path = u.pathname; try { path = decodeURIComponent(path); } catch { /* fica codificado */ }
    if (!PRODUCT_PATH.test(path) || !POKE.test(path)) continue;
    u.search = ''; u.hash = '';
    if (!out.includes(u.href)) out.push(u.href);
    if (out.length >= max) break;
  }
  return out;
}

/** URL da busca a partir do modelo ({q} = termo codificado). */
export const urlDaBusca = (base, tpl, termo) => new URL(tpl.replace(/\{q\}/g, encodeURIComponent(termo)), base).href;

/**
 * store: { url, buscaTpl } · opts: { termos, max }. Devolve os anúncios lidos (formato do leitor JSON-LD) com
 * .failed / .failReasons (páginas que não abriram) e .diag ({ buscas, links, semLinks }) para a sonda.
 */
export async function search(store, { termos = ['pokemon'], max = 20 } = {}) {
  const base = store.url.replace(/\/$/, '') + '/';
  if (!store.buscaTpl) throw new Error('loja sem modelo de busca');
  const links = []; const diag = { buscas: 0, links: 0, semLinks: [] };
  for (const termo of termos) {
    const u = urlDaBusca(base, store.buscaTpl, termo);
    await guard(u); // robots.txt: se não permitir a busca, para aqui (BlockedError)
    const r = await get(u); diag.buscas++;
    const achados = linksDaBusca(r.text, r.url || u, max);
    if (!achados.length) diag.semLinks.push(termo); // estrutura mudou ou busca vazia: nada é inventado
    for (const l of achados) if (!links.includes(l) && links.length < max) links.push(l);
  }
  diag.links = links.length; Object.defineProperty(diag, 'urls', { value: links.slice(), enumerable: false }); // a sonda abre 3 para diagnóstico
  const out = []; const failed = []; const reasons = {};
  for (const u of links) {
    try { await guard(u); const r = await get(u); const l = parseProductPage(r.text, r.url || u); if (l) out.push(l); }
    catch (e) {
      if (e.blocked && e.status !== 'robots' && e.status !== 'unreachable') throw e;
      if (transientPageError(e)) { failed.push(u); reasons[u] = String(e?.message || 'falha de leitura').slice(0, 120); }
    }
  }
  out.failed = failed; out.failReasons = reasons; out.diag = diag;
  return out;
}
