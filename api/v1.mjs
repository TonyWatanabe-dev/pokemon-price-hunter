// API de leitura v1 (FASE 3). Uma função só (o plano gratuito da Vercel limita o número de funções):
//   GET /api/v1/home                                → resumo da Home (formato do site, só o necessário)
//   GET /api/v1/produtos?pagina&limite&colecao&tipo&categoria&estoque&busca&ordem
//   GET /api/v1/produtos/:id                        → produto (id antigo ou slug) + referências + estatísticas
//   GET /api/v1/produtos/:id/ofertas?pagina&limite&todas
//   GET /api/v1/produtos/:id/historico?dias          → série diária do Price Engine (sem histórico bruto)
//   GET /api/v1/produtos/:id/estatisticas
//   GET /api/v1/referencias?pagina&limite&status
//   GET /api/v1/oportunidades?pagina&limite&faixa&colecao&categoria&referencia&minimo&abaixo&confianca_minima&produto&ordem&ofertas=todas
//       → resultado do Opportunity Engine (melhor oferta comprável por produto; referência atual, contexto histórico e
//       comunitária separados; reference_comparison = distância até a referência atual que o motor usou)
//       ordem: score | preco | confianca | abaixo | economia | queda | recentes
// FASE 4 — formato do site (mesmas regras de lista do tools/page.template.html, aplicadas no servidor):
//   GET /api/v1/site/produtos?modo&grupo&colecao&loja&tipo&max&abaixo&estoque&ordem&pagina&limite → página de /produtos
//   GET /api/v1/site/ofertas?produtos=a,b | colecao= | tipo=   → ofertas candidatas (coleção, tipo, busca)
//   GET /api/v1/site/lojas                          → diretório de lojas: domínio, ofertas observadas, atualização (sem nota de reputação)
//   GET /api/v1/site/produto/:id                    → página do produto (ofertas, Price Engine, Copag, frete, pistas)
//   GET /api/v1/produtos/:id/historico?dias&lojas=1 → série diária do produto e de cada loja (gráfico)
//   GET /api/v1/afiliados                           → links de afiliado validados (config/affiliates.json; não lê banco nem state.json)
// Fonte: banco (API_DATABASE_URL, só leitura) com fallback seguro para o state.json. ?fonte=state força o fallback.
// Frescor (Lote 2, api/_lib/freshness.mjs): toda resposta traz freshness {status, source, dataAt, ageMin[, fallback]}
// (em meta nas listas) e os cabeçalhos X-Data-Freshness/X-Data-At. Banco sem sincronizar há mais de 90 min: serve o
// state.json se ele for mais novo; /oportunidades fica vazio (status stale_db). Mais de 24 h ou sem horário: 503.
// Cache: memória da função (por URL) + CDN da Vercel (s-maxage), com stale-while-revalidate.
import { apiDbEnabled } from './_lib/db.mjs';
import { legacyState } from './_lib/legacy.mjs';
import { slimHome } from './_lib/home.mjs';
import { catalogState } from './_lib/catalog.mjs';
import * as SITE from './_lib/site.mjs';
import * as STORES from './_lib/stores.mjs';
import * as DB from './_lib/read-db.mjs';
import * as ST from './_lib/read-state.mjs';
import * as FR from './_lib/freshness.mjs';
import { publicAffiliates } from './_lib/affiliates.mjs';

export const config = { maxDuration: 15 };
const TTL = { home: 60_000, site: 60_000, default: 120_000 };
const CDN = { home: 'public, max-age=30, s-maxage=60, stale-while-revalidate=300', site: 'public, max-age=30, s-maxage=60, stale-while-revalidate=300',
  default: 'public, max-age=60, s-maxage=120, stale-while-revalidate=600' };
const MAX_CACHE = 300;
const cache = new Map();
export const _cache = cache;                            // testes

