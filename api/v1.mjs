// API de leitura v1 (FASE 3). Uma função só (o plano gratuito da Vercel limita o número de funções):
//   GET /api/v1/home                                → resumo da Home (formato do site, só o necessário)
//   GET /api/v1/produtos?pagina&limite&colecao&tipo&categoria&estoque&busca&ordem
//   GET /api/v1/produtos/:id                        → produto (id antigo ou slug) + referências + estatísticas
//   GET /api/v1/produtos/:id/ofertas?pagina&limite&todas
//   GET /api/v1/produtos/:id/historico?dias          → série diária do Price Engine (sem histórico bruto)
//   GET /api/v1/produtos/:id/estatisticas
//   GET /api/v1/referencias?pagina&limite&status
//   GET /api/v1/oportunidades?pagina&limite&faixa&colecao&categoria&referencia&minimo&abaixo&confianca_minima&produto&ordem&ofertas=todas&loja&max&idioma
//   GET /api/v1/oportunidades/lojas                 → lojas com oferta avaliada com estoque (filtro Loja)
//       → resultado do Opportunity Engine (melhor oferta comprável por produto; referência atual, contexto histórico e
//       comunitária separados; reference_comparison = distância até a referência atual que o motor usou)
//       ordem: score | preco | confianca | abaixo | economia | queda | recentes
// FASE 4 — formato do site (mesmas regras de lista do tools/page.template.html, aplicadas no servidor):
//   GET /api/v1/site/produtos?modo&grupo&colecao&loja&tipo&max&abaixo&estoque&idioma&ordem&pagina&limite → página de /produtos
//   GET /api/v1/site/ofertas?produtos=a,b | colecao= | tipo=   → ofertas candidatas (coleção, tipo, busca)
//   GET /api/v1/site/lojas                          → diretório de lojas: domínio, ofertas observadas, atualização (sem nota de reputação)
//   GET /api/v1/site/produto/:id                    → página do produto (ofertas, Price Engine, Copag, frete, pistas)
//   GET /api/v1/site/pagina/copag|pistas|prevenda|lojas → dados de /precos, /pistas, /pre-vendas e /lojas (Lote F: sem o state.json no navegador)
//   GET /api/v1/produtos/:id/historico?dias&lojas=1 → série diária do produto e de cada loja (gráfico)
//   GET /api/v1/afiliados                           → links de afiliado validados (config/affiliates.json; não lê banco nem state.json)
// Frete por CEP (issue #84), DESLIGADO por padrão: sem SHIPPING_CALC_ENABLED=1 as duas respondem 404 sem ler nada.
//   GET /api/v1/frete/estado                        → { enabled, stores } (lojas VTEX com cálculo; a página só mostra o recurso com 200)
//   GET /api/v1/frete?oferta&cep&quantidade         → cotação da loja (só VTEX). Loja/item/vendedor vêm do servidor (state.json);
//       o cliente escolhe só oferta, CEP e quantidade. Sem cache de CDN (no-store); limites e cooldown em api/_lib/shipping-calc.mjs.
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
import { publicAffiliates, registrarDesempate } from './_lib/affiliates.mjs';
import { recomendar, OBJETIVO_MODELO } from './_lib/kit.mjs';
import { readFileSync } from 'node:fs';
// Frete grátis pela regra pública da loja (config/frete-gratis.json): usado pelo kit para o frete da cesta.
let FG = null; const freteGratis = () => { if (FG) return FG; try { FG = JSON.parse(readFileSync(new URL('../config/frete-gratis.json', import.meta.url), 'utf8')).lojas || {}; } catch { FG = {}; } return FG; };
// Desempate do dono (docs/afiliados.md): em empate de total, oferta com link de afiliado primeiro. Nunca acima de mais barata.
registrarDesempate();

export const config = { maxDuration: 15 };
const TTL = { home: 60_000, site: 60_000, default: 120_000 };
const CDN = { home: 'public, max-age=30, s-maxage=60, stale-while-revalidate=300', site: 'public, max-age=30, s-maxage=60, stale-while-revalidate=300',
  default: 'public, max-age=60, s-maxage=120, stale-while-revalidate=600' };
const MAX_CACHE = 300;
const cache = new Map();
export const _cache = cache;                            // testes

