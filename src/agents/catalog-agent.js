// Catalog Agent (Fase 7, item 6) — SÓ PROPOSTA. Lê produtos/ofertas publicados (state.json) e o catálogo, e devolve
// propostas de normalização e possíveis duplicatas de produto/oferta, cada uma com evidência estruturada, para revisão
// humana. Determinístico, sem IA, sem rede, sem banco e sem relógio próprio (asOf vem de quem chama).
// Nunca grava: não edita config/catalog.json, não cria review_item, não muda oferta, preço, ranking nem score.
// Toda proposta sai com decision 'needs_review' e autoApply false; conflito (EAN divergente, URL em dois produtos)
// é só listado, nunca resolvido por palpite. Reusa o que já existe:
//   - src/core/duplicates.js      candidatos a produto duplicado (score explicável)
//   - src/core/offer-key.js       chave de dedupe de oferta (loja + vendedor + produto + URL canônica)
//   - src/agents/matching-review.js  casos de matching para revisão (contrato de evidência de ./evidence.js)
import { duplicateCandidates } from '../core/duplicates.js';
import { groupDuplicateOffers, canonicalizeUrl } from '../core/offer-key.js';
import { reviewCandidates } from './matching-review.js';
import { normalize, normEan, detectBoosters } from '../match.js';

export const CATALOG_AGENT_VERSION = 'catalog-agent-v1';
export const MIN_EAN_STORES = 2;      // EAN observado em anúncios só vira proposta forte com 2+ lojas distintas
const SAMPLE = 8;                     // evidências por proposta (o resto é contado, não listado)

const iso = (v) => (typeof v === 'string' && Number.isFinite(Date.parse(v)) ? new Date(v).toISOString() : null);
const ev = (code, detail, { basis = 'observado', source, url = null, observedAt = null } = {}) => ({ code, detail: String(detail).slice(0, 300), basis, source, url, observedAt: iso(observedAt) });
const proposal = (key, kind, subject, { confidence, evidence, suggestion = null, ambiguity = [], note = null }) =>
  ({ key, kind, subject, confidence, decision: 'needs_review', autoApply: false, suggestion, ambiguity, evidence, note });

/** Duplicatas de produto: reaproveita duplicateCandidates e converte as evidências para o formato do relatório. */
function productDuplicates(products, collections) {
  return duplicateCandidates(products, { collections }).map((c) => {
    const pair = [c.a, c.b].sort();
    return proposal(`catalog:produto_duplicado:${pair.join('|')}`, 'produto_duplicado', { products: pair }, {
      confidence: c.score,
      evidence: [...c.evidence.map((e) => ev(e.code, `${e.detail} (${e.points > 0 ? '+' : ''}${e.points})`, { basis: 'inferido', source: 'state.products' })),
        ...c.blockers.map((b) => ev('BLOQUEIO', b, { basis: 'observado', source: 'state.products' }))],
      ambiguity: c.ambiguity,
      suggestion: c.ambiguous ? null : { action: 'revisar_fusao', products: pair },
      note: 'Fusão nunca é automática: decisão humana registrada na fila duplicate_product.',
    });
  });
}

/** Coleção do produto ausente do catálogo: sugere a coleção do catálogo com o mesmo nome, se houver exatamente uma. */
function unknownCollections(products, collections) {
  const known = new Set(collections.map((c) => c.id));
  const byCol = new Map();
  for (const p of products) if (p?.collection && !known.has(p.collection)) (byCol.get(p.collection) || byCol.set(p.collection, []).get(p.collection)).push(p);
  const out = [];
  for (const [col, ps] of [...byCol].sort((a, b) => a[0].localeCompare(b[0]))) {
    const name = ps.find((p) => p.collectionName)?.collectionName || null;
    const same = name ? collections.filter((c) => normalize(c.name) === normalize(name)) : [];
    const ambiguity = same.length > 1 ? [`${same.length} coleções do catálogo com o nome "${name}"`] : [];
    out.push(proposal(`catalog:colecao_fora_do_catalogo:${col}`, 'colecao_fora_do_catalogo', { collection: col, products: ps.map((p) => p.id).sort() }, {
      confidence: same.length === 1 ? 70 : 30,
      evidence: [ev('COLECAO_AUSENTE', `código "${col}" não está em config/catalog.json (${ps.length} produto(s))`, { source: 'state.products' }),
        ...(name ? [ev('NOME_DA_COLECAO', `"${name}"${same.length ? ` = ${same.map((c) => c.id).join(', ')} no catálogo` : ' sem equivalente no catálogo'}`, { basis: 'inferido', source: 'config/catalog.json' })] : [])],
      ambiguity,
      suggestion: same.length === 1 ? { action: 'revisar_codigo_legado', from: col, to: same[0].id } : null,
    }));
  }
  return out;
}

