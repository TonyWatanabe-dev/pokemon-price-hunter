// Leituras antigas de lojas lidas pela página (JSON-LD/Open Graph) podiam trazer preço de vitrine ou de parcela.
// Em vez de apagar dados, marcamos: pontos de histórico, menor preço e atividade dessas lojas até o dia da correção
// são ignorados ao montar o site. Os arquivos ficam intactos para conferência.
import { readJson, writeJson, dataPath } from './db.js';

export const DATA_VERSION = 3; // 3: Pix lido como preço normal, preço não escrito na página, vendedor secundário de marketplace

export function loadDistrust({ sources, prev, T }) {
  const meta = readJson(dataPath('meta.json'), {});
  if ((meta.dataVersion || 1) >= DATA_VERSION && meta.distrust) return { ...meta.distrust, fresh: false };
  const stores = new Set(Object.entries(sources).filter(([, s]) => s.platform === 'jsonld').map(([id]) => id));
  for (const o of Object.values(prev)) if (['json_ld', 'open_graph', 'microdata', 'store_page'].includes(o.sourceType) || (o.sourceType === 'store_api' && o.sellerKind !== 'store') || (o.seller && o.seller !== o.storeName && o.sourceType === 'store_api')) stores.add(o.storeId);
  const distrust = { stores: [...stores].sort(), until: String(T).slice(0, 10) };
  writeJson(dataPath('meta.json'), { ...meta, dataVersion: DATA_VERSION, distrust });
  return { ...distrust, fresh: true };
}

/** Ponto [dia, valor] de uma loja ainda vale? */
export const trustedPoint = (dist, sid, d) => !dist || !dist.stores.includes(sid) || String(d).slice(0, 10) > dist.until;