const intIn = (v, d, lo, hi) => { const n = Number.parseInt(v, 10); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
const str = (v, max = 80) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const bool = (v) => v === '1' || v === 'true' || v === 'sim';
// Só parâmetros que a rota lê entram na chave do cache: "?x=1", "?x=2"... não enchem o cache nem forçam consultas repetidas.
const KEY_PARAMS = new Set(['pagina', 'limite', 'colecao', 'tipo', 'categoria', 'estoque', 'busca', 'ordem', 'todas', 'dias', 'lojas', 'status', 'faixa',
  'minimo', 'ofertas', 'referencia', 'abaixo', 'confianca_minima', 'produto', 'modo', 'grupo', 'loja', 'max', 'semref', 'produtos']);
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
    if (sub === 'historico' && segs.length === 3) return { name: 'historico', id, args: { dias: intIn(qs.get('dias'), 30, 1, 365), lojas: bool(qs.get('lojas')) } };
    if (sub === 'estatisticas' && segs.length === 3) return { name: 'estatisticas', id };
  }
  if (a === 'referencias' && segs.length === 1) {
    const status = str(qs.get('status'), 20); if (status && !['verified', 'pending', 'conflicting', 'unknown'].includes(status)) throw new HttpError(400, 'status inválido');
    return { name: 'referencias', page, limit, args: { page, limit, status } };
  }
  if (a === 'oportunidades' && segs.length === 1) {
    const faixa = str(qs.get('faixa'), 12) || null; if (faixa && !['excelente', 'boa', 'normal', 'baixa'].includes(faixa)) throw new HttpError(400, 'faixa inválida (excelente, boa, normal, baixa)');
    const ordem = str(qs.get('ordem'), 12) || 'score'; if (!Object.keys(DB.OPP_SORTS).includes(ordem)) throw new HttpError(400, `ordem inválida (use: ${Object.keys(DB.OPP_SORTS).join(', ')})`);
    const colecao = str(qs.get('colecao'), 40) || null; if (colecao && !SLUG_RE.test(colecao)) throw new HttpError(400, 'coleção inválida');
    const minimo = qs.get('minimo') != null ? intIn(qs.get('minimo'), 0, 0, 100) : null;
    const ofertas = str(qs.get('ofertas'), 10) || ''; if (ofertas && ofertas !== 'todas') throw new HttpError(400, 'ofertas inválido (use: todas)');
    // categoria do site: tipo do produto (etb, booster_box, blister_3...) ou grupo (Boosters, Blisters, Coleções...)
    const categoria = str(qs.get('categoria'), 30) || null;
    if (categoria && !SITE.GROUP_ORDER.includes(categoria) && !/^[a-z][a-z0-9_]{0,29}$/.test(categoria)) throw new HttpError(400, `categoria inválida (tipo do produto ou grupo: ${SITE.GROUP_ORDER.join(', ')})`);
    const referencia = str(qs.get('referencia'), 10) || null;
    if (referencia && !Object.keys(DB.OPP_REFERENCES).includes(referencia)) throw new HttpError(400, `referencia inválida (use: ${Object.keys(DB.OPP_REFERENCES).join(', ')})`);
    const abaixo = qs.get('abaixo') != null ? intIn(qs.get('abaixo'), 0, 0, 100) : null;                          // % mínimo abaixo da referência atual
    const confiancaMinima = qs.get('confianca_minima') != null ? intIn(qs.get('confianca_minima'), 0, 0, 100) : null;   // % (0–100)
    // produto: id ou slug (página do produto). Com ofertas=todas traz a nota oficial de cada oferta avaliada do produto.
    const produto = str(qs.get('produto'), 80) || null; if (produto && !SLUG_RE.test(produto)) throw new HttpError(400, 'produto inválido');
    return { name: 'oportunidades', page, limit, args: { page, limit, faixa, colecao, minimo, ordem, todas: ofertas === 'todas', categoria, referencia, abaixo, confiancaMinima, produto } };
  }
  // ---- FASE 4: formato do site (listas e página de produto), regras iguais às do site
  if (a === 'site') {
    if (id === 'produtos' && segs.length === 2) {
      const modo = str(qs.get('modo'), 10) || 'guardar'; if (!['guardar', 'abrir'].includes(modo)) throw new HttpError(400, 'modo inválido');
      const ordem = str(qs.get('ordem'), 10) || ''; if (ordem && !['score', 'disc', 'price', 'ppb', 'new'].includes(ordem)) throw new HttpError(400, 'ordem inválida');
      const grupo = str(qs.get('grupo'), 20) || ''; if (grupo && !SITE.GROUP_ORDER.includes(grupo)) throw new HttpError(400, 'grupo inválido');
      const max = str(qs.get('max'), 12) || ''; if (max && !(Number.isFinite(Number(max)) && Number(max) >= 0)) throw new HttpError(400, 'preço máximo inválido');
      const sp = intIn(qs.get('pagina'), 1, 1, 1000); const sl = intIn(qs.get('limite'), 48, 1, 60);
      return { name: 'site-produtos', kind: 'site', page: sp, limit: sl, F: { mode: modo, sort: ordem, group: grupo, col: str(qs.get('colecao'), 40) || '', store: str(qs.get('loja'), 60) || '',
        type: str(qs.get('tipo'), 40) || '', max, below: bool(qs.get('abaixo')), stock: qs.get('estoque') !== '0', semref: bool(qs.get('semref')) } };
    }
    if (id === 'ofertas' && segs.length === 2) {
      const ids = (str(qs.get('produtos'), 4000) || '').split(',').map((x) => x.trim()).filter(Boolean);
      if (ids.length > 60 || ids.some((x) => !SLUG_RE.test(x))) throw new HttpError(400, 'lista de produtos inválida (até 60 ids)');
      const col = str(qs.get('colecao'), 40); const type = str(qs.get('tipo'), 40);
      const busca = str(qs.get('busca'), 80);
      if (!ids.length && !col && !type && busca == null) throw new HttpError(400, 'informe produtos, colecao, tipo ou busca');
      return { name: 'site-ofertas', kind: 'site', args: { ids: ids.length || (!col && !type) ? ids : null, col, type }, busca };
    }
    if (id === 'lojas' && segs.length === 2) return { name: 'site-lojas', kind: 'site' };
    if (id === 'produto' && sub && segs.length === 3) { if (!SLUG_RE.test(sub)) throw new HttpError(400, 'identificador de produto inválido'); return { name: 'site-produto', kind: 'site', id: sub }; }
  }
  throw new HttpError(404, 'rota não encontrada');
}

