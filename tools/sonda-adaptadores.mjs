#!/usr/bin/env node
// Sonda SOMENTE LEITURA: para lojas que hoje são lidas pelo leitor genérico (JSON-LD) e que o agente de saúde aponta com
// adaptador dedicado disponível (VTEX/Shopify), roda o adaptador dedicado UMA vez e compara com a última rodada real.
// Não grava nada (nem data/, nem config/, nem banco), usa o mesmo guard (robots.txt) e o mesmo User-Agent dos adaptadores.
// Uso: node tools/sonda-adaptadores.mjs [pasta-data] --lojas id:plataforma,id:plataforma [--json saida.json]
import fs from 'node:fs';
import path from 'node:path';
import { adapters } from '../src/adapters/index.js';
import { validateListing } from '../src/adapters/contract.js';
import { matchProduct } from '../src/match.js';
import { readJson, configPath } from '../src/db.js';

const loadCatalog = () => { const c = readJson(configPath('catalog.json')); c.products ||= []; c.copag ||= {}; return c; };

const args = process.argv.slice(2);
const opt = (n) => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
const dir = args.find((a, i) => !a.startsWith('--') && !['--lojas', '--json'].includes(args[i - 1])) || 'data';
const PLAT = new Set(['vtex', 'shopify', 'woocommerce', 'jsonld']);
export const parseLojas = (s) => String(s || '').split(',').map((x) => x.trim()).filter(Boolean).map((x) => { const [id, p] = x.split(':'); return { id, plataforma: p }; })
  .filter((x) => /^[a-z0-9]{2,60}$/.test(x.id) && PLAT.has(x.plataforma));

/** Veredito: o dedicado só "passa" se casar pelo menos tantos produtos quanto o genérico e ler anúncios válidos. */
export function veredito({ atual, sonda }) {
  if (sonda.erro) return 'falhou';
  if (!sonda.validos) return 'sem_anuncios';
  return sonda.casados >= (atual.casados || 0) ? 'passa' : 'pior';
}

const anota = (nivel, msg) => { console.log(msg); if (process.env.GITHUB_ACTIONS) console.log(`::${nivel}::${msg}`); };

async function main() {
  const lojas = parseLojas(opt('--lojas'));
  if (!lojas.length) { console.error('informe --lojas id:vtex,id:shopify'); process.exit(2); }
  const sources = JSON.parse(fs.readFileSync(path.join(dir, 'sources.json'), 'utf8'));
  const cfg = JSON.parse(fs.readFileSync('config/stores.json', 'utf8')).stores || [];
  const catalog = loadCatalog(); const out = [];
  for (const { id, plataforma } of lojas) {
    const src = sources[id] || {}; const c = cfg.find((s) => s.id === id) || {};
    const url = c.url || src.url;
    const atual = { plataforma: src.platform ?? null, anuncios: src.listings ?? null, casados: src.matched ?? null };
    const sonda = { plataforma, anuncios: 0, validos: 0, casados: 0, erro: null, ms: 0 };
    const t0 = Date.now();
    try {
      if (!url) throw new Error('loja sem URL');
      const store = { ...c, id, name: c.name || src.name || id, url, platform: plataforma };
      // JSON-LD: também conta as páginas de produto Pokémon que o mapa do site expõe (diagnóstico de "plataforma não reconhecida").
      if (plataforma === 'jsonld') { const { productUrls } = await import('../src/adapters/jsonld.js'); const { sitemapsOf } = await import('../src/robots.js');
        const mapas = await sitemapsOf(url.replace(/\/$/, '') + '/').catch(() => []); sonda.mapas = mapas.length; sonda.urlsProduto = (await productUrls(url.replace(/\/$/, ''), 60).catch(() => [])).length;
        // diagnóstico do 1º mapa declarado: quantos <loc>, quantos mapas filhos e os nomes de 3 (só leitura, com o guard)
        if (mapas[0]) { try { const { get } = await import('../src/http.js'); const { guard } = await import('../src/adapters/common.js'); await guard(mapas[0]);
          const xml = (await get(mapas[0], { accept: 'application/xml' })).text; const locs = [...xml.matchAll(/<loc>\s*([^<\s]+)\s*<\/loc>/g)].map((m) => m[1]);
          const filhos = locs.filter((l) => /\.xml(\.gz)?$/i.test(l)); sonda.mapa = { url: mapas[0], locs: locs.length, filhos: filhos.length, exemplos: filhos.slice(0, 3).map((l) => l.replace(/^https?:\/\/[^/]+/, '')), pokemon: locs.filter((l) => /pokemon/i.test(l)).length };
        } catch (e) { sonda.mapa = { url: mapas[0], erro: String(e?.status || e?.code || e?.message).slice(0, 60) }; } } }
      const raw = await adapters[plataforma].search(store, catalog);
      sonda.anuncios = raw.length;
      const ok = raw.filter((l) => validateListing(l, store, { now: new Date() }).ok);
      sonda.validos = ok.length;
      sonda.casados = new Set(ok.map((l) => matchProduct(l, catalog).productId).filter(Boolean)).size;
    } catch (e) { sonda.erro = String(e?.status || e?.code || e?.message || e).slice(0, 120); }
    sonda.ms = Date.now() - t0;
    const v = veredito({ atual, sonda }); out.push({ id, url, atual, sonda, veredito: v });
    anota(v === 'passa' ? 'notice' : 'warning', `${id} · ${plataforma}: ${v} · dedicado ${sonda.validos} válidos/${sonda.casados} produtos${sonda.erro ? ' · erro ' + sonda.erro : ''}${sonda.urlsProduto != null ? ` · mapas no robots ${sonda.mapas} · páginas de produto ${sonda.urlsProduto}${sonda.mapa ? ' · mapa ' + JSON.stringify(sonda.mapa) : ''}` : ''} · genérico hoje ${atual.anuncios ?? '?'} anúncios/${atual.casados ?? '?'} casados · ${Math.round(sonda.ms / 1000)} s`);
  }
  if (opt('--json')) fs.writeFileSync(opt('--json'), JSON.stringify(out, null, 2) + '\n');
}
if (import.meta.url === `file://${process.argv[1]}`) await main();
