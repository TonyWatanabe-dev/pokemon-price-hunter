// Fase 5 / issue #113 — verificação de integridade SOMENTE LEITURA: banco (Marketplace Core) × arquivos publicados (data/ + catálogo).
// Não corrige nada: só conta e amostra. A transação é READ ONLY (o PostgreSQL recusa qualquer escrita) e termina em ROLLBACK.
// Correções (órfãos, duplicatas, constraints) seguem o plano de docs/integridade-referencial.md, com autorização e revisão.
import { copagStatus } from '../score.js';
import { isCopagUrl } from './references.js';

// Queries de detecção (somente SELECT). Cada uma conta linhas problemáticas. Mesma lista do teste test/integrity-db-tests.js.
export const DETECT = {
  historyWithoutOffer: 'SELECT count(*) n FROM hunter.price_history h WHERE NOT EXISTS (SELECT 1 FROM hunter.offer o WHERE o.id = h.offer_id)',
  historyWithoutProduct: 'SELECT count(*) n FROM hunter.price_history h WHERE NOT EXISTS (SELECT 1 FROM hunter.product x WHERE x.id = h.product_id)',
  historyProductMismatch: 'SELECT count(*) n FROM hunter.price_history h JOIN hunter.offer o ON o.id = h.offer_id WHERE o.product_id <> h.product_id',
  clickWithoutOffer: 'SELECT count(*) n FROM hunter.affiliate_click c WHERE c.offer_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM hunter.offer o WHERE o.id = c.offer_id)',
  duplicateLiveOffers: `SELECT count(*) n FROM (SELECT 1 FROM hunter.offer WHERE status <> 'removed' GROUP BY marketplace_id, store_id, url, coalesce(seller_id, 0) HAVING count(*) > 1) d`,
  duplicateProducts: `SELECT count(*) n FROM (SELECT 1 FROM hunter.product GROUP BY collection_id, category_id, coalesce(variant, ''), language, condition HAVING count(*) > 1) d`,
};
// caso 3 (histórico com o produto antigo de uma oferta reclassificada) pode ser legítimo: revisão, não erro
export const REVIEW_ONLY = new Set(['historyProductMismatch']);

// Leituras do banco para a reconciliação (somente SELECT)
export const READS = {
  products: 'SELECT legacy_id FROM hunter.product WHERE legacy_id IS NOT NULL',
  liveOffers: `SELECT legacy_id FROM hunter.offer WHERE status <> 'removed' AND legacy_id IS NOT NULL`,
  officialRefs: `SELECT p.legacy_id, r.source_url FROM hunter.reference_price r JOIN hunter.product p ON p.id = r.product_id
    WHERE r.reference_kind LIKE 'COPAG_OFFICIAL%' AND p.legacy_id IS NOT NULL`,
};

/** O que os arquivos publicados dizem que deveria estar no banco (mesmas chaves legacy_id que o sync grava). */
export function fileExpectations({ state = {}, catalog = null } = {}) {
  // legacy_id = id do arquivo (mappers.productsRows/offersRows); oferta de produto que não está nos arquivos o sync também descarta
  const products = new Set((state.products || []).filter((p) => p?.id).map((p) => String(p.id)));
  const offers = new Set((state.offers || []).filter((o) => o?.id && products.has(String(o.productId))).map((o) => String(o.id)));
  // "Copag confirmada" no site (caminho de arquivos) com fonte fora do domínio Copag: decisão do proprietário (PR #186), só listada
  const copag = { ...(catalog?.copag || {}) };
  for (const p of state.products || []) if (p?.copag) copag[p.id] = p.copag;
  const copagOffDomain = Object.entries(copag).filter(([, c]) => copagStatus({ copag: c }).confirmed && !isCopagUrl(c.source_url)).map(([id]) => id).sort();
  return { products, offers, copagOffDomain };
}

const diff = (a, b) => [...a].filter((x) => !b.has(x)).sort();
/** Reconciliação pura: arquivos × banco. Devolve verificações { name, ok, count, sample, note }. */
export function reconcile(files, db, { sampleSize = 20 } = {}) {
  const out = [];
  const add = (name, list, note, { review = false } = {}) => out.push({ name, ok: list.length === 0, review, count: list.length, sample: list.slice(0, sampleSize), note });
  add('produto nos arquivos e ausente no banco', diff(files.products, db.products), 'sync não gravou (código de coleção antigo vai para a fila duplicate_product) ou não rodou');
  add('produto no banco e ausente nos arquivos', diff(db.products, files.products), 'produto retirado do catálogo/robô: o banco preserva (sem DELETE); revisar', { review: true });
  add('oferta viva nos arquivos e não ativa no banco', diff(files.offers, db.liveOffers), 'sync atrasado, horário inválido/futuro isolado ou produto não gravado');
  add('oferta ativa no banco e ausente nos arquivos', diff(db.liveOffers, files.offers), 'o sync marca como removed na próxima rodada; persistente = sync parado');
  const badOfficial = (db.officialRefs || []).filter((r) => !isCopagUrl(r.source_url)).map((r) => r.legacy_id).sort();
  add('referência COPAG_OFFICIAL no banco com fonte fora do domínio Copag', badOfficial, 'a CHECK da migration 006 impede; diferente de zero = schema divergente');
  add('Copag confirmada no site com fonte fora do domínio Copag (arquivos)', files.copagOffDomain || [], 'decisão do proprietário pendente (PR #186); no banco são COMMUNITY_REFERENCE', { review: true });
  return out;
}

/**
 * Relatório completo, numa transação READ ONLY que sempre termina em ROLLBACK.
 * client: conexão pg (pool.connect()). Nunca recebe nem devolve a URL do banco.
 */
export async function integrityReport(client, { state, catalog, sampleSize = 20, at = new Date() } = {}) {
  await client.query('BEGIN TRANSACTION READ ONLY');
  try {
    const rows = async (sql) => (await client.query(sql)).rows;
    const detect = {};
    for (const [k, sql] of Object.entries(DETECT)) detect[k] = Number((await rows(sql))[0].n);
    const db = {
      products: new Set((await rows(READS.products)).map((r) => r.legacy_id)),
      liveOffers: new Set((await rows(READS.liveOffers)).map((r) => r.legacy_id)),
      officialRefs: await rows(READS.officialRefs),
    };
    const files = fileExpectations({ state, catalog });
    const checks = [
      ...Object.entries(detect).map(([k, count]) => ({ name: `detecção: ${k}`, ok: count === 0, review: REVIEW_ONLY.has(k), count, sample: [], note: 'docs/integridade-referencial.md' })),
      ...reconcile(files, db, { sampleSize }),
    ];
    const failing = checks.filter((c) => !c.ok && !c.review).length;
    return { at: new Date(at).toISOString(), read_only: true, totals: { files_products: files.products.size, files_offers: files.offers.size,
      db_products: db.products.size, db_live_offers: db.liveOffers.size }, failing, to_review: checks.filter((c) => !c.ok && c.review).length, checks };
  } finally {
    await client.query('ROLLBACK').catch(() => {});
  }
}
