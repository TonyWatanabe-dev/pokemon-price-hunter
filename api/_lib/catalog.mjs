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
  } else st = (await legacyState({ now })).st;
  cache.set(source, { at: now, st });
  return st;
}

/**
 * D4b (docs/fallback-dados.md): os campos que só o robô tem (menor preço já visto, média de mercado, histórico, pistas,
 * reputação, atividade, distrust, cobertura, nota das lojas, validação da loja, lançamento) só são sobrepostos aos preços
 * do banco se o state.json estiver dentro do limite que já existe (LIMITS.EXPIRA_MIN, 24 h; `classify`). Vencido, sem
 * horário confiável ou ausente: fica só a identidade e a ordem (ids, tipos, nome/URL das lojas); o resto sai nulo/vazio,
 * nunca um valor de outra época com o frescor "atual" do banco. `robotData: 'indisponivel'` marca o caso.
 */
export function legacyOverlay(st, now = nowMs()) {
  if (st && classify(stateDataAt(st), now).status !== 'indisponivel') return st;
  const s = st || {};
  return {
    generatedAt: null, types: s.types, robotData: 'indisponivel',
    collections: (s.collections || []).map((c) => ({ id: c.id })), products: (s.products || []).map((p) => ({ id: p.id })),
    offers: (s.offers || []).map((o) => ({ id: o.id })), sources: (s.sources || []).map((x) => ({ id: x.id, name: x.name, url: x.url })),
  };
}
