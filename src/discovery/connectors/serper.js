// Conector Serper (resultados do Google via API REST). Chave: SERPER_API_KEY. Sem chave: indisponível, sem simulação.
// Não validado contra o serviço ao vivo neste repositório (só offline, com fetch simulado).
import { request, safeReason } from '../../http.js';

const ENDPOINT = 'https://google.serper.dev/search';
const KEY = 'SERPER_API_KEY';

export function create(env = process.env) {
  let exhausted = null;
  return {
    id: 'serper',
    keyName: KEY,
    cost: { unit: 'query', estimate: 1 },
    available: () => !!env[KEY] && !exhausted,
    get reason() { return exhausted ? 'esgotado (429)' : env[KEY] ? 'ok' : 'sem chave'; },
    async search(q, { count = 20 } = {}) {
      if (!env[KEY]) throw new Error('serper: sem chave');
      if (exhausted) throw Object.assign(new Error('serper: esgotado nesta rodada'), { exhausted: true });
      try {
        const r = await request(ENDPOINT, { method: 'POST', accept: 'application/json', headers: { 'x-api-key': env[KEY], 'content-type': 'application/json' },
          body: JSON.stringify({ q, gl: 'br', hl: 'pt-br', num: Math.min(100, Math.max(1, count)) }) });
        return (r.json().organic || []).map((x) => ({ url: x.link, title: x.title || '', snippet: x.snippet || '' })).filter((x) => x.url);
      } catch (e) {
        if (e?.blocked && e.status === 429) { exhausted = { at: new Date().toISOString() }; e.exhausted = true; }
        e.message = `serper: ${safeReason(e)}`;
        throw e;
      }
    },
  };
}
