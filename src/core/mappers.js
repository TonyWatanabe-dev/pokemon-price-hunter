// Converte os dados atuais do robô (state.json / offers / history.jsonl) para o modelo canônico:
// PRODUCT → OFFER → STORE → MARKETPLACE, + PRICE_HISTORY, STOCK, SHIPPING, REFERENCE_PRICE.
// Funções puras (sem banco), para testar isoladas.
import { categoryOf } from './taxonomy.js';
import { robotReferenceKind } from './references.js';
import { slugs, label } from '../../api/_seo.mjs';

export const TCG = 'pokemon';
export const collectionId = (code) => `${TCG}:${code}`;

const STOCK = { IN_STOCK: 'in_stock', OUT_OF_STOCK: 'out_of_stock', PRE_ORDER: 'preorder', UNKNOWN: 'unknown' };
export const stockOf = (s) => STOCK[s] || 'unknown';

// TTL canônico do frete: um frete reaproveitado de leitura anterior só vale por 24 h, contadas da data ORIGINAL da leitura.
// Passou disso (ou sem data), o frete é desconhecido: nunca é apresentado como confirmado.
export const SHIPPING_TTL_MS = 24 * 3600e3;
export const shippingFresh = (shippingAt, nowMs = Date.now()) => {
  const t = Date.parse(shippingAt);
  return Number.isFinite(t) && nowMs - t <= SHIPPING_TTL_MS;
};

// Eventos de estoque do sync. `prev`: oferta como estava no banco ({ stock_status, status }); `lastKnown`: último estado
// conhecido em price_history (offer legacy_id → stock_status), usado quando `prev` não é confiável.
// Nunca infere evento de leitura pending/unknown/stale: sem base confiável ou sem leitura confiável nova, não há evento.
const reliableStock = (s) => !!s && s !== 'unknown';
export function stockEvents(rows, prev, lastKnown = new Map()) {
  return rows.flatMap((r) => {
    const p = prev.get(r.legacy_id);
    if (!p || r.status !== 'active' || !reliableStock(r.stock_status)) return [];
    const from = p.status === 'active' && reliableStock(p.stock_status) ? p.stock_status : lastKnown.get(r.legacy_id);
    if (!reliableStock(from) || from === r.stock_status) return [];
    return [{ legacy_id: r.legacy_id, from_status: from, to_status: r.stock_status, quantity: r.quantity, observed_at: r.last_seen_at }];
  });
}
const money = (v) => (v == null || !Number.isFinite(Number(v)) ? null : Math.round(Number(v) * 100) / 100);
const ts = (v) => (v ? new Date(v).toISOString() : null);

export function collectionsRows(collections) {
  return collections.map((c) => ({
    id: collectionId(c.id), tcg_id: TCG, code: c.id, name: c.name, series: c.series || null,
    language: 'pt-BR', aliases: c.aliases || [], logo_path: `/logos/colecoes/${c.id}.webp`,
  }));
}

// Slug fixado na primeira vez (o banco não o altera depois): mesmo algoritmo do site.
export function productsRows(products) {
  const { of } = slugs(products);
  return products.map((p) => ({
    legacy_id: p.id, slug: of[p.id], tcg_id: TCG, collection_id: collectionId(p.collection),
    category_id: categoryOf(p.type), brand: 'Copag', canonical_name: `${p.collectionName} - ${label(p)}`,
    language: 'pt-BR', units: p.boosters || null, variant: p.variant || null, image_url: p.image || null,
    status: 'active', attrs: { type: p.type, typeLabel: p.typeLabel, group: p.group },
    ean: p.ean || null,
  }));
}

export function referenceRows(products) {
  const out = [];
  for (const p of products) {
    if (p.copagConfirmed && p.msrp && p.copag?.source_url) {
      const seen = ts(p.copag.source_timestamp || p.copag.msrp_updated_at);
      out.push({ legacy_id: p.id, value: money(p.msrp), source: /copagloja/.test(p.copag.source_url) ? 'copag_loja' : 'manual',
        // só é Copag oficial se a fonte for domínio da Copag; tabela divulgada por lojas (Instagram) é referência comunitária
        reference_kind: robotReferenceKind(p.copag), observed_at: seen,
        source_url: p.copag.source_url, verification_status: 'verified', verified_at: seen,
        confidence: p.copag.confidence === 'OFICIAL' ? 95 : 70, notes: p.copag.note || null });
    } else if (p.copagReference && p.copagReferenceUrl) {
      out.push({ legacy_id: p.id, value: money(p.copagReference), source: 'internet', source_url: p.copagReferenceUrl,
        reference_kind: robotReferenceKind({ source_url: p.copagReferenceUrl }), observed_at: null,
        verification_status: 'pending', verified_at: null, confidence: 40, notes: 'referência coletada na internet, não confirmada na Copag' });
    }
  }
  return out;
}

