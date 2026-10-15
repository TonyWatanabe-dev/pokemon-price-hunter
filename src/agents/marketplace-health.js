// Marketplace Health Agent (Fase 7, item 7) — SÓ PROPOSTA. Agrupa a saúde da coleta por loja e por plataforma
// (falhas, frescor, cobertura) a partir de data/sources.json, do histórico de rodadas (meta.json → ops.runs), da
// configuração de lojas e, se houver, das ofertas publicadas (state.json). Devolve propostas de ajuste para revisão
// humana. Determinístico, sem rede, sem banco e sem relógio próprio (asOf vem de quem chama).
//
// Limite duro: as propostas NUNCA contornam bloqueio. Nada de trocar/disfarçar User-Agent, proxy ou rotação de IP,
// resolver CAPTCHA, ignorar robots.txt, contornar login ou limite de API, nem reativar loja bloqueada sozinho
// (docs/MAPA-DE-AGENTES.md §3.2). Para loja que barra o robô, o que se propõe é respeitar o bloqueio: tirar do ciclo,
// reduzir tentativas, pedir liberação ao lojista ou usar API/parceria oficial.
// Nada é gravado: sources.json, config/stores.json, banco, ranking, preço e score ficam intactos.
// Reusa tools/coleta-relatorio.mjs (classificação de quem barrou: waf) e o formato de ops.runs de src/opstate.js.
import { linhas } from '../../tools/coleta-relatorio.mjs';

export const MARKETPLACE_HEALTH_VERSION = 'marketplace-health-v1';
export const FRESH_H = 1;          // última coleta com sucesso há até 1 h: fresca (rodada a cada ~15 min)
export const STALE_H = 24;         // mais de 24 h: velha
export const MIN_FAILS = 3;        // falha de rede/servidor só vira proposta depois de 3 falhas seguidas
export const LOW_MATCH = 0.1;      // menos de 10% dos anúncios casados (com 20+ anúncios): revisar escopo/matching
export const MIN_RUNS = 24;        // histórico mínimo de rodadas para tendência (~6 h a cada 15 min)
const DEDICATED = new Set(['vtex', 'shopify', 'mercadolivre']);   // plataformas com adaptador próprio em src/adapters/
const NETWORK = new Set(['timeout', 'rede', 'http_5xx', 'dns', 'tls']);
export const FORBIDDEN = Object.freeze([
  'trocar ou disfarçar o User-Agent', 'proxy ou rotação de IP', 'resolver CAPTCHA ou desafio anti-robô', 'ignorar robots.txt',
  'contornar login, credencial ou limite de API', 'reativar automaticamente loja bloqueada ou pausada',
]);
// Ações que este agente pode propor (todas exigem decisão humana; nenhuma é executada aqui).
export const ACTIONS = Object.freeze({
  respeitar_bloqueio: 'Manter fora do ciclo; pedir liberação ao lojista ou usar API/parceria oficial',
  pausar_fonte: 'Pausar a fonte (nunca houve leitura ok; o backoff de src/run.js já espera até 6 h entre tentativas)',
  respeitar_retry_after: 'Respeitar Retry-After e reduzir a frequência nessa loja',
  configurar_credencial_oficial: 'Configurar a credencial oficial pelo mecanismo da plataforma (proprietário)',
  verificar_disponibilidade: 'Confirmar manualmente se o site está no ar; se a falha persistir, pausar',
  revisar_adaptador: 'Revisar adaptador/seletores (possível mudança no site)',
  usar_adaptador_dedicado: 'Avaliar o adaptador dedicado da plataforma detectada',
  revisar_paginacao: 'Revisar paginação/teto de páginas',
  revisar_escopo_ou_matching: 'Revisar escopo de busca da loja ou o matching',
  investigar_coleta: 'Investigar por que a loja ativa não atualiza',
  confirmar_dominio: 'Confirmar o domínio oficial da loja',
  verificar_carga: 'Conferir por que a loja configurada não aparece nas fontes',
  revisar_recusas: 'Revisar anúncios recusados pelo contrato do adaptador',
});

