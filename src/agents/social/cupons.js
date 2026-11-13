// Dica de cupom do Mercado Livre nos posts (#690). Puro: sem rede, banco ou secrets.
//
// Fonte: exportação "Meus cupons" da conta do proprietário (CSV), importada por tools/cupons-importar.mjs para
// config/social-cupons.json. São benefícios de conta, sem código digitável, e o ML personaliza por usuário: por
// isso o post traz uma DICA ("confira em Meus cupons"), nunca promete o desconto e nunca calcula preço final.
// Só entra: cupom do ML sem categoria, cupom do ML de categoria de brinquedos/jogos/colecionáveis, ou cupom do
// próprio vendedor do anúncio. Cupom vencido ou com compra mínima acima do preço não aparece.

const DIA = 86400000;
export const CATEGORIA_TCG = /brinquedo|jogos?\b|colecion|hobb|card|tcg|pok[eé]mon/i;
const SEMANA = ['domingo', 'segunda-feira', 'terça-feira', 'quarta-feira', 'quinta-feira', 'sexta-feira', 'sábado'];
const iso = (ms) => new Date(ms).toISOString().slice(0, 10);
const norm = (s) => String(s ?? '').trim().toLowerCase();
/** Nome de loja comparável: "Saga Geek", "SAGA_GEEK" e "sagageek" viram a mesma chave (o CSV usa o nome de exibição; o anúncio, o apelido). */
export const chaveLoja = (s) => norm(s).normalize('NFD').replace(/[^a-z0-9]/g, '');

/** Validade do CSV ("31/12", "domingo", "amanhã", vazio) → AAAA-MM-DD, relativa à data da exportação (BRT). */
export function validadeAte(txt, exportadoEm, { semDataDias = 3 } = {}) {
  const base = Date.parse(`${exportadoEm}T12:00:00-03:00`);
  if (!Number.isFinite(base)) throw new Error('cupons: data de exportação inválida');
  const t = norm(txt);
  if (!t) return iso(base + semDataDias * DIA);
  if (t === 'hoje') return iso(base);
  if (t === 'amanhã' || t === 'amanha') return iso(base + DIA);
  const w = SEMANA.indexOf(t);
  if (w >= 0) { const hoje = new Date(base).getUTCDay(); return iso(base + ((w - hoje + 7) % 7) * DIA); }
  const m = t.match(/^(\d{1,2})\/(\d{1,2})(?:\/(\d{2,4}))?$/);
  if (!m) return null;
  const ano0 = Number(exportadoEm.slice(0, 4));
  let ano = m[3] ? Number(m[3].length === 2 ? `20${m[3]}` : m[3]) : ano0;
  let d = `${ano}-${m[2].padStart(2, '0')}-${m[1].padStart(2, '0')}`;
  if (!m[3] && d < exportadoEm) d = `${ano + 1}${d.slice(4)}`;
  return Number.isFinite(Date.parse(d)) ? d : null;
}

const num = (s) => { const n = Number(String(s ?? '').replace(',', '.')); return Number.isFinite(n) && n >= 0 ? n : null; };

/** Linha do CSV (objeto) → cupom normalizado, ou null se não serve para Pokémon TCG. */
export function deLinha(r, exportadoEm, { vendedores = new Set() } = {}) {
  const d = String(r.desconto ?? '').trim();
  const pct = d.match(/^(\d{1,2})%$/); const rs = d.match(/^R\$\s?(\d+(?:[.,]\d+)?)$/);
  if (!pct && !rs) return null;
  const emissor = norm(r.emissor) === 'mercado livre' ? 'ml' : norm(r.emissor) === 'loja' ? 'loja' : null;
  if (!emissor) return null;
  const campanha = String(r.nome_cupom ?? '').trim(); const loja = String(r.loja ?? '').trim();
  let escopo;
  if (emissor === 'ml' && !campanha) escopo = 'ml';
  else if (emissor === 'ml' && CATEGORIA_TCG.test(campanha) && !/infantil|kids|moda|roupa/i.test(campanha)) escopo = 'categoria';
  else if (emissor === 'loja' && loja && (vendedores.has(norm(loja)) || vendedores.has(chaveLoja(loja)))) escopo = 'vendedor';
  else return null;
  const validoAte = validadeAte(r.validade, exportadoEm);
  if (!validoAte) return null;
  const minimo = num(r['compra_minima_R$']) ?? 0; const limite = num(r['limite_R$']);
  return { escopo, tipo: pct ? 'pct' : 'reais', valor: Number((pct?.[1] ?? rs[1]).replace(',', '.')), minimo, limite,
    ...(campanha ? { campanha } : {}), ...(escopo === 'vendedor' ? { vendedor: loja } : {}), validoAte };
}

