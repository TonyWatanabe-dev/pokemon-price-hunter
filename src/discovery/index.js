// Discovery Intelligence Engine (DIE) v0 — orquestra uma rodada: conector disponível → consultas do catálogo →
// seleção adaptativa pelo ledger → busca → pipeline (classifica, valida, grava) → métricas (ledger + data/meta.json).
// Nunca lança para quem chamou: qualquer erro vira { ok: false, error }. HUNTER_DISCOVERY=0 desliga (sem rede, sem escrita).
import { registry } from './connectors/index.js';
import { generateQueries } from './queries.js';
import { loadLedger, saveLedger, selectQueries, queryStats, noteConnector } from './ledger.js';
import { inventory } from './hosts.js';
import { createPipeline, RECONFERIR, VALIDATOR_VERSION } from './pipeline.js';
import { carregarOsm } from './osm.js';
import { readJson, configPath, dataPath } from '../db.js';
import { readMeta, writeJsonAtomic } from '../opstate.js';
import { safeReason } from '../http.js';

export const enabled = (env = process.env) => String(env.HUNTER_DISCOVERY ?? '') !== '0';
export const budgetOf = (env = process.env) => { const n = Math.floor(Number(env.DISCOVERY_BUDGET)); return n > 0 ? n : 40; };

/** Retrato antes/depois: hosts conhecidos, ofertas ao vivo e produtos com oferta em data/state.json. */
export function snapshot(inv) {
  const offers = inv.state?.offers || [];
  const live = offers.filter((o) => !o.stale && o.stock !== 'OUT_OF_STOCK');
  return { knownHosts: inv.byHost.size, offers: offers.length, liveOffers: live.length, productsWithOffers: new Set(offers.map((o) => o.productId)).size };
}

const envNum = (env, k, d) => { const n = Math.floor(Number(env[k])); return Number.isFinite(n) && n >= 0 ? n : d; };

/** Fontes grátis que não dependem de conector de busca (24/10/2026):
 *  1) reconferir: hosts recusados na v1 por motivo que o validador v2 resolve (busca da loja, sitemap) — DISCOVERY_RECONFERIR_MAX (20);
 *  2) OpenStreetMap: sites de lojas de jogos/brinquedos/hobby do mapa, com cidade e UF — DISCOVERY_OSM_MAX (30) validações.
 *  HUNTER_DISCOVERY_OSM=0 desliga o OSM. Cada fonte tem o próprio pipeline (limites próprios) e grava como as buscas.
 *  Prazo total DISCOVERY_EXTRAS_SEG (150 s): a rodada diária tem teto de 18 min no Actions e não pode ser cortada antes de
 *  salvar (dia vermelho no burn-in). O que não couber fica para a rodada seguinte (o ledger lembra o que já foi visto). */
export async function runExtras({ ledger, log, now, env, validate, osmLoader = carregarOsm, clock = Date.now }) {
  const at = now.toISOString(); const out = {};
  const prazo = clock() + envNum(env, 'DISCOVERY_EXTRAS_SEG', 150) * 1000; const cabe = () => clock() < prazo;
  const recMax = envNum(env, 'DISCOVERY_RECONFERIR_MAX', 15);
  const alvo = Object.entries(ledger.hosts).filter(([, h]) => (h.validator || 1) < VALIDATOR_VERSION && ['rejected', 'candidate'].includes(h.verdict) && RECONFERIR.test(h.reason || '')).map(([host]) => host).slice(0, recMax);
  if (alvo.length) {
    const pipe = createPipeline({ inv: inventory(), ledger, log, now, connector: 'reconferir', validate, env: { ...env, DISCOVERY_MAX_VALIDATIONS: String(recMax), DISCOVERY_MAX_NEW_STORES: String(recMax) }, reconferir: new Set(alvo) });
    for (const host of alvo) { if (!cabe()) break; await pipe.processResult({ url: 'https://' + host }, { id: 'reconferir:v' + VALIDATOR_VERSION }); }
    const r = pipe.flush(); out.reconferir = { hosts: alvo.length, aceitas: r.newStores.length, candidatas: r.candidates.length };
    log(`DIE/reconferir: ${alvo.length} host(s) reconferido(s), ${r.newStores.length} loja(s) aceita(s), ${r.candidates.length} candidata(s).`);
  }
  if (String(env.HUNTER_DISCOVERY_OSM ?? '') !== '0' && cabe()) {
    const osm = await osmLoader({ now, log });
    if (osm?.comSite?.length) {
      const osmMax = envNum(env, 'DISCOVERY_OSM_MAX', 20);
      const pipe = createPipeline({ inv: inventory(), ledger, log, now, connector: 'osm', validate, env: { ...env, DISCOVERY_MAX_VALIDATIONS: String(osmMax), DISCOVERY_MAX_NEW_STORES: String(osmMax) } });
      for (const x of osm.comSite) if (cabe()) await pipe.processResult({ url: x.url, loc: { cidade: x.cidade, uf: x.uf, fonte: 'osm', nome: x.nome } }, { id: 'osm:' + (x.shop || 'loja') });
      const r = pipe.flush();
      out.osm = { lista: osm.comSite.length, semSite: osm.semSite, validados: r.counts.validated, aceitas: r.newStores.length, candidatas: r.candidates.length, fetchedAt: osm.fetchedAt };
      log(`DIE/OSM: ${r.counts.validated} site(s) conferido(s) nesta rodada, ${r.newStores.length} loja(s) aceita(s), ${r.candidates.length} candidata(s).`);
    }
  }
  if (Object.keys(out).length) ledger.extras = { at, ...out };
  return out;
}

