// Social Media — legendas de carrossel por slide (issue #647, escopo da #631/#560). Desativado por padrão.
// Módulo puro e determinístico: só texto (não gera imagem), sem IA, sem rede, sem banco, sem secrets. NÃO publica nem
// chama API de Telegram/Instagram; devolve os textos para prévia e aprovação humana. Recebe as ofertas já escolhidas por
// selecionarElegiveis (elegiveis.js) e mantém a ordem dela (menor total comparável): não reordena, não filtra nem
// destaca por afiliado. Limpeza, corte e frases fixas vêm de rascunho.js; a detecção de afiliado, de elegiveis.js.
import { money } from '../../format.js';
import { limpar, cortar, quando, socialEnabled, SOCIAL_ENABLED_DEFAULT, SLUG, NOME_MAX, LOJA_MAX, DISCLOSURE, AVISO_COMPRA } from './rascunho.js';
import { exigeDisclosure } from './elegiveis.js';

export { socialEnabled, SOCIAL_ENABLED_DEFAULT };
/** Ordem fixa dos slides: o aviso de afiliado/transparência é sempre o último. */
export const TIPOS = Object.freeze(['capa', 'oferta', 'comparacao', 'cta', 'disclosure']);
export const LIMITES_SLIDE = Object.freeze({ capa: 150, oferta: 300, comparacao: 450, cta: 250, disclosure: 300 });
export const MAX_COMPARACAO = 4;
export const LOJA_COMPARACAO_MAX = 40;
export const SEM_AFILIADO = 'Sem link de afiliado nesta comparação. Comissão nunca muda o ranking, a melhor oferta, o preço nem a nota.';
export const CTA = 'Veja todas as ofertas e o histórico de preço no TCG Price Hunter.\nLink para a página do produto na bio.';

const erro = (m) => Object.assign(new Error(`carrossel social: ${m}`), { code: 'CARROSSEL_INVALIDO' });
const obj = (o) => (o && typeof o === 'object' && !Array.isArray(o) ? o : {});
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
const https = (u) => { if (typeof u !== 'string') return null; try { const x = new URL(u); return x.protocol === 'https:' && x.host ? x : null; } catch { return null; } };

// Os dois formatos de elegiveis.js: API (store.name, total_price, shipping.status, last_seen_at) e state.json
// (storeName, total, shippingKnown, source_timestamp). Frete só é conhecido quando o dado diz; senão, a calcular.
function ler(o, i, avisos, cfg) {
  const id = typeof o.id === 'string' && o.id ? o.id : `#${i + 1}`;
  const preco = num(o.price);
  if (preco == null || preco <= 0) { avisos.push(`oferta ${id} ignorada: sem preço válido`); return null; }
  if (!https(o.url)) { avisos.push(`oferta ${id} ignorada: sem URL https`); return null; }
  const bruta = obj(o.store).name ?? o.storeName;
  const loja = limpar(bruta);
  if (!loja) { avisos.push(`oferta ${id} ignorada: loja sem nome`); return null; }
  if (loja !== String(bruta).trim()) avisos.push(`oferta ${id}: texto da loja limpo (marcação, link ou menção removidos)`);
  const freteConhecido = o.shippingKnown === true || ['free', 'known'].includes(obj(o.shipping).status);
  const lido = freteConhecido ? num(o.total_price) ?? num(o.total) : null;
  const total = lido != null && lido >= preco ? lido : null;
  if (freteConhecido && total == null) avisos.push(`oferta ${id}: total inválido ignorado, frete tratado como desconhecido`);
  const afiliado = o.disclosure === true || (cfg === undefined ? exigeDisclosure(o.url) : exigeDisclosure(o.url, cfg));
  return { id, preco, loja, total, visto: quando(o.last_seen_at ?? o.source_timestamp), afiliado };
}

const precoDe = (of) => (of.total == null ? `${money(of.preco)} (frete a calcular)` : `${money(of.preco)} · total com frete ${money(of.total)}`);

