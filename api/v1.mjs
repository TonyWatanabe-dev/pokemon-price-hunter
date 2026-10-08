// API de leitura v1 (FASE 3). Uma função só (o plano gratuito da Vercel limita o número de funções):
//   GET /api/v1/home                                → resumo da Home (formato do site, só o necessário)
//   GET /api/v1/produtos?pagina&limite&colecao&tipo&categoria&estoque&busca&ordem
//   GET /api/v1/produtos/:id                        → produto (id antigo ou slug) + referências + estatísticas
//   GET /api/v1/produtos/:id/ofertas?pagina&limite&todas
//   GET /api/v1/produtos/:id/historico?dias          → série diária do Price Engine (sem histórico bruto)
//   GET /api/v1/produtos/:id/estatisticas
//   GET /api/v1/referencias?pagina&limite&status
//   GET /api/v1/oportunidades                       → estrutura reservada (Opportunity Engine ainda não calcula)
// Fonte: banco (API_DATABASE_URL, só leitura) com fallback seguro para o state.json. ?fonte=state força o fallback.
// Cache: memória da função (por URL) + CDN da Vercel (s-maxage), com stale-while-revalidate.
import { apiDbEnabled } from './_lib/db.mjs';
import { legacyState } from './_lib/legacy.mjs';
import { slimHome } from './_lib/home.mjs';
import * as DB from './_lib/read-db.mjs';
import * as ST from './_lib/read-state.mjs';

export const config = { maxDuration: 15 };
const TTL = { home: 60_000, default: 120_000 };
const CDN = { home: 'public, max-age=30, s-maxage=60, stale-while-revalidate=300', default: 'public, max-age=60, s-maxage=120, stale-while-revalidate=600' };
const MAX_CACHE = 300;
const cache = new Map();
export const _cache = cache;                            // testes

const intIn = (v, d, lo, hi) => { const n = Number.parseInt(v, 10); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const str = (v, max = 80) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const bool = (v) => v === '1' || v === 'true' || v === 'sim';
const SLUG_RE = /^[a-z0-9][a-z0-9_.-]{0,120}$/i;

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }

function route(segs, qs) {
  const page = intIn(qs.get('pagina'), 1, 1, 10_000); const limit = intIn(qs.get('limite'), 24, 1, 50);
  const [a, id, sub] = segs;
  if (a === 'home' && segs.length === 1) return { name: 'home', kind: 'home' };
  if (a === 'produtos' && segs.length === 1) {
    const ordem = str(qs.get('ordem'), 20) || 'relevancia'; if (!DB.PRODUCT_SORTS.includes(ordem)) throw new HttpError(400, `ordem inválida (use: ${DB.PRODUCT_SORTS.join(', ')})`);
    return { name: 'produtos', page, limit, args: { page, limit, colecao: str(qs.get('colecao'), 40), tipo: str(qs.get('tipo'), 40), categoria: str(qs.get('categoria'), 60),
      estoque: bool(qs.get('estoque')), busca: str(qs.get('busca'), 60), ordem } };
  }
  if (a === 'produtos' && id) {
    if (!SLUG_RE.test(id)) throw new HttpError(400, 'identificador de produto inválido');
    if (!sub) return { name: 'produto', id };
    if (sub === 'ofertas' && segs.length === 3) return { name: 'ofertas', id, page, limit, args: { page, limit, todas: bool(qs.get('todas')) } };
    if (sub === 'historico' && segs.length === 3) return { name: 'historico', id, args: { dias: intIn(qs.get('dias'), 30, 1, 180) } };
    if (sub === 'estatisticas' && segs.length === 3) return { name: 'estatisticas', id };
  }
  if (a === 'referencias' && segs.length === 1) {
    const status = str(qs.get('status'), 20); if (status && !['verified', 'pending', 'conflicting', 'unknown'].includes(status)) throw new HttpError(400, 'status inválido');
    return { name: 'referencias', page, limit, args: { page, limit, status } };
  }
  if (a === 'oportunidades' && segs.length === 1) return { name: 'oportunidades' };
  throw new HttpError(404, 'rota não encontrada');
}

const paged = (r, page, limit) => ({ data: r.items, meta: { page, limit, total: r.total, pages: Math.max(1, Math.ceil(r.total / limit)) } });

