// Seleciona, na saída de uma rodada (state.json), os casos de matching que merecem revisão humana.
// Determinístico e conservador: só entra o que tem evidência de ser produto Pokémon TCG do catálogo
// com uma dúvida específica. "Coleção não identificada" fica de fora (ruído: a maioria não é produto lacrado).
// Nada aqui altera oferta, preço ou score: o resultado vira job review.propose.
import { createHash } from 'node:crypto';
import { parseListing, canonicalUrl } from '../match.js';
import { buildEvidence } from './evidence.js';
export { canonicalUrl };

// Motivo de recusa → tipo de revisão. Só esses motivos, e só quando forem o ÚNICO motivo.
const REASONS = [
  [/^tipo de produto não identificado$/, 'tipo_desconhecido'],
  [/^quantidade de boosters não informada$/, 'boosters_desconhecidos'],
  [/^mais de uma coleção no título/, 'colecao_ambigua'],
  [/^EAN diverge do catálogo$/, 'ean_divergente'],
];
export const LOW_CONFIDENCE_MAX = 0.6; // oferta aceita com as duas deduções do matching (coleção por apelido e boosters inferidos)

const hash = (s) => createHash('sha1').update(s).digest('hex').slice(0, 16);
const keyOf = (kind, store, url) => `matching:${kind}:${store}:${hash(canonicalUrl(url))}`;
const parsedOf = (title, catalog) => {
  if (!catalog?.collections) return undefined;
  const p = parseListing(title, catalog);
  return { collection: p.collection, type: p.type, boosters: p.boosters };
};

// Cada candidato leva `proposal.evidence` (contrato em ./evidence.js): fonte, URL, motivo, base
// (observado/inferido) e horário da leitura. Sem evidência válida, o caso não vira proposta.
// O horário vem da própria fonte (generatedAt da rodada para recusas; source_timestamp para ofertas);
// se faltar, não é inventado: a evidência sai 'incompleta'.
export function reviewCandidates(state, { catalog = null, limit = 25, maxConfidence = LOW_CONFIDENCE_MAX, now = Date.now() } = {}) {
  const out = []; const seen = new Set();
  const push = (kind, store, url, entity, proposal, evidenceIn, confidence = null) => {
    if (!store || !url) return;
    const ev = buildEvidence({ url, ...evidenceIn }, { now });
    if (!ev.ok) return;
    const dedupeKey = keyOf(kind, store, url);
    if (seen.has(dedupeKey)) return;
    seen.add(dedupeKey);
    out.push({ idempotencyKey: `review:${dedupeKey}`, payload: { category: 'matching', ...entity, confidence, dedupeKey, proposal: { kind, store, url, ...proposal, evidence: ev.evidence } } });
  };

  for (const u of state?.unmatched || []) {
    const why = Array.isArray(u.why) ? u.why : [];
    if (why.length !== 1) continue;
    const kind = REASONS.find(([re]) => re.test(why[0]))?.[1];
    if (!kind) continue;
    push(kind, u.store, u.url, { entityType: 'listing', entityId: canonicalUrl(u.url).slice(0, 100) },
      { title: String(u.title || '').slice(0, 300), why: why[0].slice(0, 200), parsed: parsedOf(u.title || '', catalog) },
      { source: 'state.unmatched', reason: why[0], basis: 'observado', observedAt: state?.generatedAt });
  }
  for (const o of state?.offers || []) {
    if (!(typeof o.matchConfidence === 'number' && o.matchConfidence <= maxConfidence) || !o.productId) continue;
    push('baixa_confianca', o.storeId, o.url, { entityType: 'offer', entityId: String(o.id).slice(0, 100) },
      { title: String(o.title || '').slice(0, 300), productId: o.productId, matchConfidence: o.matchConfidence },
      { source: 'state.offers', reason: `matching aceito com confiança ${o.matchConfidence} (até ${maxConfidence})`, basis: 'inferido', observedAt: o.source_timestamp },
      Math.round(o.matchConfidence * 100));
  }
  return out.slice(0, limit);
}
