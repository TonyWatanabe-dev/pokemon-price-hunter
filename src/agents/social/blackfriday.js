// Campanha Black Friday nos grupos (pedido do dono em 02/11/2026: "vamos priorizar as ofertas no grupo, faça uma arte
// diferente para ofertas Black Friday, quero priorizar elas"). Puro, exceto fotoDoAnuncio (rede, só leitura).
//
// Fonte: config/social-black-friday.json — anúncios do Mercado Livre lidos na busca "pokémon tcg", cada um com o link de
// afiliado do dono gerado para o próprio anúncio (MLB-<id>), preço e desconto vistos na leitura e o selo BLACK FRIDAY.
// Regras:
//   • vale por `validadeHoras` do arquivo (padrão 24 h, teto 72 h) a partir de capturedAt, como as leituras manuais de Shopee/Amazon; o post diz quando o
//     preço foi lido, porque pode ter mudado;
//   • só promoção: desconto do anúncio > 0 (selo Black Friday sem desconto fica de fora);
//   • ordem: primeiro as com selo Black Friday (maior desconto primeiro), depois as demais da campanha;
//   • as com selo usam o card de Black Friday (tools/social-card.py --tema blackfriday). A foto vem do campo `foto` do
//     arquivo (lida na mesma leitura, porque o ML não entrega a página do anúncio ao runner do GitHub) e, sem ela, do
//     og:image do anúncio.
// Kill switch: SOCIAL_BLACKFRIDAY=0.
import fs from 'node:fs';
import { montarLegenda } from './legenda.js';

export const ARQUIVO = new URL('../../../config/social-black-friday.json', import.meta.url);
const H = 3600e3;
const ITEM = /^MLB\d{6,15}$/;
const MELI = /^https:\/\/meli\.la\/[A-Za-z0-9]+$/;
const IMG = /^https:\/\/(?:[a-z0-9-]+\.)*mlstatic\.com\/[^\s"'<>]+$/i;   // foto: só do CDN do Mercado Livre

export function lerCampanha(arquivo = ARQUIVO) {
  try { return JSON.parse(fs.readFileSync(arquivo, 'utf8')); } catch { return null; }
}

const quando = (iso) => new Date(iso).toLocaleDateString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit' });

/** Campanha → candidatos no formato de candidatos() (item.texto em HTML do Telegram; o WhatsApp converte).
 *  Fora da validade, desligada ou malformada: lista vazia. */
export function candidatosCampanha(campanha, { now = Date.now(), env = {}, maxHoras = null } = {}) {
  if (env.SOCIAL_BLACKFRIDAY === '0' || !campanha || !Array.isArray(campanha.ofertas)) return [];
  // validadeHoras do arquivo (padrão 24 h, teto 72 h); a legenda sempre diz o dia da leitura.
  if (maxHoras == null) maxHoras = Number.isFinite(campanha.validadeHoras) ? Math.min(Math.max(campanha.validadeHoras, 1), 72) : 24;
  const t = Date.parse(campanha.capturedAt);
  if (!Number.isFinite(t) || t > now + 5 * 60e3 || now - t > maxHoras * H) return [];
  const vistos = new Set();
  const validas = campanha.ofertas.filter((o) => o && ITEM.test(o.item) && MELI.test(o.link) && typeof o.titulo === 'string' && o.titulo.trim()
    && typeof o.preco === 'number' && o.preco > 0 && Number.isInteger(o.desconto) && o.desconto > 0 && o.desconto < 100
    && !vistos.has(o.item) && vistos.add(o.item));
  const ordem = (a, b) => b.desconto - a.desconto || a.preco - b.preco;
  const bf = validas.filter((o) => o.blackFriday === true).sort(ordem);
  const resto = validas.filter((o) => o.blackFriday !== true).sort(ordem);
  return [...bf, ...resto].map((o) => candidatoCampanha(o, campanha.capturedAt));
}

export function candidatoCampanha(o, capturedAt) {
  const { texto, parseMode } = montarLegenda({ titulo: o.titulo, atual: o.preco, loja: 'Mercado Livre', link: o.link, afiliado: true });
  const topo = o.blackFriday === true ? '🖤 <b>BLACK FRIDAY</b> 🖤\n\n' : '';
  const extra = `🔻 ${o.desconto}% OFF no anúncio\n🕒 Preço lido em ${quando(capturedAt)}; pode ter mudado`;
  const ofertaId = `ml:${o.item}`;
  return {
    item: { ofertaId, texto: `${topo}${texto}\n\n${extra}`, canal: 'whatsapp' },
    oferta: { id: ofertaId, productId: null, storeId: 'mercadolivre', firstSeen: null },
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
