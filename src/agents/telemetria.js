// Telemetria real por execução do worker (docs/ROADMAP-OPERACIONAL.md, "Lacunas para a fábrica 24/7", item 1).
// Fonte única: o execution_file da Claude Code Action (mensagens do Agent SDK; a `result` traz turnos, duração,
// uso de tokens e custo; a `system/init` traz o modelo). Nada é estimado: campo ausente vira null.
// O registro só contém números e valores de listas fechadas; nenhum texto do modelo, da issue ou do log é copiado.
// O custo é o valor que o runtime reporta (total_cost_usd, calculado a preço de API); com login por assinatura
// ele não é a cobrança efetiva, e o relatório diz isso.

import { telemetryFromExecution, CLASSES, EFFORTS } from './esforco.js';

export const VERSAO = 1;
export const AUTOR_CONFIAVEL = 'github-actions[bot]';
const MARCADOR = 'telemetria:execucao';
const MARKER_RE = /<!--\s*telemetria:execucao v=(\d+) (\{[^<>]*\})\s*-->/g;
const MODEL_RE = /^claude-[a-z0-9]+(?:[.-][a-z0-9]+)*(?:\[1m\])?$/;
const KEY_RE = /^dispatch:(\d{1,7}):(\d{1,3})$/;
const STATUS = new Set(['success', 'failure', 'cancelled', 'skipped']);

const int = (v, max = Number.MAX_SAFE_INTEGER) => {
  const n = typeof v === 'number' ? v : (typeof v === 'string' && /^\d{1,15}$/.test(v) ? Number(v) : NaN);
  return Number.isInteger(n) && n >= 0 && n <= max ? n : null;
};
const num = (v) => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);
const modelo = (m) => (typeof m === 'string' && m.length <= 64 && MODEL_RE.test(m) ? m : null);

/** Perfil escolhido pelo tools/esforco.mjs (JSON de uma linha). Valor fora das listas fechadas vira null. */
export function parsePerfil(text) {
  let p; try { p = JSON.parse(String(text || '')); } catch { return null; }
  if (!p || typeof p !== 'object') return null;
  return {
    classe: Object.values(CLASSES).includes(p.classe) ? p.classe : null,
    modelo: ['haiku', 'sonnet', 'opus'].includes(p.model) ? p.model : null,
    esforco: EFFORTS.includes(p.effort) ? p.effort : null,
    maxTurnos: int(p.maxTurns, 120),
    falhasAnteriores: int(p.falhas, 100),
    escalada: typeof p.escalada === 'boolean' ? p.escalada : null,
  };
}

/** Registro sanitizado de uma execução. `messages` é o conteúdo do execution_file (ou null, se não existir). */
export function buildRecord({ messages = null, issue, chave = '', perfil = '', runId, runAttempt, status = '', prUrl = '', repo = '', now = Date.now() } = {}) {
  const k = KEY_RE.exec(String(chave || ''));
  const sessao = telemetryFromExecution(messages);
  const list = Array.isArray(messages) ? messages : [];
  const init = list.find((m) => m && m.type === 'system' && m.subtype === 'init');
  const prRe = repo ? new RegExp(`^https://github\\.com/${repo.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&')}/pull/(\\d{1,7})$`) : null;
  const pr = prRe ? prRe.exec(String(prUrl || '')) : null;
  return {
    v: VERSAO,
    issue: int(issue, 9_999_999),
    caminho: k ? 'despacho' : 'label',
    chave: k ? k[0] : null,
    tentativa: k ? Number(k[2]) : null,
    run: { id: int(runId), tentativa: int(runAttempt, 1000) },
    perfil: parsePerfil(perfil),
    modeloSessao: modelo(init?.model),
    sessao: sessao && {
      sucesso: sessao.sucesso,
      subtipo: typeof sessao.subtipo === 'string' && /^[a-z_]{1,40}$/.test(sessao.subtipo) ? sessao.subtipo : null,
      turnos: int(sessao.turnos), duracaoMs: int(sessao.duracaoMs),
      custoUsdReportado: num(sessao.custoUsd),
      tokens: Object.fromEntries(Object.entries(sessao.tokens).map(([x, y]) => [x, int(y)])),
      modelos: sessao.modelos.map(modelo).filter(Boolean).slice(0, 5),
    },
    resultado: { status: STATUS.has(status) ? status : null, pr: pr ? Number(pr[1]) : null },
    em: new Date(now).toISOString(),
  };
}

const fmt = (v, f = (x) => String(x)) => (v === null || v === undefined ? 'n/d' : f(v));
const usd = (v) => `US$ ${v.toFixed(4)}`;
const mil = (v) => v.toLocaleString('pt-BR');

