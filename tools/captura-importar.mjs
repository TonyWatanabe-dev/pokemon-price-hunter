#!/usr/bin/env node
// Importa o arquivo do botão "Capturar ofertas" (tools/captura/bookmarklet.js), gerado pelo dono no próprio navegador nas
// páginas de busca do Mercado Livre, da Shopee e da Amazon (27/11/2026: a API do ML barra a leitura de anúncios de terceiros).
//
//   node tools/captura-importar.mjs <captura.json> [--seco]
//
// Grava as leituras nas listas manuais que o robô publica por 48 h (api/_lib/affiliates.mjs → ofertasManuaisParceiras):
//   - Mercado Livre → config/afiliados/ml-ofertas.json   (só anúncio com link do dono no mapa de config/affiliates.json)
//   - Shopee        → config/afiliados/shopee-ofertas.json (só anúncio com link do dono em config/afiliados/shopee.json)
//   - Amazon        → config/afiliados/amazon.json        (só ASIN que já tem o link curto do dono; o preço é atualizado)
// Entra só selado casado por src/match.js com confiança ≥ 0,8, sem carta avulsa nem kit, com preço até o teto do formato (tetoDe) e
// até 2x a mediana do produto no lote (grupos de 3+); até 5 mais baratos por produto e loja.
// Anúncios sem link do dono saem em tools/captura/sem-link-<loja>.txt (URL por linha) para gerar os links no painel de cada
// programa; depois de gravar os links, rode o importador de novo com o mesmo arquivo.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { matchProduct } from '../src/match.js';
import { loadCatalog } from '../src/run.js';
import { cartaAvulsa } from '../src/agents/social/blackfriday.js';
import { gravarCaptura } from '../api/_lib/affiliates.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

export const MIN_CONF = 0.8;
export const POR_PRODUTO = 5;
const VARIAS_OPCOES = /\s(ou|\/)\s|sortid|escolha|variad|diversos|\blote\b|\b\d+\s*x\s|c\/\s*\d+\s*blister|\b([2-9]|1\d)\s*blisters?\b/i;
// "Kit" junta vários produtos (2x blister, caixa com 12 blisters…); o Desafio Estratégico é o único produto vendido com esse nome.
const KIT = (t) => /\bkit\b/i.test(t) && !/desafio estrat/i.test(t);
// Preço fora da curva do próprio lote (caixa fechada lida como unidade, colecionável antigo): acima de 2x a mediana do produto.
export const TETO_MEDIANA = 2;
// Teto absoluto por tipo de produto (vale para qualquer grupo, inclusive com 1–2 ofertas): acima disso é caixa/lote lido como
// unidade ou colecionável fora de catálogo, nunca oportunidade. Valores ~3x o sugerido Copag atual de cada formato.
export function tetoDe(productId) {
  const id = String(productId || '');
  const n = (re) => { const m = re.exec(id); return m ? Number(m[1]) : null; };
  const bl = n(/-blister(\d)\b/); if (bl) return [0, 120, 200, 250, 300, 350][bl] || 350;
  const co = n(/-combo(\d+)\b/); if (co) return co * 60;
  const bx = n(/-box(\d+)\b/); if (bx) return bx * 45;
  if (/-booster(?:-|$)/.test(id)) return 120;
  if (/-etb(?:-|$)/.test(id)) return 900;
  if (/-desafio(?:-|$)/.test(id)) return 600;
  if (/-colecao_premium/.test(id)) return 900;
  if (/-colecao/.test(id)) return 700;
  return 800;
}

/** Normaliza um item do arquivo de captura; devolve null quando não serve. */
export function normalizar(it) {
  const loja = it?.loja;
  const preco = Number(it?.preco);
  if (!['mercadolivre', 'shopee', 'amazon'].includes(loja) || !(preco > 0) || typeof it.titulo !== 'string' || !it.titulo.trim()) return null;
  let id = String(it.id || '');
  if (loja === 'mercadolivre') { const m = /^MLB-?(\d{6,})$/.exec(id); if (!m) return null; id = `MLB${m[1]}`; }
  if (loja === 'shopee' && !/^\d{3,15}\/\d{3,20}$/.test(id)) return null;
  if (loja === 'amazon' && !/^[A-Z0-9]{10}$/.test(id)) return null;
  const de = Number(it.precoDe);
  const at = Date.parse(it.capturadoEm || '');
  if (!Number.isFinite(at)) return null;
  return { loja, id, titulo: it.titulo.trim().replace(/\s+/g, ' '), preco: Math.round(preco * 100) / 100, precoDe: de > preco ? Math.round(de * 100) / 100 : null,
    vendedor: it.vendedor ? String(it.vendedor).trim().slice(0, 80) : null, freteGratis: it.freteGratis === true, capturadoEm: new Date(at).toISOString().replace(/\.\d{3}Z$/, 'Z') };
}