// /oportunidades com o banco sem sincronizar: nenhuma nota antiga é mostrada como atual (mesmo formato de requires_db).
const staleOpportunities = (rt, fr) => ({ data: [], meta: { page: rt.page, limit: rt.limit, total: 0, pages: 1, status: 'stale_db',
  message: `O banco não recebe preços novos há ${fr.ageMin != null ? fr.ageMin + ' min' : 'tempo indeterminado'}: as oportunidades ficam pausadas até a próxima sincronização.` } });
const paged = (r, page, limit) => ({ data: r.items, meta: { page, limit, total: r.total, pages: Math.max(1, Math.ceil(r.total / limit)) } });

async function run(rt, source) {
  const useDb = source === 'db';
  switch (rt.name) {
    case 'home': return { body: slimHome(await catalogState(source), { source }) };   // banco + campos que ainda só o robô tem
    case 'site-produtos': return { body: { v: 1, source, ...SITE.siteProducts(await catalogState(source), rt.F, { page: rt.page, limit: rt.limit }) } };
    case 'site-ofertas': { const st = await catalogState(source);
      return { body: { v: 1, source, ...SITE.siteOffers(st, rt.args), ...(rt.busca != null ? { tips: SITE.tipHits(st, rt.busca) } : {}) } }; }
    case 'site-lojas': return { body: { v: 1, source, ...STORES.siteStores(await catalogState(source), { now: FR.nowMs() }) } };
    case 'site-produto': {
      const st = await catalogState(source);
      const key = st.products?.some((p) => p.id === rt.id) ? rt.id : useDb ? (await DB.getProduct(rt.id))?.id : ST.stateGetProduct(st, rt.id)?.id;   // aceita slug
      if (!key) throw new HttpError(404, 'produto não encontrado');
      const stats = useDb ? (await DB.productStats(key))?.stats ?? null : null;
      const minDay = useDb && stats?.history?.status === 'ok' ? await DB.productMinDay(key) : null;
      const d = SITE.siteProduct(st, key, { stats, minDay }); if (!d) throw new HttpError(404, 'produto não encontrado');
      return { body: { v: 1, source, ...d } };
    }
    case 'produtos': return { body: paged(useDb ? await DB.listProducts(rt.args) : ST.stateListProducts((await legacyState()).st, rt.args), rt.page, rt.limit) };
    case 'produto': { const d = useDb ? await DB.getProduct(rt.id) : ST.stateGetProduct((await legacyState()).st, rt.id); if (!d) throw new HttpError(404, 'produto não encontrado'); return { body: { data: d } }; }
    case 'ofertas': { const d = useDb ? await DB.productOffers(rt.id, rt.args) : ST.stateProductOffers((await legacyState()).st, rt.id, rt.args); if (!d) throw new HttpError(404, 'produto não encontrado');
      return { body: { product: d.product, ...paged(d, rt.page, rt.limit) } }; }
    case 'historico': { const d = useDb ? await DB.productHistory(rt.id, rt.args) : ST.stateProductHistory((await legacyState()).st, rt.id, rt.args); if (!d) throw new HttpError(404, 'produto não encontrado'); return { body: { data: d } }; }
    case 'estatisticas': { const d = useDb ? await DB.productStats(rt.id) : ST.stateProductStats((await legacyState()).st, rt.id); if (!d) throw new HttpError(404, 'produto não encontrado'); return { body: { data: d } }; }
    case 'referencias': return { body: paged(useDb ? await DB.listReferences(rt.args) : ST.stateListReferences((await legacyState()).st, rt.args), rt.page, rt.limit) };
    case 'oportunidades': {
      if (!useDb) return { body: { data: [], meta: { page: rt.page, limit: rt.limit, total: 0, pages: 1, status: 'requires_db',
        message: 'Oportunidades vêm do Opportunity Engine no banco; sem banco não há resultado (nada é estimado).' } } };
      const r = await DB.listOpportunities(rt.args); const body = paged(r, rt.page, rt.limit);
      body.meta.engine = r.items[0]?.engine_version ?? null; body.meta.updated_at = r.items.reduce((m, x) => (x.updated_at && x.updated_at > (m ?? '') ? x.updated_at : m), null);
      return { body };
    }
  }
  throw new HttpError(404, 'rota não encontrada');
}