async function run(rt, source) {
  const useDb = source === 'db';
  switch (rt.name) {
    case 'home': {
      const L = await legacyState();                       // campos que ainda só o robô tem (Deal Score, atividade...)
      if (useDb) return { body: slimHome(await DB.stateLikeFromDb(L.st), { source: 'db' }) };
      return { body: slimHome(L.st, { source: 'state' }) };
    }
    case 'produtos': return { body: paged(useDb ? await DB.listProducts(rt.args) : ST.stateListProducts((await legacyState()).st, rt.args), rt.page, rt.limit) };
    case 'produto': { const d = useDb ? await DB.getProduct(rt.id) : ST.stateGetProduct((await legacyState()).st, rt.id); if (!d) throw new HttpError(404, 'produto não encontrado'); return { body: { data: d } }; }
    case 'ofertas': { const d = useDb ? await DB.productOffers(rt.id, rt.args) : ST.stateProductOffers((await legacyState()).st, rt.id, rt.args); if (!d) throw new HttpError(404, 'produto não encontrado');
      return { body: { product: d.product, ...paged(d, rt.page, rt.limit) } }; }
    case 'historico': { const d = useDb ? await DB.productHistory(rt.id, rt.args) : ST.stateProductHistory((await legacyState()).st, rt.id, rt.args); if (!d) throw new HttpError(404, 'produto não encontrado'); return { body: { data: d } }; }
    case 'estatisticas': { const d = useDb ? await DB.productStats(rt.id) : ST.stateProductStats((await legacyState()).st, rt.id); if (!d) throw new HttpError(404, 'produto não encontrado'); return { body: { data: d } }; }
    case 'referencias': return { body: paged(useDb ? await DB.listReferences(rt.args) : ST.stateListReferences((await legacyState()).st, rt.args), rt.page, rt.limit) };
    case 'oportunidades': return { body: { data: [], meta: { status: 'not_computed', engine: null,
      message: 'Opportunity Engine ainda não implementado: aguardando histórico suficiente no Price Engine.',
      fields: ['product_id', 'offer_id', 'score', 'band', 'parts', 'computed_at'], bands: ['excelente', 'boa', 'normal', 'pouco_atrativo'] } } };
  }
  throw new HttpError(404, 'rota não encontrada');
}

function send(res, status, body, headers) {
  const json = typeof body === 'string' ? body : JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.setHeader('X-Payload-Bytes', String(Buffer.byteLength(json)));
  res.end(json);
}

export default async function handler(req, res, { now = Date.now() } = {}) {
  const u = new URL(req.url, 'http://local');
  if (req.method && req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'método não permitido' }, { 'Cache-Control': 'no-store', Allow: 'GET, HEAD' });
  const path = (u.searchParams.get('path') || u.pathname.replace(/^\/api\/v1\/?/, '')).split('/').filter(Boolean);
  u.searchParams.delete('path');
  let rt;
  try { rt = route(path, u.searchParams); } catch (e) { return send(res, e.status || 400, { error: e.message }, { 'Cache-Control': 'public, max-age=60' }); }
  const forced = u.searchParams.get('fonte') === 'state';
  const preferred = !forced && apiDbEnabled() ? 'db' : 'state';
  const key = `${preferred}|${path.join('/')}?${[...u.searchParams].filter(([k]) => k !== 'fonte').sort().map(([k, v]) => `${k}=${v}`).join('&')}`;
  const ttl = TTL[rt.kind] || TTL.default; const cdn = CDN[rt.kind] || CDN.default;
  const hit = cache.get(key);
  if (hit && now - hit.at < ttl) return send(res, hit.status, hit.json, { 'Cache-Control': cdn, 'X-Cache': 'HIT', 'X-Data-Source': hit.source, ...(hit.fallback ? { 'X-Fallback': hit.fallback } : {}) });

  let out; let source = preferred; let fallback = null;
  try { out = await run(rt, preferred); }
  catch (e) {
    if (e.status) { out = { status: e.status, body: { error: e.message } }; }
    else if (preferred === 'db') {                        // banco fora do ar: mesmo pedido pelo state.json
      fallback = 'db-indisponivel'; source = 'state';
      try { out = await run(rt, 'state'); } catch (e2) { out = e2.status ? { status: e2.status, body: { error: e2.message } } : null; }
    }
    if (!out) return send(res, 503, { error: 'dados indisponíveis no momento' }, { 'Cache-Control': 'no-store', 'X-Data-Source': 'none' });
  }
  const status = out.status || 200;
  const json = JSON.stringify(out.body);
  if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value);
  cache.set(key, { at: now, status, json, source, fallback });
  return send(res, status, json, { 'Cache-Control': status >= 500 ? 'no-store' : cdn, 'X-Cache': 'MISS', 'X-Data-Source': source, ...(fallback ? { 'X-Fallback': fallback } : {}) });
}
