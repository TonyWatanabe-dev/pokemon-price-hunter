// Comparação entre duas leituras da mesma oferta (Lote 7).
// O total só é comparável quando a situação do frete é a mesma nas duas leituras. Se o frete passou a ser
// conhecido (ou deixou de ser), compara só o preço do produto: mudança na disponibilidade do frete nunca é
// queda nem alta de preço.
const shipKnown = (x) => (typeof x?.shippingKnown === 'boolean' ? x.shippingKnown : x?.shipping != null);

/** { from, to, basis } com valores comparáveis, ou null quando não há base honesta para comparar. */
export function comparable(a, b) {
  if (!a || !b) return null;
  if (shipKnown(a) === shipKnown(b)) return a.total > 0 && b.total > 0 ? { from: a.total, to: b.total, basis: 'total' } : null;
  return a.price > 0 && b.price > 0 ? { from: a.price, to: b.price, basis: 'price' } : null;
}

/** Referência da leitura pendente (preço que caiu e espera confirmação), no formato que comparable entende. */
export const pendingRef = (o) => (o?.pendingFrom == null ? null
  : { total: o.pendingFrom, price: o.pendingPrice ?? null, shippingKnown: typeof o.pendingShipKnown === 'boolean' ? o.pendingShipKnown : null });
