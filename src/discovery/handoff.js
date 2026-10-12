// Hand-off das URLs descobertas (data/discovery-urls.json, escrito por src/discovery/pipeline.js) para o src/run.js:
// cada URL entra em store.productUrls (só lojas jsonld/auto, mesmo host da loja) e sai do arquivo quando aparece num
// anúncio lido (virou url-cache.relevant) ou depois de MAX_TRIES rodadas sem anúncio.
import { readJson, writeJson, dataPath } from '../db.js';
import { hostOf } from './hosts.js';

export const MAX_TRIES = 3;

export function loadHandoff(stores, { file = dataPath('discovery-urls.json') } = {}) {
  const pending = readJson(file, {});
  const attached = new Map(); let dirty = false;
  for (const store of stores) {
    const list = pending[store.id];
    if (!Array.isArray(list) || !list.length || !store.url || !['auto', 'jsonld'].includes(store.platform || 'auto')) continue;
    const host = hostOf(store.url);
    const mine = list.filter((x) => x?.url && hostOf(x.url) === host);
    if (!mine.length) continue;
    store.productUrls = [...new Set([...(store.productUrls || []), ...mine.map((x) => x.url)])];
    attached.set(store.id, mine);
  }
  return {
    attached,
    /** Depois da leitura da loja: `raw` são os anúncios devolvidos pelo adaptador (com raw.failed). */
    seen(storeId, raw) {
      const mine = attached.get(storeId); if (!mine) return;
      const got = new Set((Array.isArray(raw) ? raw : []).map((l) => l?.url));
      pending[storeId] = pending[storeId].filter((x) => {
        if (!mine.includes(x)) return true;
        dirty = true;
        if (got.has(x.url)) return false;
        x.tries = (x.tries || 0) + 1;
        return x.tries < MAX_TRIES;
      });
      if (!pending[storeId].length) delete pending[storeId];
    },
    save() { if (dirty) writeJson(file, pending); },
  };
}
