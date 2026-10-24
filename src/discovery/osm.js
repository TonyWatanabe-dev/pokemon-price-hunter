// Fonte grátis de lojas: OpenStreetMap (Overpass API, dados abertos ODbL — atribuição: © colaboradores do OpenStreetMap).
// Lojas físicas marcadas no mapa do Brasil como jogos, brinquedos, hobby, quadrinhos ou anime, COM site informado.
// Cada site vira um candidato para o pipeline (mesma validação honesta das buscas), com cidade e UF do endereço.
// A lista fica em cache em data/osm-lojas.json e só é buscada de novo depois de OSM_TTL_DIAS (7). Sem chave, sem custo.
// Lojas sem site são só contadas (semente do diretório por cidade, fase seguinte), nunca validadas.
import { request, safeReason } from '../http.js';
import { readJson, writeJson, dataPath } from '../db.js';

export const OSM_ENDPOINT = 'https://overpass-api.de/api/interpreter';
export const OSM_TTL_DIAS = 7;
export const OSM_SHOPS = ['games', 'toys', 'hobby', 'comics', 'anime', 'video_games', 'collector', 'model'];
export const osmFile = () => dataPath('osm-lojas.json');
export const OSM_QUERY = `[out:json][timeout:55];area["ISO3166-1"="BR"][admin_level=2]->.br;(nwr["shop"~"^(${OSM_SHOPS.join('|')})$"](area.br););out tags center;`;

const UF_NOME = { acre: 'AC', alagoas: 'AL', amapa: 'AP', amazonas: 'AM', bahia: 'BA', ceara: 'CE', 'distrito federal': 'DF', 'espirito santo': 'ES', goias: 'GO', maranhao: 'MA',
  'mato grosso': 'MT', 'mato grosso do sul': 'MS', 'minas gerais': 'MG', para: 'PA', paraiba: 'PB', parana: 'PR', pernambuco: 'PE', piaui: 'PI', 'rio de janeiro': 'RJ',
  'rio grande do norte': 'RN', 'rio grande do sul': 'RS', rondonia: 'RO', roraima: 'RR', 'santa catarina': 'SC', 'sao paulo': 'SP', sergipe: 'SE', tocantins: 'TO' };
export const UFS = Object.values(UF_NOME);
const semAcento = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
/** "SP", "sp", "São Paulo", "Estado de São Paulo" → "SP"; desconhecido → null. */
export function ufDe(v) {
  const s = semAcento(v).replace(/^estado d[eo] /, '');
  if (/^[a-z]{2}$/.test(s) && UFS.includes(s.toUpperCase())) return s.toUpperCase();
  return UF_NOME[s] || null;
}
const siteDe = (t) => { const w = t.website || t['contact:website'] || t.url || ''; if (!w) return null; const u = /^https?:\/\//i.test(w) ? w : 'https://' + w; try { return new URL(u).href; } catch { return null; } };

/** JSON do Overpass → { comSite: [{ url, nome, cidade, uf, shop }], semSite: n, porUf: { UF: n } } (sem duplicar site). */
export function parseOsm(json) {
  const comSite = []; const vistos = new Set(); let semSite = 0; const porUf = {};
  for (const el of json?.elements || []) {
    const t = el.tags || {}; const uf = ufDe(t['addr:state']); const cidade = t['addr:city'] || null;
    if (uf) porUf[uf] = (porUf[uf] || 0) + 1;
    const url = siteDe(t);
    if (!url) { semSite++; continue; }
    if (/(instagram|facebook|wa\.me|whatsapp|linktr\.ee|linktree|mercadolivre|shopee)\./i.test(url)) { semSite++; continue; } // rede social não é loja virtual
    const host = new URL(url).host.replace(/^www\./, '');
    if (vistos.has(host)) continue; vistos.add(host);
    comSite.push({ url, nome: t.name || null, cidade, uf, shop: t.shop || null });
  }
  return { comSite, semSite, porUf };
}

/** Lista em cache; busca de novo no Overpass depois de OSM_TTL_DIAS. Falha de rede: mantém o cache anterior. */
export async function carregarOsm({ now = new Date(), log = () => {}, req = request } = {}) {
  const cache = readJson(osmFile(), null);
  if (cache?.fetchedAt && now.getTime() - Date.parse(cache.fetchedAt) < OSM_TTL_DIAS * 864e5) return cache;
  try {
    const res = await req(OSM_ENDPOINT, { method: 'POST', accept: 'application/json', body: 'data=' + encodeURIComponent(OSM_QUERY), headers: { 'content-type': 'application/x-www-form-urlencoded' }, timeout: 60000 });
    const parsed = parseOsm(await res.json());
    const out = { fetchedAt: now.toISOString(), fonte: 'OpenStreetMap (ODbL)', shops: OSM_SHOPS, ...parsed };
    writeJson(osmFile(), out);
    log(`DIE/OSM: ${parsed.comSite.length} loja(s) com site, ${parsed.semSite} sem site no mapa do Brasil.`);
    return out;
  } catch (e) { log(`DIE/OSM: Overpass indisponível (${safeReason(e)}); ${cache ? 'usando a lista anterior' : 'sem lista nesta rodada'}.`); return cache; }
}
