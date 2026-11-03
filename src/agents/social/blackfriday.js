// Campanha Black Friday nos grupos (pedido do dono em 02/11/2026: "vamos priorizar as ofertas no grupo, faça uma arte
// diferente para ofertas Black Friday, quero priorizar elas"). Puro, exceto fotoDoAnuncio (rede, só leitura).
//
// Fonte: config/social-black-friday.json — anúncios do Mercado Livre lidos na busca "pokémon tcg", cada um com o link de
// afiliado do dono gerado para o próprio anúncio (MLB-<id>), preço e desconto vistos na leitura e o selo BLACK FRIDAY.
// Regras:
//   • vale por `validadeHoras` do arquivo (padrão 24 h, teto 72 h) a partir de capturedAt, como as leituras manuais de Shopee/Amazon; o post diz quando o
//     preço foi lido, porque pode ter mudado;
//   • só produto SELADO e ORIGINAL (decisão do dono em 02/11/2026: "não vou ficar anunciando cartas no grupo. É só
//     produto selado e original e preços bons"): o título tem de ser reconhecido pelo mesmo verificador do robô
//     (parseListing, sem nenhum motivo de recusa) como um produto do catálogo; carta avulsa, lote de cartas, kit montado
//     pela loja, acessório, réplica ou idioma não suportado ficam de fora;
//   • só preço bom: até o preço sugerido da Copag do produto; sem preço Copag (ex.: importado), pelo menos 5% abaixo do
//     menor preço em estoque do site. O "% OFF" do vendedor NÃO conta (o "de" costuma ser inflado);
//   • um anúncio por produto (o mais barato);
//   • ordem: primeiro as com selo Black Friday (maior economia primeiro), depois as demais da campanha;
//   • as com selo usam o card de Black Friday (tools/social-card.py --tema blackfriday). A foto vem do campo `foto` do
//     arquivo (lida na mesma leitura, porque o ML não entrega a página do anúncio ao runner do GitHub) e, sem ela, do
//     og:image do anúncio.
// Kill switch: SOCIAL_BLACKFRIDAY=0.
import fs from 'node:fs';
import { montarLegenda, reais } from './legenda.js';
import { parseListing, productIdOf, normalize } from '../../match.js';
import { melhoresDoSite } from './externas.js';