export async function runDiscovery({ log = console.log, env = process.env, now = new Date(), connectors = registry(env), validate } = {}) {
  const t0 = Date.now(); const at = now.toISOString();
  if (!enabled(env)) { log('DIE: desligado (HUNTER_DISCOVERY=0).'); return { ok: true, skipped: 'desligado', connectors: connectors.status() }; }
  const status = connectors.status();
  const conn = connectors.pick();
  for (const [id, s] of Object.entries(status)) if (!s.available) log(`DIE: conector ${id} indisponível: ${s.reason} (${s.keyName})`);
  if (!conn) {
    log('DIE: nenhum conector de busca disponível; seguem só as fontes grátis (reconferir, OpenStreetMap).');
    // Mesmo sem rodar, deixa evidência no ramo data: qual conector faltou e por quê (nomes de variável, nunca valores).
    try { const ledger = loadLedger(); let extras = {}; try { extras = await runExtras({ ledger, log, now, env, validate }); } catch (e) { log(`DIE: fontes grátis falharam (${safeReason(e)})`); }
      ledger.runs.push({ at, skipped: 'sem conector', connectors: status, extras, durationMs: Date.now() - t0 }); saveLedger(ledger); } catch (e) { log(`DIE: não gravou o ledger (${e.message})`); }
    try { const f = dataPath('meta.json'); const meta = readMeta(f); meta.discovery = { version: 1, last: { at, skipped: 'sem conector', connectors: status } }; writeJsonAtomic(f, meta); } catch {}
    return { ok: true, skipped: 'sem conector', connectors: status };
  }
  try {
    const ledger = loadLedger();
    const catalog = readJson(configPath('catalog.json'), { collections: [], products: [] });
    const all = generateQueries(catalog, readJson(configPath('refs-copag.json'), {})?.refs || {}); // + códigos Copag (tools/refs-copag.mjs)
    const picked = selectQueries(ledger, all, budgetOf(env), now.getTime());
    const inv = inventory();
    const baseline = snapshot(inv);
    const pipe = createPipeline({ inv, ledger, log, now, connector: conn.id, validate, env });
    let hits = 0; let queriesRun = 0; let errors = 0; let stopped = null;
    for (const q of picked) {
      const st = queryStats(ledger, q);
      let results;
      try { results = await conn.search(q.q, { count: 20 }); noteConnector(ledger, conn.id, { status: 'ok' }); }
      catch (e) {
        errors++; noteConnector(ledger, conn.id, { error: true, status: e?.exhausted ? 'esgotado' : 'erro' });
        log(`DIE: busca falhou (${q.id}): ${safeReason(e)}`);
        if (e?.exhausted || errors >= 3) { stopped = e?.exhausted ? 'conector esgotado' : 'erros seguidos'; break; }
        continue;
      }
      queriesRun++; st.runs++; st.lastRun = at; st.hits += results.length; hits += results.length;
      const before = { s: pipe.counts.storesAccepted, u: pipe.counts.urlsAccepted, h: Object.keys(ledger.hosts).length };
      for (const r of results) await pipe.processResult(r, q);
      const gained = { s: pipe.counts.storesAccepted - before.s, u: pipe.counts.urlsAccepted - before.u, h: Object.keys(ledger.hosts).length - before.h };
      st.acceptedStores += gained.s; st.acceptedUrls += gained.u; st.newHosts += gained.h;
      if (gained.s || gained.u) st.lastNewAt = at;
    }
    const out = pipe.flush();
    let extras = {}; try { extras = await runExtras({ ledger, log, now, env, validate }); } catch (e) { log(`DIE: fontes grátis falharam (${safeReason(e)})`); }
    const found = { stores: out.newStores.length, candidates: out.candidates.length, urls: out.newUrls.length, hosts: Object.keys(ledger.hosts).length };
    const cost = { connector: conn.id, unit: conn.cost.unit, queries: queriesRun + errors, estimate: (queriesRun + errors) * conn.cost.estimate };
    const run = { at, connector: conn.id, queriesRun, queriesPlanned: picked.length, queriesTotal: all.length, hits, newHosts: out.counts.validated, storesAccepted: found.stores, storesCandidates: found.candidates, urlsAccepted: found.urls,
      errors, stopped, durationMs: Date.now() - t0, baseline, found, cost, counts: out.counts, connectors: connectors.status(), extras };
    ledger.runs.push(run);
    saveLedger(ledger);
    // data/meta.json: resumo da última rodada sob a chave `discovery` (mergeOps preserva chaves desconhecidas).
    try { const f = dataPath('meta.json'); const meta = readMeta(f); meta.discovery = { version: 1, last: { at, connector: conn.id, queriesRun, hits, storesAccepted: found.stores, storesCandidates: found.candidates, urlsAccepted: found.urls, baseline, cost, stopped } }; writeJsonAtomic(f, meta); }
    catch (e) { log(`DIE: meta.json não atualizado: ${safeReason(e)}`); }
    log(`DIE: ${conn.id} rodou ${queriesRun}/${picked.length} consultas (${all.length} no total), ${hits} resultados, ${found.stores} loja(s) nova(s), ${found.candidates} candidata(s), ${found.urls} URL(s) para o coletor${stopped ? `; parou: ${stopped}` : ''}.`);
    // Conector que só falhou (nenhuma consulta respondida): rodada sem sucesso, mas registrada no ledger.
    return { ok: !(errors && !queriesRun), run, error: errors && !queriesRun ? `conector ${conn.id} falhou em todas as consultas` : undefined, connectors: run.connectors };
  } catch (e) {
    log(`DIE: rodada abortada: ${safeReason(e)}`);
    return { ok: false, error: safeReason(e), connectors: status };
  }
}
