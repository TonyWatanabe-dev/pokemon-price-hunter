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
  else if (emissor === 'loja' && loja && vendedores.has(norm(loja))) escopo = 'vendedor';
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
  const hoje = hojeBrt(now); const vend = norm(oferta.seller);
  const peso = { vendedor: 3, categoria: 2, ml: 1 };
  const ok = cupons.filter((c) => c && c.validoAte >= hoje && oferta.price >= (c.minimo || 0)
    && (c.escopo !== 'vendedor' || (vend && norm(c.vendedor) === vend)));
  ok.sort((a, b) => descontoEm(b, oferta.price) - descontoEm(a, oferta.price) || peso[b.escopo] - peso[a.escopo]);
  return ok[0] && descontoEm(ok[0], oferta.price) > 0 ? ok[0] : null;
}

/** Linha da dica (texto puro, sem HTML) ou null. */
export function dicaCupom(oferta, cupons, now = Date.now()) {
  const c = cupomPara(oferta, cupons, now); if (!c) return null;
  const quanto = c.tipo === 'pct' ? `${c.valor}% OFF${c.limite ? ` (até ${fmt(c.limite)})` : ''}` : `${fmt(c.valor)} OFF`;
  const onde = c.escopo === 'vendedor' ? ' da loja' : c.escopo === 'categoria' ? ' de Brinquedos' : '';
  const min = c.minimo > 0 ? ` acima de ${fmt(c.minimo)}` : '';
  return `🎟️ Cupom${onde}: ${quanto}${min}. Confira em "Meus cupons" no app do ML (varia por conta).`;
}
