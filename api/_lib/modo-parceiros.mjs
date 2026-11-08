// Site só com parceiros, lado do servidor (decisão do proprietário em 07/11/2026; docs/afiliados.md).
// A chave é a variável SITE_SO_PARCEIROS lida AQUI, no servidor: ela nunca sai em resposta, HTML, JSON ou cabeçalho, e não existe
// parâmetro de URL nem campo público que a mostre. Padrão LIGADO (variável ausente = ligado): a Vercel não herda a variável do
// GitHub, e na dúvida o site fica restrito. Só o valor '0' desliga. O filtro principal já acontece a montante (src/run.js:
// state.json, histórico e banco só recebem o conjunto publicado); aqui fica a segunda barreira, para o que o servidor monta por
// conta própria (diretório de lojas, "procurar em outras lojas", linhas antigas do banco, state.json de uma rodada anterior).
import { LOJAS_PARCEIRAS, ofertaParceira } from './affiliates.mjs';

export { LOJAS_PARCEIRAS };
/** true = só lojas parceiras no site (padrão). Só '0' desliga. */
export const soParceiros = (env = process.env) => String(env?.SITE_SO_PARCEIROS ?? '1').trim() !== '0';
export const lojaParceira = (id) => LOJAS_PARCEIRAS.includes(id);
/** Lista de ids para parâmetro SQL (text[]) ou null quando o modo está desligado. */
export const idsParceiros = (env = process.env) => (soParceiros(env) ? [...LOJAS_PARCEIRAS] : null);

const cache = new WeakMap();
/**
 * Estado com SÓ lojas parceiras (ofertas, fontes, reputação, desconfiança e pistas). Modo desligado ou nada a tirar: devolve o
 * próprio objeto. offerCount/inStockCount dos produtos são refeitos só quando alguma oferta saiu (estado antigo, de antes do corte).
 */
export function estadoParceiro(st, env = process.env) {
  if (!st || typeof st !== 'object' || !soParceiros(env)) return st;
  const hit = cache.get(st); if (hit) return hit;
  const ofertas = Array.isArray(st.offers) ? st.offers : [];
  const dentro = ofertas.filter((o) => lojaParceira(o?.storeId));
  const fontes = Array.isArray(st.sources) ? st.sources.filter((s) => lojaParceira(s?.id)) : st.sources;
  const pistas = Array.isArray(st.tips) ? st.tips.filter((t) => ofertaParceira(t)) : st.tips;
  const mudou = dentro.length !== ofertas.length || (Array.isArray(st.sources) && fontes.length !== st.sources.length) || (Array.isArray(st.tips) && pistas.length !== st.tips.length)
    || (st.reputation?.lojas && Object.keys(st.reputation.lojas).some((k) => !lojaParceira(k))) || (st.distrust?.stores || []).some((k) => !lojaParceira(k));
  if (!mudou) { cache.set(st, st); return st; }
  const n = {}; const v = {};
  for (const o of dentro) { n[o.productId] = (n[o.productId] || 0) + 1; if (o.stock === 'IN_STOCK' && !o.stale && !o.anomalous && o.total > 0) v[o.productId] = (v[o.productId] || 0) + 1; }
  const out = { ...st, offers: dentro, sources: fontes, tips: pistas,
    products: (st.products || []).map((p) => ({ ...p, offerCount: n[p.id] || 0, ...(p.inStockCount !== undefined ? { inStockCount: v[p.id] || 0 } : {}) })) };
  if (st.reputation) out.reputation = { ...st.reputation, lojas: Object.fromEntries(Object.entries(st.reputation.lojas || {}).filter(([k]) => lojaParceira(k))) };
  if (st.distrust) out.distrust = { ...st.distrust, stores: (st.distrust.stores || []).filter(lojaParceira) };
  cache.set(st, out); return out;
}