const intIn = (v, d, lo, hi) => { const n = Number.parseInt(v, 10); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };
// Número estrito (sem sufixo, hexa ou expoente): "10abc" não vira 10 em silêncio; vazio segue o padrão de intIn.
const NUM_RE = /^[+-]?\d+(\.\d+)?$/;
const intStrict = (name, v, d, lo, hi) => { const t = String(v).trim(); if (t && !NUM_RE.test(t)) throw new HttpError(400, `${name} inválido`); return intIn(t, d, lo, hi); };
// Preço máximo: decimal simples ≥ 0 ("12.5"); "0x10", "1e3", "Infinity" e negativos → 400.
const maxPrice = (v) => { const s = str(v, 12) || ''; if (s && !/^\d+(\.\d+)?$/.test(s)) throw new HttpError(400, 'preço máximo inválido'); return s; };
const str = (v, max = 80) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, max) : null);
const bool = (v) => v === '1' || v === 'true' || v === 'sim';
// Só parâmetros que a rota lê entram na chave do cache: "?x=1", "?x=2"... não enchem o cache nem forçam consultas repetidas.
const KEY_PARAMS = new Set(['pagina', 'limite', 'colecao', 'tipo', 'categoria', 'estoque', 'busca', 'ordem', 'todas', 'dias', 'lojas', 'status', 'faixa',
  'minimo', 'ofertas', 'referencia', 'abaixo', 'confianca_minima', 'produto', 'modo', 'grupo', 'loja', 'max', 'semref', 'produtos', 'idioma', 'objetivo', 'orcamento', 'favorito']);
const SLUG_RE = /^[a-z0-9][a-z0-9_.-]{0,120}$/i;

class HttpError extends Error { constructor(status, msg) { super(msg); this.status = status; } }
// Teto de OFFSET nas listas do banco: pagina * limite acima de 10 000 linhas → 400 (OFFSET profundo varre e descarta
// tudo antes; ninguém navega até lá). Com limite 50 vai até a página 200; com o padrão 24, até a 416.
const MAX_OFFSET = 10_000;
const capOffset = (rt) => { if (rt.page * rt.limit > MAX_OFFSET) throw new HttpError(400, `página além do limite (pagina × limite até ${MAX_OFFSET})`); return rt; };

