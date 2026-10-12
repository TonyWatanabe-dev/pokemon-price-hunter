// Burn-in da fábrica 24/7 (docs/PLANO-ENTREGA-TURBO.md: "sete dias de estabilidade real"; issue #238).
// Avalia cada dia (horário de Brasília, UTC−3 fixo) com evidência real: execuções do GitHub Actions (cadência do
// agendador primário e do fallback, sucesso) e o estado operacional do robô (data/meta.json → ops.runs: sync,
// leitor oficial, motor). Função pura: quem chama busca os dados; nada é estimado e dia sem dado não é verde.

import { RULES } from '../ops-watch.js';

export const VERSAO = 1;
const SP_OFFSET_MS = -3 * 3600e3;
export const DIA_MS = 24 * 3600e3;

/** Limites do dia verde. Cadência esperada: 1 rodada a cada 15 min (96/dia) do Hunter e do Vigia. */
export const CRITERIOS = Object.freeze({
  minRodadas: 80,                 // ≥ ~83% das 96 rodadas esperadas
  maiorIntervaloMin: RULES.STOP_MIN, // mesmo limite do "parado" do Vigia (45 min)
  sucessoHunter: 0.9,
  sucessoVigia: 0.95,
  minAmostraOps: 60,              // rodadas com estado operacional lidas no dia
  syncOk: 0.9, leitorOk: 0.9, motorParadoMax: 0.1,
  dispatcherFalhasMax: 0,
});

/** Dia (AAAA-MM-DD) em Brasília. */
export function diaSP(t) {
  const ms = typeof t === 'number' ? t : Date.parse(t);
  return new Date(ms + SP_OFFSET_MS).toISOString().slice(0, 10);
}
/** [início, fim) do dia de Brasília em ms UTC. */
export function janelaDia(dia) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(dia))) throw new Error('dia inválido');
  const a = Date.parse(`${dia}T00:00:00Z`) - SP_OFFSET_MS;
  return [a, a + DIA_MS];
}

const inWin = (ms, [a, b]) => Number.isFinite(ms) && ms >= a && ms < b;
/** Maior intervalo (min) entre marcos, contando as bordas da janela (início do dia e fim/agora). */
function maiorGap(times, a, b) {
  const pts = [a, ...times.filter((x) => x >= a && x < b).sort((x, y) => x - y), b];
  let g = 0; for (let i = 1; i < pts.length; i++) g = Math.max(g, pts[i] - pts[i - 1]);
  return Math.round(g / 60e3);
}
const ratio = (n, d) => (d > 0 ? n / d : null);

/** Cadência e sucesso de um workflow no dia. runs: [{ created_at, status, conclusion, event }] da API do Actions. */
export function cadencia(runs, win, now) {
  const [a, b0] = win; const b = Math.min(b0, now);
  const rs = (runs || []).map((r) => ({ ...r, t: Date.parse(r.created_at) })).filter((r) => inWin(r.t, [a, b]));
  const done = rs.filter((r) => r.status === 'completed');
  const ok = done.filter((r) => r.conclusion === 'success').length;
  const porEvento = {};
  for (const r of rs) porEvento[r.event || '?'] = (porEvento[r.event || '?'] || 0) + 1;
  return { total: rs.length, concluidas: done.length, sucesso: ok, falhas: done.filter((r) => !['success', 'skipped', 'cancelled'].includes(r.conclusion)).length,
    taxaSucesso: ratio(ok, done.length), porEvento, maiorIntervaloMin: b > a ? maiorGap(rs.map((r) => r.t), a, b) : null };
}

/** Qualidade da coleta pelas rodadas registradas em ops.runs (só as do dia). */
export function qualidadeColeta(opsRuns, win, now) {
  const [a, b0] = win; const b = Math.min(b0, now);
  const rs = (opsRuns || []).filter((r) => inWin(Date.parse(r?.generatedAt), [a, b]));
  const share = (f) => ratio(rs.filter(f).length, rs.length);
  return {
    amostra: rs.length,
    syncOk: share((r) => r.dbSync?.status === 'ok'),
    leitorOk: share((r) => r.reader?.status === 'ok'),
    motorParado: share((r) => r.engine?.status === 'parado'),
    parciais: rs.filter((r) => r.result === 'parcial').length,
    maiorIntervaloMin: b > a && rs.length ? maiorGap(rs.map((r) => Date.parse(r.generatedAt)), a, b) : null,
  };
}

