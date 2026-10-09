// Fila de revisão humana (review_item): listar, aprovar, rejeitar ou descartar, com autor, data,
// motivo e evento REVIEW_DECIDED na mesma transação (padrão da migration 003).
// Decisão é comparação atômica sobre status = 'open' (SELECT ... FOR UPDATE): duas decisões
// simultâneas nunca valem as duas; repetir a mesma decisão não gera segundo evento.
// Aprovar só grava uma resolução validada contra o catálogo. Nada aqui toca em oferta, preço,
// score, ranking ou oportunidade; o matching só usa a resolução via config/matching-overrides.json.
import { TYPE_LABEL, productIdOf, normalize, canonicalUrl } from '../match.js';

export const DECISIONS = { approve: 'approved', reject: 'rejected', dismiss: 'dismissed' };
const APPROVABLE = new Set(['matching']); // categorias com caminho validado para a aprovação

export class ReviewError extends Error {
  constructor(code, message, extra = {}) { super(message); this.code = code; Object.assign(this, extra); }
}

/** actor: { userId } (app_user com permissão no banco) ou { github } (login na lista de operadores). */
export async function authorize(c, actor, permission, { operators = [] } = {}) {
  if (actor?.userId) {
    const { rows } = await c.query(
      `SELECT u.id, coalesce(u.display_name, u.email, u.external_uid) AS label FROM app_user u
         JOIN user_role ur ON ur.user_id = u.id JOIN role_permission rp ON rp.role_id = ur.role_id
        WHERE u.id = $1 AND rp.permission_id = $2 LIMIT 1`, [actor.userId, permission]);
    if (!rows[0]) throw new ReviewError('forbidden', `usuário sem permissão ${permission}`);
    return { userId: rows[0].id, label: `user:${rows[0].label}` };
  }
  if (actor?.github) {
    const login = String(actor.github).trim().toLowerCase();
    if (login && operators.map((o) => String(o).trim().toLowerCase()).filter(Boolean).includes(login)) return { userId: null, label: `github:${login}` };
    throw new ReviewError('forbidden', `${actor.github} não está na lista de operadores de revisão`);
  }
  throw new ReviewError('forbidden', 'autor da decisão não identificado');
}

/** Resolução de matching: produto do catálogo, com id derivado (nunca digitado). Retorna erro em texto ou null. */
export function validateResolution(item, res, catalog) {
  if (!res || typeof res !== 'object') return 'resolução obrigatória para aprovar (coleção e tipo)';
  if (!catalog?.collections?.some((c) => c.id === res.collection)) return `coleção desconhecida: ${res.collection}`;
  if (!TYPE_LABEL[res.type]) return `tipo desconhecido: ${res.type}`;
  if (res.boosters != null && !(Number.isInteger(res.boosters) && res.boosters > 0 && res.boosters <= 36)) return 'boosters deve ser inteiro de 1 a 36';
  if (res.type === 'booster_box' && !res.boosters) return 'booster box exige a quantidade de boosters';
  if (res.variant != null && !/^[a-z0-9-]{1,40}$/.test(res.variant)) return 'variante inválida';
  const parsed = item?.proposal?.parsed?.collection;
  if (parsed && parsed !== res.collection) return `coleção diverge do anúncio (${parsed} ≠ ${res.collection})`;
  const known = item?.proposal?.productId;
  if (known && !String(known).startsWith(`${res.collection}-`)) return `coleção diverge da oferta (${known})`;
  return null;
}
export const resolutionProduct = (r) => productIdOf(r.collection, r.type, r.boosters ?? null, r.variant ?? null);

export async function listPending(c, { category = null, limit = 50 } = {}) {
  const { rows } = await c.query(
    `SELECT id, category, entity_type, entity_id, confidence, dedupe_key, proposal, created_at FROM review_item
      WHERE status = 'open' AND ($1::text IS NULL OR category = $1) ORDER BY created_at, id LIMIT $2`, [category, limit]);
  return rows.map((r) => ({ ...r, id: String(r.id) }));
}

