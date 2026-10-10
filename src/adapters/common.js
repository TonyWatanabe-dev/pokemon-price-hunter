import { check } from '../robots.js';
import { BlockedError } from '../http.js';
export async function guard(url) {
  const r = await check(url); if (r.ok) return;
  const u = new URL(url);
  if (r.why === 'blocked') throw new BlockedError(`Acesso bloqueado em ${u.host} (o site barra robôs, nem o robots.txt abre)`, 403);
  if (r.why === 'unreachable') throw new BlockedError(`${u.host} fora do ar ou lento para responder`, 'unreachable');
  throw new BlockedError(`robots.txt não permite ${u.pathname}`, 'robots');
}
// Preço em reais (número com no máximo 2 casas) ou null. Nunca chuta: negativo, zero, NaN/infinito, faixa ("10 - 20"),
// mais de um valor no texto ("12x de 28,25") e separadores incoerentes viram null.
// Aceita BR ("1.234,56", "339,00"), internacional ("1,234.56", "339.00") e milhar BR sem decimais ("1.500").
const MONEY_BR = /^\d{1,3}(\.\d{3})*,\d{1,2}$|^\d+,\d{1,2}$/;
const MONEY_INTL = /^\d{1,3}(,\d{3})+\.\d{1,2}$|^\d+\.\d{1,2}0*$/;
const MONEY_THOUSANDS = /^\d{1,3}(\.\d{3})+$/;
export const brl = (s) => {
  if (s == null) return null;
  if (typeof s === 'number') return Number.isFinite(s) && s > 0 ? Math.round(s * 100) / 100 : null;
  const t = String(s);
  const tokens = t.match(/\d[\d.,]*/g);
  if (!tokens || tokens.length !== 1 || /-\s*\d/.test(t)) return null;
  const n = tokens[0].replace(/[.,]+$/, '');
  let v;
  if (MONEY_BR.test(n)) v = Number(n.replace(/\./g, '').replace(',', '.'));
  else if (MONEY_THOUSANDS.test(n)) v = Number(n.replace(/\./g, ''));
  else if (MONEY_INTL.test(n)) v = Number(n.replace(/,/g, ''));
  else if (/^\d+$/.test(n)) v = Number(n);
  else return null;
  return Number.isFinite(v) && v > 0 ? Math.round(v * 100) / 100 : null;
};
// "R$ 339,00 no Pix" / "à vista no PIX R$ 339,00"
export function findPix(html) {
  const txt = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
  const m = txt.match(/R\$\s?([\d.]+,\d{2})\s*(?:\(?\s*)?(?:no|via|pelo|à vista no|a vista no|pagando (?:no|com))\s*pix/i)
        || txt.match(/pix[^R]{0,40}R\$\s?([\d.]+,\d{2})/i);
  return m ? brl(m[1]) : null;
}
export const searchTerms = (catalog) => catalog.collections.map((c) => `pokemon ${c.name}`);
