// Conector Brave Search API (web search). Chave: BRAVE_API_KEY. Passa por http.request (UA identificado, guarda de URL,
// intervalo por host); um 429 marca o conector como esgotado nesta rodada (respeita Retry-After, nunca insiste).
import { request, safeReason } from '../../http.js';

const ENDPOINT = 'https://api.search.brave.com/res/v1/web/search';
const KEY = 'BRAVE_API_KEY';

export function create(env = process.env) {
  let exhausted = null; // { at, retryAfter } depois de um 429
  return {
    id: 'brave',
    keyName: KEY,
    cost: { unit: 'query', estimate: 1 },
    available: () => !!env[KEY] && !exhausted,
    get reason() { return exhausted ? `esgotado (429${exhausted.retryAfter != null ? `, Retry-After ${exhausted.retryAfter} s` : ''})` : env[KEY] ? 'ok' : 'sem chave'; },
    async search(q, { count = 20 } = {}) {
      if (!env[KEY]) throw new Error('brave: sem chave');
      if (exhausted) throw Object.assign(new Error('brave: esgotado nesta rodada'), { exhausted: true });
      const url = `${ENDPOINT}?q=${encodeURIComponent(q)}&country=BR&search_lang=pt-br&count=${Math.min(20, Math.max(1, count))}`;
      try {
        const r = await request(url, { accept: 'application/json', headers: { 'x-subscription-token': env[KEY] } });
        return (r.json().web?.results || []).map((x) => ({ url: x.url, title: x.title || '', snippet: x.description || '' })).filter((x) => x.url);
      } catch (e) {
        if (e?.blocked && e.status === 429) { exhausted = { at: new Date().toISOString(), retryAfter: e.retryAfter ?? null }; e.exhausted = true; }
        e.message = `brave: ${safeReason(e)}`;
        throw e;
      }
    },
  };
}
