// Social Media MVP — comparativo de lojas para o mesmo produto (issue #654; escopo da #631/#560). Desativado por padrão.
// Módulo puro e determinístico: sem IA, sem rede, sem banco, sem secrets. NÃO publica nem chama Telegram/Instagram;
// devolve a comparação (dados + linhas de texto) para prévia e aprovação humana. A seleção e a ordem são as de
// selecionarElegiveis (elegiveis.js = contrato de elegibilidade + menor total comparável da API, offer-rank.mjs); aqui só
// se fica com uma oferta por loja e se corta nas N primeiras. Total só quando o frete é conhecido; senão, "frete
// desconhecido" explícito. Afiliado só marca a necessidade de aviso: nunca entra na seleção, na ordem nem no preço.
import { money } from '../../format.js';
import { selecionarElegiveis, exigeDisclosure } from './elegiveis.js';
import { limpar, cortar, quando, socialEnabled, SOCIAL_ENABLED_DEFAULT, LOJA_MAX, DISCLOSURE } from './rascunho.js';

export { socialEnabled, SOCIAL_ENABLED_DEFAULT, DISCLOSURE };
export const N_PADRAO = 3;
export const N_MAX = 10;
export const FRETE = Object.freeze({ GRATIS: 'gratis', CONHECIDO: 'conhecido', DESCONHECIDO: 'desconhecido' });
export const MOTIVOS = Object.freeze({
  OUTRO_PRODUTO: 'outro produto',
  MESMA_LOJA: 'loja já presente na comparação',
  FORA_DO_LIMITE: 'fora das N melhores',
});

const erro = (m) => Object.assign(new Error(`comparador social: ${m}`), { code: 'COMPARADOR_INVALIDO' });
const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const txt = (v) => (typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v)) ? String(v).trim() : '');
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const centavos = (v) => Math.round(v * 100) / 100;
const nowDe = (now) => (now === undefined ? Date.now() : now instanceof Date ? now.getTime() : typeof now === 'number' ? now : NaN);
// Os dois formatos de elegiveis.js: API (product.id, store.{id,name}, total_price, shipping.status, last_seen_at)
// e state.json (productId, storeId, storeName, total, shippingKnown, source_timestamp).
const produtoDe = (o) => txt(o.productId ?? o.product_id ?? (isObj(o.product) ? o.product.id : null));
const lojaIdDe = (o) => txt(o.storeId ?? o.store_id ?? (isObj(o.store) ? o.store.id : null));

// Frete: grátis/conhecido só quando o dado diz; total precisa ser coerente (>= preço). Senão, desconhecido.
function freteDe(o, preco, id, avisos) {
  const sh = isObj(o.shipping) ? o.shipping : {};
  const conhecido = o.shippingKnown === true || sh.status === 'free' || sh.status === 'known';
  if (!conhecido) return { frete: FRETE.DESCONHECIDO, freteValor: null, total: null };
  const lido = num(o.total_price) ?? num(o.total);
  if (lido == null || lido < preco) {
    avisos.push(`oferta ${id}: total inválido ignorado, frete tratado como desconhecido`);
    return { frete: FRETE.DESCONHECIDO, freteValor: null, total: null };
  }
  const valor = centavos(lido - preco);
  return { frete: sh.status === 'free' || valor === 0 ? FRETE.GRATIS : FRETE.CONHECIDO, freteValor: valor, total: lido };
}

function linhaDe(of) {
  const preco = money(of.preco);
  if (of.frete === FRETE.DESCONHECIDO) return `${of.posicao}. ${of.loja}: ${preco} + frete desconhecido (total a calcular)`;
  if (of.frete === FRETE.GRATIS) return `${of.posicao}. ${of.loja}: ${preco} + frete grátis = total ${money(of.total)}`;
  return `${of.posicao}. ${of.loja}: ${preco} + frete ${money(of.freteValor)} = total ${money(of.total)}`;
}