const ms = (v) => { const t = Date.parse(v); return Number.isFinite(t) ? t : null; };
const hours = (from, to) => (from == null || to == null ? null : Math.round(((to - from) / 36e5) * 10) / 10);
const num = (v) => (Number.isFinite(v) ? v : null);
const ev = (code, detail, source, observedAt = null) => ({ code, detail: String(detail).slice(0, 300), source, basis: 'observado', observedAt: observedAt && ms(observedAt) != null ? new Date(observedAt).toISOString() : null });

/** Uma linha por loja: plataforma, status, quem barrou, frescor, cobertura e ofertas publicadas. */
export function storeRows(sources, { asOf, offersByStore = new Map() } = {}) {
  const now = ms(asOf);
  const waf = new Map(linhas(sources).map((r) => [r.id, r.waf]));
  return Object.entries(sources || {}).filter(([, s]) => s && typeof s === 'object').map(([id, s]) => {
    const age = hours(ms(s.lastSuccess), now);
    const freshness = s.lastSuccess == null || age == null ? 'nunca' : age <= FRESH_H ? 'fresca' : age <= STALE_H ? 'atrasada' : 'velha';
    const listings = num(s.listings); const matched = num(s.matched);
    const o = offersByStore.get(id) || { offers: 0, inStock: 0, stale: 0 };
    return {
      id, name: s.name || id, kind: s.kind || null, status: s.status || 'DESCONHECIDO',
      platform: s.platform || s.platformHint || 'desconhecida', platformHint: s.platformHint || null,
      waf: waf.get(id) || '—', errorClass: s.errorClass || null, httpStatus: num(s.httpStatus), retryAfterSec: num(s.retryAfterSec),
      fails: num(s.fails) ?? 0, checks: num(s.checks) ?? 0, okChecks: num(s.ok) ?? 0,
      successRate: s.checks > 0 ? Math.round((s.ok / s.checks) * 1000) / 1000 : null,
      lastCheck: s.lastCheck || null, lastSuccess: s.lastSuccess || null, ageH: age, freshness,
      listings, matched, matchRate: listings > 0 && matched != null ? Math.round((matched / listings) * 1000) / 1000 : null,
      lastNonEmpty: s.lastNonEmpty || null, partial: !!s.partial, pageGiveUps: num(s.pageGiveUps) ?? 0, lastDurationMs: num(s.lastDurationMs),
      reason: s.reason ? String(s.reason).slice(0, 160) : null, offers: o.offers, inStock: o.inStock, staleOffers: o.stale,
    };
  }).sort((a, b) => a.id.localeCompare(b.id));
}

/** Tendência das últimas rodadas (ops.runs): saúde, falhas por classe, lojas lentas recorrentes, recusas do contrato. */
export function runsSummary(runs) {
  const rs = (Array.isArray(runs) ? runs : []).filter((r) => r && typeof r === 'object' && ms(r.generatedAt) != null)
    .sort((a, b) => ms(a.generatedAt) - ms(b.generatedAt));
  const errors = {}; const issues = {}; const slow = {}; const rejected = {}; const durations = [];
  let degraded = 0; let partial = 0; let failedMax = 0; let failedSum = 0;
  for (const r of rs) {
    if (r.health === 'degradado') degraded++;
    if (r.result === 'parcial' || r.stores?.deferred > 0) partial++;
    for (const i of r.issues || []) issues[i] = (issues[i] || 0) + 1;
    const c = r.collectors || {};
    failedMax = Math.max(failedMax, c.failed || 0); failedSum += c.failed || 0;
    for (const [k, v] of Object.entries(c.errors || {})) errors[k] = (errors[k] || 0) + (v || 0);
    for (const s of c.slowest || []) if (s?.id) slow[s.id] = (slow[s.id] || 0) + 1;
    for (const [id, reasons] of Object.entries(r.listingsRejected?.byStore || {})) for (const [why, k] of Object.entries(reasons || {})) {
      const x = (rejected[id] ||= { total: 0, reasons: {} }); x.total += k || 0; x.reasons[why] = (x.reasons[why] || 0) + (k || 0);
    }
    if (Number.isFinite(r.durationSec)) durations.push(r.durationSec);
  }
  durations.sort((a, b) => a - b);
  return {
    runs: rs.length, from: rs[0]?.generatedAt || null, to: rs.at(-1)?.generatedAt || null, degraded, partial,
    collectorsFailedAvg: rs.length ? Math.round((failedSum / rs.length) * 10) / 10 : null, collectorsFailedMax: failedMax,
    errorsByClass: errors, issues, slowestCount: slow, rejected,
    durationSec: durations.length ? { p50: durations[Math.floor(durations.length / 2)], max: durations.at(-1) } : null,
  };
}

