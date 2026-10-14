// Relatório da fila do Dispatcher (issue #668): quem espera e por quê, agrupado por motivo (dependência, área, vaga,
// orçamento, quarentena…). Só leitura: não acessa rede nem GitHub, não grava marcador, label nem comentário.
// O plano vem de `planDispatch` (src/agents/dispatcher.js), o mesmo do modo sem `--executar`:
//   node tools/fila-relatorio.mjs --plano plano.json        plano gravado por `node tools/dispatcher.mjs --json plano.json`
//   node tools/fila-relatorio.mjs --snapshot snapshot.json  roda planDispatch sobre um snapshot (formato de planDispatch)
//   [--json]  imprime o agrupamento em JSON em vez de markdown
// Com GITHUB_STEP_SUMMARY definido, o markdown também é anexado ao step summary.
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { planDispatch, sanitize } from '../src/agents/dispatcher.js';

/** Motivos de espera, em ordem fixa de exibição; o primeiro padrão que casar com o motivo do plano vence. */
export const MOTIVOS = Object.freeze([
  { id: 'dependencia', titulo: 'Dependência aberta', re: /^dependência aberta/ },
  { id: 'area', titulo: 'Área em uso por outra tarefa', re: /^área crítica em uso/ },
  { id: 'vaga', titulo: 'Sem vaga livre', re: /^sem vaga livre/ },
  { id: 'ciclo', titulo: 'Limite de despachos por ciclo', re: /^limite de \d+ despachos por ciclo/ },
  { id: 'orcamento', titulo: 'Orçamento', re: /^pausado por orçamento/ },
  { id: 'quarentena', titulo: 'Quarentena', re: /^em quarentena/ },
  { id: 'pausa', titulo: 'Pausa (rate limit, quota ou capacidade)', re: /^pausado/ },
  { id: 'backoff', titulo: 'Backoff entre tentativas', re: /^backoff/ },
  { id: 'em_curso', titulo: 'Em curso', re: /^(em execução|despachada \(lease ativo\))/ },
  { id: 'pr', titulo: 'PR aberto', re: /^já existe PR aberto/ },
  { id: 'concluida', titulo: 'Concluída pelo worker (aguarda revisão/merge)', re: /^já concluída/ },
  { id: 'inelegivel', titulo: 'Fora da fila (fechada, sem label ou sem operador)', re: /^(issue fechada|sem o label|autor não é operador|label da fila)/ },
  { id: 'outro', titulo: 'Outro motivo', re: /^/ },
]);

export const classificar = (reason) => MOTIVOS.find((m) => m.re.test(String(reason ?? ''))).id;

/**
 * Agrupa o plano por motivo de espera. Quem entra em quarentena neste ciclo conta em `quarentena`.
 * @returns {{ vagas, emCurso: number[], pausado: boolean, despachar: number[], grupos: [{ id, titulo, itens: [{ issue, motivo }] }] }}
 */
export function agrupar(plan = {}) {
  const porId = new Map(MOTIVOS.map((m) => [m.id, []]));
  for (const q of plan.quarantine || []) porId.get('quarentena').push({ issue: q.issue, motivo: sanitize(`vai para quarentena: ${q.reason}`, 200) });
  for (const x of plan.skipped || []) porId.get(classificar(x.reason)).push({ issue: x.issue, motivo: sanitize(x.reason, 200) });
  return {
    vagas: plan.slots ?? null,
    emCurso: [...(plan.active || [])],
    pausado: Boolean(plan.paused),
    despachar: (plan.dispatch || []).map((d) => d.issue),
    grupos: MOTIVOS.map((m) => ({ id: m.id, titulo: m.titulo, itens: porId.get(m.id) })).filter((g) => g.itens.length),
  };
}

const lista = (ns) => ns.map((n) => `#${n}`).join(', ') || 'nenhuma';

/** Markdown para o step summary: resumo por motivo e, em cada grupo, as issues com o motivo exato do plano. */
export function markdown(plan) {
  const r = agrupar(plan);
  const espera = r.grupos.reduce((s, g) => s + g.itens.length, 0);
  const out = ['## Fila do Dispatcher — quem espera e por quê (sem escrita)', '',
    `Vagas: ${r.vagas ?? 'n/d'} · em curso: ${lista(r.emCurso)}${r.pausado ? ' · **pausado**' : ''}`,
    `Despacháveis agora: ${lista(r.despachar)} · aguardando: ${espera}`, ''];
  if (!r.grupos.length) return [...out, 'Nenhuma issue aguardando.'].join('\n');
  out.push('| Motivo | Issues |', '| --- | ---: |', ...r.grupos.map((g) => `| ${g.titulo} | ${g.itens.length} |`));
  for (const g of r.grupos) out.push('', `### ${g.titulo} (${g.itens.length})`, ...g.itens.map((i) => `- #${i.issue}: ${i.motivo}`));
  return out.join('\n');
}

/** argv (sem node e script) → opções. Exige exatamente uma fonte: --plano ou --snapshot. */
export function lerArgs(argv) {
  const o = { plano: null, snapshot: null, json: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--json') o.json = true;
    else if (a === '--plano' || a === '--snapshot') {
      const v = argv[++i];
      if (!v || v.startsWith('--')) throw new Error(`${a} exige um caminho`);
      o[a.slice(2)] = v;
    } else throw new Error(`argumento desconhecido: ${a}`);
  }
  if (!o.plano === !o.snapshot) throw new Error('informe exatamente um de --plano <arquivo> ou --snapshot <arquivo>');
  return o;
}

/** Lê o plano: `{ plan }` do dispatcher.mjs --json (ou o plano puro) ou planDispatch sobre o snapshot. */
export function carregarPlano(o, ler = (p) => fs.readFileSync(p, 'utf8')) {
  if (o.snapshot) return planDispatch(JSON.parse(ler(o.snapshot)));
  const j = JSON.parse(ler(o.plano));
  const plan = j && typeof j === 'object' && 'plan' in j ? j.plan : j;
  if (!plan || typeof plan !== 'object' || !Array.isArray(plan.skipped)) throw new Error('arquivo sem plano do dispatcher');
  return plan;
}

export function main(argv = process.argv.slice(2), { env = process.env, io = console, ler } = {}) {
  try {
    const o = lerArgs(argv);
    const plan = carregarPlano(o, ler);
    if (o.json) { io.log(JSON.stringify(agrupar(plan), null, 2)); return 0; }
    const text = markdown(plan);
    io.log(text);
    if (env.GITHUB_STEP_SUMMARY) fs.appendFileSync(env.GITHUB_STEP_SUMMARY, text + '\n');
    return 0;
  } catch (e) {
    io.error(`fila-relatorio: ${sanitize(e.message, 300)}`);
    return 1;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exitCode = main();
