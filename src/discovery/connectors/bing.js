// Conector Bing Web Search API v7. Chave: BING_SEARCH_KEY. Sem chave, fica registrado como indisponível ("sem chave")
// e a rodada nunca finge resultados. Aviso: a Microsoft anunciou a aposentadoria das Bing Search APIs (ago/2025);
// o conector fica para quem ainda tem acesso e não foi validado contra o serviço ao vivo (só offline, com fetch simulado).
import { request, safeReason } from '../../http.js';

const ENDPOINT = 'https://api.bing.microsoft.com/v7.0/search';
const KEY = 'BING_SEARCH_KEY';

export function create(env = process.env) {
  let exhausted = null;
  return {
    id: 'bing',
    keyName: KEY,
    cost: { unit: 'query', estimate: 1 },
    available: () => !!env[KEY] && !exhausted,
    get reason() { return exhausted ? 'esgotado (429)' : env[KEY] ? 'ok' : 'sem chave'; },
    async search(q, { count = 20 } = {}) {
      if (!env[KEY]) throw new Error('bing: sem chave');
      if (exhausted) throw Object.assign(new Error('bing: esgotado nesta rodada'), { exhausted: true });
      const url = `${ENDPOINT}?q=${encodeURIComponent(q)}&mkt=pt-BR&count=${Math.min(50, Math.max(1, count))}`;
      try {
        const r = await request(url, { accept: 'application/json', headers: { 'ocp-apim-subscription-key': env[KEY] } });
        return (r.json().webPages?.value || []).map((x) => ({ url: x.url, title: x.name || '', snippet: x.snippet || '' })).filter((x) => x.url);
      } catch (e) {
        if (e?.blocked && e.status === 429) { exhausted = { at: new Date().toISOString() }; e.exhausted = true; }
        e.message = `bing: ${safeReason(e)}`;
        throw e;
      }
    },
  };
}