/** EAN dos anúncios casados × EAN do produto. Só propõe com acordo entre lojas; divergência é listada, nunca resolvida. */
function eanProposals(products, offers) {
  const out = [];
  const byProduct = new Map();
  for (const o of offers) if (o?.productId && normEan(o.ean)) (byProduct.get(o.productId) || byProduct.set(o.productId, []).get(o.productId)).push(o);
  const prodById = new Map(products.map((p) => [p.id, p]));
  // EAN → produtos (catálogo + anúncios casados): o mesmo EAN em produtos diferentes é conflito, nunca proposta
  const eanProducts = new Map();
  const note = (e, pid) => { if (e && prodById.has(pid)) (eanProducts.get(e) || eanProducts.set(e, new Set()).get(e)).add(pid); };
  for (const p of products) note(normEan(p.ean), p.id);
  for (const [pid, os] of byProduct) for (const o of os) note(normEan(o.ean), pid);
  for (const [e, pids] of [...eanProducts].sort((a, b) => a[0].localeCompare(b[0]))) {
    if (pids.size < 2) continue;
    const list = [...pids].sort();
    out.push(proposal(`catalog:ean_em_produtos_diferentes:${e}`, 'ean_em_produtos_diferentes', { ean: e, products: list }, {
      confidence: 0,
      evidence: list.slice(0, SAMPLE).map((pid) => {
        const o = (byProduct.get(pid) || []).find((x) => normEan(x.ean) === e);
        return o ? ev('EAN_NO_ANUNCIO', `${pid} ← ${o.storeId}: "${String(o.title || '').slice(0, 100)}"`, { source: 'state.offers', url: o.url, observedAt: o.source_timestamp })
          : ev('EAN_DO_CATALOGO', `${pid}: ${e}`, { source: 'state.products' });
      }),
      ambiguity: [`EAN ${e} aparece em ${list.length} produtos`],
      note: 'Variantes com EAN compartilhado pela loja ou matching errado. Não cadastrar esse EAN em nenhum dos produtos sem fonte oficial.',
    }));
  }
  for (const [pid, os] of [...byProduct].sort((a, b) => a[0].localeCompare(b[0]))) {
    const p = prodById.get(pid); if (!p) continue;
    const eans = new Map();
    for (const o of os) { const e = normEan(o.ean); (eans.get(e) || eans.set(e, new Set()).get(e)).add(o.storeId); }
    const seenEv = new Set();
    const evidence = os.filter((o) => { const k = `${o.storeId}|${normEan(o.ean)}`; if (seenEv.has(k)) return false; seenEv.add(k); return true; })
      .slice(0, SAMPLE).map((o) => ev('EAN_NO_ANUNCIO', `${o.storeId}: ${normEan(o.ean)}`, { source: 'state.offers', url: o.url, observedAt: o.source_timestamp }));
    const cat = normEan(p.ean);
    if (cat) {
      const diverge = [...eans.keys()].filter((e) => e !== cat);
      if (!diverge.length) continue;
      out.push(proposal(`catalog:ean_divergente:${pid}`, 'ean_divergente', { product: pid }, {
        confidence: 0, evidence: [ev('EAN_DO_CATALOGO', cat, { source: 'state.products' }), ...evidence],
        ambiguity: [`anúncios com EAN ${diverge.join(', ')} diferente do catálogo (${cat})`],
        note: 'Conflito: não se resolve por palpite. Conferir o produto (e o matching das ofertas) na fonte oficial.',
      }));
      continue;
    }
    if (eans.size > 1) {
      out.push(proposal(`catalog:ean_divergente:${pid}`, 'ean_divergente', { product: pid }, {
        confidence: 0, evidence, ambiguity: [`anúncios discordam: ${[...eans].map(([e, s]) => `${e} (${[...s].sort().join(', ')})`).join(' × ')}`],
        note: 'Sem EAN no catálogo e anúncios com EANs diferentes: possível matching errado ou variante. Nada a propor.',
      }));
      continue;
    }
    const [[ean, stores]] = [...eans];
    const shared = (eanProducts.get(ean)?.size || 0) > 1;
    const strong = stores.size >= MIN_EAN_STORES && !shared;
    out.push(proposal(`catalog:ean_observado:${pid}`, 'ean_observado', { product: pid }, {
      confidence: strong ? Math.min(90, 50 + 15 * stores.size) : shared ? 10 : 35, evidence,
      ambiguity: [...(stores.size < MIN_EAN_STORES ? ['uma única loja informa o EAN'] : []), ...(shared ? [`o mesmo EAN aparece em outros produtos (${[...eanProducts.get(ean)].filter((x) => x !== pid).sort().join(', ')})`] : [])],
      suggestion: { action: 'conferir_e_cadastrar_ean', ean, stores: [...stores].sort() },
      note: 'EAN lido em anúncios, não em fonte oficial: cadastrar só com a página Copag/fabricante como ean_source.',
    }));
  }
  return out;
}

