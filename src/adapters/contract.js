// Contrato comum do anúncio (listing) que qualquer adaptador entrega a src/run.js (issue #47).
// Função pura, sem rede: diz se o anúncio pode virar oferta e, se não puder, por quê.
// Não converte texto livre nem inventa dado: campo opcional ausente continua ausente, e valor
// que o adaptador deveria ter entregue como número (preço, quantidade) não é "consertado" aqui.
//
// Campos e vocabulário são os que os adaptadores atuais já produzem (shopify, vtex, jsonld, mercadolivre):
//   title, url, price { pix?, avista?, cartao?, base? } (as chaves de pickPrice em src/score.js),
//   listPrice, stock, quantity, shipping, image, sourceType; opcionais: currency/priceCurrency, source_timestamp.

/** Estoque: o que os adaptadores escrevem (jsonld inclui UNAVAILABLE) e o site sabe mostrar. */
export const STOCK_VALUES = Object.freeze(['IN_STOCK', 'OUT_OF_STOCK', 'PRE_ORDER', 'UNKNOWN', 'UNAVAILABLE']);
/** Proveniência (sourceType) de cada adaptador. */
export const SOURCE_TYPES = Object.freeze(['store_json', 'store_api', 'json_ld', 'store_page', 'microdata', 'open_graph', 'official_api']);
/** Chaves de preço aceitas (mesmas de pickPrice). */
export const PRICE_KEYS = Object.freeze(['pix', 'avista', 'cartao', 'base']);
/** Plataforma cujo link publicado não fica no host da API configurada em store.url (ML: api.mercadolibre.com). */
export const PLATFORM_HOSTS = Object.freeze({ mercadolivre: Object.freeze(['mercadolivre.com.br']) });
/** Folga para relógio adiantado da loja/servidor ao conferir timestamp "no futuro". */
export const FUTURE_TOLERANCE_MS = 5 * 60e3;
/** Estoque que exige preço: é o que o visitante pode comprar agora (ou reservar). */
const NEEDS_PRICE = new Set(['IN_STOCK', 'PRE_ORDER']);

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const bare = (h) => String(h || '').toLowerCase().replace(/\.$/, '').replace(/^www\./, '');

/** Hosts aceitos para o link do anúncio desta loja (sem "www."). Vazio = loja sem domínio conhecido. */
export function storeHosts(store = {}) {
  const hosts = new Set();
  if (store.url) { try { hosts.add(bare(new URL(store.url).hostname)); } catch { /* url da loja inválida: sem host */ } }
  const plat = store.platform && store.platform !== 'auto' ? store.platform : null;
  for (const h of PLATFORM_HOSTS[plat] || PLATFORM_HOSTS[store.id] || []) hosts.add(h);
  return [...hosts].filter(Boolean);
}

const hostAllowed = (host, allowed) => { const h = bare(host); return allowed.some((a) => h === a || h.endsWith('.' + a)); };

function checkTimestamp(v, now, reasons) {
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})$/.test(v) || !Number.isFinite(Date.parse(v))) {
    reasons.push(`timestamp inválido (${String(v)})`); return;
  }
  if (Date.parse(v) > now + FUTURE_TOLERANCE_MS) reasons.push(`timestamp no futuro (${v})`);
}

/**
 * Valida um anúncio contra o contrato comum.
 * @param {object} listing anúncio como o adaptador entrega
 * @param {object} store loja (usa store.url e, para Mercado Livre, store.platform/store.id)
 * @param {{ now?: number|Date }} [opts] relógio (para testes)
 * @returns {{ ok: true, listing: object } | { ok: false, reasons: string[] }}
 */
