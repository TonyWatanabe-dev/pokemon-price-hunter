// state.json do robô: fonte de fallback da API e, por enquanto, dos campos que ainda não estão no banco
// (Deal Score atual do robô, atividade, pistas, reputação). Lido do ramo "data" (o mesmo que o site usa hoje),
// com cache em memória para não baixar o arquivo a cada pedido.
const URLS = [
  'https://raw.githubusercontent.com/tonywatanabe-dev/pokemon-price-hunter/data/data/state.json',
  'https://raw.githubusercontent.com/tonywatanabe-dev/pokemon-price-hunter/main/data/state.json',
];
const TTL_MS = 60_000;
const NEG_MS = 5_000;                                 // cache negativo: após falha, não volta à rede por 5 s
let cache = { at: 0, st: null, from: null };
let fail = null;                                      // { at, err } da última falha
let loader = null;                                    // testes injetam um carregador

export function setLegacyLoader(fn) { loader = fn; cache = { at: 0, st: null, from: null }; fail = null; }

async function fetchJson(url, ms) {
  const ac = new AbortController(); const t = setTimeout(() => ac.abort(), ms);
  try { const r = await fetch(url, { signal: ac.signal, headers: { accept: 'application/json' } }); if (!r.ok) throw new Error(`HTTP ${r.status}`); return await r.json(); }
  finally { clearTimeout(t); }
}

/** Retorna { st, from, age } ou lança erro se nenhuma fonte responder. */
export async function legacyState({ now = Date.now() } = {}) {
  if (cache.st && now - cache.at < TTL_MS) return { st: cache.st, from: cache.from, age: now - cache.at, cached: true };
  if (fail && now - fail.at >= 0 && now - fail.at < NEG_MS) {
    if (cache.st) return { st: cache.st, from: cache.from + ' (cópia antiga)', age: now - cache.at, cached: true };
    throw fail.err;
  }
  let last = null;
  if (loader) {
    try { const st = await loader(); cache = { at: now, st, from: 'injected' }; fail = null; return { st, from: 'injected', age: 0, cached: false }; }
    catch (e) { last = e; }
  } else for (const u of URLS) {
    try { const st = await fetchJson(u, 5000); if (st?.products && st?.offers) { cache = { at: now, st, from: u.includes('/data/data/') ? 'ramo data' : 'ramo main' }; fail = null; return { st, from: cache.from, age: 0, cached: false }; } }
    catch (e) { last = e; }
  }
  fail = { at: now, err: new Error('state.json indisponível' + (last ? `: ${last.message}` : '')) };
  if (cache.st) return { st: cache.st, from: cache.from + ' (cópia antiga)', age: now - cache.at, cached: true };   // melhor um dado de minutos atrás que nada
  throw fail.err;
}