function slide(tipo, texto) {
  if (texto.length > LIMITES_SLIDE[tipo]) throw erro(`slide ${tipo} excede ${LIMITES_SLIDE[tipo]} caracteres`);
  return { tipo, texto };
}

/** ofertas = saída de selecionarElegiveis(...).elegiveis, na ordem dela; opts = { produto: { nome, slug }, siteUrl,
 *  afiliados? (config de api/_lib/affiliates.mjs; padrão: a do site) }. Devolve { slides: [{ tipo, texto }], link,
 *  afiliado, ofertas: [ids usados], avisos } ou lança erro explícito. */
export function gerarCarrossel(ofertas, opts) {
  const { produto, siteUrl, afiliados } = obj(opts);
  if (!Array.isArray(ofertas)) throw erro('ofertas deve ser uma lista');
  const site = https(siteUrl);
  if (!site) throw erro('siteUrl não é https');
  const slug = typeof obj(produto).slug === 'string' ? produto.slug : '';
  if (!SLUG.test(slug)) throw erro('slug do produto inválido');
  const nomeLimpo = limpar(obj(produto).nome);
  if (!nomeLimpo) throw erro('produto sem nome');
  const avisos = [];
  if (nomeLimpo !== String(produto.nome).trim()) avisos.push('nome do produto limpo: marcação, link ou menção removidos');

  const lidas = [];
  ofertas.forEach((o, i) => { const r = ler(obj(o), i, avisos, afiliados); if (r) lidas.push(r); });
  if (!lidas.length) throw erro('nenhuma oferta elegível válida');
  const [destaque, ...resto] = lidas;
  const afiliado = lidas.some((of) => of.afiliado);

  // Capa: o nome é a única parte longa e é ela que encolhe.
  const n = lidas.length;
  const subtitulo = `Comparamos ${n} ${n === 1 ? 'oferta' : 'ofertas'} com estoque confirmado.`;
  const nome = cortar(nomeLimpo, Math.min(NOME_MAX, LIMITES_SLIDE.capa - subtitulo.length - 1));
  if (nome !== nomeLimpo) avisos.push('nome do produto truncado');
  const capa = slide('capa', `${nome}\n${subtitulo}`);

  // Destaque: a primeira da lista. Pela regra de offer-rank, se ela tem frete desconhecido, todas têm.
  const lojaDestaque = cortar(destaque.loja, LOJA_MAX);
  if (lojaDestaque !== destaque.loja) avisos.push('nome da loja truncado');
  if (destaque.total == null) avisos.push('frete desconhecido no destaque: total a calcular');
  if (!destaque.visto) avisos.push('sem data de leitura do preço no destaque');
  const oferta = slide('oferta', [
    destaque.total == null ? 'Menor preço encontrado (antes do frete)' : 'Menor total com frete encontrado',
    `${lojaDestaque}: ${precoDe(destaque)}`,
    destaque.visto && `Preço visto em ${destaque.visto}.`,
  ].filter(Boolean).join('\n'));

  // Comparação: até MAX_COMPARACAO lojas, cada uma numa linha, enquanto couber no limite do slide.
  let comparacao = resto.length ? 'Outras ofertas:' : 'Só esta oferta passou na checagem de preço, estoque e frescor agora.';
  let usadas = 0;
  for (const of of resto.slice(0, MAX_COMPARACAO)) {
    const linha = `\n• ${cortar(of.loja, LOJA_COMPARACAO_MAX)}: ${precoDe(of)}`;
    if (comparacao.length + linha.length > LIMITES_SLIDE.comparacao) break;
    comparacao += linha; usadas++;
  }
  if (usadas < resto.length) avisos.push(`${resto.length - usadas} oferta(s) fora do slide de comparação`);

  const slides = [
    capa, oferta, slide('comparacao', comparacao),
    slide('cta', `${CTA}\n${AVISO_COMPRA}`),
    slide('disclosure', afiliado ? DISCLOSURE : SEM_AFILIADO),
  ];
  return { slides, link: `${site.origin}/produto/${slug}`, afiliado, ofertas: lidas.slice(0, usadas + 1).map((of) => of.id), avisos };
}
