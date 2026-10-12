// Diagnóstico de bloqueio e de plataforma por loja: só OBSERVA a resposta que a loja deu ao nosso agente honesto
// (UA identificado, robots.txt respeitado). Nunca serve para contornar WAF, CAPTCHA ou limite: serve para o relatório
// (tools/coleta-relatorio.mjs) dizer por que uma loja não abre e qual plataforma ela usa. Guarda pouco e nunca guarda
// valor de cookie, token, query ou corpo inteiro: no máximo nomes de cookie, cabeçalhos curtos e 300 caracteres de texto.
const MAX_HEAD = 300; const MAX_HDR = 40; const MAX_COOKIES = 6;
const clip = (s, n) => (s == null ? null : String(s).replace(/\s+/g, ' ').trim().slice(0, n) || null);

// Cabeçalhos podem vir como Headers (fetch), Map ou objeto simples.
export function headerOf(headers, name) {
  if (!headers) return null;
  if (typeof headers.get === 'function') { const v = headers.get(name); return v == null ? null : String(v); }
  const k = Object.keys(headers).find((x) => x.toLowerCase() === name.toLowerCase());
  return k == null ? null : Array.isArray(headers[k]) ? headers[k].join(', ') : String(headers[k]);
}

// Só os NOMES dos cookies que a loja tentou gravar (o valor nunca é guardado). Aceita getSetCookie() do Node 20+,
// a string única do get('set-cookie') ou um array.
export function cookieNames(headers) {
  let raw = [];
  if (!headers) return [];
  if (typeof headers.getSetCookie === 'function') raw = headers.getSetCookie();
  else { const v = headerOf(headers, 'set-cookie'); raw = v == null ? [] : Array.isArray(v) ? v : [v]; }
  const names = [];
  for (const c of raw.flatMap((x) => String(x).split(/,(?=\s*[\w.-]+=)/))) {
    const n = c.trim().match(/^([\w.~!#$%&'*+^`|-]{1,64})=/)?.[1];
    if (n && !names.includes(n)) names.push(n);
  }
  return names.slice(0, MAX_COOKIES);
}

// Primeiros caracteres do texto visível (sem script/style/tags), espaços colapsados, para reconhecer a página de bloqueio.
export function bodyHead(text, n = MAX_HEAD) {
  if (!text) return null;
  return clip(String(text).slice(0, 64 * 1024).replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<!--[\s\S]*?-->/g, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' '), n);
}

const has = (s, re) => !!s && re.test(s);
const allHeaderNames = (headers) => {
  if (!headers) return [];
  if (typeof headers.keys === 'function') return [...headers.keys()].map((k) => String(k).toLowerCase());
  return Object.keys(headers).map((k) => k.toLowerCase());
};

/**
 * Classifica quem barrou: cloudflare | akamai | datadome | perimeterx | imperva | sucuri | aws-waf | generic-403 |
 * timeout | dns | tls | unknown. Entrada: { status, headers, body, code } (code = código de rede: TIMEOUT, ENOTFOUND…).
 * Resposta de sucesso (2xx sem marcador de desafio) também é 'unknown': o campo só faz sentido numa falha.
 */
export function wafOf({ status = null, headers = null, body = '', code = null } = {}) {
  const c = String(code || '').toUpperCase();
  if (c === 'TIMEOUT' || c === 'ETIMEDOUT' || c === 'UND_ERR_CONNECT_TIMEOUT' || c === 'UND_ERR_HEADERS_TIMEOUT') return 'timeout';
  if (c === 'ENOTFOUND' || c === 'EAI_AGAIN' || c === 'EAI_NONAME') return 'dns';
  if (/CERT|SSL|TLS|DEPTH_ZERO|SELF_SIGNED/.test(c)) return 'tls';
  const server = (headerOf(headers, 'server') || '').toLowerCase();
  const names = allHeaderNames(headers);
  const cookies = cookieNames(headers).map((x) => x.toLowerCase());
  const head = String(body || '').slice(0, 64 * 1024);
  if (server.includes('cloudflare') || names.includes('cf-ray') || names.includes('cf-mitigated') || has(head, /cf-chl|challenge-platform|cf_chl_opt|just a moment\.\.\./i)) return 'cloudflare';
  if (server.includes('akamai') || names.some((n) => n.startsWith('x-akamai')) || cookies.some((n) => n === 'ak_bmsc' || n === 'bm_sz' || n === '_abck') || has(head, /akamai|reference #\d+\.[0-9a-f]+\./i)) return 'akamai';
  if (names.some((n) => n.startsWith('x-datadome')) || cookies.includes('datadome') || has(head, /captcha-delivery\.com|datadome/i)) return 'datadome';
  if (names.some((n) => n.startsWith('x-px')) || cookies.some((n) => n.startsWith('_px')) || has(head, /px-captcha|perimeterx|_pxhd|human security/i)) return 'perimeterx';
  if (names.includes('x-iinfo') || /incapsula|imperva/.test((headerOf(headers, 'x-cdn') || '').toLowerCase()) || cookies.some((n) => n.startsWith('visid_incap') || n.startsWith('incap_ses')) || has(head, /incapsula|imperva/i)) return 'imperva';
  if (server.includes('sucuri') || names.some((n) => n.startsWith('x-sucuri')) || has(head, /sucuri/i)) return 'sucuri';
  if (names.includes('x-amzn-waf-action') || names.includes('x-amzn-requestid') && status === 403 || cookies.some((n) => n.startsWith('aws-waf-token')) || has(head, /awswaf|aws-waf|challenge\.js.*token\.awswaf/i)) return 'aws-waf';
  if (status === 403 || status === 401) return 'generic-403';
  return 'unknown';
}

/**
 * Plataforma reconhecida pelos marcadores da resposta (cabeçalhos e HTML): vtex | shopify | nuvemshop | tray |
 * lojaintegrada | woocommerce | magento | null. Serve para o relatório e para saber qual adaptador tentar.
 */
export function platformHintOf({ headers = null, body = '', url = '' } = {}) {
  const names = allHeaderNames(headers);
  const powered = (headerOf(headers, 'x-powered-by') || '').toLowerCase();
  const head = String(body || '').slice(0, 256 * 1024);
  const u = String(url || '');
  if (names.some((n) => n.startsWith('x-vtex')) || powered.includes('vtex') || /vteximg\.com\.br|vtexassets\.com|__RUNTIME__|vtex\.com\.br/i.test(head)) return 'vtex';
  if (names.some((n) => n === 'x-shopify-stage' || n === 'x-shopid' || n.startsWith('x-sorting-hat')) || powered.includes('shopify') || /cdn\.shopify\.com|Shopify\.theme|myshopify\.com/i.test(head) || /myshopify\.com$/i.test(u)) return 'shopify';
  if (/LS\.product\s*=|nuvemshop|tiendanube|lojavirtualnuvem|cdn\.nuvem\.com/i.test(head)) return 'nuvemshop';
  if (/tray\.com\.br|trayecommerce|tcdn\.com\.br|Tray Commerce/i.test(head)) return 'tray';
  if (/lojaintegrada\.com\.br|cdn\.awsli\.com\.br|awsli\.com\.br/i.test(head)) return 'lojaintegrada';
  if (/woocommerce|wp-content\/plugins\/woocommerce/i.test(head)) return 'woocommerce';
  if (names.some((n) => n.startsWith('x-magento')) || /Magento_|\/static\/version\d+\/|mage\/(requirejs|cookies)/i.test(head)) return 'magento';
  return null;
}

/**
 * Registro compacto da falha: { at, status, errorCode, elapsedMs, server, cfRay, via, waf, setCookieNames, bodyHead }.
 * cfRay: só presença (8 primeiros caracteres), nunca o valor inteiro. setCookieNames: só nomes. Sem valor de cookie,
 * sem query, sem token. Cabe em poucas centenas de bytes.
 */
export function forensicsOf({ status = null, headers = null, body = '', code = null, at = new Date().toISOString(), elapsedMs = null } = {}) {
  const cfRay = headerOf(headers, 'cf-ray');
  return {
    at, status: Number.isInteger(status) && status > 0 ? status : null, errorCode: code || null,
    elapsedMs: Number.isFinite(elapsedMs) ? Math.round(elapsedMs) : null,
    server: clip(headerOf(headers, 'server'), MAX_HDR), cfRay: cfRay ? String(cfRay).slice(0, 8) : null, via: clip(headerOf(headers, 'via'), MAX_HDR),
    waf: wafOf({ status, headers, body, code }), setCookieNames: cookieNames(headers), bodyHead: bodyHead(body),
  };
}

// Dica de plataforma por host, observada nas respostas de sucesso (sem requisição extra): run.js lê depois da coleta.
const hints = new Map();
export function notePlatform(host, hint) { if (host && hint) hints.set(String(host).toLowerCase(), hint); }
export function platformHintFor(hostOrUrl) {
  let host = String(hostOrUrl || '').toLowerCase();
  try { host = new URL(/^https?:\/\//.test(host) ? host : 'https://' + host).host; } catch { /* já é host */ }
  return hints.get(host) ?? hints.get(host.replace(/^www\./, '')) ?? hints.get('www.' + host) ?? null;
}
export const _resetPlatformHints = () => hints.clear();

/** O que vai para sources.json: a forense que o HTTP anexou ao erro ou, sem resposta, o código de rede classificado. */
// `code` é o código de rede já extraído pelo chamador (netCode(e) do http.js), para este módulo não depender dele.
export function lastFailureOf(e, { at = new Date().toISOString(), elapsedMs = null, code = null } = {}) {
  if (e?.forensics && typeof e.forensics === 'object') return { ...e.forensics, at, elapsedMs: e.forensics.elapsedMs ?? (Number.isFinite(elapsedMs) ? Math.round(elapsedMs) : null) };
  const st = e?.httpStatus ?? e?.status;
  return forensicsOf({ status: Number.isInteger(st) ? st : null, code: code || (typeof e?.code === 'string' ? e.code : null), at, elapsedMs });
}
