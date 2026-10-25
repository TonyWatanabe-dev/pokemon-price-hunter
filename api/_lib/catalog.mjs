// Estado do catálogo para a API (serviço compartilhado por Home, listas e página de produto):
// do banco (Marketplace Core + Price Engine, com os campos que ainda só o robô tem sobrepostos) ou, no fallback,
// do próprio state.json. Cache em memória de 60 s por fonte: as listas não reconsultam o banco a cada pedido.
import { legacyState } from './legacy.mjs';
import { stateLikeFromDb } from './read-db.mjs';
import { dbDataAt, classify, stateDataAt, nowMs } from './freshness.mjs';

const TTL_MS = 60_000;
const cache = new Map();
export function clearCatalogCache() { cache.clear(); }
export async function catalogState(source, { now = Date.now() } = {}) {
  const hit = cache.get(source);
  if (hit && now - hit.at < TTL_MS) return hit.st;
  let st;
  if (source === 'db') {
    // D4b: sem o state.json (ou com ele vencido) os preços do banco seguem; só os campos do robô ficam de fora
    const L = await legacyState({ now }).catch(() => null);
    st = await stateLikeFromDb(legacyOverlay(L?.st), { dataAt: await dbDataAt({ now }) });
    if (st.robotData) st.sources = sourcesFromDb(st.sources, st.offers);
  } else st = (await legacyState({ now })).st;
  cache.set(source, { at: now, st });
  return st;
}

/**
 * D4b (docs/fallback-dados.md): os campos que só o robô tem (menor preço já visto, média de mercado, histórico, pistas,
 * reputação, atividade, distrust, cobertura, nota das lojas, validação da loja, lançamento) só são sobrepostos aos preços
 * do banco se o state.json estiver dentro do limite que já existe (LIMITS.EXPIRA_MIN, 24 h; `classify`). Vencido, sem
 * horário confiável ou ausente: fica só a identidade e a ordem (ids, tipos, lojas com nome/URL/status/plataforma); o resto sai nulo/vazio,
 * nunca um valor de outra época com o frescor "atual" do banco. `robotData: 'indisponivel'` marca o caso.
 */
export function legacyOverlay(st, now = nowMs()) {
  if (st && classify(stateDataAt(st), now).status !== 'indisponivel') return st;
  const s = st || {};
  return {
    generatedAt: null, types: s.types, robotData: 'indisponivel',
    collections: (s.collections || []).map((c) => ({ id: c.id })), products: (s.products || []).map((p) => ({ id: p.id })),
    offers: (s.offers || []).map((o) => ({ id: o.id })),
    // loja: identidade e configuração (status de leitura, plataforma) ficam; nota/evidência e horários do robô saem
    sources: (s.sources || []).map((x) => ({ id: x.id, name: x.name, url: x.url, status: x.status, platform: x.platform, platformHint: x.platformHint })),
  };
}
/** Com os campos do robô fora: loja com oferta em estoque lida pelo banco (frescor do banco utilizável) está sendo lida
 *  agora, nunca "sem leitura" (/lojas). Status antigo diferente de ACTIVE/PAUSED vira ACTIVE só por essa evidência; loja do
 *  banco que nem aparece no state.json entra com nome e status ACTIVE. Loja sem oferta viva fica com o status que tinha. */
export function sourcesFromDb(sources = [], offers = []) {
  const live = new Map();
  for (const o of offers) if (o?.storeId && o.stock === 'IN_STOCK' && !o.stale && !o.anomalous && o.total > 0 && !live.has(o.storeId)) live.set(o.storeId, o.storeName || o.storeId);
  const out = (sources || []).map((x) => { const up = String(x.status || '').toUpperCase();
    return live.has(x.id) && up !== 'ACTIVE' && up !== 'PAUSED' ? { ...x, status: 'ACTIVE' } : x; });
  for (const [id, name] of live) if (!out.some((x) => x.id === id)) out.push({ id, name, status: 'ACTIVE' });
  return out;
}
