// Disponibilidade: pré-venda não é estoque para envio imediato. Funções puras, para testar isoladas.
// Estados do robô: IN_STOCK, OUT_OF_STOCK, PRE_ORDER, UNAVAILABLE (descontinuado/só na loja física), UNKNOWN.

/** Reposição = voltou de esgotado/indisponível para em estoque. Pré-venda que vira estoque é lançamento, não restock.
 *  Desconhecido que vira estoque também não é restock: unknown não vira in/out (não há prova de que estava esgotado). */
export const isRestock = (prevStock, nextStock) => nextStock === 'IN_STOCK' && !!prevStock && prevStock !== 'IN_STOCK' && prevStock !== 'PRE_ORDER' && prevStock !== 'UNKNOWN';

/** Pré-venda que passou a estoque: mudança de estado registrada no histórico, sem alerta de reposição. */
export const isLaunch = (prevStock, nextStock) => prevStock === 'PRE_ORDER' && nextStock === 'IN_STOCK';

/** Data prevista só quando a loja informou uma data completa (AAAA-MM-DD); nunca inferida de texto solto. */
export function releaseDateOf(raw) {
  const m = String(raw ?? '').match(/^(\d{4})-(\d{2})-(\d{2})(?:$|[T\s])/);
  if (!m) return null;
  const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
  const ok = d.getUTCFullYear() === +m[1] && d.getUTCMonth() === +m[2] - 1 && d.getUTCDate() === +m[3];
  return ok ? `${m[1]}-${m[2]}-${m[3]}` : null;
}

/** Data prevista só faz sentido em pré-venda; em qualquer outro estado (payload contraditório) é descartada. */
export const availableFromOf = (stock, raw) => (stock === 'PRE_ORDER' ? releaseDateOf(raw) : null);