const STATUS = { ACTIVE: 'active', PAUSED: 'paused', BLOCKED: 'blocked', PENDING: 'pending', UNAVAILABLE: 'unavailable', ERROR: 'active' };
const domainOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return null; } };
export function storesRows(sources, reputation = {}) {
  const list = Array.isArray(sources) ? sources : Object.entries(sources).map(([id, v]) => ({ id, ...v }));
  return list.map((s) => {
    const ra = (reputation.lojas || reputation)[s.id] || null;
    return { id: s.id, name: s.name || s.id, domain: domainOf(s.url), platform: s.platform || null, kind: s.kind || null,
      status: STATUS[s.status] || 'pending', ra_status: ra?.status || null, ra_score: ra?.nota ?? null, ra_url: ra?.url || null,
      health: { status: s.status || null, fails: s.fails || 0, reason: s.reason || null, last_check_at: ts(s.lastCheck), last_success_at: ts(s.lastSuccess) } };
  });
}

export const marketplaceOf = (o) => (o.storeId === 'mercadolivre' ? 'mercadolivre' : 'direct');

export function offersRows(offers, nowMs = Date.now()) {
  return offers.map((o) => {
    const mk = marketplaceOf(o);
    // frete com data original vencida (TTL) vira desconhecido; sem data (dado antigo) segue como estava
    const known = !!o.shippingKnown && o.shipping != null && (!o.shippingAt || shippingFresh(o.shippingAt, nowMs));
    return {
      legacy_id: o.id, product_legacy_id: o.productId, store_id: o.storeId, marketplace_id: mk,
      // vendedor: no ML, o id numérico; em loja com vendedores parceiros (Ri Happy, PBKids...), o nome do vendedor
      // prefixado pela loja (o preço é do parceiro, não da loja — o site mostra "Vendedor via Loja")
      seller: (o.sellerId || o.seller) ? { external_id: mk === 'direct' ? `${o.storeId}:${o.sellerId || o.seller}` : String(o.sellerId || o.seller), name: o.seller || null, is_official: o.sellerKind === 'official_store' } : null,
      external_offer_id: mk === 'mercadolivre' ? o.sku || null : null,
      title_raw: o.title, url: o.url, image_url: o.image || null,
      price: money(o.price), price_kind: o.priceKind || null, list_price: money(o.listPrice), pix_price: money(o.prices?.pix),
      shipping_status: known ? (Number(o.shipping) === 0 ? 'free' : 'known') : 'unknown',
      shipping_price: known ? money(o.shipping) : null,
      shipping_checked_at: known ? ts(o.shippingAt) : null,
      total_price: known ? money(o.total) : null,               // frete desconhecido: total não é inventado
      stock_status: stockOf(o.stock), quantity: o.quantity ?? null,
      match_confidence: o.matchConfidence != null ? Math.round(o.matchConfidence * 100) : null,
      confirmed: o.confirmed !== false, anomalous: !!o.anomalous, status: o.stale ? 'pending' : 'active',
      source_type: o.sourceType || null, first_seen_at: ts(o.firstSeen), last_seen_at: ts(o.source_timestamp),
    };
  });
}

// history.jsonl → price_history (preço como visto; total só com frete conhecido)
export function historyRows(lines) {
  return lines.filter((h) => h.offerId && h.t).map((h) => ({
    offer_legacy_id: h.offerId, product_legacy_id: h.productId, price: money(h.price),
    shipping_price: h.shipping != null ? money(h.shipping) : null,
    total_price: h.shipping != null ? money(h.total) : null,
    stock_status: stockOf(h.stock), observed_at: ts(h.t), event: h.event || null,
  }));
}

// Janela de desconfiança do robô (state.distrust: { stores: [...], until: 'YYYY-MM-DD' }) → source_distrust.
// Pontos de histórico dessas lojas até o dia indicado ficam fora das estatísticas de preço (nada é apagado).
export function distrustRows(distrust) {
  if (!distrust?.stores?.length || !/^\d{4}-\d{2}-\d{2}$/.test(distrust.until || '')) return [];
  return distrust.stores.map((id) => ({ store_id: id, until_day: distrust.until,
    reason: 'leitura antiga pela página da loja (JSON-LD/Open Graph/vendedor secundário) podia trazer preço de vitrine ou parcela' }));
}
