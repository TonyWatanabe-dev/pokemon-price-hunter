// Esforço adaptativo dos workers (issue #235; docs/PLANO-ENTREGA-TURBO.md §3.4).
// Classifica a tarefa com regras determinísticas (sem chamar modelo) e escolhe o menor modelo/esforço adequado,
// escalando só com falha comprovada. Opções usadas existem na CLI do Claude Code: `--model <alias>` e
// `--effort <low|medium|high|xhigh|max>` por sessão (code.claude.com/docs/en/model-config). A variável
// CLAUDE_CODE_EFFORT_LEVEL tem precedência sobre a flag; quem chama NÃO deve defini-la.
// Telemetria: só a que a sessão realmente reporta (mensagem `result` do execution_file da action); sem dado, null.

import { parseAreas } from './dispatcher.js';

export const EFFORTS = Object.freeze(['low', 'medium', 'high', 'xhigh']); // `max` nunca é automático
export const CLASSES = Object.freeze({ MECANICA: 'mecanica', COMUM: 'comum', COMPLEXA: 'complexa', CRITICA: 'critica' });

// Perfil inicial por classe (antes de falhas). Crítica nunca fica abaixo de high.
export const PROFILES = Object.freeze({
  mecanica: { model: 'sonnet', effort: 'low', maxTurns: 30 },
  comum: { model: 'sonnet', effort: 'medium', maxTurns: 60 },
  complexa: { model: 'opus', effort: 'high', maxTurns: 80 },
  critica: { model: 'opus', effort: 'high', maxTurns: 80 },
});
const FLOOR = Object.freeze({ critica: 'high' });

// Áreas que tornam a tarefa crítica (espelham os caminhos R3 do Release Governor).
const CRITICAL = [/^\.github\/workflows/, /^src\/agents/, /^src\/db/, /^db\//, /^db$/, /^firebase/, /^config\//, /^data\//,
  /^api\/_lib\//, /^src\/core\//, /^(package(-lock)?\.json|vercel\.json|\.vercelignore|CLAUDE\.md|account\.js)$/, /(^|\/)(auth|secrets?)(\/|\.|$)/];
const DOCS = (p) => p.startsWith('docs/') || /\.(md|txt)$/i.test(p);
const has = (text, re) => re.test(String(text || '').toLowerCase());

/** Classe da tarefa por labels, áreas declaradas, texto e falhas anteriores. Sem dado suficiente: "comum". */
export function classifyTask({ labels = [], title = '', body = '', failures = 0 } = {}) {
  const L = new Set(labels.map((l) => String(typeof l === 'string' ? l : l?.name).toLowerCase()));
  const areas = parseAreas(body);
  const text = `${title}\n${body}`;
  const motivos = [];
  if (areas.some((a) => CRITICAL.some((re) => re.test(a))) || ['security', 'r3', 'risco:r3'].some((l) => L.has(l))
    || /risco previsto:\s*r3\b/i.test(body)
    || has(text, /(migra|secret|credential|credencia|permiss|token|auth|banco de produção)/)) {
    motivos.push('área/assunto crítico (R3: workflows, agentes, banco, credenciais ou permissões)');
    return { classe: CLASSES.CRITICA, motivos, areas };
  }
  if (failures > 0) motivos.push(`${failures} falha(s) anterior(es)`);
  if (failures >= 2 || L.has('bug') && has(text, /\b(intermitente|race|concorr|depura|investig)/) || has(text, /(arquitetura|refator|integração\s+com|integrar\s+com|debug)/)) {
    motivos.push('depuração, integração ou arquitetura');
    return { classe: CLASSES.COMPLEXA, motivos, areas };
  }
  const docsOnly = areas.length > 0 && areas.every(DOCS);
  if (failures === 0 && (docsOnly || L.has('documentation') || has(title, /^(docs?|documenta|readme|typo|formata)/))) {
    motivos.push('mecânica: documentação/formatação isolada');
    return { classe: CLASSES.MECANICA, motivos, areas };
  }
  motivos.push('desenvolvimento comum delimitado');
  return { classe: CLASSES.COMUM, motivos, areas };
}

const up = (effort, steps) => EFFORTS[Math.min(EFFORTS.length - 1, EFFORTS.indexOf(effort) + steps)];

/**
 * Perfil da sessão: classe → perfil base; cada falha anterior sobe um nível de esforço (até xhigh) e, a partir
 * da primeira falha, troca sonnet por opus. Piso por classe (crítica ≥ high). `max` nunca é escolhido sozinho.
 */
export function profileFor(classe, failures = 0) {
  const base = PROFILES[classe] || PROFILES.comum;
  let effort = up(base.effort, Math.max(0, failures));
  if (FLOOR[classe] && EFFORTS.indexOf(effort) < EFFORTS.indexOf(FLOOR[classe])) effort = FLOOR[classe];
  const model = failures >= 1 && base.model === 'sonnet' ? 'opus' : base.model;
  return { model, effort, maxTurns: base.maxTurns + Math.min(2, Math.max(0, failures)) * 10, escalada: failures > 0 };
}

/** Linhas para `claude_args` (uma flag por linha, como no workflow). Valores vêm de listas fechadas. */
export function claudeArgs(profile) {
  if (!['haiku', 'sonnet', 'opus'].includes(profile.model)) throw new Error('modelo fora da lista');
  if (!EFFORTS.includes(profile.effort)) throw new Error('esforço fora da lista');
  if (!Number.isInteger(profile.maxTurns) || profile.maxTurns < 1 || profile.maxTurns > 120) throw new Error('max-turns inválido');
  return [`--model ${profile.model}`, `--effort ${profile.effort}`, `--max-turns ${profile.maxTurns}`].join('\n');
}

/**
 * Telemetria real de uma sessão a partir do execution_file da Claude Code Action (array de mensagens; a última
 * `type: "result"` traz custo/uso). Campo ausente fica null — nunca estimado aqui.
 */
export function telemetryFromExecution(messages) {
  const list = Array.isArray(messages) ? messages : [];
  const r = [...list].reverse().find((m) => m && m.type === 'result');
  if (!r) return null;
  const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const u = r.usage || {};
  return {
    sucesso: r.subtype === 'success' && r.is_error !== true,
    subtipo: r.subtype ?? null,
    turnos: num(r.num_turns), duracaoMs: num(r.duration_ms),
    custoUsd: num(r.total_cost_usd ?? r.cost_usd),
    tokens: { entrada: num(u.input_tokens), saida: num(u.output_tokens), cacheLeitura: num(u.cache_read_input_tokens), cacheCriacao: num(u.cache_creation_input_tokens) },
    modelos: r.modelUsage && typeof r.modelUsage === 'object' ? Object.keys(r.modelUsage) : [],
  };
}

/**
 * Orçamento do ciclo: com custo real somado na janela acima do limite, pausa novos despachos até o fim da janela.
 * Sem telemetria de custo, não inventa: só o limite de tentativas/vagas do Dispatcher controla a carga.
 */
export function budgetGate({ gastoUsd = null, limiteUsd = null } = {}) {
  if (limiteUsd == null) return { permitir: true, motivo: 'sem limite configurado' };
  if (gastoUsd == null) return { permitir: true, motivo: 'sem telemetria de custo; limite não aplicável' };
  return gastoUsd >= limiteUsd ? { permitir: false, motivo: `gasto ${gastoUsd.toFixed(2)} ≥ limite ${limiteUsd.toFixed(2)} USD na janela` }
    : { permitir: true, motivo: `gasto ${gastoUsd.toFixed(2)} < limite ${limiteUsd.toFixed(2)} USD` };
}