export const ARQUIVO = new URL('../../../config/social-black-friday.json', import.meta.url);
const H = 3600e3;
const ITEM = /^MLB\d{6,15}$/;
const MELI = /^https:\/\/meli\.la\/[A-Za-z0-9]+$/;
const IMG = /^https:\/\/(?:[a-z0-9-]+\.)*mlstatic\.com\/[^\s"'<>]+$/i;   // foto: só do CDN do Mercado Livre

const CATALOGO = new URL('../../../config/catalog.json', import.meta.url);
export function lerCatalogo(arquivo = CATALOGO) {
  try { return JSON.parse(fs.readFileSync(arquivo, 'utf8')); } catch { return null; }
}

// Carta avulsa que o verificador ainda casa com um produto ("Carta Pokémon Fuecoco ex Coleção 30 Anos" ≠ a Coleção):
// "carta" no singular, ou título que começa por carta(s)/card sem nenhuma palavra de embalagem selada.
const EMBALAGEM = /\b(booster|blister|box|colecao|treinador avancado|lata|minilata|pacotes?|baralho|deck|display|etb)\b/;
export function cartaAvulsa(titulo) {
  const t = normalize(titulo);
  return /\bcarta\b|\bcard\b/.test(t) || (/^\s*(cartas?|cards?)\b/.test(t) && !EMBALAGEM.test(t));
}

/** Oferta da campanha → { productId, ref, tipoRef } quando é selado original com preço bom; senão null.
 *  products/offers = state.json do robô (msrp por produto e ofertas em estoque). */
export function seladoComPrecoBom(o, { catalog, products = [], offers = [], site = null } = {}) {
  if (!catalog || cartaAvulsa(o.titulo)) return null;
  const r = parseListing(o.titulo, catalog);
  if (r.rejects.length || !r.collection || !r.type) return null;
  const productId = productIdOf(r.collection, r.type, r.boosters ?? null, r.variant ?? null, r.lang);
  const p = (Array.isArray(products) ? products : []).find((x) => x?.id === productId);
  if (!p) return null;                                     // fora do catálogo do site: não posta
  const msrp = typeof p.msrp === 'number' && p.msrp > 0 ? p.msrp : null;
  if (msrp) return o.preco <= msrp ? { productId, ref: msrp, tipoRef: 'copag' } : null;
  const doSite = (site ?? melhoresDoSite(offers)).get(productId);
  return doSite != null && o.preco <= doSite * 0.95 ? { productId, ref: doSite, tipoRef: 'site' } : null;
}

export function lerCampanha(arquivo = ARQUIVO) {
  try { return JSON.parse(fs.readFileSync(arquivo, 'utf8')); } catch { return null; }
}

const quando = (iso) => new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' });

/** Campanha → candidatos no formato de candidatos() (item.texto em HTML do Telegram; o WhatsApp converte).
 *  state = state.json do robô; sem state ou catálogo, nada sai (falha fechada). Fora da validade ou desligada: vazio. */
export function candidatosCampanha(campanha, { now = Date.now(), env = {}, maxHoras = null, state = null, catalog = lerCatalogo() } = {}) {
  if (env.SOCIAL_BLACKFRIDAY === '0' || !campanha || !Array.isArray(campanha.ofertas) || !state || !catalog) return [];
  // validadeHoras do arquivo (padrão 24 h, teto 72 h); a legenda sempre diz o dia da leitura.
  if (maxHoras == null) maxHoras = Number.isFinite(campanha.validadeHoras) ? Math.min(Math.max(campanha.validadeHoras, 1), 72) : 24;
  const t = Date.parse(campanha.capturedAt);
  if (!Number.isFinite(t) || t > now + 5 * 60e3 || now - t > maxHoras * H) return [];
  const site = melhoresDoSite(state.offers);
  const melhor = new Map();                                 // um anúncio por produto: o mais barato
  for (const o of campanha.ofertas) {
    if (!o || !ITEM.test(o.item) || !MELI.test(o.link) || typeof o.titulo !== 'string' || !o.titulo.trim() || typeof o.preco !== 'number' || !(o.preco > 0)) continue;
    const bom = seladoComPrecoBom(o, { catalog, products: state.products, site });
    if (!bom) continue;
    const atual = melhor.get(bom.productId);
    if (!atual || o.preco < atual.o.preco) melhor.set(bom.productId, { o, ...bom, economia: 1 - o.preco / bom.ref });
  }
  const ordem = (a, b) => b.economia - a.economia || a.o.preco - b.o.preco;
  const todas = [...melhor.values()];
  const bf = todas.filter((x) => x.o.blackFriday === true).sort(ordem);
  const resto = todas.filter((x) => x.o.blackFriday !== true).sort(ordem);
  return [...bf, ...resto].map((x) => candidatoCampanha(x.o, campanha.capturedAt, x));
}

export function candidatoCampanha(o, capturedAt, { productId = null, ref = null, tipoRef = null } = {}) {
  const { texto, parseMode } = montarLegenda({ titulo: o.titulo, atual: o.preco, loja: 'Mercado Livre', link: o.link, afiliado: true, produtoId: productId });
  const topo = o.blackFriday === true ? '🖤 <b>BLACK FRIDAY</b> 🖤\n\n' : '';
  const linhaRef = ref == null ? null : tipoRef === 'copag'
    ? (o.preco < ref - 0.009 ? `💰 Abaixo do preço sugerido Copag (${reais(ref)})` : `💰 No preço sugerido Copag (${reais(ref)})`)
    : `💰 Abaixo do menor preço das outras lojas (${reais(ref)})`;
  const extra = [linhaRef, `🕒 Preço lido em ${quando(capturedAt)}; pode ter mudado`].filter(Boolean).join('\n');
  const ofertaId = `ml:${o.item}`;
  return {
    item: { ofertaId, texto: `${topo}${texto}\n\n${extra}`, canal: 'whatsapp' },
    oferta: { id: ofertaId, productId, storeId: 'mercadolivre', firstSeen: null },
    foto: typeof o.foto === 'string' && IMG.test(o.foto) ? o.foto : null, itemMl: o.item, tema: o.blackFriday === true ? 'blackfriday' : null,
    parseMode, afiliado: true, loja: 'mercadolivre', campanha: 'black-friday', blackFriday: o.blackFriday === true,
  };
}

const OG = /<meta[^>]+property=["']og:image["'][^>]+content=["']([^"']+)["']|<meta[^>]+content=["']([^"']+)["'][^>]+property=["']og:image["']/i;
/** Foto do anúncio (og:image da página MLB-<id>), só de *.mlstatic.com. Falha: null (o post sai com o card sem foto do produto). */
export async function fotoDoAnuncio(item, fetchFn, { timeoutMs = 15000 } = {}) {
  if (!ITEM.test(String(item))) return null;
  try {
    const r = await fetchFn(`https://produto.mercadolivre.com.br/MLB-${item.slice(3)}-_JM`, { signal: AbortSignal.timeout(timeoutMs), headers: { 'user-agent': 'TCGPriceHunterBot/1.0' } });
    if (!r.ok) return null;
    const m = (await r.text()).match(OG);
    const url = m ? (m[1] || m[2]).replace(/&amp;/g, '&') : null;
    return url && IMG.test(url) ? url : null;
  } catch { return null; }
}
