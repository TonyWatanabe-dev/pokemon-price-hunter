// Foco em economia no WhatsApp (pedido do dono em 03/11/2026: "focar em blister duplos, triplos e quadruplos em bons
// preços com de X por X, focar em economia mesmo [...] booster ou pack caros demais não vou perder tempo levando ao
// grupo"). Puro: sem rede, banco ou secrets.
//
//   • blister duplo, triplo e quádruplo (produto do catálogo *-blister2/3/4, em português) até `precoMax` (padrão R$ 100);
//   • qualquer outro produto em português só com desconto forte (`descontoForte`, padrão 20%) e até `precoMaxForte`
//     (padrão R$ 250): oferta verdadeiramente barata entra, caixa cara não;
//   • "De X por Y" com referência honesta e rotulada: o preço sugerido da Copag do produto; sem ele, a média do mercado
//     que o site calcula. Blister entra com economia de pelo menos `economiaMin` (padrão 5%) sobre essa referência;
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
export function focoEconomia(c, { produtos, precoMax = 100, economiaMin = 0.05, descontoForte = 0.2, precoMaxForte = 250 } = {}) {
  const pid = c?.oferta?.productId; const preco = pos(c?.preco ?? c?.oferta?.price);
  if (!pid || IMPORTADO.test(pid) || !preco) return null;
  const r = referencia(produtos?.get(pid)); if (!r) return null;
  const economia = 1 - preco / r.ref;
  // Blister 2/3/4: até precoMax com economiaMin. Outro produto (03/11: "ofertas verdadeiramente baratas, aonde os
  // descontos são bons"): só com desconto forte (descontoForte) e até precoMaxForte, para caixa cara não voltar.
  const blister = TIPOS.test(pid);
  if (blister ? (preco > precoMax || economia < economiaMin) : (preco > precoMaxForte || economia < descontoForte)) return null;
  let texto = String(c.item?.texto ?? '');
  if (!/\nPor <b>/.test(texto)) return null;                       // sem a linha "Por": não há como montar o "De X por Y"
  // O "De" do vendedor (listPrice) e a linha 💰 de outra base (campanha) saem: fica uma referência só, a do foco.
  texto = texto.replace(/\nDe <b>[^\n]*/g, '').replace(/\n💰[^\n]*/g, '').replace(/\n{3,}/g, '\n\n');
  const de = `\nDe <b>${esc(reais(r.ref))}</b> (${r.rotulo}) ❌`;
  const eco = `\n💰 Economia de <b>${esc(reais(r.ref - preco))}</b> (${Math.round(economia * 100)}%)`;
  texto = texto.replace(/(\nPor <b>[^\n]*)/, `${de}$1${eco}`);
  return { ...c, item: { ...c.item, texto }, economia, economiaReais: r.ref - preco };
}

const lojaDe = (c) => c.loja || c.oferta?.storeId || '';
/** Ordem da fila (04/11/2026: "privilegiando os com mais desconto e melhor valor", nos 3 marketplaces):
 *  Black Friday primeiro; dentro de cada bloco, maior desconto (%) e, no empate, maior economia em reais. Para variar
 *  de loja, a oferta de outra loja passa na frente só se o desconto dela estiver a até `folga` (5 pontos) do melhor:
 *  desconto alto nunca perde a vez para um fraco só para revezar. */
export function ordenarPorEconomia(lista, { folga = 0.05 } = {}) {
  const ordem = (a, b) => (b.economia ?? 0) - (a.economia ?? 0) || (b.economiaReais ?? 0) - (a.economiaReais ?? 0);
  const intercala = (l) => {
    const resto = [...l].sort(ordem); const out = [];
    while (resto.length) {
      const ultima = out.length ? lojaDe(out.at(-1)) : null;
      const topo = resto[0].economia ?? 0;
      const i = lojaDe(resto[0]) === ultima ? resto.findIndex((c) => lojaDe(c) !== ultima && (c.economia ?? 0) >= topo - folga) : 0;
      out.push(resto.splice(i < 0 ? 0 : i, 1)[0]);
    }
    return out;
  };
  return [...intercala(lista.filter((c) => c.blackFriday)), ...intercala(lista.filter((c) => !c.blackFriday))];
}
