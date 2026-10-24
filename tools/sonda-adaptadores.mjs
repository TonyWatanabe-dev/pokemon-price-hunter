#!/usr/bin/env node
// Sonda SOMENTE LEITURA: para lojas que hoje são lidas pelo leitor genérico (JSON-LD) e que o agente de saúde aponta com
// adaptador dedicado disponível (VTEX/Shopify), roda o adaptador dedicado UMA vez e compara com a última rodada real.
// Não grava nada (nem data/, nem config/, nem banco), usa o mesmo guard (robots.txt) e o mesmo User-Agent dos adaptadores.
// Uso: node tools/sonda-adaptadores.mjs [pasta-data] --lojas id:plataforma,id:plataforma [--json saida.json]
// A anotação de cada loja traz até 6 títulos inválidos (com o motivo) e 6 válidos que não casaram, para triar lojas lidas sem produto.
import fs from 'node:fs';
import path from 'node:path';
import { adapters } from '../src/adapters/index.js';
import { validateListing } from '../src/adapters/contract.js';
import { matchProduct } from '../src/match.js';
import { readJson, configPath } from '../src/db.js';
import { jsonLdNodes } from '../src/adapters/parse-limits.js';

const loadCatalog = () => { const c = readJson(configPath('catalog.json')); c.products ||= []; c.copag ||= {}; return c; };

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const dir = args.find((a, i) => !a.startsWith('--') && !['--lojas', '--json'].includes(args[i - 1])) || 'data';
// 'busca': prova de conceito do leitor pela página de busca da loja (src/adapters/busca.js), fora do robô diário.
const PLAT = new Set(['vtex', 'shopify', 'woocommerce', 'jsonld', 'busca']);
export const parseLojas = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean).map((x) => { const [id, p] = x.split(':'); return { id, plataforma: p }; })
  .filter((x) => /^[a-z0-9]{2,60}$/.test(x.id) && PLAT.has(x.plataforma));

/** Veredito: o dedicado só "passa" se casar pelo menos tantos produtos quanto o genérico e ler anúncios válidos. */
export function veredito({ atual, sonda }) {
  if (sonda.erro) return 'falhou';
  if (!sonda.validos) return 'sem_anuncios';
  return sonda.casados >= (atual.casados || 0) ? 'passa' : 'pior';
}

/** Amostra para triagem (só leitura): até `max` anúncios inválidos (1º motivo) e até `max` válidos que não casaram (motivo do casamento). */
export function amostra(raw, store, catalog, { now = new Date(), max = 6 } = {}) {
  const invalidos = []; const naoCasados = [];
  for (const l of raw) {
    const v = validateListing(l, store, { now });
    const t = String(l?.title || '').replace(/\s+/g, ' ').slice(0, 90);
    if (!v.ok) { if (invalidos.length < max) invalidos.push(`${t} — ${String(v.reasons[0] || '').slice(0, 80)}`); continue; }
    const m = matchProduct(l, catalog);
    if (!m.productId && naoCasados.length < max) naoCasados.push(`${t} — ${(m.why || []).join('; ').slice(0, 60) || 'sem motivo'}`);
  }
  return { invalidos, naoCasados };
}

