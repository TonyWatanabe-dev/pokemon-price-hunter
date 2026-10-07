// Trava de publicação: o link do anúncio precisa falar do mesmo produto que o título.
// Pega tema de loja que mostra outro produto, vitrine "relacionados" e anúncio com título trocado.
import { parseListing } from './match.js';

const slugText = (url) => {
  try {
    const u = new URL(url);
    return decodeURIComponent(u.pathname).replace(/\.[a-z]{2,5}$/i, '').replace(/\/p$/i, '').split('/').filter(Boolean).pop()
      .replace(/[-_]+/g, ' ').replace(/\b[a-z0-9]{5}$/i, (m) => (/\d/.test(m) && /[a-z]/i.test(m) ? '' : m));
  } catch { return ''; }
};

export function linkAgrees(listing, match, catalog) {
  const s = slugText(listing.url);
  if (!s || s.split(' ').length < 3) return { ok: true }; // link sem nome (ex.: /p/12345): nada a comparar
  // "ev3-5" / "me2-5" / "violeta-3-5" no link = 3.5 / 2.5
  const fromLink = parseListing('pokemon ' + s.replace(/(\b(?:ev|sv|me|violeta|evolucao)\s?\d{1,2}) 5\b/g, '$1.5'), catalog);
  const t = match.parsed;
  if (fromLink.collection && !fromLink.collectionFallback && t.collection && fromLink.collection !== t.collection) return { ok: false, why: `link é de outra coleção (${fromLink.collection}) que o título (${t.collection})` };
  if (fromLink.type && t.type && fromLink.type !== t.type) {
    const sameFamily = (a, b) => [a, b].every((x) => /^colecao/.test(x)); // "box greninja ex" x "box coleção greninja ex"
    if (!sameFamily(fromLink.type, t.type)) return { ok: false, why: `link é de outro formato (${fromLink.type}) que o título (${t.type})` };
  }
  return { ok: true };
}
