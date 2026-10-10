import { check, failureOf } from '../robots.js';
import { BlockedError } from '../http.js';
// O motivo leva o status HTTP real e o código de rede: 429 (limite) não vira "barra robôs", e DNS, timeout, TLS e 5xx
// não viram o mesmo "fora do ar". A decisão não muda: robots.txt que não abre = não rastrear.
export async function guard(url) {
  const r = await check(url); if (r.ok) return;
  const u = new URL(url);
  if (r.why === 'robots') throw new BlockedError(`robots.txt não permite ${u.pathname}`, 'robots');
  const f = (await failureOf(url)) || {};
  const httpStatus = f.httpStatus ?? null; const code = f.code ?? null; const retryAfter = f.retryAfter ?? null;
  if (r.why === 'blocked') {
    if (httpStatus === 429) throw new BlockedError(`Limite de requisições (429) em ${u.host}: o robots.txt pediu para esperar${retryAfter != null ? ` (Retry-After ${retryAfter} s)` : ''}`, 429, { httpStatus, retryAfter });
    const what = httpStatus == null ? 'bloqueio' : httpStatus < 300 ? `desafio anti-robô com HTTP ${httpStatus}` : `HTTP ${httpStatus}`;
    throw new BlockedError(`Acesso bloqueado em ${u.host} (o site barra robôs, nem o robots.txt abre: ${what})`, 403, { httpStatus });
  }
  const what = code === 'TIMEOUT' ? 'tempo esgotado, TIMEOUT' : code ? `erro de rede ${code}` : httpStatus ? `HTTP ${httpStatus}` : 'erro de rede';
  throw new BlockedError(`${u.host} fora do ar ou lento para responder (robots.txt: ${what})`, 'unreachable', { httpStatus, code });
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
  // milhar separado por espaço, nbsp ou espaço fino ("R$ 1 299,90"): junta antes de contar os valores
  const t = String(s).replace(/(\d)[   ](?=\d{3}(?:[.,]\d|\D|$))/g, '$1');
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
