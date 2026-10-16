// Pista do Mercado Livre que vira oferta normal (decisão do dono, 16/10/2026: "Pistas ficou muitos. Eu incluiria nos
// produtos normais"). Uma pista (src/tips.js) com produto identificado e link meli.la/MLB é conferida na API oficial
// do ML (/items/MLB…, mesma leitura de src/inbox.js readLink e do adaptador src/adapters/mercadolivre.js). Só vira oferta
// com prova: anúncio ativo, novo, com estoque, do MESMO produto da pista e com preço no máximo 10% acima do postado
// (acima disso a promoção acabou). Shopee e Amazon continuam só como pista: não há API para conferir.
// Módulo puro: fetch, token, relógio e matching são injetados; nunca lança e nunca devolve o token.
import { catalogStock, trustedSeller } from './adapters/mercadolivre.js';
import { matchProduct as defaultMatch } from './match.js';
import { assertSafeUrl } from './urlguard.js';
import { pickPrice, PRICE_LABEL } from './score.js';

export const API = 'https://api.mercadolibre.com';
export const STORE_ID = 'mercadolivre';
export const SOURCE_TYPE = 'pista_verificada';
export const STOCK_SOURCE = 'ml-api-item';
export const TOLERANCIA_PRECO = 1.10; // anúncio até 10% acima do preço da pista ainda é a mesma promoção
const UA = process.env.HUNTER_UA || 'PokeHunterBR/1.0 (monitor pessoal de precos; respeita robots.txt)';
const MAX_SALTOS = 3;
const TIMEOUT_MS = 10000;
const round2 = (v) => (v == null ? null : Math.round(v * 100) / 100);
const https = (u) => (typeof u === 'string' && u ? u.replace(/^http:/, 'https:') : null);

/** Link que pode ser conferido: encurtador meli.la ou URL que já traz o id do anúncio (MLB…). */
export const ehLinkML = (url) => { try { const h = new URL(url).hostname.toLowerCase().replace(/^www\./, ''); return h === 'meli.la' || ((h === 'mercadolivre.com.br' || h.endsWith('.mercadolivre.com.br')) && !!mlbDeUrl(url)); } catch { return false; } };

/** Id do anúncio (MLB + dígitos) numa URL do ML. `/p/MLB…` é o id de catálogo, não do anúncio: só vale com item_id. */
export function mlbDeUrl(url) {
  const s = String(url || '');
  const byItem = s.match(/item_id(?::|%3A)MLB-?(\d{6,})/i); if (byItem) return 'MLB' + byItem[1];
  const semCatalogo = s.replace(/\/p\/MLB-?\d+/gi, '');
  const m = semCatalogo.match(/MLB-?(\d{6,})/i);
  return m ? 'MLB' + m[1] : null;
}

/** Resolve meli.la/… seguindo só os cabeçalhos Location (GET com redirect manual, no máximo 3 saltos, 10 s por salto,
 * sem ler o HTML do anúncio). Devolve { mlb, erro }: erro é falha de rede/timeout (vale tentar de novo); sem erro e sem
 * mlb, o link não leva a um anúncio. Aceita URL que já traz o MLB (sem ir à rede). */
export async function resolverLink(url, { fetch = globalThis.fetch, timeoutMs = TIMEOUT_MS } = {}) {
  let cur = String(url || '');
  const direto = mlbDeUrl(cur); if (direto) return { mlb: direto, erro: null };
  try {
    for (let hop = 0; hop <= MAX_SALTOS; hop++) {
      assertSafeUrl(cur);
      const res = await fetch(cur, { method: 'GET', redirect: 'manual', headers: { 'user-agent': UA, accept: 'text/html' }, signal: AbortSignal.timeout(timeoutMs) });
      const loc = res && res.status >= 300 && res.status < 400 ? res.headers?.get?.('location') : null;
      if (!loc) { try { await res?.body?.cancel?.(); } catch { /* corpo já fechado */ } return { mlb: mlbDeUrl(res?.url || cur), erro: null }; }
      cur = new URL(loc, cur).href;
      const achou = mlbDeUrl(cur); if (achou) return { mlb: achou, erro: null }; // não precisa baixar a página do anúncio
    }
    return { mlb: null, erro: null };
  } catch (e) {
    if (e?.unsafe) return { mlb: null, erro: null }; // destino privado/inválido: não é anúncio
    return { mlb: null, erro: String(e?.code || e?.message || e?.name || e).slice(0, 60) };
  }
}
/** Só o id: null se não achar (por qualquer motivo). */
export const mlbDeLink = async (url, opts) => (await resolverLink(url, opts)).mlb;