/**
 * Veredito do dia. Entradas: listas de execuções por workflow (hunter, vigia, dispatcher, tarefas), ops.runs e,
 * opcionalmente, o resumo de telemetria do dia. `final` só quando o dia terminou.
 * veredito: 'verde' | 'vermelho' | 'parcial' (dia em curso sem falha) | 'sem_dados'.
 */
export function avaliarDia({ dia, now = Date.now(), hunter, vigia, dispatcher, tarefas, opsRuns, telemetria = null }) {
  const win = janelaDia(dia); const final = now >= win[1];
  const H = cadencia(hunter, win, now), V = cadencia(vigia, win, now), D = cadencia(dispatcher, win, now), T = cadencia(tarefas, win, now);
  const Q = qualidadeColeta(opsRuns, win, now);
  const C = CRITERIOS; const crit = [];
  const add = (id, ok, valor, limite) => crit.push({ id, ok, valor, limite });
  const fmt = (x) => (x === null ? null : Math.round(x * 1000) / 1000);
  // contagem mínima só faz sentido com o dia inteiro; em curso, vale a cadência (intervalo)
  if (final) { add('hunter_rodadas', H.concluidas >= C.minRodadas, H.concluidas, `≥ ${C.minRodadas}`); add('vigia_rodadas', V.concluidas >= C.minRodadas, V.concluidas, `≥ ${C.minRodadas}`); }
  add('hunter_intervalo', H.maiorIntervaloMin !== null && H.maiorIntervaloMin <= C.maiorIntervaloMin, H.maiorIntervaloMin, `≤ ${C.maiorIntervaloMin} min`);
  add('vigia_intervalo', V.maiorIntervaloMin !== null && V.maiorIntervaloMin <= C.maiorIntervaloMin, V.maiorIntervaloMin, `≤ ${C.maiorIntervaloMin} min`);
  add('hunter_sucesso', H.taxaSucesso !== null && H.taxaSucesso >= C.sucessoHunter, fmt(H.taxaSucesso), `≥ ${C.sucessoHunter}`);
  add('vigia_sucesso', V.taxaSucesso !== null && V.taxaSucesso >= C.sucessoVigia, fmt(V.taxaSucesso), `≥ ${C.sucessoVigia}`);
  add('dispatcher_falhas', D.falhas <= C.dispatcherFalhasMax, D.falhas, `≤ ${C.dispatcherFalhasMax}`);
  if (final) add('coleta_amostra', Q.amostra >= C.minAmostraOps, Q.amostra, `≥ ${C.minAmostraOps}`);
  add('sync', Q.syncOk !== null && Q.syncOk >= C.syncOk, fmt(Q.syncOk), `≥ ${C.syncOk}`);
  add('leitor', Q.leitorOk !== null && Q.leitorOk >= C.leitorOk, fmt(Q.leitorOk), `≥ ${C.leitorOk}`);
  add('motor', Q.motorParado !== null && Q.motorParado <= C.motorParadoMax, fmt(Q.motorParado), `≤ ${C.motorParadoMax}`);
  const semDados = H.total === 0 && V.total === 0 && Q.amostra === 0;
  const falhou = crit.filter((c) => !c.ok);
  const veredito = semDados ? 'sem_dados' : falhou.length ? 'vermelho' : final ? 'verde' : 'parcial';
  return {
    v: VERSAO, dia, final, veredito, falhas: falhou.map((c) => c.id), criterios: crit,
    hunter: H, vigia: V, dispatcher: D, tarefas: T, coleta: Q,
    fallback: { hunter: H.porEvento.schedule || 0, vigia: V.porEvento.schedule || 0, dispatcher: D.porEvento.schedule || 0 },
    telemetria: telemetria && { execucoes: telemetria.execucoes, sucesso: telemetria.sucesso, falhas: telemetria.falhas, custoUsdReportado: telemetria.custoUsdReportado?.soma ?? null },
    em: new Date(now).toISOString(),
  };
}

/** Dias verdes consecutivos (só dias finais), do mais recente para trás; dia faltando quebra a sequência. */
export function sequenciaVerde(dias) {
  const finais = new Map((dias || []).filter((d) => d?.final).map((d) => [d.dia, d]));
  if (!finais.size) return 0;
  let cur = [...finais.keys()].sort().at(-1); let n = 0;
  while (finais.get(cur)?.veredito === 'verde') { n++; cur = new Date(Date.parse(`${cur}T00:00:00Z`) - DIA_MS).toISOString().slice(0, 10); }
  return n;
}

