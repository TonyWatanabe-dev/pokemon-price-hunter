// Foco em economia no WhatsApp (pedido do dono em 03/11/2026: "focar em blister duplos, triplos e quadruplos em bons
// preços com de X por X, focar em economia mesmo [...] booster ou pack caros demais não vou perder tempo levando ao
// grupo"). Puro: sem rede, banco ou secrets.
//
//   • só blister duplo, triplo e quádruplo (produto do catálogo *-blister2/3/4, em português);
//   • só preço até `precoMax` (padrão R$ 100): blister caro de coleção antiga fica de fora;
//   • "De X por Y" com referência honesta e rotulada: o preço sugerido da Copag do produto; sem ele, a média do mercado
//     que o site calcula. Só entra com economia de pelo menos `economiaMin` (padrão 5%) sobre essa referência;
//   • o "De" do vendedor (listPrice) não é usado: costuma ser inflado.
import { reais } from './legenda.js';

export const TIPOS = /-blister[234]$/;
const IMPORTADO = /-(en|ja|zh|ko)$/;
const pos = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Referência do "De": preço sugerido Copag; sem ele, média do mercado. null sem nenhuma. */
export function referencia(produto) {
  const msrp = pos(produto?.msrp); if (msrp) return { ref: msrp, rotulo: 'sugerido Copag' };
  const media = pos(produto?.marketAverage); if (media) return { ref: media, rotulo: 'média do mercado' };
  return null;
}

/** Candidato da fila → mesmo candidato com "De X (rótulo) ❌" e a economia no texto, ou null se não for o foco. */
export function focoEconomia(c, { produtos, precoMax = 100, economiaMin = 0.05 } = {}) {
  const pid = c?.oferta?.productId; const preco = pos(c?.preco ?? c?.oferta?.price);
  if (!pid || !TIPOS.test(pid) || IMPORTADO.test(pid) || !preco || preco > precoMax) return null;
  const r = referencia(produtos?.get(pid)); if (!r) return null;
  const economia = 1 - preco / r.ref; if (economia < economiaMin) return null;
  let texto = String(c.item?.texto ?? '');
  if (!/\nPor <b>/.test(texto)) return null;                       // sem a linha "Por": não há como montar o "De X por Y"
  // O "De" do vendedor (listPrice) e a linha 💰 de outra base (campanha) saem: fica uma referência só, a do foco.
  texto = texto.replace(/\nDe <b>[^\n]*/g, '').replace(/\n💰[^\n]*/g, '').replace(/\n{3,}/g, '\n\n');
  const de = `\nDe <b>${esc(reais(r.ref))}</b> (${r.rotulo}) ❌`;
  const eco = `\n💰 Economia de <b>${esc(reais(r.ref - preco))}</b> (${Math.round(economia * 100)}%)`;
  texto = texto.replace(/(\nPor <b>[^\n]*)/, `${de}$1${eco}`);
  return { ...c, item: { ...c.item, texto }, economia };
}