/** Agrupamento por plataforma e por motivo de falha (waf/classe). */
export function groupStores(rows) {
  const byPlatform = {}; const byFailure = {}; const freshness = { fresca: 0, atrasada: 0, velha: 0, nunca: 0 };
  for (const r of rows) {
    const p = (byPlatform[r.platform] ||= { stores: 0, active: 0, blocked: 0, error: 0, unavailable: 0, paused: 0, pending: 0, listings: 0, matched: 0, offers: 0 });
    p.stores++; p.listings += r.listings || 0; p.matched += r.matched || 0; p.offers += r.offers;
    const k = { ACTIVE: 'active', BLOCKED: 'blocked', ERROR: 'error', UNAVAILABLE: 'unavailable', PAUSED: 'paused', PENDING: 'pending' }[r.status];
    if (k) p[k]++;
    if (r.status !== 'ACTIVE') { const f = r.waf !== '—' && r.waf !== 'unknown' ? r.waf : r.errorClass || r.status.toLowerCase(); (byFailure[f] ||= []).push(r.id); }
    if (r.status === 'ACTIVE') freshness[r.freshness]++;
  }
  return { byPlatform, byFailure, freshnessActive: freshness };
}

const P = (key, kind, stores, { severity, action, evidence, impact = 0, note = null }) =>
  ({ key: `health:${kind}:${key}`, kind, stores, severity, action, actionText: ACTIONS[action], decision: 'needs_review', autoApply: false, impact, evidence, note });

