// SOURCE_DISCOVERY_ENGINE: busca lojas novas, valida e adiciona como candidatas. Requer BRAVE_API_KEY (Brave Search API).
import { readJson, writeJson, configPath } from './db.js';
import { getJson, get } from './http.js';
import { detectPlatform } from './adapters/index.js';
import { allowed } from './robots.js';

const QUERIES = ['Pokemon TCG booster box Brasil', 'Pokemon TCG box 36 boosters', 'Pokemon TCG ETB Brasil', 'Pokemon TCG Copag', 'Pokemon TCG booster', 'Pokemon TCG lacrado', 'Pokemon TCG preço', 'Pokemon TCG promoção'];
const IGNORE = /(mercadolivre|mercadolibre|amazon|shopee|magazineluiza|magalu|americanas|casasbahia|pontofrio|extra\.com|carrefour|kabum|aliexpress|youtube|instagram|facebook|tiktok|reddit|wikipedia|buscape|zoom\.com|google|pokemon\.com|ligamagic|escorregaopreco|pelando|promobit)/i;

export async function discover({ log = console.log } = {}) {
  const key = process.env.BRAVE_API_KEY;
  if (!key) { log('Descoberta desativada: defina BRAVE_API_KEY.'); return []; }
  const cfg = readJson(configPath('stores.json'));
  const catalog = readJson(configPath('catalog.json'));
  const known = new Set(cfg.stores.filter((s) => s.url).map((s) => new URL(s.url).host.replace(/^www\./, '')));
  const queries = [...QUERIES, ...catalog.collections.map((c) => `Pokemon TCG ${c.name} box comprar`)];
  const candidates = new Set();
  for (const q of queries) {
    try {
      const j = await getJson(`https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&country=BR&search_lang=pt-br&count=20`, { headers: { 'x-subscription-token': key } });
      for (const r of j.web?.results || []) { const h = new URL(r.url).host.replace(/^www\./, ''); if (!known.has(h) && !IGNORE.test(h)) candidates.add(new URL(r.url).origin); }
    } catch (e) { log(`Busca falhou (${q}): ${e.message}`); }
  }
  const added = [];
  for (const origin of candidates) {
    const host = new URL(origin).host.replace(/^www\./, ''); if (known.has(host)) continue; known.add(host);
    try {
      if (!(await allowed(origin + '/'))) continue;
      const html = (await get(origin + '/')).text;
      const brazilian = /\.br$/.test(host) || /R\$\s?\d/.test(html) || /lang=["']pt-BR/i.test(html);
      const sellsTcg = /pok[eé]mon/i.test(html) && /(booster|treinador avan|elite trainer|tcg|estampas ilustradas)/i.test(html);
      if (!brazilian || !sellsTcg) continue;
      const platform = await detectPlatform(origin);
      if (!platform) continue;
      const store = { id: host.replace(/[^a-z0-9]/g, ''), name: host, url: origin, platform, kind: 'specialist', evidence: {}, discoveredAt: new Date().toISOString(), enabled: true };
      cfg.stores.push(store); added.push(store); log(`Nova fonte: ${origin} (${platform})`);
    } catch { /* inacessível: ignora */ }
  }
  if (added.length) writeJson(configPath('stores.json'), cfg);
  return added;
}

if (import.meta.url.endsWith('discover.js') && process.argv[1]?.endsWith('discover.js')) await discover();
