// Links de afiliado do Mercado Livre (docs/afiliados.md). Único leitor de config/affiliates.json.
// Regras: (1) afiliado é só o DESTINO do clique: nunca entra em ranking, melhor oferta, preço, frete, estoque ou nota;
// (2) a URL original da oferta continua sendo o dado (o.url) e é o destino sempre que não houver link próprio validado;
// (3) só anúncio do Mercado Livre com link gerado para ELE no painel troca de destino — link geral nunca vai para anúncio;
// (4) o link é usado inteiro, como veio do painel: nada é anexado, montado ou reescrito.
import fs from 'node:fs';
import { setTiePreference } from './offer-rank.mjs';

// Onde ficam os anúncios (URL original da oferta) e para onde um link de afiliado pode levar.
const ML_HOST = /^(?:[a-z0-9-]+\.)*mercadoli(?:vre\.com\.br|bre\.com)$/;
export const DESTINATION_HOSTS = new Set(['meli.la', 'mercadolivre.com.br', 'www.mercadolivre.com.br', 'produto.mercadolivre.com.br']);
const LISTING_ID = /^MLB\d{6,15}$/;

// Id do anúncio (MLB123456789) numa URL do Mercado Livre; null para outra loja, página de catálogo sem vendedor ou URL inválida.
export function mlListingId(url) {
  let u; try { u = new URL(String(url ?? '').trim()); } catch { return null; }
  if ((u.protocol !== 'https:' && u.protocol !== 'http:') || !ML_HOST.test(u.hostname.toLowerCase())) return null;
  const f = (u.searchParams.get('pdp_filters') || '').match(/item_id:(MLB\d{6,15})\b/i);   // página do produto com o vendedor escolhido
  if (f) return f[1].toUpperCase();
  const p = u.pathname.match(/^\/MLB-?(\d{6,15})(?:[-_/]|$)/i);                            // anúncio: produto.mercadolivre.com.br/MLB-123-...
  return p ? 'MLB' + p[1] : null;
}