function route(segs, qs) {
  const page = intIn(qs.get('pagina'), 1, 1, 10_000); const limit = intIn(qs.get('limite'), 24, 1, 50);
  const [a, id, sub] = segs;
  if (a === 'home' && segs.length === 1) return { name: 'home', kind: 'home' };
  if (a === 'produtos' && segs.length === 1) {
    const ordem = str(qs.get('ordem'), 20) || 'relevancia'; if (!DB.PRODUCT_SORTS.includes(ordem)) throw new HttpError(400, `ordem inválida (use: ${DB.PRODUCT_SORTS.join(', ')})`);
    return capOffset({ name: 'produtos', page, limit, args: { page, limit, colecao: str(qs.get('colecao'), 40), tipo: str(qs.get('tipo'), 40), categoria: str(qs.get('categoria'), 60),
      estoque: bool(qs.get('estoque')), busca: str(qs.get('busca'), 60), ordem } });
  }
  if (a === 'produtos' && id) {
    if (!SLUG_RE.test(id)) throw new HttpError(400, 'identificador de produto inválido');
    if (!sub) return { name: 'produto', id };
    if (sub === 'ofertas' && segs.length === 3) return capOffset({ name: 'ofertas', id, page, limit, args: { page, limit, todas: bool(qs.get('todas')) } });
    if (sub === 'historico' && segs.length === 3) return { name: 'historico', id, args: { dias: intIn(qs.get('dias'), 30, 1, 365), lojas: bool(qs.get('lojas')) } };
    if (sub === 'estatisticas' && segs.length === 3) return { name: 'estatisticas', id };
  }
  if (a === 'referencias' && segs.length === 1) {
    const status = str(qs.get('status'), 20); if (status && !['verified', 'pending', 'conflicting', 'unknown'].includes(status)) throw new HttpError(400, 'status inválido');
    return capOffset({ name: 'referencias', page, limit, args: { page, limit, status } });
  }
  if (a === 'oportunidades' && segs.length === 1) {
    const faixa = str(qs.get('faixa'), 12) || null; if (faixa && !['excelente', 'boa', 'normal', 'baixa'].includes(faixa)) throw new HttpError(400, 'faixa inválida (excelente, boa, normal, baixa)');
    const ordem = str(qs.get('ordem'), 12) || 'score'; if (!Object.keys(DB.OPP_SORTS).includes(ordem)) throw new HttpError(400, `ordem inválida (use: ${Object.keys(DB.OPP_SORTS).join(', ')})`);
    const colecao = str(qs.get('colecao'), 40) || null; if (colecao && !SLUG_RE.test(colecao)) throw new HttpError(400, 'coleção inválida');
    const minimo = qs.get('minimo') != null ? intStrict('minimo', qs.get('minimo'), 0, 0, 100) : null;
    const ofertas = str(qs.get('ofertas'), 10) || ''; if (ofertas && ofertas !== 'todas') throw new HttpError(400, 'ofertas inválido (use: todas)');
    // categoria do site: tipo do produto (etb, booster_box, blister_3...) ou grupo (Boosters, Blisters, Coleções...)
    const categoria = str(qs.get('categoria'), 30) || null;
    if (categoria && !SITE.GROUP_ORDER.includes(categoria) && !/^[a-z][a-z0-9_]{0,29}$/.test(categoria)) throw new HttpError(400, `categoria inválida (tipo do produto ou grupo: ${SITE.GROUP_ORDER.join(', ')})`);
    const referencia = str(qs.get('referencia'), 10) || null;
    if (referencia && !Object.keys(DB.OPP_REFERENCES).includes(referencia)) throw new HttpError(400, `referencia inválida (use: ${Object.keys(DB.OPP_REFERENCES).join(', ')})`);
    const abaixo = qs.get('abaixo') != null ? intStrict('abaixo', qs.get('abaixo'), 0, 0, 100) : null;                          // % mínimo abaixo da referência atual
    const confiancaMinima = qs.get('confianca_minima') != null ? intStrict('confianca_minima', qs.get('confianca_minima'), 0, 0, 100) : null;   // % (0–100)
    // produto: id ou slug (página do produto). Com ofertas=todas traz a nota oficial de cada oferta avaliada do produto.
    const produto = str(qs.get('produto'), 80) || null; if (produto && !SLUG_RE.test(produto)) throw new HttpError(400, 'produto inválido');
    // loja: id da loja (filtro da página); max: preço até R$ (total quando o frete é conhecido, senão o preço do produto)
    const loja = str(qs.get('loja'), 60) || null; if (loja && !SLUG_RE.test(loja)) throw new HttpError(400, 'loja inválida');
    const maxS = maxPrice(qs.get('max'));
    // idioma do produto: pt (português) ou importado en/ja/zh/ko; "todos" = todos. Ausente: português, exceto com
    // produto (a página do produto mostra as ofertas dele, seja qual for o idioma).
    const idioma = str(qs.get('idioma'), 6) || null; if (idioma && !SITE.LANGS.includes(idioma)) throw new HttpError(400, `idioma inválido (use: ${SITE.LANGS.join(', ')})`);
    return capOffset({ name: 'oportunidades', page, limit, args: { page, limit, faixa, colecao, minimo, ordem, todas: ofertas === 'todas', categoria, referencia, abaixo, confiancaMinima, produto,
      loja, max: maxS ? Number(maxS) : null, idioma: idioma === 'todos' ? null : idioma || (produto ? null : 'pt') } });
  }
  // lojas com oferta avaliada com estoque (opções do filtro "Loja" da página de oportunidades)
  if (a === 'oportunidades' && segs.length === 2 && segs[1] === 'lojas') return { name: 'oportunidades-lojas' };
  // ---- FASE 4: formato do site (listas e página de produto), regras iguais às do site
  if (a === 'site') {
    if (id === 'produtos' && segs.length === 2) {
      const modo = str(qs.get('modo'), 10) || 'guardar'; if (!['guardar', 'abrir'].includes(modo)) throw new HttpError(400, 'modo inválido');
      const ordem = str(qs.get('ordem'), 10) || ''; if (ordem && !['score', 'disc', 'price', 'ppb', 'new'].includes(ordem)) throw new HttpError(400, 'ordem inválida');
      const grupo = str(qs.get('grupo'), 20) || ''; if (grupo && !SITE.GROUP_ORDER.includes(grupo)) throw new HttpError(400, 'grupo inválido');
      const max = maxPrice(qs.get('max'));
      const sp = intIn(qs.get('pagina'), 1, 1, 1000); const sl = intIn(qs.get('limite'), 48, 1, 60);
      return { name: 'site-produtos', kind: 'site', page: sp, limit: sl, F: { mode: modo, sort: ordem, group: grupo, col: str(qs.get('colecao'), 40) || '', store: str(qs.get('loja'), 60) || '',
        type: str(qs.get('tipo'), 40) || '', max, below: bool(qs.get('abaixo')), stock: qs.get('estoque') !== '0', semref: bool(qs.get('semref')), lang: SITE.LANGS.includes(qs.get('idioma')) ? qs.get('idioma') : 'pt' } };
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
    // Monte seu kit (docs/monte-seu-kit.md, K3): protótipo; respostas do questionário → cesta com produtos e ofertas reais.
    if (id === 'kit' && segs.length === 2) {
      const objetivo = str(qs.get('objetivo'), 20) || ''; if (!Object.hasOwn(OBJETIVO_MODELO, objetivo)) throw new HttpError(400, `objetivo inválido (use: ${Object.keys(OBJETIVO_MODELO).join(', ')})`);
      const orcamento = Number(qs.get('orcamento')); if (objetivo !== 'proteger' && !(Number.isFinite(orcamento) && orcamento >= 1 && orcamento <= 100000)) throw new HttpError(400, 'orcamento inválido (1 a 100000)');
      const idioma = str(qs.get('idioma'), 10) || 'pt'; if (!['pt', 'en', 'ja', 'zh', 'ko', 'qualquer'].includes(idioma)) throw new HttpError(400, 'idioma inválido');
      return { name: 'site-kit', kind: 'site', resp: { objetivo, orcamento, idioma, favorito: str(qs.get('favorito'), 40) || '' } };
    }
    if (id === 'pagina' && segs.length === 3) { if (!Object.hasOwn(SITE.SITE_PAGES, sub)) throw new HttpError(404, 'rota não encontrada'); return { name: 'site-pagina', kind: 'site', page: sub }; }
    if (id === 'produto' && sub && segs.length === 3) { if (!SLUG_RE.test(sub)) throw new HttpError(400, 'identificador de produto inválido'); return { name: 'site-produto', kind: 'site', id: sub }; }
  }
  throw new HttpError(404, 'rota não encontrada');
}

// /oportunidades com o banco sem sincronizar (decisão do dono, 17/10/2026): mostra as últimas notas registradas até a
// próxima rodada, marcadas com status 'stale_db' (frescor real em meta.freshness e nos headers; o site não mostra a idade).
// Antes a lista ficava vazia ("pausadas"). Política: vale também acima de 24 h, sem 503 (o meta.status pula esse corte).
const staleNote = (body) => { if (body?.meta) Object.assign(body.meta, { status: 'stale_db',
  message: 'Últimos valores registrados. Atualiza sozinho na próxima rodada.' }); return body; };
const paged = (r, page, limit) => ({ data: r.items, meta: { page, limit, total: r.total, pages: Math.max(1, Math.ceil(r.total / limit)) } });

async function run(rt, source) {
  const useDb = source === 'db';
  switch (rt.name) {
    case 'home': return { body: slimHome(await catalogState(source), { source }) };   // banco + campos que ainda só o robô tem
    case 'site-produtos': return { body: { v: 1, source, ...SITE.siteProducts(await catalogState(source), rt.F, { page: rt.page, limit: rt.limit }) } };
    case 'site-ofertas': { const st = await catalogState(source);
      return { body: { v: 1, source, ...SITE.siteOffers(st, rt.args), ...(rt.busca != null ? { tips: SITE.tipHits(st, rt.busca) } : {}) } }; }
    case 'site-pagina': return { body: { v: 1, source, ...SITE.SITE_PAGES[rt.page](await catalogState(source), { now: FR.nowMs() }) } };
    case 'site-kit': { const st = await catalogState(source);
      const produtos = (st.products || []).map((p) => ({ id: p.id, type: p.type, name: p.name, image: p.image || null }));
      const ofertas = (st.offers || []).map((o) => ({ productId: o.productId, storeId: o.storeId, storeName: o.storeName, price: o.price, total: o.total, shipping: o.shipping, shippingKnown: o.shippingKnown, stock: o.stock, url: o.url, image: o.image || null, source_timestamp: o.source_timestamp || null, anomalous: !!o.anomalous, stale: !!o.stale }));
      return { body: { v: 1, source, prototipo: true, ...recomendar(rt.resp, produtos, ofertas, { fg: freteGratis() }) } }; }
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
    case 'oportunidades-lojas': {
      if (!useDb) return { body: { data: [], meta: { status: 'requires_db' } } };
      return { body: { data: await DB.opportunityStores() } };
    }
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
  const path = (u.searchParams.get('path') || u.pathname.replace(/^\/api\/v1\/?/, '')).toLowerCase().split('/').filter(Boolean);   // caixa normalizada: /produtos/ABC e /produtos/abc dividem a entrada do cache
  u.searchParams.delete('path');
  // Afiliados (docs/afiliados.md): só destino de clique, à parte dos dados; sem banco, sem frescor, sem cache por consulta.
  if (path.length === 1 && path[0] === 'afiliados') return send(res, 200, publicAffiliates(), { 'Cache-Control': CDN.default });
  if (path[0] === 'frete') return frete(req, res, path, u.searchParams);
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
      if (rt.name !== 'oportunidades') {
        const L = await legacyState({ now }).catch(() => null); const stFr = L ? FR.classify(FR.stateDataAt(L.st), now, 'state') : null;
        if (FR.usable(stFr) && Date.parse(stFr.dataAt) > Date.parse(dbFr.dataAt || 0)) { source = 'state'; fallback = 'banco-desatualizado'; reason = dbFr.ageMin != null ? `banco-${dbFr.ageMin}min` : 'banco-sem-horario'; }
      }
    }
  }
  try { if (!out) { if (dbErr) throw dbErr; out = await run(rt, source); if (rt.name === 'oportunidades' && dbFr && !FR.usable(dbFr) && !out.status) staleNote(out.body); } }
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
    else { const L = await legacyState({ now }).catch(() => null); fr = FR.classify(FR.stateDataAt(L?.st), now, 'state'); }
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

// ---- Frete por CEP (issue #84). A flag é lida a cada pedido: desligada, 404 sem carregar o módulo nem ler o state.json.
// O serviço (cache de 5 min, limites por IP e por chave, cooldown por loja) vive na memória da instância da função:
// é proteção por instância, não global (decisão documentada em docs/arquitetura-e-testes.md).
export const SHIPPING_FLAG = 'SHIPPING_CALC_ENABLED';
let freteDeps = null;                                   // testes: { service }
let freteHandler = null;
export function _setFrete(deps) { freteDeps = deps || null; freteHandler = null; }
// IP do cliente: x-real-ip / primeiro x-forwarded-for (a Vercel sobrescreve esses cabeçalhos); sem eles, o socket.
const clientIp = (req) => String(req.headers?.['x-real-ip'] || String(req.headers?.['x-forwarded-for'] || '').split(',')[0].trim() || req.socket?.remoteAddress || 'anon').slice(0, 64);
async function frete(req, res, path, qs) {
  const H = { 'Cache-Control': 'no-store' };
  if (process.env[SHIPPING_FLAG] !== '1') return send(res, 404, { error: 'rota não encontrada' }, H);
  const SC = await import('./_lib/shipping-calc.mjs');
  let st;
  try { st = (await legacyState()).st; } catch { return send(res, 503, { error: 'dados indisponíveis no momento' }, H); }
  if (path.length === 2 && path[1] === 'estado') {
    return send(res, 200, { enabled: true, stores: SC.calcSources(st).map((s) => s.id), ttlSec: SC.QUOTE_TTL_MS / 1000,
      limits: { perIpPerMin: SC.RATE_LIMIT.max, perKeyPerMin: SC.KEY_RATE_LIMIT.max } }, H);
  }
  if (path.length !== 1) return send(res, 404, { error: 'rota não encontrada' }, H);
  freteHandler ||= SC.createShippingCalcHandler({ enabled: true, ...(freteDeps?.service ? { service: freteDeps.service } : {}),
    resolveOffer: async (id) => SC.resolveVtexOffer((await legacyState()).st, id) });
  // do pedido só saem oferta, CEP e quantidade; qualquer outro parâmetro (base, url, itemId, sellerId…) é ignorado
  const r = await freteHandler({ offerId: qs.get('oferta') ?? undefined, cep: qs.get('cep') ?? undefined, quantity: qs.get('quantidade') ?? 1 }, { ip: clientIp(req) });
  return send(res, r.status, r.body, { ...H, ...(r.status === 429 ? { 'Retry-After': '60' } : {}) });
}