/** Anúncio casado cujo título declara (explicitamente) outra quantidade de boosters que a do produto. */
function boosterMismatches(products, offers) {
  const prodById = new Map(products.map((p) => [p.id, p]));
  const out = [];
  const byProduct = new Map();
  for (const o of offers) {
    const p = prodById.get(o?.productId); if (!p || p.boosters == null || !o.title) continue;
    const b = detectBoosters(normalize(o.title));
    if (b.count == null || b.inferred || b.count === p.boosters) continue;
    (byProduct.get(p.id) || byProduct.set(p.id, []).get(p.id)).push({ o, count: b.count });
  }
  for (const [pid, rows] of [...byProduct].sort((a, b) => a[0].localeCompare(b[0]))) {
    out.push(proposal(`catalog:contagem_divergente:${pid}`, 'contagem_divergente', { product: pid, offers: rows.map((r) => r.o.id).sort() }, {
      confidence: rows.length > 1 ? 60 : 45,
      evidence: [ev('BOOSTERS_DO_PRODUTO', String(prodById.get(pid).boosters), { source: 'state.products' }),
        ...rows.slice(0, SAMPLE).map(({ o, count }) => ev('BOOSTERS_NO_TITULO', `${o.storeId}: "${String(o.title).slice(0, 120)}" declara ${count}`, { source: 'state.offers', url: o.url, observedAt: o.source_timestamp }))],
      suggestion: { action: 'revisar_matching_das_ofertas' },
      note: 'Título com contagem explícita diferente: o anúncio pode ser outro produto (kit, lote ou outra caixa).',
    }));
  }
  return out;
}