export function validateListing(listing, store, opts = {}) {
  const now = opts.now instanceof Date ? opts.now.getTime() : isNum(opts.now) ? opts.now : Date.now();
  if (!listing || typeof listing !== 'object' || Array.isArray(listing)) return { ok: false, reasons: ['anúncio não é objeto'] };
  const reasons = [];
  const l = listing;

  // Título
  const title = typeof l.title === 'string' ? l.title.trim() : '';
  if (!title || title === 'undefined' || title === 'null') reasons.push('título vazio');

  // Estoque
  if (!STOCK_VALUES.includes(l.stock)) reasons.push(`estoque fora do vocabulário (${String(l.stock)})`);

  // Preço: objeto com as chaves de pickPrice; cada valor presente é número finito > 0 (texto não é convertido).
  let priced = false;
  if (!l.price || typeof l.price !== 'object' || Array.isArray(l.price)) reasons.push('preço ausente ou fora do formato { base, pix… }');
  else {
    for (const k of Object.keys(l.price)) {
      const v = l.price[k];
      if (!PRICE_KEYS.includes(k)) { reasons.push(`tipo de preço desconhecido (${k})`); continue; }
      if (v == null) continue;
      if (!isNum(v)) reasons.push(`preço ${k} não é número (${typeof v === 'string' ? JSON.stringify(v) : String(v)})`);
      else if (!(v > 0)) reasons.push(`preço ${k} não é positivo (${v})`);
      else priced = true;
    }
    // Esgotado/indisponível/não confirmado pode vir sem preço (VTEX escreve 0 no esgotado; o adaptador manda null).
    if (!priced && NEEDS_PRICE.has(l.stock)) reasons.push(`sem preço válido para estoque ${l.stock}`);
  }
  if (l.listPrice != null && !(isNum(l.listPrice) && l.listPrice > 0)) reasons.push(`preço "de" inválido (${String(l.listPrice)})`);

  // Moeda: só quando o adaptador informa.
  for (const k of ['currency', 'priceCurrency']) if (l[k] != null && String(l[k]).trim().toUpperCase() !== 'BRL') reasons.push(`moeda ${String(l[k])} (só BRL)`);

  // Link: absoluto, http(s), no domínio da loja (ou subdomínio dele).
  const allowed = storeHosts(store);
  let u = null;
  if (typeof l.url !== 'string' || !l.url.trim()) reasons.push('link ausente');
  else {
    try { u = new URL(l.url); } catch { reasons.push(`link não é absoluto (${l.url})`); }
    if (u && !/^https?:$/.test(u.protocol)) { reasons.push(`link com protocolo não permitido (${u.protocol})`); u = null; }
    if (u && (u.username || u.password)) reasons.push('link com usuário/senha embutidos');
    if (u) {
      if (!allowed.length) reasons.push('loja sem domínio conhecido para conferir o link');
      else if (!hostAllowed(u.hostname, allowed)) reasons.push(`link fora do domínio da loja (${u.hostname} ≠ ${allowed.join(', ')})`);
    }
  }

  // Proveniência
  if (!SOURCE_TYPES.includes(l.sourceType)) reasons.push(`proveniência desconhecida (sourceType ${String(l.sourceType)})`);

  // Opcionais: quando presentes, precisam ser coerentes.
  if (l.quantity != null && !(isNum(l.quantity) && l.quantity >= 0)) reasons.push(`quantidade inválida (${String(l.quantity)})`);
  if (l.shipping != null && !(isNum(l.shipping) && l.shipping >= 0)) reasons.push(`frete inválido (${String(l.shipping)})`);
  if (l.image != null) { let ok = false; try { ok = /^https?:$/.test(new URL(l.image).protocol); } catch { /* inválida */ } if (!ok) reasons.push('imagem não é link http(s) absoluto'); }
  if (l.source_timestamp != null) checkTimestamp(l.source_timestamp, now, reasons);

  if (reasons.length) return { ok: false, reasons };
  // Normalização mínima: o link fica exatamente como veio (ele compõe o id da oferta em src/run.js).
  const out = { ...l, title };
  for (const k of ['currency', 'priceCurrency']) if (out[k] != null) out[k] = 'BRL';
  return { ok: true, listing: out };
}