/** CSV (texto, separador ;) → cupons normalizados, sem duplicatas. */
export function importarCsv(texto, exportadoEm, opts = {}) {
  const linhas = String(texto).replace(/^﻿/, '').split(/\r?\n/).filter((l) => l.trim());
  const cab = linhas.shift()?.split(';').map((c) => c.trim()) ?? [];
  for (const c of ['desconto', 'emissor', 'loja', 'nome_cupom', 'compra_minima_R$', 'limite_R$', 'validade']) if (!cab.includes(c)) throw new Error(`cupons: coluna ausente: ${c}`);
  const vistos = new Set(); const out = [];
  for (const l of linhas) {
    const v = l.split(';'); const r = Object.fromEntries(cab.map((c, i) => [c, v[i] ?? '']));
    const c = deLinha(r, exportadoEm, opts); if (!c) continue;
    const k = JSON.stringify(c); if (vistos.has(k)) continue; vistos.add(k); out.push(c);
  }
  return out;
}

/** Loja do cupom: campo `loja` (mercadolivre, shopee, amazon); sem ele, Mercado Livre (formato antigo do arquivo). */
export const lojaDoCupom = (c) => (c && typeof c.loja === 'string' && c.loja ? c.loja : 'mercadolivre');

/** Desconto que o cupom daria nesse preço (R$), respeitando o teto. */
export function descontoEm(c, preco) {
  const bruto = c.tipo === 'pct' ? (preco * c.valor) / 100 : c.valor;
  return c.limite != null && c.limite > 0 ? Math.min(bruto, c.limite) : bruto;
}

const hojeBrt = (now) => iso(now - 3 * 3600000);
const fmt = (v) => 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: v % 1 ? 2 : 0, maximumFractionDigits: 2 });

/** Melhor cupom para a oferta (ML, válido hoje, preço ≥ mínimo), ou null. Vendedor > categoria > ML geral no empate. */
export function cupomPara(oferta, cupons, now = Date.now()) {
  if (!oferta || oferta.storeId !== 'mercadolivre' || !(oferta.price > 0) || !Array.isArray(cupons)) return null;
  const hoje = hojeBrt(now); const vend = chaveLoja(oferta.seller);
  const peso = { vendedor: 3, categoria: 2, ml: 1 };
  const ok = cupons.filter((c) => c && lojaDoCupom(c) === 'mercadolivre' && c.validoAte >= hoje && oferta.price >= (c.minimo || 0)
    && (c.escopo !== 'vendedor' || (vend && chaveLoja(c.vendedor) === vend)));
  ok.sort((a, b) => descontoEm(b, oferta.price) - descontoEm(a, oferta.price) || peso[b.escopo] - peso[a.escopo]);
  return ok[0] && descontoEm(ok[0], oferta.price) > 0 ? ok[0] : null;
}

/** Linha da dica (texto puro, sem HTML) ou null. */
export function dicaCupom(oferta, cupons, now = Date.now()) {
  const c = cupomPara(oferta, cupons, now); if (!c) return null;
  // Curto (pedido do proprietário em 16/10/2026): valor, limite, mínimo e onde achar. 02/11/2026: "Meus cupons" só
  // lista o que já foi aplicado; o cupom geral é ativado em "Cupons" (botão Aplicar), então o post manda para lá.
  const quanto = c.tipo === 'pct' ? `${c.valor}%${c.limite ? ` até ${fmt(c.limite)}` : ''}` : `${fmt(c.valor)} OFF`;
  const onde = c.escopo === 'vendedor' ? ' da loja' : c.escopo === 'categoria' ? ' de Brinquedos' : '';
  const min = c.minimo > 0 ? ` (mín. ${fmt(c.minimo)})` : '';
  return `🎟️ Cupom${onde}: ${quanto}${min} · ative em "Cupons" no ML`;
}

