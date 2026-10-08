// Estado do catálogo para a API (serviço compartilhado por Home, listas e página de produto):
// do banco (Marketplace Core + Price Engine, com os campos que ainda só o robô tem sobrepostos) ou, no fallback,
// do próprio state.json. Cache em memória de 60 s por fonte: as listas não reconsultam o banco a cada pedido.
import { legacyState } from './legacy.mjs';
import { stateLikeFromDb } from './read-db.mjs';

const TTL_MS = 60_000;
const cache = new Map();
export function clearCatalogCache() { cache.clear(); }
export async function catalogState(source, { now = Date.now() } = {}) {
  const hit = cache.get(source);
  if (hit && now - hit.at < TTL_MS) return hit.st;
  const L = await legacyState({ now });
  const st = source === 'db' ? await stateLikeFromDb(L.st) : L.st;
  cache.set(source, { at: now, st });
  return st;
}