/** Propostas por loja + do histórico de rodadas. Nunca propõe contornar bloqueio (ver FORBIDDEN). */
export function healthProposals(rows, runs, { configuredIds = [] } = {}) {
  const out = [];
  const src = 'data/sources.json';
  for (const r of rows) {
    const e = [ev('STATUS', `${r.status}${r.reason ? `: ${r.reason}` : ''}`, src, r.lastCheck)];
    if (r.status === 'BLOCKED' && (r.errorClass === 'bloqueio' || !['—', 'unknown', 'timeout', 'dns', 'tls'].includes(r.waf))) {
      if (r.httpStatus === 429 || r.retryAfterSec != null) {
        out.push(P(r.id, 'limite_de_requisicoes', [r.id], { severity: 'media', action: 'respeitar_retry_after', impact: r.offers,
          evidence: [...e, ev('HTTP', `${r.httpStatus ?? '?'}${r.retryAfterSec != null ? ` · Retry-After ${r.retryAfterSec} s` : ''}`, src, r.lastCheck)] }));
      } else {
        const never = r.fails >= MIN_FAILS && r.okChecks === 0;
        out.push(P(r.id, 'bloqueio_anti_robo', [r.id], { severity: never ? 'media' : 'baixa', action: never ? 'pausar_fonte' : 'respeitar_bloqueio', impact: r.offers,
          evidence: [...e, ev('QUEM_BARROU', `${r.waf}${r.httpStatus ? ` · HTTP ${r.httpStatus}` : ''} · ${r.fails} falha(s) seguida(s), ${r.okChecks}/${r.checks} leituras ok`, src, r.lastCheck)],
          note: 'Bloqueio é decisão da loja: respeitar. Caminho permitido: pedido de liberação ao lojista ou API/parceria oficial.' }));
      }
      continue;
    }
    if (r.errorClass === 'auth') { out.push(P(r.id, 'credencial_ausente', [r.id], { severity: 'alta', action: 'configurar_credencial_oficial', impact: r.offers, evidence: e })); continue; }
    if ((r.status === 'BLOCKED' || r.status === 'ERROR') && NETWORK.has(r.errorClass || r.waf) && r.fails >= MIN_FAILS) {
      out.push(P(r.id, 'falha_de_rede_persistente', [r.id], { severity: 'baixa', action: r.okChecks === 0 ? 'pausar_fonte' : 'verificar_disponibilidade', impact: r.offers,
        evidence: [...e, ev('FALHAS_SEGUIDAS', `${r.fails} (${r.errorClass || r.waf}), última ${r.lastDurationMs ?? '?'} ms`, src, r.lastCheck)] }));
      continue;
    }
    if (r.status === 'ERROR' && r.errorClass === 'plataforma') {
      out.push(P(r.id, 'plataforma_nao_reconhecida', [r.id], { severity: 'baixa', action: 'revisar_adaptador', impact: r.offers, evidence: e }));
      continue;
    }
    if (r.status === 'PENDING') { out.push(P(r.id, 'dominio_pendente', [r.id], { severity: 'baixa', action: 'confirmar_dominio', evidence: e })); continue; }
    if (r.status !== 'ACTIVE') continue;
    if (r.freshness === 'velha' || r.freshness === 'nunca') {
      out.push(P(r.id, 'dados_velhos', [r.id], { severity: 'alta', action: 'investigar_coleta', impact: r.offers,
        evidence: [...e, ev('ULTIMO_SUCESSO', r.lastSuccess ? `há ${r.ageH} h (${r.lastSuccess})` : 'nunca', src, r.lastSuccess)] }));
    }
    if (!(r.listings > 0) && r.lastNonEmpty) {
      out.push(P(r.id, 'vazio_suspeito', [r.id], { severity: 'media', action: 'revisar_adaptador', impact: r.offers,
        evidence: [...e, ev('ULTIMA_RODADA_COM_ANUNCIOS', r.lastNonEmpty, src, r.lastNonEmpty)] }));
    }
    if (r.partial || r.pageGiveUps > 0) {
      out.push(P(r.id, 'paginacao_incompleta', [r.id], { severity: 'baixa', action: 'revisar_paginacao', impact: r.offers,
        evidence: [...e, ev('PAGINACAO', `partial=${r.partial} · desistências de página=${r.pageGiveUps}`, src, r.lastCheck)] }));
    }
    if (r.listings >= 20 && r.matchRate != null && r.matchRate < LOW_MATCH) {
      out.push(P(r.id, 'matching_baixo', [r.id], { severity: 'baixa', action: 'revisar_escopo_ou_matching', impact: r.offers,
        evidence: [...e, ev('CASADOS', `${r.matched}/${r.listings} anúncios (${Math.round(r.matchRate * 100)}%)`, src, r.lastCheck)] }));
    }
    if (r.platformHint && DEDICATED.has(r.platformHint) && r.platform !== r.platformHint && r.platform !== 'desconhecida') {
      out.push(P(r.id, 'adaptador_dedicado_disponivel', [r.id], { severity: 'baixa', action: 'usar_adaptador_dedicado', impact: r.offers,
        evidence: [...e, ev('PLATAFORMA', `lida via ${r.platform}; respostas indicam ${r.platformHint}`, src, r.lastCheck)],
        note: 'Só leitura do que a loja publica, pelo mesmo agente honesto; não muda frequência nem identificação.' }));
    }
  }
  // tendência das rodadas
  if (runs.runs >= 2) {
    for (const [id, k] of Object.entries(runs.slowestCount).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))) {
      if (k / runs.runs < 0.5) continue;
      const r = rows.find((x) => x.id === id);
      out.push(P(id, 'lenta_recorrente', [id], { severity: 'baixa', action: 'revisar_paginacao', impact: r?.offers || 0,
        evidence: [ev('ENTRE_AS_MAIS_LENTAS', `${k} de ${runs.runs} rodadas${r?.lastDurationMs != null ? `; última ${Math.round(r.lastDurationMs / 1000)} s` : ''}`, 'meta.json ops.runs', runs.to)] }));
    }
    for (const [id, x] of Object.entries(runs.rejected).sort((a, b) => b[1].total - a[1].total || a[0].localeCompare(b[0]))) {
      if (x.total < runs.runs) continue;   // menos de 1 recusa por rodada em média: ruído
      out.push(P(id, 'recusas_do_contrato', [id], { severity: 'baixa', action: 'revisar_recusas', impact: rows.find((r) => r.id === id)?.offers || 0,
        evidence: [ev('RECUSAS', `${x.total} em ${runs.runs} rodadas: ${Object.entries(x.reasons).sort((a, b) => b[1] - a[1]).slice(0, 3).map(([w, k]) => `${w} (${k})`).join('; ')}`, 'meta.json ops.runs', runs.to)] }));
    }
  }
  const known = new Set(rows.map((r) => r.id));
  for (const id of [...new Set(configuredIds)].sort()) if (!known.has(id)) {
    out.push(P(id, 'fora_das_fontes', [id], { severity: 'media', action: 'verificar_carga', evidence: [ev('CONFIGURADA', 'em config/stores.json e ausente de data/sources.json', 'config/stores.json')] }));
  }
  const sev = { alta: 0, media: 1, baixa: 2 };
  return out.sort((a, b) => sev[a.severity] - sev[b.severity] || b.impact - a.impact || a.key.localeCompare(b.key));
}