// Motivos de recusa que não mudam com o tempo: a pista não é conferida de novo.
export const MOTIVOS_DEFINITIVOS = new Set(['link sem MLB', 'anúncio não encontrado', 'usado', 'outro produto']);

/**
 * Confere a pista na API oficial. Devolve { ok, motivo, oferta, mlb, produto }. `oferta` sai no formato do anúncio do
 * adaptador do ML (title, url, price { base }, listPrice, stock…) mais os campos da oferta (storeId, source_url…).
 */
export async function verificarPista(tip, { fetch = globalThis.fetch, token, catalog, matchProduct = defaultMatch, mlb = null, now = new Date(), exigirReputacao = true, timeoutMs = TIMEOUT_MS } = {}) {
  const rec = (motivo, extra = {}) => ({ ok: false, motivo, oferta: null, mlb: mlb || null, ...extra });
  try {
    if (!tip || !tip.productId) return rec('pista sem produto');
    if (!token) return rec('sem token do Mercado Livre');
    if (!mlb) { const r = await resolverLink(tip.url, { fetch, timeoutMs }); if (r.erro) return rec(`falha de rede (${r.erro})`); mlb = r.mlb; }
    if (!mlb) return rec('link sem MLB');
    const H = { headers: { authorization: `Bearer ${token}`, accept: 'application/json', 'user-agent': UA }, signal: AbortSignal.timeout(timeoutMs) };
    const res = await fetch(`${API}/items/${mlb}`, H);
    if (!res || res.status === 404) return rec('anúncio não encontrado');
    if (res.status === 401 || res.status === 403) return rec(`API do ML recusou (${res.status})`);
    if (!res.ok) return rec(`API do ML respondeu ${res.status}`);
    const j = await res.json();
    if (!j || typeof j !== 'object' || !j.id) return rec('resposta da API sem anúncio');
    if (j.status !== 'active') return rec(`status ${j.status || 'desconhecido'}`);
    if (j.condition && j.condition !== 'new') return rec('usado');
    const st = catalogStock(j, STOCK_SOURCE);
    if (st.stock !== 'IN_STOCK') return rec(st.stock === 'OUT_OF_STOCK' ? 'sem estoque' : 'estoque não informado');
    const price = Number(j.price);
    if (!(price > 0)) return rec('sem preço');
    if (tip.price > 0 && price > tip.price * TOLERANCIA_PRECO) return rec(`preço subiu (${price} > ${tip.price})`);
    const m = matchProduct({ title: j.title || '', url: j.permalink || '' }, catalog);
    if (!m.productId || m.productId !== tip.productId) return rec('outro produto', { produto: m.product || null });
    if (!j.permalink) return rec('anúncio sem link');
    const official = j.official_store_id != null;
    let sellerName = j.official_store_name || null;
    if (j.seller_id != null) {
      try {
        const r = await fetch(`${API}/users/${j.seller_id}`, H);
        const u = r && r.ok ? await r.json() : null;
        if (!u) { if (exigirReputacao && !official) return rec('reputação do vendedor indisponível'); }
        else {
          sellerName ||= u.nickname || null;
          const rep = u.seller_reputation || {};
          const v = { level: rep.level_id || null, sales: rep.transactions?.completed ?? rep.transactions?.total ?? 0 };
          if (exigirReputacao && !official && !trustedSeller(v)) return rec('vendedor sem reputação');
        }
      } catch { if (exigirReputacao && !official) return rec('reputação do vendedor indisponível'); }
    }
    const readAt = now.toISOString();
    const oferta = {
      storeId: STORE_ID, storeName: 'Mercado Livre', storeKind: 'marketplace',
      title: j.title, url: j.permalink, price: { base: price }, listPrice: j.original_price > price ? j.original_price : null,
      stock: 'IN_STOCK', quantity: st.quantity, stockSource: STOCK_SOURCE,
      shipping: j.shipping?.free_shipping ? 0 : null, sku: j.id, ean: null,
      image: https(j.pictures?.[0]?.secure_url || j.pictures?.[0]?.url || j.thumbnail) || null,
      seller: sellerName || 'Vendedor no Mercado Livre', sellerId: j.seller_id != null ? String(j.seller_id) : null,
      sellerKind: official ? 'official_store' : 'marketplace_seller',
      sourceType: SOURCE_TYPE, source_url: tip.postUrl || tip.url, source_timestamp: readAt,
      matchConfidence: tip.matchConfidence || m.confidence || 0, confirmed: true, pista: tip.id,
    };
    return { ok: true, motivo: null, oferta, mlb, produto: m.product };
  } catch (e) {
    return rec(`falha de rede (${String(e?.code || e?.message || e?.name || e).slice(0, 60)})`);
  }
}

