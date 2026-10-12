// Ledger da descoberta: data/discovery.json. Guarda o rendimento de cada consulta, o veredito de cada host e o
// histórico das rodadas (últimas 30). A seleção de consultas é uma HEURÍSTICA simples (não é "IA"): pontua pelo que
// a consulta já rendeu, dá chance às nunca rodadas e reativa as esquecidas. Fórmula (selectQueries):
//   score = (accepted + hits/20) / (runs + 1) + bônus
//   bônus = EXPLORATION (1,0) se runs == 0; RECENCY (0,25) se a última rodada foi há mais de 7 dias
//   accepted = acceptedStores + acceptedUrls; hits = resultados devolvidos (acumulado)
// Escolhe as `budget` melhores (DISCOVERY_BUDGET, padrão 40), com no máximo 1/3 de consultas nunca rodadas; se não
// houver consultas rodadas suficientes, as vagas sobram para as nunca rodadas. Empate: ordem de geração (mais novas primeiro).
// Os pesos (1/20, 1,0, 0,25, 7 dias) são chutes iniciais a ajustar com as métricas do relatório (tools/discovery-relatorio.mjs).
import { readJson, writeJson, dataPath } from '../db.js';

export const VERSION = 1;
export const KEEP_RUNS = 30;
export const EXPLORATION = 1.0;
export const RECENCY = 0.25;
export const RECENCY_DAYS = 7;
export const file = () => dataPath('discovery.json');

export function loadLedger(path = file()) {
  const l = readJson(path, null);
  const ok = l && typeof l === 'object' && !Array.isArray(l);
  return { version: VERSION, queries: ok && l.queries && typeof l.queries === 'object' ? l.queries : {}, hosts: ok && l.hosts && typeof l.hosts === 'object' ? l.hosts : {},
    connectors: ok && l.connectors && typeof l.connectors === 'object' ? l.connectors : {}, runs: ok && Array.isArray(l.runs) ? l.runs : [] };
}
export function saveLedger(ledger, path = file()) { ledger.runs = ledger.runs.slice(-KEEP_RUNS); writeJson(path, ledger); }

export const queryStats = (ledger, q) => ledger.queries[q.id] ||= { q: q.q, kind: q.kind, runs: 0, hits: 0, newHosts: 0, acceptedStores: 0, acceptedUrls: 0, lastRun: null, lastNewAt: null };

export function scoreOf(stats, now = Date.now()) {
  const s = stats || { runs: 0, hits: 0, acceptedStores: 0, acceptedUrls: 0, lastRun: null };
  const accepted = (s.acceptedStores || 0) + (s.acceptedUrls || 0);
  let score = (accepted + (s.hits || 0) / 20) / ((s.runs || 0) + 1);
  if (!s.runs) score += EXPLORATION;
  else if (s.lastRun && now - Date.parse(s.lastRun) > RECENCY_DAYS * 864e5) score += RECENCY;
  return score;
}

/** Seleção adaptativa: `queries` na ordem de geração; devolve até `budget` consultas, pontuadas pelo ledger. */
export function selectQueries(ledger, queries, budget = 40, now = Date.now()) {
  const scored = queries.map((q, i) => ({ q, i, stats: ledger.queries[q.id], score: scoreOf(ledger.queries[q.id], now) }));
  const byScore = (a, b) => b.score - a.score || a.i - b.i;
  const unrun = scored.filter((x) => !x.stats?.runs).sort(byScore);
  const run = scored.filter((x) => x.stats?.runs).sort(byScore);
  const maxUnrun = Math.floor(budget / 3);
  const pickedRun = run.slice(0, budget - Math.min(maxUnrun, unrun.length));
  const pickedUnrun = unrun.slice(0, budget - pickedRun.length);
  return [...pickedRun, ...pickedUnrun].sort(byScore).map((x) => x.q);
}

export function noteHost(ledger, host, { queryId, verdict, reason, at = new Date().toISOString() }) {
  const h = ledger.hosts[host] ||= { firstSeen: at, lastSeen: at, seenIn: [], verdict: null, reason: null };
  h.lastSeen = at;
  if (queryId && !h.seenIn.includes(queryId)) h.seenIn = [...h.seenIn, queryId].slice(-20);
  if (verdict) { h.verdict = verdict; h.reason = reason || null; h.verdictAt = at; }
  return h;
}
export function noteConnector(ledger, id, { error, status }) {
  const c = ledger.connectors[id] ||= { calls: 0, errors: 0, lastStatus: null };
  c.calls++; if (error) c.errors++; c.lastStatus = status || (error ? 'erro' : 'ok'); c.lastAt = new Date().toISOString();
}
