// Campanha Black Friday nos grupos (pedido do dono em 02/11/2026: "vamos priorizar as ofertas no grupo, faça uma arte
// diferente para ofertas Black Friday, quero priorizar elas"). Puro, exceto fotoDoAnuncio (rede, só leitura).
//
// Fonte: config/social-black-friday.json — anúncios do Mercado Livre lidos na busca "pokémon tcg", cada um com o link de
// afiliado do dono gerado para o próprio anúncio (MLB-<id>), preço e desconto vistos na leitura e o selo BLACK FRIDAY.
// Regras:
//   • vale por `validadeHoras` do arquivo (padrão 24 h, teto 72 h) a partir do capturedAt da linha (ou do arquivo), como as leituras manuais de Shopee/Amazon; o post diz quando o
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
// Três lojas (06/11/2026, planilha "Ofertas BF Pokémon TCG" do dono): cada linha pode trazer `loja` (mercadolivre,
// padrão; shopee; amazon), o link de afiliado do dono daquela loja, `pix` (preço só no Pix, a legenda diz "no Pix") e
// `productId` — mapeamento manual título a título, usado quando o título curto da planilha não passa no verificador;
// o produto ainda tem de existir no site e o preço continua sujeito à mesma regra. Sem `item`, o anúncio do ML é
// identificado pelo link. A mesma planilha alimenta a seção Black Friday da Home (tools/black-friday-site.mjs).
// Kill switch: SOCIAL_BLACKFRIDAY=0.
import fs from 'node:fs';
import { montarLegenda, reais } from './legenda.js';
import { parseListing, productIdOf, normalize } from '../../match.js';
import { melhoresDoSite } from './externas.js';

export const ARQUIVO = new URL('../../../config/social-black-friday.json', import.meta.url);
const H = 3600e3;
const ITEM = /^MLB\d{6,15}$/;
const MELI = /^https:\/\/meli\.la\/[A-Za-z0-9]+$/;
// link de afiliado do dono por loja (Amazon: só o link curto, como as leituras manuais)
export const LINKS = {
  mercadolivre: MELI,
  shopee: /^https:\/\/s\.shopee\.com\.br\/[A-Za-z0-9]+$/,
  amazon: /^https:\/\/link\.amazon\/[A-Za-z0-9]+$/,
};
const NOME = { mercadolivre: 'Mercado Livre', shopee: 'Shopee', amazon: 'Amazon' };
const lojaDe = (o) => (o?.loja == null ? 'mercadolivre' : o.loja);
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
  let productId = typeof o.productId === 'string' && o.productId ? o.productId : null;
  if (!productId) {
    const r = parseListing(o.titulo, catalog);
    if (r.rejects.length || !r.collection || !r.type) return null;
    productId = productIdOf(r.collection, r.type, r.boosters ?? null, r.variant ?? null, r.lang);
  }
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
  // cada linha pode ter o próprio capturedAt (releitura parcial, 07/11/2026); sem ele, vale o do arquivo
  const quandoDe = (o) => (typeof o?.capturedAt === 'string' ? o.capturedAt : campanha.capturedAt);
  const vigente = (o) => { const t = Date.parse(quandoDe(o)); return Number.isFinite(t) && t <= now + 5 * 60e3 && now - t <= maxHoras * H; };
  const site = melhoresDoSite(state.offers);
  const melhor = new Map();                                 // um anúncio por produto: o mais barato
  for (const o of campanha.ofertas) {
    const loja = lojaDe(o);
    if (!o || !vigente(o) || !LINKS[loja]?.test(o.link) || (o.item != null && !ITEM.test(o.item)) || (loja === 'mercadolivre' && o.item == null && !o.productId) || typeof o.titulo !== 'string' || !o.titulo.trim() || typeof o.preco !== 'number' || !(o.preco > 0)) continue;
    const bom = seladoComPrecoBom(o, { catalog, products: state.products, site });
    if (!bom) continue;
    bom.imagem = (state.products || []).find((p) => p?.id === bom.productId)?.image || null;
    const atual = melhor.get(bom.productId);
    if (!atual || o.preco < atual.o.preco) melhor.set(bom.productId, { o, ...bom, economia: 1 - o.preco / bom.ref });
  }
  const ordem = (a, b) => b.economia - a.economia || a.o.preco - b.o.preco;
  const todas = [...melhor.values()];
  const bf = todas.filter((x) => x.o.blackFriday === true).sort(ordem);
  const resto = todas.filter((x) => x.o.blackFriday !== true).sort(ordem);
  return [...bf, ...resto].map((x) => candidatoCampanha(x.o, quandoDe(x.o), x));
}

export function candidatoCampanha(o, capturedAt, { productId = null, ref = null, tipoRef = null, imagem = null } = {}) {
  const loja = lojaDe(o);
  const { texto, parseMode } = montarLegenda({ titulo: o.titulo, atual: o.preco, loja: NOME[loja], link: o.link, afiliado: true, produtoId: productId, pix: o.pix === true });
  const topo = o.blackFriday === true ? '🖤 <b>BLACK FRIDAY</b> 🖤\n\n' : '';
  const linhaRef = ref == null ? null : tipoRef === 'copag'
    ? (o.preco < ref - 0.009 ? `💰 Abaixo do preço sugerido Copag (${reais(ref)})` : `💰 No preço sugerido Copag (${reais(ref)})`)
    : `💰 Abaixo do menor preço das outras lojas (${reais(ref)})`;
  // Cupom do anúncio (campo `cupom` da linha, lido na mesma leitura do preço): texto curto, escapado, sem inventar valor.
  const cupom = typeof o.cupom === 'string' && o.cupom.trim() ? `🎟️ ${o.cupom.trim().slice(0, 140).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}` : null;
  const extra = [cupom, linhaRef, `🕒 Preço lido em ${quando(capturedAt)}; pode ter mudado`].filter(Boolean).join('\n');
  const ofertaId = o.item ? `ml:${o.item}` : `${loja}:${o.link.split('/').pop()}`;
  const foto = typeof o.foto === 'string' && IMG.test(o.foto) ? o.foto : (typeof imagem === 'string' && /^https:\/\//.test(imagem) ? imagem : null);
  return {
    item: { ofertaId, texto: `${topo}${texto}\n\n${extra}`, canal: 'whatsapp' },
    oferta: { id: ofertaId, productId, storeId: loja, firstSeen: null },
    foto, ...(o.item ? { itemMl: o.item } : {}), tema: o.blackFriday === true ? 'blackfriday' : null,
    parseMode, afiliado: true, loja, campanha: 'black-friday', blackFriday: o.blackFriday === true, preco: o.preco,
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