const answered = new WeakSet();                         // uma resposta por pedido (o prazo pode responder antes do trabalho terminar)
function send(res, status, body, headers) {
  if (answered.has(res)) return;
  answered.add(res);
  const json = typeof body === 'string' ? body : JSON.stringify(body);
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  res.setHeader('X-Payload-Bytes', String(Buffer.byteLength(json)));
  res.end(json);
}

// Prazo total do pedido, abaixo do maxDuration (15 s) da função: banco (5–6 s por consulta) + fallback do state.json (5 s por URL)
// podem somar mais que isso. Estourou: 503 curto com Retry-After, em vez de a plataforma matar a função sem resposta.
export const DEADLINE_MS = 12_000;

export default async function handler(req, res, { now = FR.nowMs(), deadlineMs = DEADLINE_MS } = {}) {
  let timer;
  const late = new Promise((ok) => { timer = setTimeout(() => { send(res, 503, { error: 'tempo esgotado; tente novamente' }, { 'Cache-Control': 'no-store', 'Retry-After': '5', 'X-Data-Source': 'none' }); ok(); }, deadlineMs); });
  try { await Promise.race([handle(req, res, { now }), late]); }
  finally { clearTimeout(timer); }
}

async function handle(req, res, { now }) {
  const u = new URL(req.url, 'http://local');
  if (req.method && req.method !== 'GET' && req.method !== 'HEAD') return send(res, 405, { error: 'método não permitido' }, { 'Cache-Control': 'no-store', Allow: 'GET, HEAD' });
  const path = (u.searchParams.get('path') || u.pathname.replace(/^\/api\/v1\/?/, '')).split('/').filter(Boolean);
  u.searchParams.delete('path');
  // Afiliados (docs/afiliados.md): só destino de clique, à parte dos dados; sem banco, sem frescor, sem cache por consulta.
  if (path.length === 1 && path[0] === 'afiliados') return send(res, 200, publicAffiliates(), { 'Cache-Control': CDN.default });
  let rt;
  try { rt = route(path, u.searchParams); } catch (e) { return send(res, e instanceof HttpError ? e.status : 400, { error: e instanceof HttpError ? e.message : 'pedido inválido' }, { 'Cache-Control': 'public, max-age=60' }); }
  const forced = u.searchParams.get('fonte') === 'state';
  const preferred = !forced && apiDbEnabled() ? 'db' : 'state';
  const key = `${preferred}|${path.join('/')}?${[...u.searchParams].filter(([k]) => KEY_PARAMS.has(k)).sort().map(([k, v]) => `${k}=${v}`).join('&')}`;
  const ttl = TTL[rt.kind] || TTL.default; const cdn = CDN[rt.kind] || CDN.default;
  const hit = cache.get(key);
  const stale = (f) => !!f && !FR.usable(f);   // sem frescor (400/404): cache normal
  if (hit && now - hit.at < (hit.fallback || stale(hit.fr) ? 15_000 : ttl)) return send(res, hit.status, hit.json, { 'Cache-Control': hit.fallback || stale(hit.fr) ? 'no-store' : cdn, 'X-Cache': 'HIT', 'X-Data-Source': hit.source, ...FR.headers(hit.fr), ...(hit.fallback ? { 'X-Fallback': hit.fallback, 'X-Fallback-Reason': hit.reason } : {}) });

  let out; let source = preferred; let fallback = null; let reason = null; let dbFr = null; let dbErr = null;
  // Frescor do banco ANTES de servir: banco que parou de sincronizar não é apresentado como atual.
  if (preferred === 'db') {
    try { dbFr = FR.classify(await FR.dbDataAt({ now }), now, 'db'); } catch (e) { dbErr = e; }
    if (dbFr && !FR.usable(dbFr)) {
      if (rt.name === 'oportunidades') out = { body: staleOpportunities(rt, dbFr) };
      else {
        const L = await legacyState({ now }).catch(() => null); const stFr = L ? FR.classify(L.st?.generatedAt, now, 'state') : null;
        if (FR.usable(stFr) && Date.parse(stFr.dataAt) > Date.parse(dbFr.dataAt || 0)) { source = 'state'; fallback = 'banco-desatualizado'; reason = dbFr.ageMin != null ? `banco-${dbFr.ageMin}min` : 'banco-sem-horario'; }
      }
    }
  }
  try { if (!out) { if (dbErr) throw dbErr; out = await run(rt, source); } }
  catch (e) {
    if (e instanceof HttpError) { out = { status: e.status, body: { error: e.message } }; }   // só mensagens nossas; erro de biblioteca/banco nunca vai ao usuário
    else if (preferred === 'db') {                        // banco fora do ar: mesmo pedido pelo state.json
      fallback = 'db-indisponivel'; source = 'state';
      // diagnóstico sem segredo: só o código do erro (28P01 senha, XX000 tenant, ENOTFOUND host...) e a mensagem sem a URL
      reason = String(e.code || e.name || 'erro').slice(0, 20);
      const url = process.env.API_DATABASE_URL || ''; let msg = String(e.message || '');
      try { const u = new URL(url); for (const x of [u.password, decodeURIComponent(u.password), u.username, u.hostname]) if (x && x.length > 3) msg = msg.split(x).join('***'); } catch {}
      console.error(`[api/v1] banco indisponível (${reason}): ${msg.slice(0, 200)}`);
      try { out = await run(rt, 'state'); } catch (e2) { out = e2 instanceof HttpError ? { status: e2.status, body: { error: e2.message } } : null; }
    }
    if (!out) return send(res, 503, { error: 'dados indisponíveis no momento' }, { 'Cache-Control': 'no-store', 'X-Data-Source': 'none' });
  }
  // Frescor da fonte realmente servida. Indisponível (mais de 24 h ou sem horário) não vai como dado: 503.
  let fr = null;
  if (!out.status || out.status < 400) {
    if (source === 'db') fr = dbFr || FR.classify(null, now, 'db');
    else { const L = await legacyState({ now }).catch(() => null); fr = FR.classify(L?.st?.generatedAt, now, 'state'); }
    if (fr.status === 'indisponivel' && !out.body?.meta?.status) out = { status: 503, body: { error: 'dados desatualizados ou sem horário confiável no momento' } };
    FR.attach(out.body, fr, fallback ? { from: 'db', reason: fallback, ...(dbFr?.dataAt ? { dbDataAt: dbFr.dataAt, dbAgeMin: dbFr.ageMin } : {}) } : null);
  }
  const status = out.status || 200;
  const json = JSON.stringify(out.body);
  cache.delete(key);                                      // regravar move a chave para o fim: entrada renovada não é a próxima a sair
  if (cache.size >= MAX_CACHE) cache.delete(cache.keys().next().value);
  cache.set(key, { at: now, status, json, source, fallback, reason, fr });
  return send(res, status, json, { 'Cache-Control': status >= 500 || fallback || stale(fr) ? 'no-store' : cdn, 'X-Cache': 'MISS', 'X-Data-Source': source, ...FR.headers(fr), ...(fallback ? { 'X-Fallback': fallback, 'X-Fallback-Reason': reason } : {}) });
}
