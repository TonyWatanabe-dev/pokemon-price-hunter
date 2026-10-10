// Diretório de lojas (/api/v1/site/lojas): só metadados confirmados nos dados que o robô já coletou.
// Por loja: domínio normalizado, link HTTPS, ofertas observadas, ofertas com estoque e a última atualização.
// Não há nota, ranking nem rótulo de confiabilidade: reputação sem fonte verificável não é prometida aqui.
// Estados (status): com_ofertas (há oferta recente) · sem_dados_recentes (tem ofertas, mas nenhuma recente) · sem_ofertas (nenhuma oferta).
import { live } from './site.mjs';

/** oferta sem leitura há mais que isto (ou marcada stale pelo robô) não conta como dado recente */
export const RECENT_HOURS = 24;

const HTTP_RE = /^https?:\/\//i;
const parse = (u) => {
  if (typeof u !== 'string' || !u.trim()) return null;
  const s = u.trim();
  try { const x = new URL(HTTP_RE.test(s) ? s : /^[a-z][a-z0-9+.-]*:/i.test(s) ? '' : `https://${s}`); return x.protocol === 'http:' || x.protocol === 'https:' ? x : null; } catch { return null; }
};

/** Domínio normalizado (minúsculo, sem www., porta nem ponto final) ou null se não houver host válido. */
export function normalizeDomain(u) {
  const x = parse(u); if (!x) return null;
  const h = x.hostname.toLowerCase().replace(/\.$/, '').replace(/^www\./, '');
  return h.includes('.') ? h : null;
}

/**
 * Link de compra seguro: só http/https. http vira https quando o mesmo domínio já aparece em https nos dados
 * (httpsHosts); sem essa evidência o endereço original é mantido. URL inválida (ou outro esquema) = null.
 */
export function safeUrl(u, httpsHosts = new Set()) {
  const x = parse(u); if (!x) return null;
  if (x.protocol === 'http:' && httpsHosts.has(normalizeDomain(x.href))) x.protocol = 'https:';
  return x.href;
}

/** @param {object} st estado (offers, sources) @param {{now?: number}} opts */
export function siteStores(st, { now = Date.now() } = {}) {
  const sources = st.sources || []; const offers = st.offers || [];
  const httpsHosts = new Set();
  for (const u of [...sources.map((s) => s.url), ...offers.map((o) => o.url)]) { if (typeof u === 'string' && /^https:\/\//i.test(u.trim())) { const d = normalizeDomain(u); if (d) httpsHosts.add(d); } }
  const by = new Map();
  const slot = (id, name) => { if (!by.has(id)) by.set(id, { id, name: name || id, url: null, offers: [] }); return by.get(id); };
  for (const s of sources) if (s.id) { const e = slot(s.id, s.name); e.url = s.url || e.url; }
  for (const o of offers) if (o.storeId) { const e = slot(o.storeId, o.storeName); if (!parse(e.url)) e.url = parse(o.url)?.origin ?? e.url; e.offers.push(o); }
  const recent = (o) => { if (o.stale) return false; const t = Date.parse(o.source_timestamp ?? ''); return !Number.isFinite(t) || now - t <= RECENT_HOURS * 3600e3; };
  const items = [...by.values()].map((e) => {
    const stamps = e.offers.map((o) => Date.parse(o.source_timestamp ?? '')).filter(Number.isFinite);
    const fresh = e.offers.filter(recent);
    const link = safeUrl(e.url, httpsHosts);
    return {
      id: e.id, name: e.name, domain: normalizeDomain(e.url), url: link,
      status: !e.offers.length ? 'sem_ofertas' : fresh.length ? 'com_ofertas' : 'sem_dados_recentes',
      // "em estoque" só entre as ofertas recentes: leitura velha não afirma estoque atual
      offers: e.offers.length, activeOffers: fresh.length, inStockOffers: fresh.filter(live).length,
      updatedAt: stamps.length ? new Date(Math.max(...stamps)).toISOString() : null,
    };
  });
  items.sort((a, b) => b.activeOffers - a.activeOffers || String(a.name).localeCompare(String(b.name)) || String(a.id).localeCompare(String(b.id)));
  return { items, total: items.length };
}