const MARKER_RE = /<!--\s*burnin:dia v=(\d+) (\{[^<>]*\})\s*-->/;
const ICON = { verde: '🟢', vermelho: '🔴', parcial: '🟡', sem_dados: '⚪' };
const NOMES = {
  hunter_rodadas: 'Hunter: rodadas concluídas', vigia_rodadas: 'Vigia: rodadas concluídas', hunter_intervalo: 'Hunter: maior intervalo (min)',
  vigia_intervalo: 'Vigia: maior intervalo (min)', hunter_sucesso: 'Hunter: taxa de sucesso', vigia_sucesso: 'Vigia: taxa de sucesso',
  dispatcher_falhas: 'Dispatcher: execuções com falha', coleta_amostra: 'Coleta: rodadas com estado operacional', sync: 'Sincronização com o banco ok',
  leitor: 'Leitor oficial ok', motor: 'Motor parado (fração)',
};

/** Comentário do dia: tabela legível + marcador (JSON sem `<`/`>`). */
export function formatarDia(av, { sequencia = null } = {}) {
  const json = JSON.stringify(av);
  if (/[<>]/.test(json)) throw new Error('registro com caractere proibido');
  const st = av.final ? 'dia encerrado' : `parcial até ${av.em.slice(11, 16)} UTC`;
  return [
    `${ICON[av.veredito]} **Burn-in ${av.dia}** — ${av.veredito} (${st})${sequencia !== null ? ` · sequência verde: **${sequencia}/7**` : ''}`,
    '', '| Critério | Valor | Limite | |', '|---|---|---|---|',
    ...av.criterios.map((c) => `| ${NOMES[c.id] || c.id} | ${c.valor ?? 'n/d'} | ${c.limite} | ${c.ok ? '✅' : '❌'} |`),
    '',
    `Fallback (cron do GitHub): Hunter ${av.fallback.hunter} · Vigia ${av.fallback.vigia} · Dispatcher ${av.fallback.dispatcher}. ` +
      `Worker: ${av.tarefas.total} execução(ões), ${av.tarefas.falhas} com falha` +
      (av.telemetria ? `; telemetria: ${av.telemetria.execucoes} registro(s), custo reportado ${av.telemetria.custoUsdReportado === null ? 'n/d' : `US$ ${av.telemetria.custoUsdReportado.toFixed(2)}`}.` : '.'),
    '',
    `<sub>Fontes: API do GitHub Actions e data/meta.json (ops.runs). Horário de Brasília. Gerado por tools/burnin.mjs; não editar à mão.</sub>`,
    '', `<!-- burnin:dia v=${av.v} ${json} -->`,
  ].join('\n');
}

/** Dias registrados nos comentários do autor confiável: { dia → { avaliacao, commentId } }. */
export function parseDias(comments, { trustedAuthor = 'github-actions[bot]' } = {}) {
  const out = new Map();
  for (const c of comments || []) {
    if (String(c?.author ?? '').toLowerCase() !== trustedAuthor) continue;
    const m = MARKER_RE.exec(String(c?.body ?? ''));
    if (!m || Number(m[1]) !== VERSAO) continue;
    try {
      const av = JSON.parse(m[2]);
      if (av?.v === VERSAO && /^\d{4}-\d{2}-\d{2}$/.test(av.dia) && !out.has(av.dia)) out.set(av.dia, { avaliacao: av, commentId: c.id ?? null });
    } catch { /* corrompido: ignora */ }
  }
  return out;
}

/**
 * Plano de publicação: hoje (sempre atualiza) e ontem (finaliza se ainda não final). Dia já final é imutável.
 * Retorna [{ dia, acao: 'criar'|'atualizar'|'manter', commentId }].
 */
export function planoPublicacao(existentes, now = Date.now()) {
  const hoje = diaSP(now); const ontem = diaSP(now - DIA_MS);
  return [ontem, hoje].map((dia) => {
    const e = existentes.get(dia);
    if (!e) return { dia, acao: 'criar', commentId: null };
    return { dia, acao: e.avaliacao.final ? 'manter' : 'atualizar', commentId: e.commentId };
  });
}
