// Shopee e Amazon nos posts do WhatsApp (pedido do proprietário em 02/11/2026: "15 min, variando entre os 3
// marketplaces, sempre com meus links de afiliado, as melhores promoções"). Puro: sem rede, banco ou secrets.
//
// O robô não lê Shopee nem Amazon: os preços vêm das leituras manuais com link de afiliado do dono
// (leituras de Shopee e Amazon carregadas por api/_lib/affiliates.mjs). Por isso, diferente das ofertas do ML
// (frescor de 30 min), aqui vale:
//   • só leitura das últimas `maxHoras` (24 h), e o post diz quando o preço foi lido;
//   • só promoção: preço efetivo (com cupom da Shopee, quando houver) até o preço sugerido da Copag (msrp) ou até o
//     menor preço em estoque do site para o mesmo produto;
//   • Amazon "Não disponível" fica de fora; um anúncio por produto e loja (o mais barato).
import { montarLegenda, reais } from './legenda.js';

const H = 3600e3;
const pos = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const quando = (iso) => {
  const d = new Date(iso);
  const f = (o) => d.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', ...o });
  return `${f({ day: '2-digit', month: '2-digit' })} às ${f({ hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })}`;
};

/** Menor preço em estoque por produto, nas ofertas do robô (state.offers). */
export function melhoresDoSite(offers) {
  const m = new Map();
  for (const o of Array.isArray(offers) ? offers : []) {
    if (o?.stock !== 'IN_STOCK' || o.stale === true || !pos(o.price) || !o.productId) continue;
    m.set(o.productId, Math.min(m.get(o.productId) ?? Infinity, o.price));
  }
  return m;
}

/** Leituras manuais → ofertas de promoção { loja, ofertaId, titulo, preco, precoCupom, efetivo, desconto, link, productId, capturedAt }. */
export function ofertasExternas({ shopee = [], amazon = [], products = [], offers = [], now = Date.now(), maxHoras = 24 } = {}) {
  const prod = new Map((Array.isArray(products) ? products : []).map((p) => [p.id, p]));
  const site = melhoresDoSite(offers);
  const brutas = [
    ...(Array.isArray(shopee) ? shopee : []).map((x) => ({ loja: 'shopee', ofertaId: `shopee:${x.item}`, titulo: x.title, preco: pos(x.price), precoCupom: pos(x.priceCupom), link: x.url, productId: x.productId, capturedAt: x.capturedAt })),
    ...(Array.isArray(amazon) ? amazon : []).filter((x) => x?.stockNote !== 'Não disponível')
      .map((x) => ({ loja: 'amazon', ofertaId: `amazon:${x.asin}`, titulo: x.title, preco: pos(x.price), precoCupom: null, link: x.shortUrl, productId: x.productId, capturedAt: x.capturedAt })),
  ];
  const melhor = new Map();
  for (const o of brutas) {
    const t = Date.parse(o.capturedAt);
    if (!o.preco || !o.productId || !o.titulo || !Number.isFinite(t) || t > now + 5 * 60e3 || now - t > maxHoras * H) continue;
    if (!/^https:\/\//.test(String(o.link || ''))) continue;
    const p = prod.get(o.productId); if (!p) continue;
    const efetivo = o.precoCupom && o.precoCupom < o.preco ? o.precoCupom : o.preco;
    const msrp = pos(p.msrp); const doSite = site.get(o.productId);
    if (!((msrp && efetivo <= msrp) || (doSite != null && efetivo <= doSite))) continue;
    const desconto = msrp ? 1 - efetivo / msrp : 0;
    const k = `${o.loja}|${o.productId}`; const atual = melhor.get(k);
    if (!atual || efetivo < atual.efetivo) melhor.set(k, { ...o, efetivo, desconto, image: p.image ?? null });
  }
  return [...melhor.values()].sort((a, b) => b.desconto - a.desconto || a.efetivo - b.efetivo);
}

const SHOPEE_LINK = /^https:\/\/s\.shopee\.com\.br\/[A-Za-z0-9]+$/;
const AMAZON_CURTO = /^https:\/\/link\.amazon\/[A-Za-z0-9]+$/;
/** JSON das leituras (o workflow passa os caminhos) → { shopee, amazon }; só links curtos de afiliado do dono. */
export function lerLeituras(shopeeJson, amazonJson) {
  const am = amazonJson?.links;
  return {
    shopee: (Array.isArray(shopeeJson?.ofertas) ? shopeeJson.ofertas : []).filter((x) => SHOPEE_LINK.test(x?.url || '')),
    amazon: (Array.isArray(am) ? am : Object.values(am && typeof am === 'object' ? am : {})).filter((x) => /^[A-Z0-9]{10}$/.test(x?.asin || '') && AMAZON_CURTO.test(x?.shortUrl || '')),
  };
}

const NOME = { shopee: 'Shopee', amazon: 'Amazon' };

/** Oferta externa → candidato no formato de candidatos() (item.texto em HTML do Telegram; o WhatsApp converte). */
export function candidatoExterno(o) {
  const { texto, parseMode } = montarLegenda({ titulo: o.titulo, atual: o.preco, loja: NOME[o.loja], link: o.link, afiliado: true, produtoId: o.productId });
  const extra = [
    o.precoCupom && o.precoCupom < o.preco ? `🎟️ Com cupom da Shopee: <b>${esc(reais(o.precoCupom))}</b> (o cupom aparece na página)` : null,
    `🕒 Preço lido em ${quando(o.capturedAt)}; pode ter mudado`,
  ].filter(Boolean).join('\n');
  const t = `${texto}\n\n${extra}`;
  return { item: { ofertaId: o.ofertaId, texto: t, canal: 'whatsapp' }, oferta: { id: o.ofertaId, productId: o.productId, storeId: o.loja, firstSeen: null }, foto: o.image, parseMode, afiliado: true, loja: o.loja };
}

/** Intercala as listas na ordem dada (ML, Shopee, Amazon, ML, ...). Lista que acaba sai da roda. */
export function intercalar(...listas) {
  const out = []; const ls = listas.map((l) => [...l]);
  while (ls.some((l) => l.length)) for (const l of ls) if (l.length) out.push(l.shift());
  return out;
}
