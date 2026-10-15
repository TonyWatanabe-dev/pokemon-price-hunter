// Social Media — links de afiliado por anúncio informados como links curtos (meli.la) (#690). Cada link é seguido até
// a página do anúncio para descobrir o id MLB; o resultado entra no mapa `anuncios` usado por linkDe() nos bots.
// Só leitura (GET/redirect); falhas são ignoradas (o post usa a URL da loja). Nada muda ranking, preço ou nota.
import fs from 'node:fs';
import { mlListingId, validDestination } from '../../../api/_lib/affiliates.mjs';

export const ARQUIVO = new URL('../../../config/social-afiliados-links.json', import.meta.url);

export function lerLinks(arquivo = ARQUIVO) {
  try {
    const raw = JSON.parse(fs.readFileSync(arquivo, 'utf8'));
    return [...new Set((Array.isArray(raw?.links) ? raw.links : []).filter((l) => validDestination(l) && new URL(l).hostname === 'meli.la'))];
  } catch { return []; }
}

const ID_NO_HTML = /item_id(?:%3A|:|"\s*:\s*")(MLB\d{6,15})|"(?:item_id|id)"\s*:\s*"(MLB\d{6,15})"/i;

/** Segue o link curto (até 6 redirecionamentos, sem executar nada) e devolve o id MLB do anúncio, ou null. */
export async function idDoLink(link, fetchFn, { timeoutMs = 10000 } = {}) {
  let url = link;
  for (let i = 0; i < 6; i++) {
    const id = mlListingId(url);
    if (id) return id;
    let r;
    try { r = await fetchFn(url, { redirect: 'manual', signal: AbortSignal.timeout(timeoutMs), headers: { 'user-agent': 'TCGPriceHunterBot/1.0' } }); } catch { return null; }
    const loc = r.headers?.get?.('location');
    if (r.status >= 300 && r.status < 400 && loc) { url = new URL(loc, url).href; continue; }
    if (r.ok) { try { const m = (await r.text()).match(ID_NO_HTML); return m ? (m[1] || m[2]).toUpperCase() : null; } catch { return null; } }
    return null;
  }
  return null;
}

/** afiliados (de loadAffiliates) + links curtos resolvidos → novo objeto com `anuncios` ampliado. Não sobrescreve id já configurado. */
export async function comLinksSociais(afiliados, fetchFn, { links = lerLinks() } = {}) {
  const anuncios = { ...(afiliados?.anuncios || {}) };
  for (const l of links) {
    const id = await idDoLink(l, fetchFn);
    if (id && !anuncios[id]) anuncios[id] = l;
  }
  return { ...(afiliados || {}), anuncios };
}
