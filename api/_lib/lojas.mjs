// Frente 7: todas as lojas que o projeto conhece, com link direto para a busca de Pokémon em cada uma.
// Fonte: sources.json do branch data (o mesmo objeto vem dentro do state.json como `sources`) e config/stores.json
// (plataforma/enabled). Os hosts de config/lojas/*.txt não são lidos aqui: o robô já registra cada um deles em
// sources.json (com nome, status e dedupe), e é esse registro que a página mostra. Regras do dono: nunca prejudicar
// uma loja, nunca mostrar preço que o robô não leu, Pix sempre sinalizado, texto honesto ("sem leitura automática", nunca "fora do ar").
// O site (index.html, const LOJAS_CFG) carrega uma cópia literal de LOJAS_CFG: test/lojas-page-tests.js confere.
import fs from 'node:fs';
import { RAW, live } from '../_seo.mjs';

export const LOJAS_CFG = {
  // Busca por plataforma: {q} = termo codificado (encodeURIComponent).
  busca: { shopify: '/search?q={q}', vtex: '/{q}?_q={q}&map=ft', nuvemshop: '/search/?q={q}', tray: '/loja/busca.php?palavra_busca={q}', woocommerce: '/?s={q}&post_type=product', lojaintegrada: '/buscar?q={q}', magento: '/catalogsearch/result/?q={q}', opencart: '/index.php?route=product/search&search={q}' },
  rotulo: { shopify: 'Shopify', vtex: 'VTEX', nuvemshop: 'Nuvemshop', tray: 'Tray', woocommerce: 'WooCommerce', lojaintegrada: 'Loja Integrada', magento: 'Magento', opencart: 'OpenCart', mercadolivre: 'API Mercado Livre' },
  // Marketplaces: busca própria de cada um ({slug} = termo com hífens, {q+} = termo com +). Sem tag de afiliado: só a
  // lista curada "Também na Amazon" leva tag (docs/afiliados.md); a busca é link comum, nada é anexado.
  marketplaces: {
    mercadolivre: { name: 'Mercado Livre', host: 'mercadolivre.com.br', url: 'https://www.mercadolivre.com.br', busca: 'https://lista.mercadolivre.com.br/{slug}' },
    amazon: { name: 'Amazon Brasil', host: 'amazon.com.br', url: 'https://www.amazon.com.br', busca: 'https://www.amazon.com.br/s?k={q+}' },
    shopee: { name: 'Shopee Brasil', host: 'shopee.com.br', url: 'https://shopee.com.br', busca: 'https://shopee.com.br/search?keyword={q}' },
    magalu: { name: 'Magalu', host: 'magazineluiza.com.br', url: 'https://www.magazineluiza.com.br', busca: 'https://www.magazineluiza.com.br/busca/{q}/' },
  },
  // Lojas oficiais de marca dentro de um marketplace: link direto (a leitura do ML vem do catálogo oficial, por produto).
  lojasOficiais: {
    'ml-pokemon': { name: 'Pokémon · loja oficial no Mercado Livre', host: 'mercadolivre.com.br/loja/pokemon', url: 'https://www.mercadolivre.com.br/loja/pokemon', marketplace: 'mercadolivre' },
    'shopee-lvftcg': { name: 'LVF TCG · loja na Shopee', host: 'shopee.com.br/lvftcg', url: 'https://shopee.com.br/lvftcg', marketplace: 'shopee', reason: 'Loja dentro da Shopee: o robô não lê a Shopee; confira os preços na própria loja.' },
    'ml-lvftcg': { name: 'LVF TCG · loja no Mercado Livre', host: 'mercadolivre.com.br/pagina/lvftcg', url: 'https://www.mercadolivre.com.br/pagina/lvftcg', marketplace: 'mercadolivre', reason: 'Vendedor no Mercado Livre: os anúncios entram pela leitura do catálogo quando estão nas páginas de produto.' },
    'shopee-asuamaneirafestas': { name: 'A Sua Maneira Festas · loja na Shopee', host: 'shopee.com.br/asuamaneirafestas', url: 'https://shopee.com.br/asuamaneirafestas', marketplace: 'shopee', reason: 'Loja dentro da Shopee: o robô não lê a Shopee; confira os preços na própria loja.' },
  },
  // Plataforma confirmada na página inicial da loja (marcadores de CDN/meta) em 12/10/2026. O robô só distingue
  // Shopify/VTEX; "jsonld" é método de leitura, não plataforma. Sem confirmação, o link vai para a página inicial.
  plataformaPorHost: { 'gatogingado.com.br': 'lojaintegrada', 'lojalifegeek.com.br': 'lojaintegrada', 'dalaran.com.br': 'lojaintegrada', 'loja.drop1.com.br': 'lojaintegrada', 'omniverse.com.br': 'lojaintegrada',
    'happynerd.com.br': 'tray', 'lojaarenagames.com.br': 'woocommerce', 'supertcg.com.br': 'woocommerce', 'maximuxtcg.com': 'woocommerce', 'grifogeek.com.br': 'woocommerce', 'pokebola.com.br': 'woocommerce', 'cavernatcg.com.br': 'woocommerce',
    'livrariacolecionador.com.br': 'magento', 'cardora.com.br': 'nuvemshop', 'shisuistore.com.br': 'nuvemshop', 'geekworldcascavel.com.br': 'opencart' },
  // Busca própria (plataforma fora da lista) confirmada na mesma data.
  buscaPorHost: { 'kalunga.com.br': '/busca/1?q={q}', 'bravojogos.com.br': '/busca?q={q}', 'kantonerd.com.br': '/selados?search={q}' },
  termo: 'pokemon', termoMarketplace: 'pokemon tcg',
};

