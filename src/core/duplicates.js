// Candidatos a produto duplicado, com evidências e score explicável. Função pura: não lê nem grava banco.
// Nunca funde: o resultado é sempre "needs_review" e vira item da fila de revisão (category duplicate_product),
// onde uma pessoa decide e o motivo fica registrado (review_item.decision_reason + system_event).
// Coleção, tipo, boosters, variante ou idioma diferentes são bloqueios: não geram candidato (a não ser com EAN igual,
// que é conflito de cadastro e entra marcado como ambíguo).
import { normalize } from '../match.js';

export const DUP_VERSION = 'dup-candidates-v1';
export const MIN_SCORE = 60;      // abaixo disso não vira candidato
export const AMBIGUOUS_CAP = 50;  // candidato com conflito ou ambiguidade nunca passa deste score

const LANGS = [[/\b(japon[eê]s|japanese|jp)\b/, 'ja'], [/\b(ingl[eê]s|english|en)\b/, 'en'], [/\b(coreano|korean|kr)\b/, 'ko'], [/\b(chin[eê]s|chinese)\b/, 'zh']];
const eanOf = (v) => String(v || '').replace(/\D/g, '').replace(/^0+/, '');
const langOf = (p) => p.language || (LANGS.find(([re]) => re.test(normalize(`${p.name || ''} ${p.id || ''}`)))?.[1]) || 'pt';
const keyOf = (a, b) => [a.id, b.id].sort().join('|');

/** Compara um par. Devolve null se não há motivo para suspeitar; senão o candidato com evidências e bloqueios. */
export function scorePair(a, b, collectionName = (id) => id) {
  const evidence = []; const blockers = [];
  const add = (code, points, detail) => evidence.push({ code, points, detail });
  const sameEan = !!eanOf(a.ean) && eanOf(a.ean) === eanOf(b.ean);
  const eanConflict = !!eanOf(a.ean) && !!eanOf(b.ean) && !sameEan;

  if (a.type !== b.type) blockers.push(`tipo diferente: ${a.type} × ${b.type}`);
  if ((a.boosters ?? null) !== (b.boosters ?? null)) blockers.push(`boosters diferentes: ${a.boosters ?? '?'} × ${b.boosters ?? '?'}`);
  if ((a.variant ?? null) !== (b.variant ?? null)) blockers.push(`variante diferente: ${a.variant ?? '-'} × ${b.variant ?? '-'}`);
  if (langOf(a) !== langOf(b)) blockers.push(`idioma diferente: ${langOf(a)} × ${langOf(b)}`);
  if (a.collection === b.collection) add('MESMA_COLECAO', 30, a.collection);
  else {
    const na = normalize(collectionName(a.collection)); const nb = normalize(collectionName(b.collection));
    if (na && na === nb) add('COLECAO_MESMO_NOME_CODIGO_DIFERENTE', 25, `${a.collection} × ${b.collection}: "${collectionName(a.collection)}"`);
    else blockers.push(`coleção diferente: ${a.collection} × ${b.collection}`);
  }
  if (!blockers.length) add('MESMO_TIPO_BOOSTERS_VARIANTE', 40, `${a.type}${a.boosters ? ' ' + a.boosters : ''}${a.variant ? ' ' + a.variant : ''}`);
  if (sameEan) add('MESMO_EAN', 30, eanOf(a.ean));
  if (a.name && b.name && normalize(a.name) === normalize(b.name)) add('MESMO_NOME', 10, a.name);

  if (!blockers.length && !sameEan && evidence.every((e) => e.code === 'MESMO_NOME')) return null;
  if (blockers.length && !sameEan) return null; // sem EAN em comum, divergência de coleção/tipo/idioma descarta o par
  const ambiguity = [...blockers.map((x) => `conflito com EAN igual: ${x}`)];
  if (eanConflict) { add('EAN_DIVERGENTE', -30, `${eanOf(a.ean)} × ${eanOf(b.ean)}`); ambiguity.push('EANs diferentes'); }
  let score = Math.max(0, Math.min(100, evidence.reduce((s, e) => s + e.points, 0)));
  if (ambiguity.length) score = Math.min(score, AMBIGUOUS_CAP);
  return { a: a.id, b: b.id, score, evidence, blockers, ambiguity };
}

/** Todos os candidatos a duplicata. `autoMerge` é sempre false; ambiguidade (incluindo produto em vários pares) exige decisão humana. */
export function duplicateCandidates(products, { collections = [], minScore = MIN_SCORE } = {}) {
  const names = new Map(collections.map((c) => [c.id, c.name]));
  for (const p of products) if (p.collectionName && !names.has(p.collection)) names.set(p.collection, p.collectionName);
  const nameOf = (id) => names.get(id) || id;
  const list = []; const seenId = new Set();
  for (const p of products || []) { if (p?.id && !seenId.has(p.id)) { seenId.add(p.id); list.push(p); } }
  const out = [];
  for (let i = 0; i < list.length; i++) for (let j = i + 1; j < list.length; j++) {
    const c = scorePair(list[i], list[j], nameOf);
    if (c && c.score >= minScore) out.push(c);
    else if (c && c.ambiguity.length) out.push(c); // conflito de cadastro sempre aparece, mesmo com score baixo
  }
  const degree = new Map();
  for (const c of out) for (const id of [c.a, c.b]) degree.set(id, (degree.get(id) || 0) + 1);
  for (const c of out) {
    if (degree.get(c.a) > 1 || degree.get(c.b) > 1) { c.ambiguity.push('produto aparece em mais de um candidato'); c.score = Math.min(c.score, AMBIGUOUS_CAP); }
    c.ambiguous = c.ambiguity.length > 0; c.decision = 'needs_review'; c.autoMerge = false;
  }
  return out.sort((x, y) => y.score - x.score || keyOf({ id: x.a }, { id: x.b }).localeCompare(keyOf({ id: y.a }, { id: y.b })));
}

/** Itens para a fila de revisão. dedupe_key estável e independente da ordem do par: repetir não duplica. */
export function duplicateReviewItems(candidates) {
  return candidates.map((c) => {
    const pair = [c.a, c.b].sort();
    return { category: 'duplicate_product', entityType: 'product_pair', entityId: pair.join('|').slice(0, 100), confidence: c.score,
      dedupeKey: `dupcand:${pair.join('|')}`.slice(0, 200),
      proposal: { version: DUP_VERSION, products: pair, score: c.score, evidence: c.evidence, blockers: c.blockers, ambiguity: c.ambiguity, ambiguous: c.ambiguous, autoMerge: false,
        reason: c.evidence.map((e) => `${e.code} (${e.points > 0 ? '+' : ''}${e.points})`).join(', ') } };
  });
}
