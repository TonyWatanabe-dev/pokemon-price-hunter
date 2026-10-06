import { allowed } from '../robots.js';
import { BlockedError } from '../http.js';
export async function guard(url) { if (!(await allowed(url))) throw new BlockedError(`robots.txt não permite ${new URL(url).pathname}`, 'robots'); }
export const brl = (s) => { if (s == null) return null; if (typeof s === 'number') return s; const v = Number(String(s).replace(/[^\d,.-]/g, '').replace(/\.(?=\d{3}(\D|$))/g, '').replace(',', '.')); return Number.isFinite(v) && v > 0 ? v : null; };
// "R$ 339,00 no Pix" / "à vista no PIX R$ 339,00"
export function findPix(html) {
  const txt = html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/\s+/g, ' ');
  const m = txt.match(/R\$\s?([\d.]+,\d{2})\s*(?:\(?\s*)?(?:no|via|pelo|à vista no|a vista no|pagando (?:no|com))\s*pix/i)
        || txt.match(/pix[^R]{0,40}R\$\s?([\d.]+,\d{2})/i);
  return m ? brl(m[1]) : null;
}
export const searchTerms = (catalog) => catalog.collections.map((c) => `pokemon ${c.name}`);
