// Diagnóstico offline de um incidente do Vigia: reproduz a checagem (src/ops-watch.js) com os dados de um commit do
// ramo data, refaz o caminho do resumo até a issue (arquivo → `jq -c` → $GITHUB_OUTPUT → saída do job → VIGIA_JSON →
// tools/vigia-incidente.mjs) e classifica: incidente real × indisponibilidade transitória × falha de observabilidade.
// Só leitura: não chama rede, não escreve nada, não dispara workflow.
//
// Uso:
//   node tools/vigia-diagnostico.mjs --commit <sha do ramo data> [--ate <ISO>] [--now <ISO>] [--runs runs.json]
//        [--deploy deploy.json] [--wa-runs wa-runs.json] [--json]
//   node tools/vigia-diagnostico.mjs --meta meta.json [--sources sources.json] --ate <ISO> [...]
// --ate: horário dos dados publicados que a checagem viu ("Dados publicados em" da issue). O ramo data é reescrito a
//   cada rodada, mas meta.json guarda as últimas 96 rodadas (ops.runs): um commit até ~24 h DEPOIS reconstrói o
//   estado da época (ops.runs cortado em --ate; ops.last = última rodada até --ate). Sem --ate: o próprio commit.
// --now: horário da checagem (padrão: --ate + 7 min). --runs: `gh run list --workflow hunter.yml --json
//   databaseId,status,conclusion,createdAt,updatedAt,event` da época (sem ele, `rodadas_falhando` não é avaliado).
import fs from 'node:fs';
import { execFileSync } from 'node:child_process';
import { evaluate, RULES, hhmm } from '../src/ops-watch.js';
import { parseResumo, planIncident, classificar } from '../src/ops-incident.js';

const DOWN = (x) => !!x && (['BLOCKED', 'ERROR'].includes(x.status) || (x.status === 'ACTIVE' && x.listings === 0));
const T = (s) => Date.parse(s || '');

/** meta.json como estava quando os dados de `ate` foram publicados (ops.runs até `ate`; ops.last = a última delas). */
export function metaAte(meta, ate) {
  const runs = Array.isArray(meta?.ops?.runs) ? meta.ops.runs : [];
  if (!ate) return { meta, cobre: runs.length > 0, reconstruido: false };
  const A = T(ate);
  const ate_ = runs.filter((r) => T(r.generatedAt) <= A);
  const cobre = runs.some((r) => Math.abs(T(r.generatedAt) - A) < 1000);   // o commit tem a rodada exata de --ate
  const last = ate_[ate_.length - 1] || null;
  return { meta: { ...meta, ops: { ...meta.ops, runs: ate_, last } }, cobre, reconstruido: true, depois: runs.filter((r) => T(r.generatedAt) > A) };
}

/** Sequência de rodadas com a fonte fora até `ate` e, se houver rodadas depois (diagnóstico retroativo), quando voltou. */
export function episodioFonte(id, antes, depois = []) {
  let seguidas = 0;
  for (let i = antes.length - 1; i >= 0 && DOWN(antes[i].watched?.[id]); i--) seguidas++;
  const inicio = seguidas ? antes[antes.length - seguidas].generatedAt : null;
  let voltou = null; let foraDepois = 0;
  for (const r of depois) { if (DOWN(r.watched?.[id])) foraDepois++; else { voltou = r.generatedAt; break; } }
  // episódios nas 24 h anteriores (mesma fonte): quantas rodadas cada um durou
  const eps = []; let n = 0;
  for (const r of antes) { if (DOWN(r.watched?.[id])) n++; else if (n) { eps.push(n); n = 0; } }
  return { seguidas, inicio, voltou, rodadasAteVoltar: voltou ? seguidas + foraDepois : null, episodiosAnteriores: eps };
}