/** Ofertas repetidas (mesma chave de dedupe) e mesma URL da loja casada com produtos diferentes. */
function offerDuplicates(offers) {
  const out = [];
  for (const g of groupDuplicateOffers(offers).duplicates) {
    const ids = g.offers.map((o) => String(o.id)).sort();
    out.push(proposal(`catalog:oferta_duplicada:${ids.join('|')}`.slice(0, 200), 'oferta_duplicada', { offers: ids, store: g.offers[0].storeId, product: g.offers[0].productId }, {
      confidence: g.basis === 'none' ? 0 : 80,
      evidence: [ev('CHAVE_DE_DEDUPE', `${g.basis}: ${g.reason}`, { basis: 'inferido', source: 'core/offer-key' }),
        ...g.offers.slice(0, SAMPLE).map((o) => ev('OFERTA', `${o.id} · ${o.price ?? '?'} · ${o.stock ?? '?'}`, { source: 'state.offers', url: o.url, observedAt: o.source_timestamp }))],
      suggestion: { action: 'revisar_dedupe' },
    }));
  }
  const byUrl = new Map();
  for (const o of offers) {
    const c = canonicalizeUrl(o?.url); if (!c.valid || !o.productId || !o.storeId) continue;
    const k = `${o.storeId}|${c.canonical}`;
    (byUrl.get(k) || byUrl.set(k, []).get(k)).push(o);
  }
  for (const [k, os] of [...byUrl].sort((a, b) => a[0].localeCompare(b[0]))) {
    const prods = [...new Set(os.map((o) => o.productId))].sort();
    if (prods.length < 2) continue;
    out.push(proposal(`catalog:url_em_produtos_diferentes:${k}`.slice(0, 200), 'url_em_produtos_diferentes', { store: os[0].storeId, products: prods, offers: os.map((o) => String(o.id)).sort() }, {
      confidence: 0,
      evidence: os.slice(0, SAMPLE).map((o) => ev('MESMA_URL', `${o.productId} (confiança ${o.matchConfidence ?? '?'}): "${String(o.title || '').slice(0, 120)}"`, { source: 'state.offers', url: o.url, observedAt: o.source_timestamp })),
      ambiguity: ['a mesma página da loja foi casada com produtos diferentes'],
      note: 'Conflito de matching (ou variante na query). Revisar; não escolher um produto automaticamente.',
    }));
  }
  return out;
}

/** Casos de matching: só reaproveita reviewCandidates (já com o contrato de evidência). */
function matchingCases(state, catalog, { limit, now }) {
  return reviewCandidates(state, { catalog, limit, now }).map((c) => {
    const p = c.payload.proposal;
    return proposal(`catalog:${c.payload.dedupeKey}`, 'revisao_matching', { store: p.store, url: p.url, kind: p.kind, product: p.productId ?? null }, {
      confidence: c.payload.confidence, evidence: [{ code: 'EVIDENCIA_MATCHING', detail: p.why || p.title || p.kind, ...p.evidence }],
      suggestion: { action: 'revisar_no_review_mjs', kind: p.kind },
    });
  });
}

/**
 * Pré-requisitos do plano (matching/golden estáveis, evidência, fila, métricas reais), avaliados com o que a chamada recebe.
 * golden: saída de runGolden (src/agents/golden-eval.js) ou null. Status: atendido | parcial | nao_atendido | nao_verificavel.
 */
export function catalogPrerequisites({ golden = null } = {}) {
  const g = golden && typeof golden.total === 'number' ? golden : null;
  return [
    { id: 'golden_matching', status: !g ? 'nao_verificavel' : g.failures.length ? 'nao_atendido' : 'parcial',
      detail: !g ? 'golden não avaliado nesta execução' : `${g.passed}/${g.total} casos SINTÉTICOS ok; ${g.matching.falsePositives} FP, ${g.matching.falseNegatives} FN (não mede produção)` },
    { id: 'contrato_de_evidencia', status: 'atendido', detail: 'src/agents/evidence.js (issue #91) usado pelas propostas de matching' },
    { id: 'fila_de_revisao', status: 'parcial', detail: 'review_item + tools/review.mjs existem; sem tela própria; este agente não grava na fila' },
    { id: 'metricas_falso_positivo_reais', status: 'nao_atendido', detail: 'precisão do matching em dados reais ainda não medida' },
    { id: 'autorizacao_ia', status: 'nao_atendido', detail: 'agente determinístico; IA continua não autorizada' },
  ];
}

/**
 * Relatório completo. state: data/state.json; catalog: config/catalog.json; asOf: horário de referência (ISO/Date).
 * Puro: não lê arquivo, rede, banco nem relógio.
 */