/** Agrupa pendentes que pedem a mesma decisão: mesmo título (outra loja), mesma página em tipos diferentes, mesmo produto com baixa confiança. */
export function triage(items) {
  const groups = new Map();
  const add = (key, it) => { if (!groups.has(key)) groups.set(key, []); groups.get(key).push(it.id); };
  for (const it of items) {
    const p = it.proposal || {};
    if (p.title) add(`título: ${normalize(p.title).replace(/\s+/g, ' ').trim()}`, it);
    if (p.url && p.store) add(`página: ${p.store} ${canonicalUrl(p.url)}`, it);
    if (p.kind === 'baixa_confianca' && p.productId) add(`produto: ${p.productId}`, it);
  }
  return [...groups].filter(([, ids]) => ids.length > 1).map(([key, ids]) => ({ key, ids }));
}

export async function decideReview(c, { id, decision, reason, actor, resolution = null, catalog = null, operators = [], now = new Date(), source = 'review' }) {
  const to = DECISIONS[decision];
  if (!to) throw new ReviewError('invalid', `decisão desconhecida: ${decision}`);
  const why = String(reason ?? '').trim();
  if (why.length < 3 || why.length > 500) throw new ReviewError('invalid', 'motivo obrigatório (3 a 500 caracteres)');
  if (!/^\d+$/.test(String(id))) throw new ReviewError('invalid', `id inválido: ${id}`);
  const who = await authorize(c, actor, 'review.decide', { operators });

  const { rows: [item] } = await c.query(`SELECT * FROM review_item WHERE id = $1 FOR UPDATE`, [id]);
  if (!item) throw new ReviewError('not_found', `revisão ${id} não existe`);

  let res = null;
  if (to === 'approved') {
    if (!APPROVABLE.has(item.category)) throw new ReviewError('invalid', `aprovação de "${item.category}" ainda não tem caminho validado; use reject ou dismiss`);
    const err = validateResolution(item, resolution, catalog);
    if (err) throw new ReviewError('invalid_resolution', err);
    res = { collection: resolution.collection, type: resolution.type, boosters: resolution.boosters ?? null, variant: resolution.variant ?? null };
    res.productId = resolutionProduct(res);
  }

  if (item.status !== 'open') {
    const same = item.status === to && (to !== 'approved' || item.resolution?.productId === res.productId);
    if (same) return { changed: false, item: { ...item, id: String(item.id) } };
    throw new ReviewError('already_decided', `revisão ${id} já foi decidida (${item.status} por ${item.decided_by_label || item.decided_by || '?'})`, { current: item.status });
  }

  const { rows: [up] } = await c.query(
    `UPDATE review_item SET status = $2, decided_at = $3, decision_reason = $4, decided_by = $5, decided_by_label = $6, resolution = $7::jsonb
      WHERE id = $1 AND status = 'open' RETURNING *`,
    [id, to, now, why, who.userId, who.label, res ? JSON.stringify(res) : null]);
  if (!up) throw new ReviewError('already_decided', `revisão ${id} foi decidida por outro processo`);
  await c.query(`INSERT INTO system_event (type, entity_type, entity_id, payload) VALUES ('REVIEW_DECIDED', 'review_item', $1, $2::jsonb)`,
    [String(id), JSON.stringify({ category: item.category, kind: item.proposal?.kind ?? null, from_status: 'open', to_status: to, reason: why, decided_by: who.label, resolution: res, source })]);
  return { changed: true, item: { ...up, id: String(up.id) } };
}

/** Aprovações de matching → entradas de config/matching-overrides.json (revalidadas; inválidas ficam de fora). */
export async function approvedOverrides(c, catalog) {
  const { rows } = await c.query(
    `SELECT id, proposal, resolution, decided_at, decided_by_label FROM review_item
      WHERE category = 'matching' AND status = 'approved' AND resolution IS NOT NULL ORDER BY id`);
  const out = []; const skipped = [];
  for (const r of rows) {
    const p = r.proposal || {};
    const err = !p.store || !p.url ? 'sem loja ou página' : validateResolution(r, r.resolution, catalog)
      || (resolutionProduct(r.resolution) !== r.resolution.productId ? 'productId não confere' : null);
    if (err) { skipped.push({ id: String(r.id), err }); continue; }
    out.push({ store: p.store, url: canonicalUrl(p.url), productId: r.resolution.productId, collection: r.resolution.collection, type: r.resolution.type,
      boosters: r.resolution.boosters, variant: r.resolution.variant, reviewId: String(r.id), decidedAt: new Date(r.decided_at).toISOString(), decidedBy: r.decided_by_label });
  }
  return { overrides: out, skipped };
}
