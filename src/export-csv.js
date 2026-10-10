// Exportação de oportunidades em CSV. Puro: recebe ofertas e produtos e devolve texto; não grava arquivo, não lê banco
// e não toca em base humana. Desconhecido sai como célula vazia (nunca 0) e toda célula é protegida contra fórmulas.
import { shipKnown } from '../api/_lib/offer-rank.mjs';

export const COLUMNS = ['produto', 'loja', 'preco', 'frete', 'total', 'referencia_copag', 'status', 'estoque', 'visto_em', 'coletado_em', 'url'];

const FORMULA_START = /^[=+\-@\t\r]/;

/** Escapa uma célula: neutraliza fórmulas (prefixo apóstrofo) e aplica aspas RFC 4180 quando preciso. */
export function csvCell(v) {
  if (v == null) return '';
  let s = v instanceof Date ? (Number.isNaN(v.getTime()) ? '' : v.toISOString()) : String(v);
  if (typeof v === 'string' && FORMULA_START.test(s)) s = `'${s}`;
  return /[",;\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

// número válido e positivo ou vazio: null/undefined/'' /NaN/negativo/0 nunca viram "0"
const money = (v) => {
  if (v == null || v === '' || typeof v === 'boolean') return null;
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n.toFixed(2) : null;
};
// 0 é frete grátis legítimo, mas só quando o frete é conhecido (shippingKnown === true; ausente ou false = desconhecido)
const freight = (o) => {
  if (!shipKnown(o) || o.shipping == null || o.shipping === '' || typeof o.shipping === 'boolean') return null;
  const n = Number(o.shipping);
  return Number.isFinite(n) && n >= 0 ? n.toFixed(2) : null;
};
// Com frete desconhecido o o.total é só o preço: exportá-lo como "total" inventaria frete zero. Total só com frete conhecido
// (mesma regra de api/_lib/offer-rank.mjs: desconhecido nunca se compara com total que já inclui o frete).
const total = (o) => (shipKnown(o) ? money(o.total) : null);
const iso = (v) => { if (v == null || v === '') return null; const t = Date.parse(v); return Number.isFinite(t) ? new Date(t).toISOString() : null; };

/**
 * @param {object[]} offers ofertas do state/API
 * @param {object[]} products produtos (msrp = referência Copag)
 * @returns {string} CSV com BOM UTF-8 (acentos no Excel), separador vírgula e quebra CRLF
 */
export function opportunitiesToCsv(offers, products = []) {
  const byId = new Map((products || []).map((p) => [p.id, p]));
  const rows = (offers || []).filter(Boolean).map((o) => {
    const p = byId.get(o.productId) || {};
    const ref = p.copagConfirmed === false ? null : money(p.msrp);
    const status = o.classification?.label || (o.opportunity === true ? 'OPORTUNIDADE' : null);
    return [p.name || p.title || o.productId, o.storeName || o.storeId, money(o.price), freight(o), total(o), ref, status, o.stock,
      iso(o.source_timestamp), iso(o.firstSeen), o.url];
  });
  return '﻿' + [COLUMNS, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';
}