/** Comparação das N melhores ofertas elegíveis de UM produto, uma por loja, na ordem da API.
 *  opts = { productId (obrigatório), n = N_PADRAO (1..N_MAX), now, afiliados? (config de api/_lib/affiliates.mjs;
 *  padrão: a do site) }. Devolve { productId, ofertas: [{ posicao, id, lojaId, loja, preco, frete, freteValor, total,
 *  diferencaParaMelhor, visto, afiliado }], linhas, freteDesconhecido, afiliado, disclosure, recusadas: [{ id, motivo }],
 *  avisos }. diferencaParaMelhor só existe quando os dois totais são conhecidos (comparáveis); senão é null. */
export function compararLojas(ofertas, opts) {
  const { productId, n = N_PADRAO, now, afiliados } = isObj(opts) ? opts : {};
  const alvo = txt(productId);
  if (!alvo) throw erro('productId obrigatório');
  if (!(Number.isInteger(n) && n >= 1 && n <= N_MAX)) throw erro(`n deve ser inteiro entre 1 e ${N_MAX}`);
  if (!Array.isArray(ofertas)) throw erro('ofertas deve ser uma lista');
  const t0 = nowDe(now);
  if (!Number.isFinite(t0)) throw erro('relógio inválido');

  const recusadas = []; const doProduto = [];
  for (const o of ofertas) {
    if (isObj(o) && produtoDe(o) && produtoDe(o) !== alvo) recusadas.push({ id: txt(o.id) || null, motivo: MOTIVOS.OUTRO_PRODUTO });
    else doProduto.push(o);   // inválidas seguem para selecionarElegiveis, que registra o motivo
  }
  const sel = selecionarElegiveis(doProduto, { now: t0 });
  recusadas.push(...sel.recusadas);

  // Uma oferta por loja: a primeira na ordem da API (a melhor dela). Nada é reordenado.
  const lojas = new Set(); const escolhidas = [];
  for (const o of sel.elegiveis) {
    const id = txt(o.id) || null;
    const loja = lojaIdDe(o);
    if (lojas.has(loja)) { recusadas.push({ id, motivo: MOTIVOS.MESMA_LOJA }); continue; }
    lojas.add(loja);
    if (escolhidas.length >= n) { recusadas.push({ id, motivo: MOTIVOS.FORA_DO_LIMITE }); continue; }
    escolhidas.push(o);
  }

  const avisos = [];
  const lista = escolhidas.map((o, i) => {
    const id = txt(o.id) || `#${i + 1}`;
    const preco = o.price;   // já validado por ofertaElegivel (número > 0)
    const bruta = (isObj(o.store) ? o.store.name : null) ?? o.storeName;
    let loja = limpar(bruta);
    if (loja && loja !== String(bruta).trim()) avisos.push(`oferta ${id}: texto da loja limpo (marcação, link ou menção removidos)`);
    if (!loja) { loja = lojaIdDe(o); avisos.push(`oferta ${id}: loja sem nome, usado o id da loja`); }
    const curta = cortar(loja, LOJA_MAX);
    if (curta !== loja) avisos.push(`oferta ${id}: nome da loja truncado`);
    const afiliado = o.disclosure === true || (afiliados === undefined ? exigeDisclosure(o.url) : exigeDisclosure(o.url, afiliados));
    return { posicao: i + 1, id, lojaId: lojaIdDe(o), loja: curta, preco, ...freteDe(o, preco, id, avisos),
      visto: quando(o.last_seen_at ?? o.source_timestamp), afiliado };
  });
  const melhor = lista[0];
  for (const of of lista) {
    of.diferencaParaMelhor = melhor && melhor.total != null && of.total != null ? centavos(of.total - melhor.total) : null;
  }
  const freteDesconhecido = lista.some((of) => of.frete === FRETE.DESCONHECIDO);
  if (melhor && melhor.frete === FRETE.DESCONHECIDO) avisos.push('frete desconhecido na melhor oferta: comparação por preço antes do frete');
  if (lista.length === 1) avisos.push('só uma loja elegível: não há comparação');
  const afiliado = lista.some((of) => of.afiliado);

  return {
    productId: alvo, ofertas: lista, linhas: lista.map(linhaDe), freteDesconhecido, afiliado,
    disclosure: afiliado ? DISCLOSURE : null, recusadas, avisos,
  };
}