/** Caminho do resumo até a issue, como no watchdog.yml: devolve o que o job `incidente` leria e o corpo gerado. */
export function simularTransporte(resumoObj, { segredos = [] } = {}) {
  const linha = `json=${JSON.stringify(resumoObj)}`;                       // echo "json=$(jq -c . wd/vigia.json)"
  if (/[\r\n]/.test(linha)) return { etapa: 'github_output', ok: false, motivo: 'quebra de linha no valor (formato NAME=VALUE)' };
  const valor = linha.slice(linha.indexOf('=') + 1);                        // runner: divide no 1º '='
  if (segredos.some((s) => s && valor.includes(s))) return { etapa: 'saida_do_job', ok: false, motivo: 'saída pulada pelo runner (contém segredo): o job incidente nem roda' };
  const uma = parseResumo(valor);
  const plano = planIncident({ resumo: uma, runUrl: null });               // como tools/vigia-incidente.mjs (objeto já analisado)
  const problemas = String(plano.body || '').split('\n').filter((l) => /^- (`|\(sem detalhe)/.test(l));
  return { etapa: 'issue', ok: !!uma && uma.reasons.length === (resumoObj.reasonsDetail || []).length, bytes: Buffer.byteLength(valor),
    motivosEnviados: (resumoObj.reasonsDetail || []).length, motivosNaIssue: uma ? parseResumo(uma).reasons.length : 0, acao: plano.type, problemas };
}

/** Classificação retroativa (com o que aconteceu depois) e no momento da checagem (classificar, sem futuro). */
export function classificarRetro(ev, fontes, transporte) {
  if (!['degradado', 'parado'].includes(ev.status)) return { tipo: ev.status === 'saudavel' ? 'sem_incidente' : 'desconhecido', confianca: 'confirmada' };
  if (transporte && !transporte.ok) return { tipo: 'observabilidade', confianca: 'confirmada', motivo: transporte.motivo || 'motivos perdidos no caminho até a issue' };
  const codes = ev.reasons.map((r) => r.code);
  if (codes.every((c) => c === 'fonte_degradada') && fontes.length && fontes.every((f) => f.voltou && f.rodadasAteVoltar <= RULES.CONSEC + 1))
    return { tipo: 'transitorio', confianca: 'confirmada', motivo: fontes.map((f) => `${f.nome}: fora ${f.rodadasAteVoltar} rodada(s), voltou às ${hhmm(f.voltou)}`).join('; ') };
  if (codes.every((c) => c === 'fonte_degradada') && fontes.some((f) => !f.voltou)) return { tipo: 'transitorio_ou_real', confianca: 'provavel', motivo: 'fonte ainda fora no último registro disponível' };
  return { tipo: 'real', confianca: 'confirmada', motivo: codes.join(', ') };
}

export function diagnosticar({ meta, sources = null, stateGeneratedAt = null, ate = null, now = null, runs = null, deploy = null, waRuns = null, segredos = [] }) {
  const corte = metaAte(meta, ate);
  const dataAt = ate || stateGeneratedAt || corte.meta?.ops?.last?.generatedAt || null;
  const quando = now || (dataAt ? new Date(T(dataAt) + 7 * 6e4).toISOString() : new Date().toISOString());
  const ev = evaluate({ now: quando, stateGeneratedAt: dataAt, meta: corte.meta, metaError: corte.meta ? null : 'ausente', runs, deploy, waRuns });
  const resumo = { v: 1, now: quando, status: ev.status, previousStatus: null, reasonsDetail: ev.reasons.map((r) => ({ code: r.code, text: r.text })), facts: ev.facts };
  const antes = corte.meta?.ops?.runs || [];
  const last = antes[antes.length - 1];
  const fontes = Object.keys(last?.watched || {}).filter((id) => DOWN(last.watched[id])).map((id) => {
    // sources.json só descreve a última rodada do commit: vale para --ate apenas se o commit for da mesma rodada
    const daEpoca = !(corte.depois || []).length;
    const s = daEpoca && sources && typeof sources === 'object' ? (sources[id] || sources.sources?.[id]) : null;
    return { id, nome: last.watched[id].name || id, status: last.watched[id].status, ...episodioFonte(id, antes, corte.depois || []),
      sourcesStatus: s?.status ?? null, sourcesReason: s?.reason ?? (daEpoca ? null : 'sources.json do commit é de outra rodada') };
  });
  const transporte = ['degradado', 'parado'].includes(ev.status) ? simularTransporte(resumo, { segredos }) : null;
  return { dataAt, now: quando, reconstruido: corte.reconstruido, cobre: corte.cobre, rodadasNoMeta: antes.length,
    runsAvaliadas: Array.isArray(runs), coletoresErros: last?.collectors?.errors || null, status: ev.status, reasons: resumo.reasonsDetail, facts: ev.facts, fontes, transporte,
    classificacaoNaChecagem: classificar(resumo), classificacao: classificarRetro(ev, fontes, transporte) };
}

// ---------------- CLI
const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf('--' + k); return i >= 0 ? args[i + 1] : undefined; };
const readJson = (f) => (f ? JSON.parse(fs.readFileSync(f, 'utf8')) : null);
const gitJson = (sha, file) => { try { return JSON.parse(execFileSync('git', ['show', `${sha}:${file}`], { maxBuffer: 256 * 1024 * 1024, encoding: 'utf8' })); } catch { return null; } };

export function main({ log = console.log } = {}) {
  const sha = opt('commit');
  if (sha && !/^[0-9a-f]{7,40}$/i.test(sha)) throw new Error('--commit precisa ser um SHA');
  const meta = sha ? gitJson(sha, 'data/meta.json') : readJson(opt('meta'));
  if (!meta) throw new Error('meta.json não encontrado (use --commit <sha> ou --meta arquivo)');
  const sources = sha ? gitJson(sha, 'data/sources.json') : readJson(opt('sources'));
  const state = sha && !opt('ate') ? gitJson(sha, 'data/state.json') : null;
  const d = diagnosticar({ meta, sources, stateGeneratedAt: state?.generatedAt || null, ate: opt('ate') || null, now: opt('now') || null,
    runs: readJson(opt('runs')), deploy: readJson(opt('deploy')), waRuns: readJson(opt('wa-runs')) });
  if (args.includes('--json')) { log(JSON.stringify(d, null, 2)); return d; }
  log(`Checagem reproduzida: ${d.now} · dados de ${d.dataAt}${d.reconstruido ? ` (meta reconstruído: ${d.rodadasNoMeta} rodadas até --ate${d.cobre ? '' : '; ATENÇÃO: o commit não tem a rodada de --ate'})` : ''}`);
  log(`Estado: ${d.status}${d.runsAvaliadas ? '' : ' (rodadas do robô não fornecidas: rodadas_falhando não avaliado)'}`);
  for (const r of d.reasons) log(`- ${r.code}: ${r.text}`);
  for (const f of d.fontes) log(`  fonte ${f.nome}: ${f.status} há ${f.seguidas} rodada(s) desde ${hhmm(f.inicio)}; sources.json: ${f.sourcesStatus ?? '?'} — ${f.sourcesReason ?? '?'}; ${f.voltou ? `voltou às ${hhmm(f.voltou)} (${f.rodadasAteVoltar} rodadas fora)` : 'sem registro de volta'}; episódios nas 24 h anteriores: [${f.episodiosAnteriores.join(', ')}]`);
  if (d.coletoresErros) log(`  erros dos coletores na rodada de --ate (bloqueio = 403/429): ${JSON.stringify(d.coletoresErros)}`);
  if (d.transporte) log(`Caminho até a issue: ${d.transporte.ok ? 'ok' : 'FALHA'} (${d.transporte.motivosEnviados} motivo(s) enviados, ${d.transporte.motivosNaIssue} na issue)${d.transporte.problemas ? '\n  ' + d.transporte.problemas.join('\n  ') : ''}`);
  log(`Classificação: ${d.classificacao.tipo} (${d.classificacao.confianca})${d.classificacao.motivo ? ' — ' + d.classificacao.motivo : ''}`);
  return d;
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());
if (isMain) { try { main(); } catch (e) { console.error('vigia-diagnostico:', String(e?.message || e).slice(0, 200)); process.exitCode = 2; } }