export const hostOf = (u) => { try { const x = new URL(String(u || '')); return /^https?:$/.test(x.protocol) ? x.host.toLowerCase().replace(/^www\./, '') : null; } catch { return null; } };
const originOf = (u) => { try { const x = new URL(String(u || '')); return /^https?:$/.test(x.protocol) ? x.origin : null; } catch { return null; } };
const normName = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '');
// {q} codificado; {q+} com + no lugar de espaço; {slug} com hífens (lista.mercadolivre.com.br/pokemon-tcg).
const fill = (tpl, q) => tpl.replace(/\{q\+\}/g, encodeURIComponent(q).replace(/%20/g, '+')).replace(/\{q\}/g, encodeURIComponent(q)).replace(/\{slug\}/g, String(q).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, ''));

// Plataforma a partir das URLs das ofertas daquela loja (padrões inequívocos: /products/ Shopify, /produtos/ Nuvemshop, /p VTEX).
export function inferPlatform(urls) {
  const paths = []; for (const u of urls || []) { try { paths.push(new URL(u).pathname); } catch {} }
  if (!paths.length) return null;
  if (paths.every((p) => /^\/products\//.test(p))) return 'shopify';
  if (paths.every((p) => /^\/produtos\//.test(p))) return 'nuvemshop';
  if (paths.every((p) => /\/p$/.test(p))) return 'vtex';
  return null;
}

/** Modelo da busca da loja: { tpl, kind: 'busca' | 'inicio' }. Sem padrão confirmado, a página inicial. */
export function searchTemplate(loja, cfg = LOJAS_CFG) {
  if (loja.oficial && loja.url) return { tpl: loja.url, kind: 'loja' };
  if (loja.marketplace && cfg.marketplaces[loja.marketplace]) return { tpl: cfg.marketplaces[loja.marketplace].busca, kind: 'busca' };
  const origin = originOf(loja.url); if (!origin) return null;
  const own = loja.host && cfg.buscaPorHost[loja.host];
  if (own) return { tpl: origin + own, kind: 'busca' };
  const p = loja.platform && cfg.busca[loja.platform];
  if (p) return { tpl: origin + p, kind: 'busca' };
  return { tpl: origin + '/', kind: 'inicio' };
}
export function searchUrlFor(loja, q = null, cfg = LOJAS_CFG) { const t = searchTemplate(loja, cfg); return t ? fill(t.tpl, q ?? (loja.marketplace ? cfg.termoMarketplace : cfg.termo)) : null; }

const ST = { ACTIVE: 'monitorada', PAUSED: 'pausada', BLOCKED: 'sem-leitura', ERROR: 'sem-leitura', PENDING: 'sem-leitura', UNAVAILABLE: 'indisponivel' };
// Motivo em texto honesto (nunca "fora do ar"): o que o robô consegue ou não ler, sem julgar a loja.
function reasonOf(src, status) {
  if (status === 'marketplace') return 'Marketplace com muitos vendedores: o robô não lê os preços; confira na busca do próprio site.';
  if (status === 'pausada') return 'Leitura pausada pelo projeto; os preços só aparecem na loja.';
  if (status === 'indisponivel') return 'Sem API pública de busca: o robô não lê os preços desta loja.';
  if (status === 'sem-leitura') {
    if (!src.url) return 'Endereço da loja ainda não confirmado.';
    if (src.errorClass === 'bloqueio' || src.httpStatus === 403) return 'A loja não aceita leitura automática; os preços só aparecem nela.';
    if (src.errorClass === 'plataforma') return 'Plataforma ainda sem leitura automática.';
    if (String(src.status).toUpperCase() === 'PENDING') return 'Leitura ainda não configurada.';
    return 'Sem leitura automática no momento; confira os preços na loja.';
  }
  return null;
}

/**
 * Lista normalizada de lojas. sources: array (state.sources) ou objeto {id: ...} (sources.json); stores: config/stores.json;
 * offers: state.offers (contagem de ofertas vivas e última leitura, nunca preço).
 */
export function normalizeLojas({ sources = [], stores = [], offers = [], cfg = LOJAS_CFG } = {}) {
  const list = Array.isArray(sources) ? sources : Object.entries(sources || {}).map(([id, v]) => ({ id, ...v }));
  const cfgStore = new Map((Array.isArray(stores) ? stores : stores?.stores || []).map((s) => [s.id, s]));
  const mk = cfg.marketplaces;
  const byStore = new Map();
  for (const o of offers) { if (!o?.storeId) continue; if (!byStore.has(o.storeId)) byStore.set(o.storeId, []); byStore.get(o.storeId).push(o); }
  const raw = [];
  for (const s of list) {
    if (!s?.id) continue;
    const c = cfgStore.get(s.id) || {};
    const m = mk[s.id] || null;
    const url = originOf(s.url && !/api\.mercadolibre\.com/.test(s.url) ? s.url : null) || originOf(c.url) || (m ? m.url : null);
    const host = m ? m.host : hostOf(url);
    const up = String(s.status || '').toUpperCase();
    let status = m ? (up === 'ACTIVE' ? 'monitorada' : 'marketplace') : (ST[up] || 'sem-leitura');
    if (c.enabled === false && status === 'monitorada') status = 'pausada';
    const offs = byStore.get(s.id) || [];
    const hint = s.platformHint || (c.platform && cfg.busca[c.platform] ? c.platform : null) || (host && cfg.plataformaPorHost[host]) || (cfg.busca[s.platform] ? s.platform : null) || inferPlatform(offs.map((o) => o.url));
    const stamps = offs.map((o) => Date.parse(o.source_timestamp || '')).filter(Number.isFinite);
    const lastRead = stamps.length ? new Date(Math.max(...stamps)).toISOString() : (s.lastSuccess || null);
    raw.push({ id: s.id, name: m ? m.name : (s.name || c.name || host || s.id), host, url, platform: m ? (s.platform === 'mercadolivre' ? 'mercadolivre' : null) : hint, marketplace: m ? s.id : null, status,
      offersLive: offs.filter(live).length, lastReadAt: status === 'monitorada' ? lastRead : null, reason: reasonOf(s, status), _src: s });
  }
  // Mesmo host duas vezes (amazon × amazon.com.br, mercadolivre × mercadolivre.com.br): fica uma, de preferência a monitorada ou o marketplace.
  const rank = (x) => (x.status === 'monitorada' ? 3 : x.marketplace ? 2 : 1);
  const byHost = new Map();
  for (const x of raw) { if (!x.host) continue; const y = byHost.get(x.host); if (!y || rank(x) > rank(y)) byHost.set(x.host, x); }
  const names = new Set(raw.filter((x) => x.host).map((x) => normName(x.name)));
  const ids = raw.filter((x) => x.host).map((x) => x.id);
  const out = [];
  for (const x of raw) {
    if (x.host) { if (byHost.get(x.host) !== x) continue; }
    else if (names.has(normName(x.name)) || ids.some((id) => id !== x.id && id.startsWith(x.id))) continue;   // pendente que já existe com domínio
    const { _src, ...loja } = x;
    const t = loja.url || loja.marketplace ? searchTemplate(loja, cfg) : null;
    out.push({ ...loja, searchUrl: t ? fill(t.tpl, loja.marketplace ? cfg.termoMarketplace : cfg.termo) : null, searchKind: t ? t.kind : null });
  }
  for (const [id, o] of Object.entries(cfg.lojasOficiais || {})) {
    if (out.some((x) => x.id === id)) continue;
    const loja = { id, name: o.name, host: o.host, url: o.url, platform: null, marketplace: o.marketplace, oficial: true, status: 'marketplace', offersLive: 0, lastReadAt: null,
      reason: o.reason || 'Loja oficial da marca dentro do marketplace; os anúncios dela entram pela leitura do catálogo do Mercado Livre quando estão nas páginas de produto.' };
    out.push({ ...loja, searchUrl: o.url, searchKind: 'loja' });
  }
  const order = { monitorada: 0, 'sem-leitura': 1, indisponivel: 1, marketplace: 2, pausada: 3 };
  out.sort((a, b) => order[a.status] - order[b.status] || b.offersLive - a.offersLive || a.name.localeCompare(b.name, 'pt-BR') || a.id.localeCompare(b.id));
  return out;
}

/** Seções da página /lojas, na ordem. */
export function sections(lojas) {
  return [
    ['monitoradas', 'Monitoradas agora', lojas.filter((l) => l.status === 'monitorada')],
    ['sem-leitura', 'Conhecidas, sem leitura automática', lojas.filter((l) => l.status === 'sem-leitura' || l.status === 'indisponivel')],
    ['marketplaces', 'Marketplaces', lojas.filter((l) => l.status === 'marketplace')],
    ['pausadas', 'Pausadas', lojas.filter((l) => l.status === 'pausada')],
  ];
}

/** "Procurar em outras lojas" do produto: os 4 marketplaces primeiro, depois lojas não monitoradas com busca própria, em ordem alfabética; até `max` links. */
export function outrasLojas(lojas, q, { max = 12, cfg = LOJAS_CFG } = {}) {
  const mk = Object.keys(cfg.marketplaces).map((id) => lojas.find((l) => l.marketplace === id && !l.oficial) || { id, name: cfg.marketplaces[id].name, host: cfg.marketplaces[id].host, url: cfg.marketplaces[id].url, marketplace: id, status: 'marketplace' });
  const of = lojas.filter((l) => l.oficial);
  const rest = lojas.filter((l) => !l.marketplace && l.status !== 'monitorada' && l.searchKind === 'busca').sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));
  return [...mk, ...of, ...rest].slice(0, max).map((l) => ({ id: l.id, name: l.name, host: l.host, url: searchUrlFor(l, q, cfg) })).filter((l) => l.url);
}

// ---- leitura dos dados (servidor) ----
export const RAW_SOURCES = RAW.replace(/state\.json$/, 'sources.json');
let cache = { t: 0, s: null };
/** sources: o array já presente no state.json; sem ele, sources.json do branch data (cache de 10 min, como state()). */
export async function loadSources(st = null) {
  if (Array.isArray(st?.sources) && st.sources.length) return st.sources;
  if (cache.s && Date.now() - cache.t < 10 * 60e3) return cache.s;
  const r = await fetch(RAW_SOURCES); if (!r.ok) throw new Error('sources ' + r.status);
  cache = { t: Date.now(), s: await r.json() }; return cache.s;
}
const STORES_FILE = new URL('../../config/stores.json', import.meta.url);
/** config/stores.json (lojas semeadas: plataforma, enabled). Ausente na função: lista vazia, nunca erro. */
export function readStores() { try { return JSON.parse(fs.readFileSync(STORES_FILE, 'utf8')).stores || []; } catch { return []; } }
export async function lojasFromState(st) {
  return normalizeLojas({ sources: await loadSources(st), stores: readStores(), offers: st?.offers || [] });
}