/** Casa com o catálogo e filtra (selado, uma opção, confiança mínima); fica até POR_PRODUTO mais baratos por produto e loja. */
export function selecionar(itens, catalog) {
  const ok = [];
  const fora = {};
  const conta = (k) => { fora[k] = (fora[k] || 0) + 1; };
  const vistos = new Map();
  for (const bruto of itens) {
    const it = normalizar(bruto);
    if (!it) { conta('inválido'); continue; }
    const k = `${it.loja}|${it.id}`;
    const ant = vistos.get(k);
    if (ant && ant.capturadoEm >= it.capturadoEm) continue;
    vistos.set(k, it);
  }
  for (const it of vistos.values()) {
    if (cartaAvulsa(it.titulo)) { conta('carta avulsa'); continue; }
    if (VARIAS_OPCOES.test(it.titulo) || KIT(it.titulo)) { conta('várias opções/lote/kit'); continue; }
    const m = matchProduct({ title: it.titulo }, catalog);
    if (!m.productId || !(m.confidence >= MIN_CONF)) { conta('sem produto do catálogo'); continue; }
    if (it.preco > tetoDe(m.productId)) { conta('preço acima do teto do formato'); continue; }
    ok.push({ ...it, productId: m.productId });
  }
  const grupos = new Map();
  for (const it of ok) { const k = `${it.loja}|${it.productId}`; (grupos.get(k) || grupos.set(k, []).get(k)).push(it); }
  const sel = [];
  for (const g of grupos.values()) {
    g.sort((a, b) => a.preco - b.preco);
    const med = g[Math.floor((g.length - 1) / 2)].preco;
    const n0 = g.length;
    if (g.length >= 3) g.splice(0, g.length, ...g.filter((x) => x.preco <= med * TETO_MEDIANA));
    if (g.length < n0) fora['preço fora da curva'] = (fora['preço fora da curva'] || 0) + (n0 - g.length);
    sel.push(...g.slice(0, POR_PRODUTO)); fora['além dos 5 mais baratos'] = (fora['além dos 5 mais baratos'] || 0) + Math.max(0, g.length - POR_PRODUTO);
  }
  return { sel, fora };
}

async function main() {
  const [arq, ...flags] = process.argv.slice(2);
  if (!arq) { console.error('uso: node tools/captura-importar.mjs <captura.json> [--seco]'); process.exit(2); }
  const seco = flags.includes('--seco');
  let cap = null; try { cap = JSON.parse(fs.readFileSync(path.resolve(arq), 'utf8')); } catch (e) { console.error('arquivo ilegível:', e.message); process.exit(2); }
  const itens = Array.isArray(cap?.itens) ? cap.itens : Array.isArray(cap) ? cap : [];
  const { sel, fora } = selecionar(itens, loadCatalog());
  const { gravados, semLink, semVendedor } = gravarCaptura(sel, { seco });
  if (!seco) for (const [loja, l] of Object.entries(semLink)) fs.writeFileSync(path.join(root, 'tools', 'captura', `sem-link-${loja}.txt`), l.join('\n') + (l.length ? '\n' : ''));
  console.log(JSON.stringify({ lidos: itens.length, selecionados: sel.length, gravados, semLink: Object.fromEntries(Object.entries(semLink).map(([k, v]) => [k, v.length])), semVendedor: { amazon: (semVendedor?.amazon || []).length, shopee: (semVendedor?.shopee || []).length }, fora, seco, diagnostico: cap?.diagnostico ? 'há diagnóstico no arquivo (página sem leitura)' : null }, null, 1));
}

if (import.meta.url === `file://${process.argv[1]}`) main();
