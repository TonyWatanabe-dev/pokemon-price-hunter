// "Monte seu kit" (docs/monte-seu-kit.md, K2): respostas do questionário + produtos e ofertas reais → cesta explicável.
// Função pura (sem rede, sem I/O): quem chama passa os produtos e as ofertas que já vieram da API do site.
// Regras (§4 a §6 do documento):
//  • só oferta com estoque agora; idioma pelo sufixo do id (-en/-ja/-zh/-ko; sem sufixo = português); nunca misturar;
//  • a melhor oferta de cada produto pelo mesmo critério do site (bestComparable de api/_lib/offer-rank.mjs);
//  • orçamento pelo preço dos produtos; total com frete só quando todo frete for conhecido; frete é por loja (um pedido),
//    nunca por item; frete desconhecido nunca vira zero; frete grátis da regra pública da loja vale acima do mínimo;
//  • sem dado suficiente: cesta vazia com o motivo, nunca um item inventado; nunca prometer carta, raridade ou chance.
import { bestComparable } from '../../api/_lib/offer-rank.mjs';
import { MODELOS, OBJETIVO_MODELO, ACESSORIO_NOME } from './modelos.js';

const LANGS = ['en', 'ja', 'zh', 'ko'];
export const idiomaDe = (id) => { const s = String(id).split('-').pop(); return LANGS.includes(s) ? s : 'pt'; };
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
const r2 = (v) => Math.round(v * 100) / 100;

/** Melhor oferta com estoque por produto (Map productId → oferta). */
export function melhoresOfertas(ofertas) {
  const by = new Map();
  for (const o of ofertas || []) if (o && o.stock === 'IN_STOCK' && Number.isFinite(o.price) && o.price > 0 && o.url) (by.get(o.productId) || by.set(o.productId, []).get(o.productId)).push(o);
  return new Map([...by].map(([id, l]) => [id, bestComparable(l)]));
}

/** Frete da cesta por loja. fg = { storeId: { min } } (config/frete-gratis.json). */
export function freteDaCesta(itens, fg = {}) {
  const lojas = new Map();
  for (const it of itens) { const l = lojas.get(it.oferta.storeId) || { storeId: it.oferta.storeId, nome: it.oferta.storeName || it.oferta.storeId, itens: [], subtotal: 0 }; l.itens.push(it); l.subtotal = r2(l.subtotal + it.oferta.price * it.quantidade); lojas.set(l.storeId, l); }
  const out = [];
  for (const l of lojas.values()) {
    const regra = fg[l.storeId];
    let frete = null; let como = 'a calcular na loja';
    if (regra && l.subtotal >= regra.min) { frete = 0; como = `grátis pela regra da loja (acima de R$ ${regra.min})`; }
    else if (l.itens.length === 1 && l.itens[0].quantidade === 1 && l.itens[0].oferta.shippingKnown === true && Number.isFinite(l.itens[0].oferta.shipping)) { frete = l.itens[0].oferta.shipping; como = frete === 0 ? 'grátis informado pela loja' : 'informado pela loja'; }
    else if (l.itens.every((it) => it.oferta.shippingKnown === true && it.oferta.shipping === 0)) { frete = 0; como = 'grátis informado pela loja'; }
    out.push({ storeId: l.storeId, nome: l.nome, subtotal: l.subtotal, frete, como });
  }
  return out;
}

/** respostas = { objetivo, orcamento, idioma ('pt'|'en'|'ja'|'qualquer'), favorito? }.
 *  produtos = [{ id, type, name }]; ofertas = [{ productId, storeId, storeName, price, total, shipping, shippingKnown, stock, url, source_timestamp }]. */
export function recomendar(respostas, produtos, ofertas, { fg = {} } = {}) {
  const limitacoes = [];
  const modeloId = OBJETIVO_MODELO[respostas?.objetivo];
  const orcamento = Number(respostas?.orcamento);
  if (!modeloId) return { modelo: null, itens: [], limitacoes: ['Ainda não comparamos preço de acessórios (sleeves, fichários, deck boxes). Veja as lojas que vendem na página de lojas.'] };
  if (!(orcamento > 0)) return { modelo: modeloId, itens: [], limitacoes: ['Informe um orçamento para montar o kit.'] };
  const modelo = MODELOS[modeloId];
  const idioma = ['pt', 'en', 'ja', 'zh', 'ko'].includes(respostas.idioma) ? respostas.idioma : 'qualquer';
  const best = melhoresOfertas(ofertas);
  const fav = norm(respostas.favorito).trim();
  const itens = []; let resta = orcamento;
  for (const papel of modelo.papeis) {
    let cands = (produtos || []).filter((p) => papel.tipos.includes(p.type) && best.has(p.id) && (idioma === 'qualquer' || idiomaDe(p.id) === idioma));
    if (fav) { const f = cands.filter((p) => norm(p.name).includes(fav)); if (f.length) cands = f; else limitacoes.push(`Nenhum produto com "${respostas.favorito}" no nome dentro deste kit agora; mostramos as outras opções.`); }
    // ordem: tipo preferido do papel, depois o que cabe com melhor preço; português antes quando o idioma é indiferente
    cands.sort((a, b) => papel.tipos.indexOf(a.type) - papel.tipos.indexOf(b.type) || (idioma === 'qualquer' ? (idiomaDe(a.id) !== 'pt') - (idiomaDe(b.id) !== 'pt') : 0) || best.get(a.id).price - best.get(b.id).price || a.id.localeCompare(b.id));
    const escolha = cands.find((p) => best.get(p.id).price <= resta);
    if (!escolha) { limitacoes.push(cands.length ? `O produto mais em conta deste kit (R$ ${Math.min(...cands.map((p) => best.get(p.id).price)).toFixed(2).replace('.', ',')}) passa do orçamento.` : 'Não há produto deste tipo com estoque agora no idioma escolhido.'); continue; }
    const of = best.get(escolha.id);
    const quantidade = Math.max(1, Math.min(papel.repetir || 1, Math.floor(resta / of.price)));
    resta = r2(resta - of.price * quantidade);
    itens.push({ productId: escolha.id, nome: escolha.name, tipo: escolha.type, idioma: idiomaDe(escolha.id), quantidade, porque: papel.porque, oferta: of });
  }
  if (modelo.acessorios.length) limitacoes.push(`Sugerimos também ${modelo.acessorios.map((a) => ACESSORIO_NOME[a]).join(', ')}, mas ainda não comparamos o preço de acessórios: não estão no valor abaixo.`);
  const subtotal = r2(itens.reduce((s, it) => s + it.oferta.price * it.quantidade, 0));
  const fretes = freteDaCesta(itens, fg);
  const freteConhecido = fretes.length > 0 && fretes.every((f) => f.frete != null);
  const total = freteConhecido ? r2(subtotal + fretes.reduce((s, f) => s + f.frete, 0)) : null;
  return { modelo: modeloId, nomeModelo: modelo.nome, orcamento, itens, subtotal, fretes, total, cabeNoOrcamento: subtotal <= orcamento, limitacoes };
}
