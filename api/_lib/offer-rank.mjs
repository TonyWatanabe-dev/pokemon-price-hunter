// "Menor total" comparável entre ofertas do MESMO produto (issue #84) — regra única do servidor.
// Sem frete informado, o "total" da oferta é só o preço: ele não se compara com um total que já inclui o frete.
// Por isso:
// • ofertas com frete conhecido (ou grátis) vêm antes, ordenadas pelo total;
// • oferta com frete desconhecido nunca vence uma com frete conhecido pelo "menor total";
// • se todas tiverem frete desconhecido, vence a de menor preço (o site mostra "Preço antes do frete").
// É a mesma regra da página do produto no site (index.html: shipOk/shipCmp em OFFER_SORTS.price, PR #178).
// Não mexe em estoque (quem filtra estoque é quem chama) nem em nota (Opportunity Score / Deal Score).
// src/ pode reutilizar este módulo importando-o de api/_lib, como src/core/references.js faz com references.mjs.

/** frete conhecido = o robô/banco informou o valor (grátis inclui). Ausente ou false = desconhecido. */
export const shipKnown = (o) => o?.shippingKnown === true;
/** frete conhecido antes de desconhecido; 0 quando os dois estão no mesmo caso. */
export const shipCmp = (a, b) => shipKnown(b) - shipKnown(a);
const idCmp = (a, b) => String(a.id).localeCompare(String(b.id));
const num = (v) => (Number.isFinite(v) ? v : 1e12);

/** Comparador do "menor total" comparável: frete conhecido primeiro, depois total (= preço sem frete), depois id. */
export const byComparableTotal = (a, b) => shipCmp(a, b) || num(a.total) - num(b.total) || idCmp(a, b);
/** Mesmo critério para uma chave derivada do total (ex.: preço por booster no modo "Para abrir"). */
export const byComparable = (key) => (a, b) => shipCmp(a, b) || num(key(a)) - num(key(b)) || idCmp(a, b);
/** A melhor oferta de uma lista pelo critério acima (null se vazia). Não altera a lista. */
export const bestComparable = (list, cmp = byComparableTotal) => (list && list.length ? [...list].sort(cmp)[0] : null);