/** Resumo de uma página de produto (só leitura): quantos Product no JSON-LD, se tem preço em meta og/product e se o leitor publica. */
export function resumoPagina(html, url, parse) {
  const { nodes } = jsonLdNodes(html);
  const ld = nodes.filter((n) => [].concat(n['@type']).some((t) => /^product$/i.test(String(t)))).length;
  const og = /<meta[^>]+(?:product|og):price:amount/i.test(html);
  let caminho = url; try { caminho = decodeURIComponent(new URL(url).pathname).slice(0, 70); } catch { /* fica a URL */ }
  // Para achar o motivo da recusa: nome do Product × título da página, preço do JSON-LD e se esse preço aparece escrito.
  const prod = nodes.find((n) => [].concat(n['@type']).some((t) => /^product$/i.test(String(t))));
  const titulo = (html.match(/<meta[^>]+property=["']og:title["'][^>]+content=["']([^"']+)/i)?.[1] || html.match(/<title[^>]*>([^<]+)<\/title>/i)?.[1] || '').trim().slice(0, 60);
  const oferta = prod ? [].concat(prod.offers || [])[0] : null;
  const preco = oferta ? (oferta.price ?? oferta.lowPrice ?? oferta.priceSpecification?.price ?? null) : null;
  const escrito = preco != null && Number.isFinite(Number(preco)) ? html.includes(Number(preco).toFixed(2).replace('.', ',')) : null;
  return { caminho, ld, og, publica: !!parse(html, url), ...(prod ? { nome: String(prod.name || '').slice(0, 60), titulo, preco, escrito } : {}) };
}
/** Marcadores de plataforma e de estado da página (só leitura, sem guardar a página): explica recusa sem JSON-LD útil. */
export function marcadores(html) {
  const h = String(html || ''); const txt = h.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
  const precos = [...txt.matchAll(/R\$\s?[\d.]+,\d{2}/g)].slice(0, 3).map((m) => txt.slice(Math.max(0, m.index - 40), m.index + m[0].length + 25).trim());
  return {
    tamanho: h.length,
    tituloTag: (h.match(/<title\b[^>]*>([^<]*)<\/title>/i)?.[1] || '').replace(/\s+/g, ' ').trim().slice(0, 60),
    h1: (h.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1] || '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60),
    nuvemshop: /LS\.product\s*=/.test(h), variantes: /LS\.variants\s*=/.test(h),
    tray: /\/loja\/arquivos\/|tray\.com\.br|traycorp/i.test(h), microdata: (h.match(/itemprop=["']price["']/gi) || []).length,
    dataLayer: /dataLayer/.test(h), esgotado: /esgotad|indispon[ií]vel|avise-?me/i.test(txt), naoEncontrado: /n[aã]o encontrad|p[aá]gina n[aã]o existe|404/i.test(txt),
    precos,
    // trecho do dataLayer com preço/produto (Tray põe o preço só no código): 240 caracteres, sem guardar a página
    dataLayerTrecho: (() => { const i = h.search(/dataLayer[\s\S]{0,400}?(price|preco|valor)/i); return i < 0 ? null : h.slice(i, i + 240).replace(/\s+/g, ' '); })(),
  };
}
/** Contagem das páginas diagnosticadas: publicadas, página de erro (404 com HTTP 200 ou h1 de erro), sem dados, falha de rede. */
export function resumoOfertas(ps) {
  const r = { paginas: ps.length, publica: 0, erro404: 0, falha: 0, semDados: 0 };
  for (const p of ps) { if (p.erro) r.falha++; else if (p.publica) r.publica++; else if (p.m?.naoEncontrado || /\b404\b|erro/i.test(p.m?.h1 || '')) r.erro404++; else r.semDados++; }
  return r;
}
async function diagnosticoPaginas(urls) {
  const { get } = await import('../src/http.js'); const { guard } = await import('../src/adapters/common.js'); const { parseProductPage } = await import('../src/adapters/jsonld.js');
  const out = [];
  for (const u of urls) { try { await guard(u); const r = await get(u); out.push({ ...resumoPagina(r.text, r.url || u, parseProductPage), m: marcadores(r.text) }); } catch (e) { out.push({ caminho: u.replace(/^https?:\/\/[^/]+/, '').slice(0, 70), erro: String(e?.status || e?.code || e?.message).slice(0, 40) }); } }
  return out;
}

// Uma anotação por loja (o GitHub limita anotações por passo): a amostra vai na mesma linha.
export const textoAmostra = (a) => (!a ? '' : (a.invalidos.length ? ` · inválidos: ${a.invalidos.join(' | ')}` : '') + (a.naoCasados.length ? ` · não casaram: ${a.naoCasados.join(' | ')}` : ''));

const anota = (nivel, msg) => { console.log(msg); if (process.env.GITHUB_ACTIONS) console.log(`::${nivel}::${msg}`); };

async function main() {
  const lojas = parseLojas(opt('--lojas'));
  if (!lojas.length) { console.error('informe --lojas id:vtex,id:shopify'); process.exit(2); }
  const sources = JSON.parse(fs.readFileSync(path.join(dir, 'sources.json'), 'utf8'));
  const cfg = JSON.parse(fs.readFileSync('config/stores.json', 'utf8')).stores || [];
  const catalog = loadCatalog(); const out = [];
  for (const { id, plataforma } of lojas) {
    const src = sources[id] || {}; const c = cfg.find((s) => s.id === id) || {};
    const url = c.url || src.url;
    const atual = { plataforma: src.platform ?? null, anuncios: src.listings ?? null, casados: src.matched ?? null };
    const sonda = { plataforma, anuncios: 0, validos: 0, casados: 0, erro: null, ms: 0 };
    const t0 = Date.now();
    try {
      if (!url) throw new Error('loja sem URL');
      const store = { ...c, id, name: c.name || src.name || id, url, platform: plataforma };
      // JSON-LD: também conta as páginas de produto Pokémon que o mapa do site expõe (diagnóstico de "plataforma não reconhecida").
      if (plataforma === 'jsonld') { const { productUrls } = await import('../src/adapters/jsonld.js'); const { sitemapsOf } = await import('../src/robots.js');
        const mapas = await sitemapsOf(url.replace(/\/$/, '') + '/').catch(() => []); sonda.mapas = mapas.length; const pu = await productUrls(url.replace(/\/$/, ''), 60).catch(() => []); sonda.urlsProduto = pu.length; sonda.paginas = await diagnosticoPaginas(pu.slice(0, 3));
        // páginas das ofertas que a loja já teve (data/offers.json): explica loja que lia produto e passou a ler 0
        const ofertas = (() => { try { const o = JSON.parse(fs.readFileSync(path.join(dir, 'offers.json'), 'utf8')); return (Array.isArray(o) ? o : Object.values(o.offers || o)).filter((x) => x?.storeId === id).map((x) => x.url); } catch { return []; } })();
        if (ofertas.length) { const us = [...new Set(ofertas)]; sonda.paginasOfertas = await diagnosticoPaginas(us.slice(0, 3));
          // resumo de até 30 páginas das ofertas atuais: quantas viraram página de erro, quantas ainda mostram o produto
          if (us.length > 3) sonda.resumoOfertas = resumoOfertas(await diagnosticoPaginas(us.slice(0, 30))); }
        // diagnóstico do 1º mapa declarado: quantos <loc>, quantos mapas filhos e os nomes de 3 (só leitura, com o guard)
        if (mapas[0]) { try { const { get } = await import('../src/http.js'); const { guard } = await import('../src/adapters/common.js'); await guard(mapas[0]);
          const xml = (await get(mapas[0], { accept: 'application/xml' })).text; const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);
          const filhos = locs.filter((l) => /\.xml(\.gz)?$/i.test(l)); sonda.mapa = { url: mapas[0], locs: locs.length, filhos: filhos.length, exemplos: filhos.slice(0, 3).map((l) => l.replace(/^https?:\/\/[^/]+/, '')), pokemon: locs.filter((l) => /pokemon/i.test(l)).length };
        } catch (e) { sonda.mapa = { url: mapas[0], erro: String(e?.status || e?.code || e?.message).slice(0, 60) }; } } }
      let raw;
      if (plataforma === 'busca') {
        const { LOJAS_CFG, hostOf } = await import('../api/_lib/lojas.mjs'); const { search } = await import('../src/adapters/busca.js');
        const buscaTpl = LOJAS_CFG.buscaPorHost[hostOf(url)]; if (!buscaTpl) throw new Error('loja sem modelo de busca confirmado');
        raw = await search({ ...store, buscaTpl }, { termos: ['pokemon', 'pokemon tcg', 'booster pokemon'] }); sonda.busca = raw.diag; sonda.falhas = raw.failed.length; if (!raw.length && raw.diag.urls?.length) sonda.paginas = await diagnosticoPaginas(raw.diag.urls.slice(0, 3));
        sonda.lidos = raw.slice(0, 8).map((l) => `${String(l.title).slice(0, 70)} → ${matchProduct(l, catalog).productId || 'sem produto'} · R$ ${l.price.pix ?? l.price.base} · ${l.stock} · sku ${l.sku ?? '?'}`);
      } else raw = await adapters[plataforma].search(store, catalog);
      sonda.anuncios = raw.length;
      const ok = raw.filter((l) => validateListing(l, store, { now: new Date() }).ok);
      sonda.validos = ok.length;
      sonda.casados = new Set(ok.map((l) => matchProduct(l, catalog).productId).filter(Boolean)).size;
      sonda.amostra = amostra(raw, store, catalog);
    } catch (e) { sonda.erro = String(e?.status || e?.code || e?.message || e).slice(0, 120); }
    sonda.ms = Date.now() - t0;
    const v = veredito({ atual, sonda }); out.push({ id, url, atual, sonda, veredito: v });
    anota(v === 'passa' ? 'notice' : 'warning', `${id} · ${plataforma}: ${v} · dedicado ${sonda.validos} válidos/${sonda.casados} produtos${sonda.erro ? ' · erro ' + sonda.erro : ''}${sonda.urlsProduto != null ? ` · mapas no robots ${sonda.mapas} · páginas de produto ${sonda.urlsProduto}${sonda.mapa ? ' · mapa ' + JSON.stringify(sonda.mapa) : ''}${sonda.paginas?.length ? ' · páginas ' + JSON.stringify(sonda.paginas) : ''}${sonda.paginasOfertas ? ' · páginas das ofertas atuais ' + JSON.stringify(sonda.paginasOfertas) : ''}${sonda.resumoOfertas ? ' · resumo das ofertas atuais ' + JSON.stringify(sonda.resumoOfertas) : ''}` : ''} · genérico hoje ${atual.anuncios ?? '?'} anúncios/${atual.casados ?? '?'} casados · ${Math.round(sonda.ms / 1000)} s${sonda.busca ? ` · busca ${JSON.stringify(sonda.busca)}${sonda.paginas?.length ? ' · páginas ' + JSON.stringify(sonda.paginas) : ''} · falhas ${sonda.falhas} · lidos: ${sonda.lidos.join(' | ')}` : ''}${textoAmostra(sonda.amostra)}`);
  }
  if (opt('--json')) fs.writeFileSync(opt('--json'), JSON.stringify(out, null, 2) + '\n');
}
if (import.meta.url === `file://${process.argv[1]}`) await main();
