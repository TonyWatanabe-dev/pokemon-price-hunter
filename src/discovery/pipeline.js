// Pipeline de classificação dos resultados de busca. Para cada URL: guarda de segurança (assertSafeUrl), host sem www,
// e então:
//   marketplace/site da lista IGNORE → 'ignored'; host de removidas.txt → 'removed' (nunca reproposto);
//   host conhecido → se a URL parece página de produto (isProductCandidate, src/adapters/jsonld.js) e ainda não está
//     nas ofertas/url-cache → entra em data/discovery-urls.json[storeId] (hand-off ao src/run.js);
//   host desconhecido → validação honesta igual à do src/discover.js (robots.txt permite, página inicial via http.request
//     com UA identificado, sinais BR, Pokémon lacrado, plataforma reconhecida) → 'accepted' (linha ativa em
//     config/lojas/descobertas.txt), 'candidate' (linha comentada) ou 'rejected' (só no ledger).
// Limites por rodada: DISCOVERY_MAX_NEW_STORES (10), DISCOVERY_MAX_URLS (50), DISCOVERY_MAX_VALIDATIONS (40).
// Um host validado não é revalidado por DISCOVERY_REVALIDATE_DAYS (30) dias (veredito guardado no ledger).
import fs from 'node:fs';
import { assertSafeUrl } from '../urlguard.js';
import { get, safeReason } from '../http.js';
import { check as robotsCheck } from '../robots.js';
import { detectPlatform } from '../adapters/index.js';
import { isProductCandidate } from '../adapters/jsonld.js';
import { readJson, writeJson, dataPath, configPath } from '../db.js';
import { IGNORE, hostOf } from './hosts.js';
import { noteHost } from './ledger.js';

const envInt = (env, k, d) => { const n = Number(env[k]); return Number.isFinite(n) && n >= 0 ? Math.floor(n) : d; };
export const limits = (env = process.env) => ({ stores: envInt(env, 'DISCOVERY_MAX_NEW_STORES', 10), urls: envInt(env, 'DISCOVERY_MAX_URLS', 50), validations: envInt(env, 'DISCOVERY_MAX_VALIDATIONS', 40), revalidateDays: envInt(env, 'DISCOVERY_REVALIDATE_DAYS', 30) });
export const urlsFile = () => dataPath('discovery-urls.json');
export const storesFile = () => configPath('lojas/descobertas.txt');
const HEADER = '# Lojas encontradas pelo Discovery Intelligence Engine (docs/discovery-engine.md). Linha ativa = entra na coleta\n# (src/run.js lê qualquer config/lojas/*.txt). "# candidata" = sinais parciais, conferir à mão antes de ativar.\n';