// ---------------------------------------------------------------------------------------------------------------------
// Cupom com preço final nos posts dos grupos (pedido do dono em 13/11/2026: "SEMPRE colocar cupom de desconto, e o preço
// que vai sair com o cupom atrelado. Se não tiver cupom, sugerir algum que esteja funcionando; se não tiver, não colocar
// nada"). Vale para as três lojas: cada cupom de config/social-cupons.json pode ter `loja` e `codigo` (o código digitável;
// sem código, o cupom é ativado na página "Cupons" da loja). Escolhe, entre os cupons vigentes daquela loja cujo mínimo o
// preço alcança (e, se for de vendedor, do mesmo vendedor), o que dá mais desconto. Sem cupom que sirva: null (nada no post).
// O preço final é estimativa: a loja pode personalizar ou esgotar o cupom, então o post diz "com o cupom" e não promete.
const LOJAS_CUPOM = new Set(['mercadolivre', 'shopee', 'amazon']);
const CODIGO = /^[A-Za-z0-9]{3,30}$/;
const escHtml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** Melhor cupom vigente para { loja, preco, seller } (qualquer loja), ou null. */
export function melhorCupom({ loja, preco, seller = null } = {}, cupons, now = Date.now()) {
  if (!LOJAS_CUPOM.has(loja) || !(preco > 0) || !Array.isArray(cupons)) return null;
  const hoje = hojeBrt(now); const vend = chaveLoja(seller);
  const peso = { vendedor: 3, categoria: 2, ml: 1, loja: 1 };
  const ok = cupons.filter((c) => c && lojaDoCupom(c) === loja && typeof c.validoAte === 'string' && c.validoAte >= hoje
    && preco >= (c.minimo || 0) && (c.tipo === 'pct' || c.tipo === 'reais') && c.valor > 0
    && (c.escopo !== 'vendedor' || (vend && chaveLoja(c.vendedor) === vend))
    && (c.codigo == null || CODIGO.test(c.codigo)));
  ok.sort((a, b) => descontoEm(b, preco) - descontoEm(a, preco) || (peso[b.escopo] || 0) - (peso[a.escopo] || 0));
  const c = ok[0]; if (!c) return null;
  const desconto = Math.min(descontoEm(c, preco), preco);
  return desconto > 0 ? { cupom: c, desconto, final: Math.round((preco - desconto) * 100) / 100 } : null;
}

const ATIVAR = { mercadolivre: 'ative em "Cupons" no ML', shopee: 'resgate em "Cupons" na Shopee', amazon: 'resgate na página do produto na Amazon' };
/** Linha do post (HTML do Telegram) com o cupom e o preço final, ou null quando não há cupom que sirva. */
export function linhaCupomComPreco(oferta, cupons, now = Date.now()) {
  const r = melhorCupom(oferta, cupons, now); if (!r) return null;
  const { cupom: c, final } = r;
  const quanto = c.tipo === 'pct' ? `${c.valor}% OFF${c.limite ? ` (até ${fmt(c.limite)})` : ''}` : `${fmt(c.valor)} OFF`;
  const min = c.minimo > 0 ? `, mín. ${fmt(c.minimo)}` : '';
  const onde = c.codigo ? `Cupom <b>${escHtml(c.codigo)}</b>` : `Cupom${c.escopo === 'vendedor' ? ' da loja' : ''} (${ATIVAR[lojaDoCupom(c)]})`;
  return `🎟️ ${onde}: ${quanto}${min}\n➡️ Com o cupom sai por <b>${escHtml(reaisCentavos(final))}</b>`;
}
const reaisCentavos = (v) => 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