/** Corpo do comentário: resumo legível + marcador máquina (JSON sem `<`/`>`, logo não fecha o comentário HTML). */
export function formatComment(rec) {
  const json = JSON.stringify(rec);
  if (/[<>]/.test(json)) throw new Error('registro com caractere proibido');
  const s = rec.sessao; const p = rec.perfil;
  const linhas = [
    `**Telemetria da execução** (${rec.caminho}${rec.chave ? ` · \`${rec.chave}\`` : ''}) · run ${fmt(rec.run.id)}`,
    '',
    '| Campo | Valor |', '|---|---|',
    `| Perfil solicitado | ${p ? `${fmt(p.classe)} · ${fmt(p.modelo)}/${fmt(p.esforco)} · até ${fmt(p.maxTurnos)} turnos${p.escalada ? ' (escalado)' : ''}` : 'n/d'} |`,
    `| Modelo(s) usados | ${s?.modelos?.length ? s.modelos.join(', ') : fmt(rec.modeloSessao)} |`,
    `| Turnos · duração | ${fmt(s?.turnos)} · ${fmt(s?.duracaoMs, (x) => `${Math.round(x / 1000)} s`)} |`,
    `| Tokens (entrada · saída · cache leitura · cache criação) | ${s ? ['entrada', 'saida', 'cacheLeitura', 'cacheCriacao'].map((x) => fmt(s.tokens[x], mil)).join(' · ') : 'n/d'} |`,
    `| Custo reportado pelo runtime | ${fmt(s?.custoUsdReportado, usd)} |`,
    `| Resultado | ${fmt(rec.resultado.status)}${rec.resultado.pr ? ` · PR #${rec.resultado.pr}` : ' · sem PR'} |`,
    '',
    '<sub>Valores lidos do execution_file da sessão; "n/d" = o runtime não informou. O custo é o valor a preço de API reportado pelo SDK, não a cobrança da assinatura.</sub>',
    '',
    `<!-- ${MARCADOR} v=${rec.v} ${json} -->`,
  ];
  return linhas.join('\n');
}

/** Registros nos comentários; só do autor confiável (o token do workflow). */
export function parseRecords(comments, { trustedAuthor = AUTOR_CONFIAVEL } = {}) {
  const out = [];
  for (const c of comments || []) {
    if (String(c?.author ?? '').toLowerCase() !== trustedAuthor) continue;
    for (const m of String(c?.body ?? '').matchAll(MARKER_RE)) {
      if (Number(m[1]) !== VERSAO) continue;
      try { const r = JSON.parse(m[2]); if (r && r.v === VERSAO && int(r.issue) !== null) out.push(r); } catch { /* marcador corrompido: ignora */ }
    }
  }
  return dedupe(out.sort((a, b) => String(a.em).localeCompare(String(b.em))));
}

/**
 * Um registro por execução: (issue, chave, run.id, run.tentativa). O mesmo marcador em comentários repetidos (reenvio
 * do workflow) conta uma vez só; fica a primeira ocorrência. Sem run.id não há como identificar a execução: mantém.
 */
export function dedupe(records) {
  const vistos = new Set();
  return (records || []).filter((r) => {
    if (r?.run?.id == null) return true;
    const k = JSON.stringify([r.issue, r.chave ?? null, r.run.id, r.run.tentativa ?? null]);
    if (vistos.has(k)) return false;
    vistos.add(k); return true;
  });
}

const add = (a, b) => (b === null || b === undefined ? a : a + b);

/**
 * Agregado por período: execuções, sucesso/falha, escaladas, turnos, duração, tokens e custo reportado, com a
 * contagem do que veio sem dado (nunca preenchido). `prsIntegradas` (números de PR com merge) dá o custo por PR
 * (média e `porPrIntegrada`, uma linha por issue com PR integrada).
 */
export function summarize(records, { prsIntegradas = [] } = {}) {
  const rs = dedupe(records);
  const merged = new Set(prsIntegradas.map(Number));
  const tok = { entrada: 0, saida: 0, cacheLeitura: 0, cacheCriacao: 0 };
  let custo = 0, semCusto = 0, semSessao = 0, duracao = 0, turnos = 0;
  const porIssue = new Map();
  for (const r of rs) {
    const s = r.sessao;
    if (!s) semSessao++;
    if (s?.custoUsdReportado == null) semCusto++; else custo += s.custoUsdReportado;
    duracao = add(duracao, s?.duracaoMs); turnos = add(turnos, s?.turnos);
    for (const k of Object.keys(tok)) tok[k] = add(tok[k], s?.tokens?.[k]);
    const i = porIssue.get(r.issue) || { issue: r.issue, execucoes: 0, sucesso: 0, falhas: 0, escaladas: 0, custoUsdReportado: 0, semCusto: 0, prs: new Set() };
    i.execucoes++; if (r.resultado?.status === 'success' && r.resultado?.pr) i.sucesso++; else i.falhas++;
    if (r.perfil?.escalada) i.escaladas++;
    if (s?.custoUsdReportado == null) i.semCusto++; else i.custoUsdReportado += s.custoUsdReportado;
    if (r.resultado?.pr) i.prs.add(r.resultado.pr);
    porIssue.set(r.issue, i);
  }
  // custoTotalUsd: soma de todas as execuções da issue só quando nenhuma veio sem custo; senão null (n/d, nunca parcial)
  const issues = [...porIssue.values()].map((i) => ({ ...i, prs: [...i.prs].sort((a, b) => a - b), prIntegrada: [...i.prs].some((p) => merged.has(p)),
    custoTotalUsd: i.semCusto === 0 ? i.custoUsdReportado : null }));
  const integradas = issues.filter((i) => i.prIntegrada);
  // custo por PR integrada soma TODAS as execuções da issue (inclui as tentativas que falharam: retrabalho conta)
  const custoIntegradas = integradas.reduce((a, i) => a + i.custoUsdReportado, 0);
  const custoCompleto = integradas.every((i) => i.semCusto === 0);
  return {
    execucoes: rs.length,
    sucesso: rs.filter((r) => r.resultado?.status === 'success' && r.resultado?.pr).length,
    falhas: rs.filter((r) => !(r.resultado?.status === 'success' && r.resultado?.pr)).length,
    escaladas: rs.filter((r) => r.perfil?.escalada).length,
    semExecutionFile: semSessao,
    turnos, duracaoMs: duracao, tokens: tok,
    custoUsdReportado: { soma: rs.length > semCusto ? custo : null, execucoesSemCusto: semCusto },
    prsIntegradas: integradas.length,
    custoPorPrIntegrada: integradas.length && custoCompleto ? custoIntegradas / integradas.length : null,
    porPrIntegrada: integradas.map((i) => ({ issue: i.issue, prs: i.prs.filter((p) => merged.has(p)), execucoes: i.execucoes,
      tentativasFalhas: i.falhas, custoTotalUsd: i.custoTotalUsd, custoUsdReportado: i.custoUsdReportado, execucoesSemCusto: i.semCusto })).sort((a, b) => a.prs[0] - b.prs[0]),
    porIssue: issues.sort((a, b) => a.issue - b.issue),
  };
}

/**
 * Relatório legível do `summarize` (CLI `resumo`). Custo da issue/PR = todas as execuções, inclui tentativas falhas;
 * com qualquer execução sem custo informado vira "n/d" (o parcial aparece entre parênteses, nunca como total).
 */
export function formatResumo(s, { desde = null } = {}) {
  const usd2 = (v) => (v === null || v === undefined ? 'n/d' : `US$ ${v.toFixed(2)}`);
  const custo = (total, parcial, semCusto, execucoes) => (total !== null ? usd2(total)
    : semCusto < execucoes ? `n/d (parcial ${usd2(parcial)}; ${semCusto} sem dado)` : 'n/d');
  const linhas = [
    `Telemetria do worker${desde ? ` desde ${desde}` : ''}: ${s.execucoes} execução(ões), ${s.sucesso} com PR, ${s.falhas} sem entrega, ${s.escaladas} escalada(s).`,
    `Custo reportado: ${usd2(s.custoUsdReportado.soma)} (${s.custoUsdReportado.execucoesSemCusto} sem dado) · por PR integrada: ${usd2(s.custoPorPrIntegrada)} (${s.prsIntegradas} PR).`,
    `Tokens: entrada ${s.tokens.entrada}, saída ${s.tokens.saida}, cache leitura ${s.tokens.cacheLeitura}, cache criação ${s.tokens.cacheCriacao} · ${s.semExecutionFile} execução(ões) sem execution_file.`,
  ];
  if (s.porPrIntegrada.length) {
    linhas.push('Custo por PR integrada (todas as execuções da issue, inclui tentativas falhas):');
    for (const x of s.porPrIntegrada) {
      linhas.push(`  PR ${x.prs.map((p) => `#${p}`).join(', ')} (issue #${x.issue}): ${custo(x.custoTotalUsd, x.custoUsdReportado, x.execucoesSemCusto, x.execucoes)} · ${x.execucoes} exec., ${x.tentativasFalhas} tentativa(s) falha(s)`);
    }
  }
  if (s.porIssue.length) linhas.push('Custo por issue (inclui tentativas falhas):');
  for (const x of s.porIssue) {
    linhas.push(`  #${x.issue}: ${x.execucoes} exec., ${x.falhas} tentativa(s) falha(s), ${x.escaladas} escalada(s), ${custo(x.custoTotalUsd, x.custoUsdReportado, x.semCusto, x.execucoes)}, PR ${x.prs.map((p) => `#${p}`).join(', ') || '—'}${x.prIntegrada ? ' (integrada)' : ''}`);
  }
  return linhas.join('\n');
}

/** Gasto reportado na janela (para o budgetGate). Sem nenhum custo informado na janela: null (não inventa zero). */
export function gastoNaJanela(records, { now = Date.now(), janelaMs = 24 * 3600e3 } = {}) {
  const desde = now - janelaMs;
  const custos = dedupe(records).filter((r) => Date.parse(r.em) >= desde).map((r) => r.sessao?.custoUsdReportado).filter((v) => typeof v === 'number');
  return custos.length ? custos.reduce((a, b) => a + b, 0) : null;
}