/** Validação honesta de um host desconhecido. Devolve { verdict, reason, signals }. */
export async function validateHost(host) {
  const origin = 'https://' + host; const signals = [];
  const rb = await robotsCheck(origin + '/');
  if (!rb.ok) return { verdict: 'rejected', reason: rb.why === 'robots' ? 'robots.txt proíbe' : rb.why === 'blocked' ? 'bloqueia robôs' : 'robots.txt inacessível', signals };
  signals.push('robots ok');
  let html;
  try { html = (await get(origin + '/')).text; } catch (e) { return { verdict: 'rejected', reason: e?.blocked ? 'bloqueia robôs' : `página inicial: ${safeReason(e).slice(0, 80)}`, signals }; }
  if (/\.br$/.test(host)) signals.push('.br'); if (/R\$\s?\d/.test(html)) signals.push('R$'); if (/lang=["']pt-BR/i.test(html)) signals.push('pt-BR');
  const brazilian = signals.some((s) => ['.br', 'R$', 'pt-BR'].includes(s));
  const pokemon = /pok[eé]mon/i.test(html); if (pokemon) signals.push('pokémon');
  const sealed = pokemon && /(booster|treinador avan|elite trainer|tcg|estampas ilustradas)/i.test(html); if (sealed) signals.push('lacrado');
  if (!brazilian) return { verdict: 'rejected', reason: 'sem sinal de loja brasileira', signals };
  if (!pokemon) return { verdict: 'rejected', reason: 'página inicial não menciona Pokémon', signals };
  let platform = null;
  try { platform = await detectPlatform(origin); } catch (e) { if (e?.blocked) return { verdict: 'rejected', reason: 'bloqueia robôs nas APIs', signals }; }
  if (platform) signals.push('plataforma:' + platform);
  if (sealed && platform) return { verdict: 'accepted', reason: 'loja BR com Pokémon TCG lacrado e plataforma ' + platform, signals, platform };
  return { verdict: 'candidate', reason: !sealed ? 'menciona Pokémon, mas sem sinal de TCG lacrado' : 'plataforma não reconhecida (sem Shopify, VTEX ou JSON-LD)', signals, platform };
}

export function createPipeline({ inv, ledger, log = () => {}, now = new Date(), connector = '?', validate = validateHost, env = process.env } = {}) {
  const lim = limits(env); const date = now.toISOString().slice(0, 10); const at = now.toISOString();
  const pending = readJson(urlsFile(), {});
  const queued = new Set(Object.values(pending).flat().map((x) => x?.url).filter(Boolean));
  const counts = { results: 0, unsafe: 0, ignored: 0, removed: 0, known: 0, urlsAccepted: 0, validated: 0, storesAccepted: 0, storesCandidates: 0, rejected: 0, skipped: 0 };
  const newStores = []; const candidates = []; const newUrls = []; const seenHosts = new Set();
  const recent = (h) => { const v = ledger.hosts[h]; return v?.verdict && v.verdictAt && now.getTime() - Date.parse(v.verdictAt) < lim.revalidateDays * 864e5; };

  async function processResult(r, q) {
    counts.results++;
    let u; try { u = assertSafeUrl(r.url); } catch { counts.unsafe++; return 'unsafe'; }
    const host = hostOf(u.href); if (!host) { counts.unsafe++; return 'unsafe'; }
    if (IGNORE.test(host)) { counts.ignored++; return 'ignored'; }
    if (inv.removed.has(host)) { counts.removed++; noteHost(ledger, host, { queryId: q.id, at }); return 'removed'; }
    const known = inv.byHost.get(host);
    if (known) {
      counts.known++; noteHost(ledger, host, { queryId: q.id, at });
      const platformOk = !['shopify', 'vtex', 'mercadolivre', 'unsupported'].includes(known.detected || known.platform);
      if (!known.id || !platformOk || !isProductCandidate(u.href) || inv.urls.has(u.href) || queued.has(u.href) || newUrls.length >= lim.urls) return 'known';
      queued.add(u.href); newUrls.push({ storeId: known.id, url: u.href, q: q.id, at });
      counts.urlsAccepted++; return 'url';
    }
    // host novo: valida uma vez por rodada e respeita o veredito recente do ledger
    if (seenHosts.has(host)) return 'dup';
    seenHosts.add(host);
    if (inv.candidates.has(host) || recent(host)) { counts.skipped++; noteHost(ledger, host, { queryId: q.id, at }); return 'skipped'; }
    if (counts.validated >= lim.validations || newStores.length >= lim.stores) { counts.skipped++; noteHost(ledger, host, { queryId: q.id, at }); return 'skipped'; }
    counts.validated++;
    let v; try { v = await validate(host); } catch (e) { v = { verdict: 'rejected', reason: safeReason(e).slice(0, 80), signals: [] }; }
    const h = noteHost(ledger, host, { queryId: q.id, verdict: v.verdict, reason: v.reason, at });
    h.why = { query: q.id, connector, signals: v.signals };
    if (v.verdict === 'accepted') { counts.storesAccepted++; newStores.push({ host, q: q.id, platform: v.platform }); inv.byHost.set(host, { id: null, platform: v.platform }); log(`[DIE] nova loja: ${host} (${v.platform}) via ${q.id}`); }
    else if (v.verdict === 'candidate') { counts.storesCandidates++; candidates.push({ host, q: q.id, reason: v.reason }); inv.candidates.add(host); }
    else counts.rejected++;
    return v.verdict;
  }

  // Grava o que a rodada rendeu: linhas em config/lojas/descobertas.txt e URLs em data/discovery-urls.json.
  function flush() {
    if (newStores.length || candidates.length) {
      const f = storesFile(); fs.mkdirSync(configPath('lojas'), { recursive: true });
      const head = fs.existsSync(f) ? '' : HEADER;
      const body = [...newStores.map((s) => `https://${s.host}  # DIE ${connector} ${s.q} ${date}`), ...candidates.map((c) => `# candidata https://${c.host}  # ${c.reason} (DIE ${connector} ${c.q} ${date})`)].join('\n') + '\n';
      fs.appendFileSync(f, head + body);
    }
    if (newUrls.length) {
      for (const x of newUrls) (pending[x.storeId] ||= []).push({ url: x.url, q: x.q, at: x.at, tries: 0 });
      writeJson(urlsFile(), pending);
    }
    return { counts, newStores, candidates, newUrls };
  }
  return { processResult, flush, counts };
}