/** Pré-requisitos do plano: contratos e rate limits estáveis, telemetria por loja, histórico de rodadas. */
export function healthPrerequisites(rows, runs) {
  const failing = rows.filter((r) => r.status === 'BLOCKED' || r.status === 'ERROR');
  const withForensics = failing.filter((r) => r.errorClass || r.waf !== '—').length;
  const rateLimited = rows.filter((r) => r.httpStatus === 429 || r.retryAfterSec != null).map((r) => r.id);
  return [
    { id: 'contratos_adaptadores', status: 'atendido', detail: 'contrato comum testado offline (test/adapter-contract-tests.js); falha tipada por loja' },
    { id: 'rate_limits', status: 'parcial',   // código respeita limites, mas o caminho de rede da cotação VTEX ainda recebe 429 (#84)
      detail: `intervalo por domínio e Retry-After respeitados no código; ${rateLimited.length} loja(s) com 429 agora${rateLimited.length ? ` (${rateLimited.slice(0, 5).join(', ')})` : ''}; VTEX responde 429 a IPs de nuvem na cotação de frete (#84)` },
    { id: 'telemetria_por_loja', status: !failing.length || withForensics === failing.length ? 'atendido' : 'parcial', detail: `${withForensics}/${failing.length} loja(s) com falha têm classe/forense registrada` },
    { id: 'historico_de_rodadas', status: runs.runs >= MIN_RUNS ? 'atendido' : runs.runs ? 'parcial' : 'nao_atendido', detail: `${runs.runs} rodada(s) em ops.runs (mínimo ${MIN_RUNS})${runs.from ? `, ${runs.from} → ${runs.to}` : ''}` },
    { id: 'testes_falha_transitoria', status: 'atendido', detail: 'test/collectors-tests.js e test/adapter-contract-tests.js' },
  ];
}

/**
 * Relatório completo. sources: data/sources.json; meta: data/meta.json (ops.runs); stores: config/stores.json;
 * state: data/state.json (opcional, só para contar ofertas por loja); asOf: horário de referência. Puro.
 */
export function marketplaceHealthReport({ sources, meta = null, stores = null, state = null, asOf } = {}) {
  const at = asOf ? new Date(asOf) : new Date(state?.generatedAt || meta?.ops?.last?.generatedAt || NaN);
  if (!Number.isFinite(at.getTime())) throw new Error('asOf ausente: informe o horário de referência (--as-of ou state.generatedAt)');
  const offersByStore = new Map();
  for (const o of state?.offers || []) {
    if (!o?.storeId) continue;
    const x = offersByStore.get(o.storeId) || { offers: 0, inStock: 0, stale: 0 };
    x.offers++; if (o.stock === 'IN_STOCK') x.inStock++; if (o.stale) x.stale++;
    offersByStore.set(o.storeId, x);
  }
  const rows = storeRows(sources, { asOf: at.toISOString(), offersByStore });
  const runs = runsSummary(meta?.ops?.runs);
  const proposals = healthProposals(rows, runs, { configuredIds: (stores?.stores || []).map((s) => s?.id).filter(Boolean) });
  const byKind = {};
  for (const p of proposals) byKind[p.kind] = (byKind[p.kind] || 0) + 1;
  return {
    agent: 'marketplace-health', version: MARKETPLACE_HEALTH_VERSION, mode: 'proposta', writes: false, autoApply: false,
    asOf: at.toISOString(), forbidden: FORBIDDEN,
    inputs: { stores: rows.length, configured: (stores?.stores || []).length, runs: runs.runs, offers: state?.offers?.length ?? null },
    prerequisites: healthPrerequisites(rows, runs),
    groups: groupStores(rows), runs,
    summary: { proposals: proposals.length, byKind, bySeverity: proposals.reduce((a, p) => ({ ...a, [p.severity]: (a[p.severity] || 0) + 1 }), {}) },
    proposals, stores: rows,
  };
}