// Destino aceito: https, sem credenciais, sem porta, sem espaços, num domínio do Mercado Livre. Qualquer outra coisa: null.
export function validDestination(v) {
  if (typeof v !== 'string' || v !== v.trim() || /[\s"'<>\\]/.test(v)) return null;
  let u; try { u = new URL(v); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || u.port || !DESTINATION_HOSTS.has(u.hostname.toLowerCase())) return null;
  if (!/^https:\/\/[^/?#]+\//i.test(v)) return null;   // host escrito exatamente (sem truques de barra/@ antes do caminho)
  return v;
}

// Config bruta -> config usada. Entradas inválidas ficam de fora (e listadas em `rejeitados`), nunca quebram o site.
export function parseAffiliates(raw) {
  const ml = raw && typeof raw === 'object' ? raw.mercadolivre : null;
  const anuncios = {}; const rejeitados = [];
  const map = ml && typeof ml.anuncios === 'object' && !Array.isArray(ml.anuncios) ? ml.anuncios : {};
  for (const [k, v] of Object.entries(map)) {
    const id = String(k).trim().toUpperCase().replace(/^MLB-/, 'MLB'); const dest = validDestination(v);
    if (LISTING_ID.test(id) && dest) anuncios[id] = dest; else rejeitados.push(k);
  }
  const g = ml?.geral; const gUrl = validDestination(g?.url);
  const geral = g && g.ativo === true && g.destinoConfirmado === true && gUrl
    ? { url: gUrl, rotulo: typeof g.rotulo === 'string' && g.rotulo.trim() ? g.rotulo.trim().slice(0, 60) : 'Ver mais no Mercado Livre' } : null;
  return { anuncios, geral, rejeitados };
}

const FILE = new URL('../../config/affiliates.json', import.meta.url);
let cached = null;
export function loadAffiliates({ file = FILE, fresh = false } = {}) {
  if (cached && !fresh) return cached;
  let raw = null; try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { raw = null; }   // ausente ou inválida: tudo como sem afiliado
  cached = parseAffiliates(raw);
  return cached;
}

// Destino do clique para a URL de uma oferta: o link do anúncio, se houver; senão a própria URL, intacta.
export function resolveOutbound(url, cfg = loadAffiliates()) {
  const id = mlListingId(url);
  return (id && cfg?.anuncios?.[id]) || url;
}

// O que o navegador recebe (GET /api/v1/afiliados): só entradas validadas.
export function publicAffiliates(cfg = loadAffiliates(), extra = loadOutrasLojas()) {
  return { v: 1, anuncios: { ...cfg.anuncios }, geral: cfg.geral ? { ...cfg.geral } : null, shopee: { ...extra.shopee }, amazon: { ...extra.amazon } };
}

// Shopee e Amazon (17/10/2026): só para o destino de PISTAS (posts de canais do Telegram), que nunca podem levar ao
// afiliado de quem postou. Shopee: mapa loja/item → link gerado pelo dono (config/afiliados/shopee.json). Amazon:
// ASIN → link curto gerado pelo dono na SiteStripe (shortUrl da lista curada). Nada é montado; produto fora dos mapas
// vai para o anúncio limpo. Entrada inválida fica de fora; arquivo ausente = nada.
const SHOPEE_LINK = /^https:\/\/s\.shopee\.com\.br\/[A-Za-z0-9]+$/;
const SHOPEE_ID = /^\d{3,15}\/\d{3,20}$/;
const AMAZON_CURTO = /^https:\/\/link\.amazon\/[A-Za-z0-9]+$/;
export function parseOutrasLojas(shopeeRaw, amazonRaw) {
  const shopee = {}; const amazon = {};
  for (const [k, v] of Object.entries(shopeeRaw?.links && typeof shopeeRaw.links === 'object' ? shopeeRaw.links : {})) if (SHOPEE_ID.test(k) && typeof v === 'string' && SHOPEE_LINK.test(v)) shopee[k] = v;
  for (const l of Array.isArray(amazonRaw?.links) ? amazonRaw.links : []) if (/^[A-Z0-9]{10}$/.test(l?.asin || '') && AMAZON_CURTO.test(l?.shortUrl || '')) amazon[l.asin] = l.shortUrl;
  return { shopee, amazon };
}
const SHOPEE_FILE = new URL('../../config/afiliados/shopee.json', import.meta.url);
const AMAZON_FILE = new URL('../../config/afiliados/amazon.json', import.meta.url);
let outras = null;
export function loadOutrasLojas({ fresh = false } = {}) {
  if (outras && !fresh) return outras;
  const ler = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
  outras = parseOutrasLojas(ler(SHOPEE_FILE), ler(AMAZON_FILE));
  return outras;
}

// Desempate do dono (17/10/2026, docs/afiliados.md): com o MESMO total comparável, a oferta cujo anúncio do ML tem link
// de afiliado no mapa fica antes. Nunca passa uma oferta mais barata (o offer-rank só consulta isto em empate).
export function afiliadoPreferido(cfg = null) {
  return (o) => { const id = mlListingId(o?.url); return !!(id && (cfg || loadAffiliates()).anuncios?.[id]); };
}
/** Registra o desempate no offer-rank. Chamado pelas rotas que mostram ofertas (api/v1.mjs, api/pagina.mjs). */
export function registrarDesempate(cfg = null) { setTiePreference(afiliadoPreferido(cfg)); }

// ---------------------------------------------------------------------------------------------------------------------
// SITE SÓ COM PARCEIROS (decisão do proprietário em 07/11/2026, docs/afiliados.md). O site público mostra apenas ofertas
// que levam o link de afiliado do dono: anúncios do Mercado Livre com link no mapa + leituras manuais da Amazon e da
// Shopee. O restante da coleta vira só referência de mercado. As funções abaixo são o ÚNICO ponto que decide isso; quem
// as chama (src/core/parceiros.js) não lê configuração de afiliado. Ordenação entre parceiros continua por preço/nota:
// a comissão não reordena (afiliadoPreferido segue sendo só desempate de total igual).
// ---------------------------------------------------------------------------------------------------------------------
import crypto from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Lojas cujas ofertas podem aparecer no site quando SITE_SO_PARCEIROS=1. */
export const LOJAS_PARCEIRAS = Object.freeze(['mercadolivre', 'amazon', 'shopee']);

/** Oferta do Mercado Livre cujo anúncio (MLB) tem link de afiliado do dono no mapa. Qualquer outra: false. */
export function ofertaParceira(o, cfg = null) {
  const id = mlListingId(o?.url);
  return !!(id && (cfg || loadAffiliates()).anuncios?.[id]);
}

/** Carrega a configuração dos parceiros de uma pasta de config (HUNTER_CONFIG_DIR nos testes); sem pasta, a do repositório. */
export function carregarParceiros({ dir = null } = {}) {
  const base = dir ? path.resolve(dir) : path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../config');
  const ler = (...p) => { try { return JSON.parse(fs.readFileSync(path.join(base, ...p), 'utf8')); } catch { return null; } };
  return { cfg: parseAffiliates(ler('affiliates.json')), amazon: ler('afiliados', 'amazon.json'), shopee: ler('afiliados', 'shopee-ofertas.json') };
}

const SEM_OFERTA = /esgotad|indispon|sem oferta|sem estoque|n[ãa]o dispon/i;
const FUTURO_MS = 5 * 60e3;   // mesma folga de relógio do restante do projeto (src/adapters/contract.js)
const idDe = (storeId, url) => crypto.createHash('sha1').update(`${storeId}|${url}|`).digest('hex').slice(0, 12);

/**
 * Leituras manuais do dono (Amazon e Shopee) no formato de oferta do robô (src/run.js). Só entra a leitura com preço, sem
 * "esgotado/sem oferta", com link curto do dono, de produto que existe, lida há no máximo `maxHoras` e não no futuro:
 * cada leitura some sozinha quando vence. Frete NUNCA vira zero: fica desconhecido e o total é só o preço.
 * Shopee: price = preço sem cupom (priceCupom segue como campo extra). products: mapa/lista/Set de ids de produto.
 */
export function ofertasManuaisParceiras({ now = new Date(), maxHoras = 48, products = {}, amazon = undefined, shopee = undefined } = {}) {
  if (amazon === undefined || shopee === undefined) {
    const lido = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
    if (amazon === undefined) amazon = lido(AMAZON_FILE);
    if (shopee === undefined) shopee = lido(new URL('../../config/afiliados/shopee-ofertas.json', import.meta.url));
  }
  const ids = products instanceof Set ? products : new Set(Array.isArray(products) ? products.map((p) => p?.id ?? p) : Object.keys(products || {}));
  const t0 = (now instanceof Date ? now : new Date(now)).getTime();
  const limite = Math.max(0, Number(maxHoras)) * 3600e3;
  const recente = (iso) => { const t = Date.parse(iso ?? ''); return Number.isFinite(t) && t <= t0 + FUTURO_MS && t0 - t <= limite ? new Date(t).toISOString() : null; };
  const base = (storeId, storeName, e, at, extra) => {
    const price = Math.round(Number(e.price) * 100) / 100;
    return {
      id: idDe(storeId, extra.url), productId: e.productId, matchConfidence: 1, storeId, storeName, storeKind: 'marketplace',
      seller: e.seller || null, sellerId: null, sellerKind: 'marketplace_seller', title: e.title, url: extra.url, image: null, sku: extra.sku, ean: null,
      prices: { base: price }, listPrice: null, price, priceKind: 'base', priceKindLabel: 'preço da loja',
      shipping: null, shippingKnown: false, shippingAt: null, shippingError: null, total: price, perBooster: null,
      stock: 'IN_STOCK', availableFrom: null, quantity: extra.quantity ?? null, sourceType: 'manual_afiliado', source_url: extra.url, source_timestamp: at,
      firstSeen: at, stale: false, confirmed: true, manual: true, capturedAt: at, ...(extra.campos || {}),
    };
  };
  const ok = (e, at) => at && ids.has(e?.productId) && Number.isFinite(Number(e.price)) && Number(e.price) > 0 && typeof e.title === 'string' && e.title && !SEM_OFERTA.test(String(e.stockNote ?? ''));
  const out = [];
  for (const l of Array.isArray(amazon?.links) ? amazon.links : []) {
    const at = recente(l?.capturedAt);
    if (!ok(l, at) || !/^[A-Z0-9]{10}$/.test(l.asin || '') || !AMAZON_CURTO.test(l.shortUrl || '')) continue;
    const q = /somente\s+(\d+)\s+em estoque/i.exec(l.stockNote || '');
    out.push(base('amazon', 'Amazon', l, at, { url: l.shortUrl, sku: l.asin, quantity: q ? Number(q[1]) : null, campos: { fulfilledBy: l.fulfilledBy ?? null } }));
  }
  for (const s of Array.isArray(shopee?.ofertas) ? shopee.ofertas : []) {
    const at = recente(s?.capturedAt);
    if (!ok(s, at) || !SHOPEE_ID.test(s.item || '') || !SHOPEE_LINK.test(s.url || '')) continue;
    const cupom = Number(s.priceCupom);
    out.push(base('shopee', 'Shopee', s, at, { url: s.url, sku: s.item, campos: { selo: s.selo ?? null, ...(Number.isFinite(cupom) && cupom > 0 ? { priceCupom: Math.round(cupom * 100) / 100 } : {}) } }));
  }
  // Mesmo link repetido na lista: fica a leitura mais recente.
  const porId = new Map();
  for (const o of out) { const x = porId.get(o.id); if (!x || o.source_timestamp > x.source_timestamp) porId.set(o.id, o); }
  return [...porId.values()].sort((a, b) => a.id.localeCompare(b.id));
}