/** Pistas que merecem conferência nesta rodada: com produto, link do ML, não expiradas, não anômalas, com preço, ainda
 * não conferidas (ou conferidas há mais de revalidarMin, salvo recusa definitiva). Maior desconto primeiro. */
export function pistasParaVerificar(tipStore, { now = new Date(), max = 10, revalidarMin = 60 } = {}) {
  const t0 = now.getTime(); const janela = revalidarMin * 60e3;
  const lim = Number.isFinite(Number(max)) && Number(max) > 0 ? Math.floor(Number(max)) : 10;
  return Object.values(tipStore || {}).filter((t) => {
    if (!t || !t.productId || !(t.price > 0) || t.expired || t.anomalous || !ehLinkML(t.url)) return false;
    const v = t.verificada;
    if (!v) return true;
    if (!v.ok && MOTIVOS_DEFINITIVOS.has(v.motivo)) return false;
    const at = Date.parse(v.at ?? '');
    return !Number.isFinite(at) || t0 - at >= janela;
  }).sort((a, b) => (b.discount ?? -9) - (a.discount ?? -9) || String(b.postedAt || b.firstSeen || '').localeCompare(String(a.postedAt || a.firstSeen || ''))).slice(0, lim);
}

/** Oferta do ML já publicada para o mesmo anúncio (mesmo link ou mesmo MLB): id dela, ou null. */
export function ofertaDuplicada(oferta, offers, mlb = null) {
  const alvo = mlb || mlbDeUrl(oferta?.url) || null;
  for (const o of Object.values(offers || {})) {
    if (!o || o.storeId !== STORE_ID || o.sourceType === SOURCE_TYPE) continue;
    if (oferta?.url && o.url === oferta.url) return o.id;
    if (alvo && (String(o.sku || '').toUpperCase() === alvo || mlbDeUrl(o.url) === alvo)) return o.id;
  }
  return null;
}

/** Registro da oferta como src/run.js grava em offers.json (mesmos campos do anúncio do ML que casou). */
export function registroDeOferta(oferta, { id, T, prev = null }) {
  const pp = pickPrice(oferta.price);
  const ship = oferta.shipping ?? null;
  const total = pp.value != null ? round2(pp.value + (ship || 0)) : null;
  return {
    id, productId: oferta.productId, matchConfidence: oferta.matchConfidence, storeId: oferta.storeId, storeName: oferta.storeName, storeKind: oferta.storeKind,
    seller: oferta.seller || null, sellerId: oferta.sellerId ?? null, sellerKind: oferta.sellerKind,
    title: oferta.title, url: oferta.url, image: oferta.image || null, sku: oferta.sku || null, ean: null,
    prices: oferta.price, listPrice: oferta.listPrice || null, price: pp.value, priceKind: pp.kind, priceKindLabel: PRICE_LABEL[pp.kind] || '-',
    shipping: ship, shippingKnown: ship != null, shippingAt: ship != null ? T : null, shippingError: null,
    total, perBooster: oferta.boosters && total ? round2(total / oferta.boosters) : null,
    stock: 'IN_STOCK', availableFrom: null, quantity: oferta.quantity ?? null, stockSource: oferta.stockSource,
    sourceType: SOURCE_TYPE, source_url: oferta.source_url, source_timestamp: oferta.source_timestamp,
    pista: oferta.pista, firstSeen: prev?.firstSeen || T, stale: false,
  };
}

/**
 * Confere as pistas selecionadas e anota cada uma em tipStore[id].verificada = { at, ok, motivo, mlb, ofertaId }.
 * Devolve as ofertas aprovadas (ainda sem id: quem integra em offers decide o id e o dedupe). Tolera qualquer falha.
 */
export async function verificarPistas(tipStore, { fetch = globalThis.fetch, token, catalog, matchProduct = defaultMatch, now = new Date(), max = 10, revalidarMin = 60, log = () => {}, exigirReputacao = true } = {}) {
  const out = []; const fila = pistasParaVerificar(tipStore, { now, max, revalidarMin });
  for (const t of fila) {
    const r = await verificarPista(t, { fetch, token, catalog, matchProduct, now, exigirReputacao });
    const antes = t.verificada || null;
    t.verificada = { at: now.toISOString(), ok: r.ok, motivo: r.motivo, mlb: r.mlb || antes?.mlb || null, ofertaId: r.ok ? antes?.ofertaId || null : null };
    if (!r.ok) { delete t.virouOferta; log(`[pistas] ${t.id} (${t.productId}): ${r.motivo}`); continue; }
    out.push({ tip: t, oferta: { ...r.oferta, productId: t.productId }, produto: r.produto, mlb: r.mlb });
  }
  return out;
}