const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();
/** Markdown para o resumo do job / revisão humana. */
export function marketplaceHealthMarkdown(rep, { maxProposals = 40 } = {}) {
  const g = rep.groups; const r = rep.runs;
  const out = [`# Marketplace Health — saúde das lojas (${rep.asOf})`, '',
    'Modo **somente proposta**: nada foi alterado (fontes, configuração, banco, ranking, preço e score intactos).', '',
    `**Nunca proposto:** ${rep.forbidden.join('; ')}.`, '',
    `Lojas: ${rep.inputs.stores} nas fontes, ${rep.inputs.configured} na configuração. Ativas por frescor: ${Object.entries(g.freshnessActive).map(([k, v]) => `${k} ${v}`).join(', ')}.`, '',
    '## Pré-requisitos', '', '| item | status | detalhe |', '|---|---|---|',
    ...rep.prerequisites.map((p) => `| ${p.id} | ${p.status} | ${esc(p.detail)} |`), '',
    '## Por plataforma', '', '| plataforma | lojas | ativas | bloqueadas | erro | indisp. | pausadas | pendentes | anúncios | casados | ofertas |', '|---|---|---|---|---|---|---|---|---|---|---|',
    ...Object.entries(g.byPlatform).sort((a, b) => b[1].stores - a[1].stores || a[0].localeCompare(b[0]))
      .map(([p, x]) => `| ${esc(p)} | ${x.stores} | ${x.active} | ${x.blocked} | ${x.error} | ${x.unavailable} | ${x.paused} | ${x.pending} | ${x.listings} | ${x.matched} | ${x.offers} |`), '',
    '## Por motivo de falha', '', '| motivo | lojas |', '|---|---|',
    ...Object.entries(g.byFailure).sort((a, b) => b[1].length - a[1].length || a[0].localeCompare(b[0])).map(([k, ids]) => `| ${esc(k)} | ${ids.length}: ${esc(ids.slice(0, 12).join(', '))}${ids.length > 12 ? '…' : ''} |`), '',
    '## Rodadas (meta.json → ops.runs)', '',
    r.runs ? `${r.runs} rodada(s) de ${r.from} a ${r.to}: ${r.degraded} degradada(s), ${r.partial} parcial(is); coletores com falha por rodada: média ${r.collectorsFailedAvg}, máx. ${r.collectorsFailedMax}; duração p50 ${r.durationSec?.p50 ?? '?'} s, máx. ${r.durationSec?.max ?? '?'} s. Erros por classe: ${Object.entries(r.errorsByClass).map(([k, v]) => `${k} ${v}`).join(', ') || 'nenhum'}.`
      : 'Sem histórico de rodadas.', '',
    `## Propostas (${rep.summary.proposals})`, '', '| severidade | tipo | loja | ação proposta | ofertas | evidência |', '|---|---|---|---|---|---|'];
  for (const p of rep.proposals.slice(0, maxProposals)) out.push(`| ${p.severity} | ${p.kind} | ${esc(p.stores.join(', '))} | ${esc(p.actionText)} | ${p.impact} | ${esc(p.evidence.map((e) => e.detail).join(' · '))} |`);
  if (rep.proposals.length > maxProposals) out.push('', `… e mais ${rep.proposals.length - maxProposals} (ver JSON).`);
  return out.join('\n') + '\n';
}
