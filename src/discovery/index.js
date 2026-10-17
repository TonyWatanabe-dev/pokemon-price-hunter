// Discovery Intelligence Engine (DIE) v0 — orquestra uma rodada: conector disponível → consultas do catálogo →
// seleção adaptativa pelo ledger → busca → pipeline (classifica, valida, grava) → métricas (ledger + data/meta.json).
// Nunca lança para quem chamou: qualquer erro vira { ok: false, error }. HUNTER_DISCOVERY=0 desliga (sem rede, sem escrita).
import { registry } from './connectors/index.js';
import { generateQueries } from './queries.js';
import { loadLedger, saveLedger, selectQueries, queryStats, noteConnector } from './ledger.js';
import { inventory } from './hosts.js';
import { createPipeline } from './pipeline.js';
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

export async function runDiscovery({ log = console.log, env = process.env, now = new Date(), connectors = registry(env), validate } = {}) {
  const t0 = Date.now(); const at = now.toISOString();
  if (!enabled(env)) { log('DIE: desligado (HUNTER_DISCOVERY=0).'); return { ok: true, skipped: 'desligado', connectors: connectors.status() }; }
  const status = connectors.status();
  const conn = connectors.pick();
  for (const [id, s] of Object.entries(status)) if (!s.available) log(`DIE: conector ${id} indisponível: ${s.reason} (${s.keyName})`);
  if (!conn) {
    log('DIE: nenhum conector disponível; nada a fazer.');
    // Mesmo sem rodar, deixa evidência no ramo data: qual conector faltou e por quê (nomes de variável, nunca valores).
    try { const ledger = loadLedger(); ledger.runs.push({ at, skipped: 'sem conector', connectors: status, durationMs: Date.now() - t0 }); saveLedger(ledger); } catch (e) { log(`DIE: não gravou o ledger (${e.message})`); }
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
    const found = { stores: out.newStores.length, candidates: out.candidates.length, urls: out.newUrls.length, hosts: Object.keys(ledger.hosts).length };
    const cost = { connector: conn.id, unit: conn.cost.unit, queries: queriesRun + errors, estimate: (queriesRun + errors) * conn.cost.estimate };
    const run = { at, connector: conn.id, queriesRun, queriesPlanned: picked.length, queriesTotal: all.length, hits, newHosts: out.counts.validated, storesAccepted: found.stores, storesCandidates: found.candidates, urlsAccepted: found.urls,
      errors, stopped, durationMs: Date.now() - t0, baseline, found, cost, counts: out.counts, connectors: connectors.status() };
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