export function catalogReport({ state, catalog, asOf, golden = null, matchingLimit = 25 } = {}) {
  const products = (state?.products || []).filter((p) => p && p.id);
  const offers = (state?.offers || []).filter((o) => o && o.id);
  const collections = catalog?.collections || [];
  const at = asOf ? new Date(asOf) : new Date(state?.generatedAt || NaN);
  if (!Number.isFinite(at.getTime())) throw new Error('asOf ausente: informe o horário de referência (state.generatedAt ou --as-of)');
  const proposals = [
    ...productDuplicates(products, collections),
    ...unknownCollections(products, collections),
    ...eanProposals(products, offers),
    ...boosterMismatches(products, offers),
    ...offerDuplicates(offers),
    ...(catalog?.collections ? matchingCases(state, catalog, { limit: matchingLimit, now: at.getTime() }) : []),
  ];
  const byKind = {};
  for (const p of proposals) byKind[p.kind] = (byKind[p.kind] || 0) + 1;
  return {
    agent: 'catalog', version: CATALOG_AGENT_VERSION, mode: 'proposta', writes: false, autoApply: false,
    asOf: at.toISOString(), dataGeneratedAt: iso(state?.generatedAt),
    inputs: { products: products.length, offers: offers.length, collections: collections.length },
    prerequisites: catalogPrerequisites({ golden }),
    summary: { proposals: proposals.length, byKind, conflicts: proposals.filter((p) => p.ambiguity.length).length },
    proposals,
  };
}

const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
const KIND_LABEL = {
  produto_duplicado: 'Possível produto duplicado', colecao_fora_do_catalogo: 'Coleção fora do catálogo', ean_observado: 'EAN observado em anúncios',
  ean_divergente: 'EAN divergente (conflito)', ean_em_produtos_diferentes: 'Mesmo EAN em produtos diferentes (conflito)', contagem_divergente: 'Contagem de boosters divergente', oferta_duplicada: 'Oferta duplicada',
  url_em_produtos_diferentes: 'Mesma URL em produtos diferentes (conflito)', revisao_matching: 'Revisão de matching',
};
const subjectOf = (p) => {
  const s = p.subject;
  if (s.collection || s.ean) return esc(`${s.collection || s.ean}: ${(s.products || []).join(', ')}`);
  if (s.store && s.offers) return esc(`${s.store}: ${s.products?.join(' × ') || s.product} (ofertas ${s.offers.join(', ')})`);
  if (s.store && s.url) return esc(`${s.store}: ${s.url}`);
  return esc(s.products?.join(' × ') || s.product || p.key);
};

/** Markdown para o resumo do job / revisão humana. */
export function catalogMarkdown(rep, { maxPerKind = 15 } = {}) {
  const out = [`# Catalog Agent — propostas para revisão (${rep.asOf})`, '',
    `Modo **somente proposta**: nada foi gravado (catálogo, banco, fila, preço, ranking e score intactos). Dados de ${rep.dataGeneratedAt || '?'}.`, '',
    `Entrada: ${rep.inputs.products} produtos, ${rep.inputs.offers} ofertas, ${rep.inputs.collections} coleções. Propostas: ${rep.summary.proposals} (${rep.summary.conflicts} com conflito/ambiguidade).`, '',
    '## Pré-requisitos', '', '| item | status | detalhe |', '|---|---|---|',
    ...rep.prerequisites.map((p) => `| ${p.id} | ${p.status} | ${esc(p.detail)} |`), ''];
  for (const kind of Object.keys(KIND_LABEL)) {
    const ps = rep.proposals.filter((p) => p.kind === kind); if (!ps.length) continue;
    out.push(`## ${KIND_LABEL[kind]} (${ps.length})`, '', '| assunto | confiança | sugestão | evidência | ambiguidade |', '|---|---|---|---|---|');
    for (const p of ps.slice(0, maxPerKind)) {
      const evd = p.evidence.slice(0, 3).map((e) => `${e.code}: ${e.detail}`).join('; ');
      out.push(`| ${subjectOf(p)} | ${p.confidence ?? '—'} | ${esc(p.suggestion ? Object.entries(p.suggestion).map(([k, v]) => `${k}=${Array.isArray(v) ? v.join(',') : v}`).join(' ') : '—')} | ${esc(evd)} | ${esc(p.ambiguity.join('; ') || '—')} |`);
    }
    if (ps.length > maxPerKind) out.push('', `… e mais ${ps.length - maxPerKind} (ver JSON).`);
    out.push('');
  }
  return out.join('\n');
}
