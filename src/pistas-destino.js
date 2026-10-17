// Destino limpo das pistas (decisão do dono, 17/10/2026): o botão de uma pista não pode levar ao link de afiliado de
// quem postou no canal. O robô segue o link curto do post (meli.la, s.shopee.com.br, link.amazon…) só até descobrir o
// anúncio de destino e guarda o anúncio sem parâmetro nenhum: { loja, id, url }. O site troca pelo link do dono quando
// ele existe (config de afiliados) e, senão, usa essa URL limpa. Nada aqui lê config de afiliado nem monta tag.
// Só redirecionamentos (GET sem seguir, como resolverLink de src/pistas-ofertas.js); a página do ML /social/ é lida
// por resolverLink. Nunca lança.
import { assertSafeUrl } from './urlguard.js';
import { resolverLink, mlbDeUrl, catalogoDeUrl, ehLinkML } from './pistas-ofertas.js';

const UA = process.env.HUNTER_UA || 'PokeHunterBR/1.0 (monitor pessoal de precos; respeita robots.txt)';
const MAX_SALTOS = 6;
const TIMEOUT_MS = 10000;
export const VERSAO = 1;
export const REVALIDAR_DIAS = 7;

const host = (u) => { try { return new URL(u).hostname.toLowerCase().replace(/^www\./, ''); } catch { return ''; } };

/** URL já no destino → { loja, id, url limpa } ou null. */
export function destinoDeUrl(url) {
  const h = host(url); let u; try { u = new URL(url); } catch { return null; }
  if (/(^|\.)mercadoli(?:vre\.com\.br|bre\.com)$/.test(h)) {
    const mlb = mlbDeUrl(url); if (mlb) return { loja: 'mercadolivre', id: mlb, url: `https://produto.mercadolivre.com.br/MLB-${mlb.slice(3)}-_JM` };
    const cat = catalogoDeUrl(url); if (cat) return { loja: 'mercadolivre', id: cat, url: `https://www.mercadolivre.com.br/p/${cat}` };
    return null;
  }
  if (h === 'shopee.com.br') {
    const m = u.pathname.match(/^\/product\/(\d+)\/(\d+)/) || u.pathname.match(/-i\.(\d+)\.(\d+)(?:$|[/?])/) || u.pathname.match(/\/(\d{5,})\/(\d{6,})(?:$|[/?])/);
    return m ? { loja: 'shopee', id: `${m[1]}/${m[2]}`, url: `https://shopee.com.br/product/${m[1]}/${m[2]}` } : null;
  }
  if (h === 'amazon.com.br') {
    const m = u.pathname.match(/\/(?:dp|gp\/product|gp\/aw\/d)\/([A-Z0-9]{10})(?:$|[/?])/i);
    return m ? { loja: 'amazon', id: m[1].toUpperCase(), url: `https://www.amazon.com.br/dp/${m[1].toUpperCase()}` } : null;
  }
  return null;
}

/** Segue o link do post até o anúncio. { loja, id, url } ou { erro }. */
export async function resolverDestino(url, { fetch = globalThis.fetch, timeoutMs = TIMEOUT_MS } = {}) {
  const direto = destinoDeUrl(url); if (direto) return direto;
  if (ehLinkML(url)) {   // meli.la e /social/: mesma leitura já usada para conferir a pista na API do ML
    const r = await resolverLink(url, { fetch, timeoutMs });
    if (r.mlb) return destinoDeUrl(`https://produto.mercadolivre.com.br/${r.mlb}`);
    if (r.catalogo) return destinoDeUrl(`https://www.mercadolivre.com.br/p/${r.catalogo}`);
    return { erro: r.erro || 'link sem anúncio' };
  }
  let cur = String(url || '');
  try {
    for (let hop = 0; hop < MAX_SALTOS; hop++) {
      assertSafeUrl(cur);
      const res = await fetch(cur, { method: 'GET', redirect: 'manual', headers: { 'user-agent': UA, accept: 'text/html' }, signal: AbortSignal.timeout(timeoutMs) });
      try { await res?.body?.cancel?.(); } catch { /* sem corpo */ }
      const loc = res && res.status >= 300 && res.status < 400 ? res.headers?.get?.('location') : null;
      if (!loc) return destinoDeUrl(res?.url || cur) || { erro: `sem redirecionamento (${res?.status ?? '?'})` };
      cur = new URL(loc, cur).href;
      const d = destinoDeUrl(cur); if (d) return d;
    }
    return { erro: 'muitos redirecionamentos' };
  } catch (e) {
    if (e?.unsafe) return { erro: 'destino inválido' };
    return { erro: String(e?.code || e?.message || e?.name || e).slice(0, 60) };
  }
}

/** Pistas que precisam de destino: sem destino, de versão antiga, ou com erro/destino mais velho que REVALIDAR_DIAS. */
export function pistasSemDestino(tipStore, { now = new Date(), max = 30 } = {}) {
  const limite = now.getTime() - REVALIDAR_DIAS * 864e5;
  return Object.values(tipStore || {}).filter((t) => t && typeof t.url === 'string' && !t.expired
    && (!t.destino || t.destino.versao !== VERSAO || (t.destino.erro && Date.parse(t.destino.at) < limite))).slice(0, max);
}

/** Resolve até `max` pistas e grava t.destino = { at, versao, loja, id, url } ou { at, versao, erro }. */
export async function destinosPistas(tipStore, { fetch = globalThis.fetch, now = new Date(), max = 30, log = () => {} } = {}) {
  let ok = 0; let erro = 0;
  for (const t of pistasSemDestino(tipStore, { now, max })) {
    // pista do ML já conferida na API: o id do anúncio já é conhecido, não precisa de rede
    const r = t.verificada?.mlb ? destinoDeUrl(`https://produto.mercadolivre.com.br/${t.verificada.mlb}`) : await resolverDestino(t.url, { fetch });
    t.destino = { at: now.toISOString(), versao: VERSAO, ...(r && !r.erro ? { loja: r.loja, id: r.id, url: r.url } : { erro: r?.erro || 'sem destino' }) };
    if (t.destino.erro) erro++; else ok++;
  }
  if (ok || erro) log(`[pistas] destino limpo: ${ok} resolvidas, ${erro} sem destino`);
  return { ok, erro };
}
