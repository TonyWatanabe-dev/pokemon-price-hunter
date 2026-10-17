#!/usr/bin/env node
// Sonda SOMENTE LEITURA de feeds de produto (Google Shopping/Merchant) nas lojas lidas pelo JSON-LD. Para cada loja,
// tenta caminhos conhecidos de feed das plataformas (Tray, Loja Integrada, Nuvemshop, WooCommerce, genéricos) e os
// "Sitemap:" do robots.txt que parecem feed. Respeita o robots.txt (guard) e não segue links. Não grava dados.
// Uso: node tools/sonda-feeds.mjs [pasta-data] [--lojas id,id] [--json saida.json]
import fs from 'node:fs';
import path from 'node:path';
import { get } from '../src/http.js';
import { guard } from '../src/adapters/common.js';

export const CAMINHOS = Object.freeze(['/xml/googleshopping.xml', '/xml/google-shopping.xml', '/xml/google.xml', '/googleshopping.xml', '/google-shopping.xml',
  '/feed/google', '/feeds/google.xml', '/feed/google-shopping.xml', '/merchant.xml', '/product-feed.xml', '/xml/produtos.xml', '/wp-content/uploads/woo-feed/google/xml/google.xml']);

/** Resumo de um XML de feed: itens, quantos com preço (g:price) e quantos citam Pokémon. null se não parece feed. */
export function resumoFeed(xml) {
  const s = String(xml || '').slice(0, 20_000_000);
  if (!/<(rss|feed|channel)[\s>]/i.test(s)) return null;
  const itens = s.match(/<(item|entry)[\s>][\s\S]*?<\/(item|entry)>/gi) || [];
  if (!itens.length) return null;
  const preco = itens.filter((i) => /<g:price>|<price>/i.test(i)).length;
  const poke = itens.filter((i) => /pok[eé]mon/i.test(i)).length;
  const estoque = itens.filter((i) => /<g:availability>/i.test(i)).length;
  return { itens: itens.length, comPreco: preco, pokemon: poke, comEstoque: estoque };
}

// Anotações (só 10 aparecem por etapa): uma por loja COM feed e um resumo final com as demais.
const anota = (nivel, msg) => { console.log(msg); if (process.env.GITHUB_ACTIONS) console.log(`::${nivel}::${msg}`); };

async function main() {
  const args = process.argv.slice(2); const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
  const dir = args.find((a, i) => !a.startsWith('--') && !['--lojas', '--json'].includes(args[i - 1])) || 'data';
  const sources = JSON.parse(fs.readFileSync(path.join(dir, 'sources.json'), 'utf8'));
  const so = (opt('--lojas') || '').split(',').filter(Boolean);
  const lojas = Object.entries(sources).filter(([id, v]) => (so.length ? so.includes(id) : v.status === 'ACTIVE' && v.platform === 'jsonld') && v.url);
  const out = [];
  for (const [id, v] of lojas) {
    const base = v.url.replace(/\/$/, ''); const achados = [];
    let extras = [];
    try { await guard(base + '/robots.txt'); const r = await get(base + '/robots.txt'); extras = [...String(r.text).matchAll(/^sitemap:\s*(\S+)/gim)].map((m) => m[1]).filter((u) => /feed|shopping|merchant|google/i.test(u)); } catch { /* sem robots */ }
    for (const url of [...CAMINHOS.map((c) => base + c), ...extras]) {
      try { await guard(url); } catch { continue; }
      try { const r = await get(url, { accept: 'application/xml,text/xml,*/*' }); const s = resumoFeed(r.text); if (s && s.comPreco) achados.push({ url, ...s }); } catch { /* 404 etc. */ }
      if (achados.length) break;
    }
    const f = achados[0] || null; out.push({ id, base, plataforma: v.platformHint || null, feed: f });
    (f ? (m) => anota('notice', m) : console.log)(`${id} (${v.platformHint || '?'}): ${f ? `feed ${f.url} · ${f.itens} itens, ${f.comPreco} com preço, ${f.pokemon} Pokémon, ${f.comEstoque} com estoque` : 'sem feed público'}`);
  }
  const sem = out.filter((x) => !x.feed).map((x) => x.id);
  anota('notice', `${out.length - sem.length} de ${out.length} lojas com feed público; sem feed: ${sem.join(', ').slice(0, 900)}`);
  if (opt('--json')) fs.writeFileSync(opt('--json'), JSON.stringify(out, null, 2) + '\n');
}
if (import.meta.url === `file://${process.argv[1]}`) await main();
