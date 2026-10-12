// Inventário de hosts conhecidos para a descoberta: config/stores.json, config/lojas/*.txt (linhas ativas → id como o
// src/run.js deriva; linhas comentadas de removidas.txt → nunca repropor), data/sources.json e as URLs das ofertas de
// data/state.json. Também o filtro de marketplaces/sites que nunca viram loja (espelha BIG_MARKETPLACES de src/run.js
// e IGNORE de src/discover.js; src/run.js não é importado para não carregar o orquestrador inteiro).
import fs from 'node:fs';
import { readJson, dataPath, configPath } from '../db.js';

export const IGNORE = /(^|\.)(mercadolivre|mercadolibre|amazon|shopee|magazineluiza|magalu|americanas|casasbahia|pontofrio|extra|submarino|shoptime|carrefour|kabum|aliexpress|youtube|instagram|facebook|tiktok|reddit|wikipedia|buscape|zoom|google|pokemon|ligamagic|escorregaopreco|pelando|promobit|olx|enjoei|twitter|x|pinterest|linkedin|bing|duckduckgo|ebay|tcgplayer)\.(com|com\.br|net|org|br)$/i;
export const hostOf = (url) => { try { return new URL(url).host.toLowerCase().replace(/^www\./, ''); } catch { return null; } };
// Mesma derivação de id que src/run.js usa para lojas vindas de config/lojas/*.txt.
export const idFromHost = (host) => host.replace(/[^a-z0-9]/gi, '').toLowerCase();

function lines(file) { try { return fs.readFileSync(file, 'utf8').split(/\r?\n/); } catch { return []; } }
const hostFromLine = (raw) => { try { return hostOf(/^https?:\/\//.test(raw) ? raw : 'https://' + raw); } catch { return null; } };

/** Hosts das linhas ativas dos .txt; à parte, os comentados de removidas.txt (formato "# host | data | motivo") e as
 * candidatas já anotadas em descobertas.txt ("# candidata https://host  # motivo"). */
export function listedHosts() {
  const active = new Map(); const removed = new Set(); const candidates = new Set(); const dir = configPath('lojas');
  const files = []; try { files.push(...fs.readdirSync(dir).filter((f) => f.endsWith('.txt')).map((f) => dir + '/' + f)); } catch { /* sem pasta */ }
  files.push(configPath('lojas.txt'));
  for (const f of files) for (const line of lines(f)) {
    const raw = line.replace(/#.*/, '').trim();
    if (raw) { const h = hostFromLine(raw.split(/\s+/)[0]); if (h) active.set(h, f); continue; }
    if (/removidas\.txt$/.test(f)) { const m = line.match(/^#\s*(?:https?:\/\/)?([a-z0-9][a-z0-9.-]*\.[a-z]{2,}(?:\.[a-z]{2})?)\s*\|/i); if (m) removed.add(m[1].toLowerCase().replace(/^www\./, '')); }
    const c = line.match(/^#\s*candidata\s+(https?:\/\/\S+)/i); if (c) { const h = hostOf(c[1]); if (h) candidates.add(h); }
  }
  return { active, removed, candidates };
}

/** Inventário completo: host → storeId (o id que src/run.js atribuiria), hosts removidos e URLs já cobertas. */
export function inventory() {
  const stores = readJson(configPath('stores.json'), { stores: [] }).stores || [];
  const byHost = new Map();
  for (const s of stores) { const h = s.url && hostOf(s.url); if (h && !byHost.has(h)) byHost.set(h, { id: s.id, platform: s.platform || 'auto', url: s.url }); }
  const { active, removed, candidates } = listedHosts();
  for (const [h] of active) if (!byHost.has(h)) byHost.set(h, { id: idFromHost(h), platform: 'auto', url: 'https://' + h });
  const sources = readJson(dataPath('sources.json'), {});
  for (const [id, s] of Object.entries(sources)) { const h = s?.url && hostOf(s.url); if (h && !byHost.has(h)) byHost.set(h, { id, platform: 'auto', url: s.url }); }
  for (const e of byHost.values()) if (e.id && sources[e.id]?.platform) e.detected = sources[e.id].platform; // plataforma observada nas rodadas
  const state = readJson(dataPath('state.json'), {});
  const urls = new Set();
  for (const o of state.offers || []) { if (o?.url) { urls.add(o.url); const h = hostOf(o.url); if (h && !byHost.has(h)) byHost.set(h, { id: o.storeId || null, platform: 'auto', url: 'https://' + h }); } }
  for (const c of Object.values(readJson(dataPath('url-cache.json'), {}))) for (const k of ['candidates', 'visited', 'relevant']) for (const u of c?.[k] || []) urls.add(u);
  return { byHost, removed, candidates, urls, state };
}
