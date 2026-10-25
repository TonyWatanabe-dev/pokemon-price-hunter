#!/usr/bin/env node
// Conferência PRÉ-merge (só leitura) de uma PR para a main. Complementa tools/merge-audit.mjs (#916), que audita
// DEPOIS do merge. Nunca faz merge, não comenta, não grava: só `gh api` GET.
//
// O resultado vale SÓ NO INSTANTE DA LEITURA (data/hora UTC e SHA da main são sempre impressos). PODE não é
// autorização de merge: a ferramenta não vê dependências funcionais não declaradas, e com enforce_admins=false um
// admin integra mesmo com a main andando.
//
// Quatro estados (precedência: NÃO PODE > EVIDÊNCIA INSUFICIENTE > REVISÃO HUMANA > PODE) e códigos de saída:
//   0 PODE                         critérios técnicos satisfeitos neste instante, sem marcador de risco;
//   1 NÃO PODE                     algum critério falhou (fechada/draft/base, check ausente/falho/rodando, atrás da
//                                  main, conflito, head mudou, depende de PR ainda aberta);
//   3 EVIDÊNCIA INSUFICIENTE       algo não pôde ser lido (PR, proteção, check-runs, compare, arquivos, dependência,
//                                  mergeable=null, main mudou durante a leitura) — fail-closed, rode de novo;
//   4 REVISÃO HUMANA NECESSÁRIA    técnico ok, mas há marcador de risco: caminho crítico (CAMINHOS_CRITICOS),
//                                  marcador no corpo ("bloqueado até", "não integrar"...), label de bloqueio, ou
//                                  dependência fechada sem merge / issue ainda aberta;
//   2 uso inválido (nenhuma chamada à API).
// Trechos em código (`...` ou blocos ```) são ignorados nos marcadores e dependências.
// Dependências: "depende de #N", "Depends on #N", "após #N", "bloqueado por #N", "blocked by #N", "requer #N" no
// corpo. PR #N integrada = ok; PR #N aberta = NÃO PODE (integre #N antes ou corrija o corpo); PR #N fechada sem
// merge ou issue #N aberta = REVISÃO HUMANA; issue #N fechada = ok (aviso); ilegível = EVIDÊNCIA INSUFICIENTE.
//
// Lock de merge (refs/tags/merge-lock, proposta em tools/merge-lock.mjs — só leitura aqui): lock de OUTRO dono
// vigente = NÃO PODE (outra sessão está integrando; a main vai andar — espere, como check rodando); lock de outro dono
// EXPIRADO ou sem dono legível = REVISÃO HUMANA (sessão pode ter morrido no meio do merge; só humano confere e decide
// a liberação forçada); seu lock expirado = NÃO PODE; main andou desde a aquisição do seu lock = REVISÃO HUMANA
// (alguém integrou fora do lock); lock inconsistente (tag aponta para outro SHA, TTL fora de faixa) ou relógio suspeito
// (adquirido no futuro) = REVISÃO HUMANA; sem lock = aviso, ou NÃO PODE com --exigir-lock (que, com EM_USO=false, não
// tem como ser satisfeito); falha ao LER o lock = EVIDÊNCIA INSUFICIENTE.
// Dono = --sessao <id> + esta PR + head atual; sem --sessao nenhum lock é reconhecido como seu.
// O comando de merge NÃO é impresso por padrão; só com --mostrar-comando e só no estado PODE, com sha fixado e o
// aviso de que não é autorização.
// Uso: node tools/pode-integrar.mjs <pr> [--repo dono/repo] [--sha <head esperado>] [--sessao <id>] [--exigir-lock]
//        [--json] [--mostrar-comando]
import { execFileSync } from 'node:child_process';
import { comRetry } from './gh-retry.mjs';
// Só as funções de LEITURA do lock (tools/merge-lock.mjs, proposta): nada aqui adquire, libera ou escreve.
import { lerLock, situacao as situacaoLock, descrever as descreverLock, LOCK_REF, EM_USO as LOCK_EM_USO } from './merge-lock.mjs';

export const REQUIRED = Object.freeze(['test', 'regression', 'golden', 'qa-review']);
export const BASE = 'main';
export const ESTADOS = Object.freeze({
  PODE: 'PODE',
  NAO_PODE: 'NÃO PODE',
  REVISAO: 'REVISÃO HUMANA NECESSÁRIA',
  EVIDENCIA: 'EVIDÊNCIA INSUFICIENTE',
});
export const CODIGOS = Object.freeze({ [ESTADOS.PODE]: 0, [ESTADOS.NAO_PODE]: 1, USO: 2, [ESTADOS.EVIDENCIA]: 3, [ESTADOS.REVISAO]: 4 });
export const AVISO_COMANDO = 'ATENÇÃO: isto NÃO é autorização; exige autorização humana explícita; rode de novo imediatamente antes (o resultado vale só no instante da leitura).';
const ESTADOS_OK = new Set(['clean', 'has_hooks']);
const MAX_PAGINAS = 10;
const MAX_ARQUIVOS = 3000; // limite da rota pulls/{n}/files

/**
 * Caminhos críticos (burn-in, produção, governança). Prefixos/arquivos exatos valem em qualquer pasta indicada;
 * as palavras-chave (watchdog, vigia, ops-incident, dispatcher, burnin) valem fora de test/ e docs/.
 */
export const CAMINHOS_CRITICOS = Object.freeze([
  { re: /^src\/run\.js$/, motivo: 'coleta em produção (src/run.js)' },
  { re: /^src\/adapters\//, motivo: 'adaptadores de loja (src/adapters/)' },
  { re: /^src\/match\.js$/, motivo: 'matching (src/match.js)' },
  { re: /^src\/discovery\//, motivo: 'discovery (src/discovery/)' },
  { re: /^(?!test\/|docs\/).*(watchdog|vigia|ops-incident)/i, motivo: 'Vigia/watchdog/ops-incident' },
  { re: /^(?!test\/|docs\/).*dispatcher/i, motivo: 'Dispatcher' },
  { re: /^(?!test\/|docs\/).*burn-?in/i, motivo: 'burn-in' },
  { re: /^\.github\/workflows\//, motivo: 'workflows (.github/workflows/)' },
  { re: /^\.github\/CODEOWNERS$|^CODEOWNERS$|^docs\/CODEOWNERS$/, motivo: 'CODEOWNERS' },
  { re: /^vercel\.json$/, motivo: 'deploy (vercel.json)' },
  { re: /^config\//, motivo: 'configuração (config/)' },
  { re: /^firebase\/|^firestore\.rules$|^firebase\.json$/, motivo: 'Firebase (regras)' },
  { re: /^account\.js$|^tools\/account\.src\.js$/, motivo: 'conta/autenticação (account.js)' },
  { re: /^api\//, motivo: 'API em produção (api/)' },
  { re: /^src\/agents\/release-/, motivo: 'Release Executor Bridge/Governor' },
  { re: /^tools\/pode-integrar\.mjs$/, motivo: 'o próprio verificador de merge' },
  { re: /^tools\/merge-lock\.mjs$/, motivo: 'lock de merge (tools/merge-lock.mjs)' },
  { re: /^package\.json$|^test\/run-all\.mjs$/, motivo: 'execução da suíte de testes' },
]);

const RE_DEP = /\b(depende(?:\s+d[eao]s?)?|depends\s+on|ap[óo]s(?:\s+[ao]s?)?|bloquead[oa]s?\s+(?:por|pel[ao]s?)|blocked\s+by|requer|requires)\s*:?\s*((?:#\d+(?:\s*(?:,|\be\b|\band\b|&|\/)\s*)?)+)/gi;
const MARCADORES = Object.freeze([
  /bloquead[oa]s?\s+at[ée]/i, /blocked\s+until/i, /n[ãa]o\s+(?:integrar|mergear|fazer\s+merge)/i, /do\s+not\s+merge/i,
  /aguardar?\s+(?:o\s+)?fim\s+do\s+burn-?in/i,
]);
const RE_LABEL = /bloque|block|do.?not.?merge|n[ãa]o.?integrar|wip|depend|revis[ãa]o.?humana|^r3$|hold/i;

/** Remove blocos ``` e trechos `inline` (citações/exemplos não contam como marcador nem dependência). */
export const semCodigo = (t) => String(t || '').replace(/```[\s\S]*?```/g, ' ').replace(/`[^`\n]*`/g, ' ');
const ts = (s) => { const t = Date.parse(s || ''); return Number.isFinite(t) ? t : 0; };
const nome = (s) => String(s || '').trim().toLowerCase();
const curto = (s) => (s ? String(s).slice(0, 10) : '?');

/** Rodada mais recente por nome (ordem: id do check-run, desempate started_at) e as rodadas em andamento. */
export function rodadasPorNome(checkRuns, { appId = null } = {}) {
  const ultimo = new Map(); const andamento = new Map(); const outroApp = new Map();
  const ordem = (r) => [Number(r.id) || 0, ts(r.started_at)];
  for (const r of Array.isArray(checkRuns) ? checkRuns : []) {
    if (!r || typeof r.name !== 'string') continue;
    const k = nome(r.name);
    if (appId != null && Number(r.app?.id) !== Number(appId)) { outroApp.set(k, (outroApp.get(k) || 0) + 1); continue; }
    if (r.status !== 'completed') andamento.set(k, [...(andamento.get(k) || []), r]);
    const prev = ultimo.get(k);
    if (!prev) { ultimo.set(k, r); continue; }
    const [a, b] = [ordem(r), ordem(prev)];
    if (a[0] > b[0] || (a[0] === b[0] && a[1] > b[1])) ultimo.set(k, r);
  }
  return { ultimo, andamento, outroApp };
}

/** Aceita a resposta de branches/main/protection (completa) ou só required_status_checks. */
export function normalizarProtecao(p) {
  if (!p || typeof p !== 'object') return null;
  const completa = 'required_status_checks' in p || 'enforce_admins' in p || 'required_pull_request_reviews' in p;
  const rsc = completa ? (p.required_status_checks || null) : p;
  return {
    rsc,
    enforceAdmins: completa ? (p.enforce_admins?.enabled ?? null) : null,
    aprovacoes: completa ? (p.required_pull_request_reviews ? Number(p.required_pull_request_reviews.required_approving_review_count) || 0 : 0) : null,
  };
}

/** Lista exigida = os 4 fixos + contextos da proteção (nunca menos que os 4). appIds por nome, se a proteção disser. */
export function exigidos(protecao) {
  const rsc = normalizarProtecao(protecao)?.rsc;
  const nomes = [...REQUIRED]; const apps = new Map();
  for (const c of Array.isArray(rsc?.checks) ? rsc.checks : []) {
    if (!c?.context) continue;
    if (!nomes.some((n) => nome(n) === nome(c.context))) nomes.push(c.context);
    if (c.app_id != null && c.app_id !== -1) apps.set(nome(c.context), c.app_id);
  }
  for (const c of Array.isArray(rsc?.contexts) ? rsc.contexts : []) if (!nomes.some((n) => nome(n) === nome(c))) nomes.push(c);
  return { nomes, apps };
}

/** Dependências declaradas no corpo ("depende de #N" etc.), sem a própria PR. */
export function dependenciasDeclaradas(body, propria = null) {
  const out = new Map();
  const texto = semCodigo(body);
  for (const m of texto.matchAll(RE_DEP)) {
    for (const d of m[2].matchAll(/#(\d+)/g)) {
      const n = Number(d[1]);
      if (n > 0 && n !== Number(propria) && !out.has(n)) out.set(n, m[0].replace(/\s+/g, ' ').trim().slice(0, 80));
    }
  }
  return [...out].map(([numero, trecho]) => ({ numero, trecho }));
}

/** Marcadores de risco no corpo e nas labels. */
export function marcadoresDeRisco(pr) {
  const out = [];
  const body = semCodigo(pr?.body);
  for (const re of MARCADORES) { const m = body.match(re); if (m) out.push(`corpo da PR contém "${m[0]}"`); }
  for (const l of Array.isArray(pr?.labels) ? pr.labels : []) {
    const n = typeof l === 'string' ? l : l?.name;
    if (n && RE_LABEL.test(n)) out.push(`label "${n}"`);
  }
  return out;
}

/** Arquivos da PR que tocam caminho crítico (inclui o nome anterior em renomeações). */
export function arquivosCriticos(arquivos) {
  const out = [];
  for (const f of Array.isArray(arquivos) ? arquivos : []) {
    for (const p of new Set([f?.filename, f?.previous_filename].filter(Boolean))) {
      const c = CAMINHOS_CRITICOS.find((x) => x.re.test(p));
      if (c) out.push({ arquivo: p, motivo: c.motivo });
    }
  }
  return out;
}

/**
 * Decisão pura. Entradas lidas da API (null = não lida):
 *   pr / prFinal: pulls/{n} no início e no fim; checkRuns: rodadas do head (filter=all); compare: compare/main...head;
 *   protecao: branches/main/protection; arquivos: pulls/{n}/files; dependencias: { [n]: {tipo:'pr'|'issue', dado} | null };
 *   mainSha / mainShaFinal: git/ref/heads/main no início e no fim; lidoEm: ISO UTC; falhas: [texto] de leituras que falharam.
 */
export function avaliar({
  pr, prFinal, checkRuns, compare, protecao, arquivos = null, dependencias = {}, mainSha = null, mainShaFinal = null,
  lidoEm = new Date().toISOString(), falhas = [], shaEsperado = null, repo = '', mostrarComando = false,
  lock, lockErro = null, sessao = null, exigirLock = false,
}) {
  const motivos = []; const evidencia = [...falhas]; const revisao = []; const avisos = []; const checks = [];
  const criticos = []; const deps = []; let lockSit = null;
  const head = pr?.head?.sha || null;
  const n = pr?.number;
  const fim = () => {
    const estado = motivos.length ? ESTADOS.NAO_PODE : evidencia.length ? ESTADOS.EVIDENCIA : revisao.length ? ESTADOS.REVISAO : ESTADOS.PODE;
    const pode = estado === ESTADOS.PODE;
    const comando = pode && mostrarComando && /^[0-9a-f]{40}$/.test(head || '')
      ? `gh api -X PUT repos/${repo}/pulls/${n}/merge -f sha=${head} -f merge_method=squash` : null;
    return { estado, codigo: CODIGOS[estado], pode, lidoEm, mainSha, head, motivos, evidencia, revisao, avisos, checks, criticos, dependencias: deps, lock: lockSit, comando };
  };

  if (!pr || typeof pr !== 'object') { if (!evidencia.length) evidencia.push('PR não lida'); return fim(); }
  if (pr.state !== 'open') motivos.push(`PR não está aberta (state=${pr.state ?? '?'})`);
  if (pr.merged === true) motivos.push('PR já integrada (merged=true)');
  else if (pr.merged !== false) evidencia.push('campo merged ausente: não dá para confirmar que não foi integrada');
  if (motivos.length || evidencia.length) return fim(); // fechada/integrada: nada mais a conferir
  if (pr.draft) motivos.push('PR em rascunho (draft)');
  if (pr.base?.ref !== BASE) motivos.push(`base é "${pr.base?.ref ?? '?'}", não "${BASE}"`);
  if (!/^[0-9a-f]{40}$/.test(head || '')) evidencia.push('head SHA ausente ou inválido');
  if (shaEsperado && head !== shaEsperado) motivos.push(`head atual ${curto(head)} ≠ SHA esperado ${curto(shaEsperado)} (houve push/update-branch; valide de novo)`);
  if (prFinal) {
    if (prFinal.head?.sha !== head) motivos.push(`head mudou durante a conferência (${curto(head)} → ${curto(prFinal.head?.sha)})`);
    if (prFinal.state !== 'open' || prFinal.merged !== false) motivos.push('PR deixou de estar aberta/não integrada durante a conferência');
  } else evidencia.push('releitura final da PR ausente');

  // main lida: precisa ser a mesma no início, no compare e no fim
  if (!/^[0-9a-f]{40}$/.test(mainSha || '')) evidencia.push('SHA da main não lido');
  else {
    if (mainShaFinal && mainShaFinal !== mainSha) evidencia.push(`main andou durante a conferência (${curto(mainSha)} → ${curto(mainShaFinal)}): rode de novo`);
    else if (!mainShaFinal) evidencia.push('releitura final da main ausente');
    const base = compare?.base_commit?.sha;
    if (base && base !== mainSha) evidencia.push(`compare leu outra main (${curto(base)} ≠ ${curto(mainSha)}): rode de novo`);
  }

  // proteção
  const prot = normalizarProtecao(protecao);
  if (!prot) evidencia.push('proteção da main não lida (checks exigidos, strict, enforce_admins, aprovações)');
  else {
    if (!prot.rsc) avisos.push('proteção da main não exige status checks; conferindo os 4 fixos mesmo assim');
    else if (prot.rsc.strict !== true) avisos.push('proteção da main está com strict=false; esta conferência exige branch atualizada mesmo assim');
    if (prot.enforceAdmins === false) avisos.push('enforce_admins=false: o strict e os checks NÃO protegem merge de admin (admin integra com check pendente ou com a main andando)');
    else if (prot.enforceAdmins == null) avisos.push('enforce_admins não informado na leitura da proteção');
    if (prot.aprovacoes === 0) avisos.push('proteção exige 0 aprovações: nenhum humano precisa revisar antes do merge');
  }

  // checks obrigatórios
  if (!Array.isArray(checkRuns)) evidencia.push('check-runs do head não lidos');
  else {
    const { nomes, apps } = exigidos(protecao);
    for (const req of nomes) {
      const appId = apps.get(nome(req)) ?? null;
      const { ultimo, andamento, outroApp } = rodadasPorNome(checkRuns, { appId });
      const k = nome(req); const r = ultimo.get(k); const vivos = andamento.get(k) || [];
      checks.push({ nome: req, id: r?.id ?? null, status: r?.status ?? null, conclusion: r?.conclusion ?? null, head_sha: r?.head_sha ?? null, rodadas: checkRuns.filter((x) => nome(x?.name) === k).length });
      if (outroApp.get(k)) avisos.push(`${req}: ${outroApp.get(k)} rodada(s) de outro app ignorada(s) (a proteção exige app ${appId})`);
      if (!r) { motivos.push(`${req}: nenhuma rodada no head ${curto(head)}`); continue; }
      if (r.head_sha && head && r.head_sha !== head) motivos.push(`${req}: rodada ${r.id} é de outro SHA (${curto(r.head_sha)})`);
      if (vivos.length) motivos.push(`${req}: rodada em andamento (${vivos.map((x) => `${x.id} ${x.status}`).join(', ')}); espere concluir`);
      else if (r.status !== 'completed') motivos.push(`${req}: rodada mais recente ${r.id} não concluída (${r.status})`);
      else if (r.conclusion !== 'success') {
        const verdeAntiga = checkRuns.some((x) => nome(x?.name) === k && x !== r && x.status === 'completed' && x.conclusion === 'success');
        motivos.push(`${req}: rodada mais recente ${r.id} terminou ${r.conclusion || 'sem conclusão'}${verdeAntiga ? ' (há verde mais antiga, que não vale)' : ''}`);
      }
    }
    for (const r of checkRuns) {
      if (!r?.name || nomes.some((x) => nome(x) === nome(r.name))) continue;
      if (r.status !== 'completed') avisos.push(`check não obrigatório em andamento: ${r.name}`);
      else if (!['success', 'skipped', 'neutral'].includes(r.conclusion)) avisos.push(`check não obrigatório ${r.name}=${r.conclusion}`);
    }
  }

  if (!compare || !Number.isInteger(compare.behind_by)) evidencia.push('comparação com a main não lida: não dá para confirmar que a branch está atualizada');
  else if (compare.behind_by > 0) motivos.push(`branch ${compare.behind_by} commit(s) atrás da main (strict): atualize e espere nova rodada completa dos checks no novo SHA`);

  const st = (prFinal || pr).mergeable_state; const mg = (prFinal || pr).mergeable;
  if (mg === false) motivos.push('mergeable=false (conflito)');
  else if (mg !== true) evidencia.push('mergeable ainda não calculado pelo GitHub (null): rode de novo em instantes');
  if (mg === true && !ESTADOS_OK.has(st)) {
    if (st == null || st === 'unknown') evidencia.push(`mergeable_state=${st ?? '?'} (GitHub ainda calculando)`);
    else motivos.push(`mergeable_state=${st} (precisa ser clean)`);
  }

  // marcadores de risco → revisão humana
  if (!Array.isArray(arquivos)) evidencia.push('arquivos da PR não lidos: não dá para conferir caminhos críticos');
  else {
    if (Number.isInteger(pr.changed_files) && pr.changed_files > arquivos.length) evidencia.push(`só ${arquivos.length} de ${pr.changed_files} arquivos lidos`);
    criticos.push(...arquivosCriticos(arquivos));
    if (criticos.length) revisao.push(`toca caminho crítico: ${criticos.map((c) => `${c.arquivo} (${c.motivo})`).join('; ')}`);
  }
  for (const m of marcadoresDeRisco(pr)) revisao.push(m);

  // lock de merge (só leitura). undefined = não consultado (uso da função pura sem lock).
  if (lock === null) evidencia.push(`lock de merge (${LOCK_REF}) não lido${lockErro ? `: ${lockErro}` : ''}`);
  else if (lock && lock.livre) {
    lockSit = { livre: true };
    if (exigirLock) motivos.push(LOCK_EM_USO
      ? `nenhum lock de merge (${LOCK_REF}) desta sessão: adquira antes (--exigir-lock)`
      : `nenhum lock de merge (${LOCK_REF}) e a aquisição está desligada (EM_USO=false em tools/merge-lock.mjs): --exigir-lock não tem como ser satisfeito sem autorização do dono`);
    else avisos.push(`sem lock de merge (${LOCK_REF}); o procedimento de lock é proposta e não está em uso`);
  } else if (lock) {
    const quem = sessao && head ? { sessao, pr: n, sha: head } : null;
    const s = situacaoLock(lock, { agora: lidoEm, mainAtual: mainSha, quem });
    lockSit = s;
    const d = descreverLock(s);
    if (!s.dono) revisao.push(`lock de merge sem dono legível (${s.motivo}): só um humano identifica o dono e decide`);
    else if (s.ilegivel) revisao.push(`lock de merge inconsistente (${s.motivo}) — ${d}: só um humano decide`);
    else if (s.relogioSuspeito && s.seu) revisao.push(`relógio suspeito: seu lock foi adquirido no futuro (${s.dono.adquiridoEm} > ${lidoEm}); só um humano decide`);
    else if (s.seu) {
      if (s.expirado) motivos.push(`seu lock de merge expirou (${s.dono.expiraEm}): libere e adquira de novo antes de integrar`);
      else if (s.mainAndou) revisao.push(`a main andou desde a aquisição do seu lock (${curto(s.dono.main)} → ${curto(mainSha)}): alguém integrou fora do lock`);
      else avisos.push(`lock de merge é seu (expira ${s.dono.expiraEm})`);
    } else if (s.expirado) revisao.push(`lock de merge de outro dono EXPIRADO — ${d}. A sessão pode ter morrido no meio do merge: humano confere se a PR #${s.dono.pr} foi integrada e decide a liberação forçada`);
    else {
      motivos.push(`lock de merge de outro dono — ${d}${sessao ? '' : ' (sem --sessao nenhum lock é reconhecido como seu)'}: espere a liberação e rode de novo`);
      if (s.relogioSuspeito) revisao.push(`relógio suspeito no lock de outro dono (adquirido em ${s.dono.adquiridoEm}, no futuro): humano confere e decide a liberação forçada`);
    }
  }

  for (const { numero, trecho } of dependenciasDeclaradas(pr.body, n)) {
    const d = dependencias?.[numero];
    const linha = { numero, trecho, tipo: d?.tipo ?? null, situacao: 'ilegível' };
    deps.push(linha);
    if (!d || !d.dado) { evidencia.push(`dependência #${numero} ("${trecho}") não lida`); continue; }
    const x = d.dado;
    if (d.tipo === 'pr') {
      if (x.merged === true) linha.situacao = 'integrada';
      else if (x.state === 'open') { linha.situacao = 'aberta'; motivos.push(`depende da PR #${numero}, ainda não integrada ("${trecho}"): integre #${numero} antes ou corrija o corpo`); }
      else if (x.state === 'closed' && x.merged === false) { linha.situacao = 'fechada sem merge'; revisao.push(`depende da PR #${numero}, fechada sem merge ("${trecho}")`); }
      else evidencia.push(`dependência #${numero}: estado ilegível`);
    } else if (d.tipo === 'issue') {
      if (x.state === 'closed') { linha.situacao = 'issue fechada'; avisos.push(`dependência #${numero} é issue fechada (${x.state_reason || 'sem motivo'}); confira se foi resolvida de fato`); }
      else if (x.state === 'open') { linha.situacao = 'issue aberta'; revisao.push(`depende da issue #${numero}, ainda aberta ("${trecho}")`); }
      else evidencia.push(`dependência #${numero}: estado ilegível`);
    } else evidencia.push(`dependência #${numero}: tipo desconhecido`);
  }
  return fim();
}

// ---------------------------------------------------------------- CLI (gh autenticado; só GET)
const gh = (args) => comRetry((a) => JSON.parse(execFileSync('gh', a, { encoding: 'utf8', maxBuffer: 32 << 20, stdio: ['ignore', 'pipe', 'pipe'] })), args);
const msgErro = (e) => String(e?.message || e).split('\n')[0].slice(0, 160);

async function paginado(api, rota, extrair, max = MAX_PAGINAS) {
  const out = [];
  for (let p = 1; p <= max; p++) {
    const r = await api(['api', `${rota}${rota.includes('?') ? '&' : '?'}per_page=100&page=${p}`]);
    const lote = extrair(r);
    if (!Array.isArray(lote)) throw new Error(`resposta inesperada de ${rota}`);
    out.push(...lote);
    if (lote.length < 100) return out;
  }
  throw new Error(`${rota} excedeu ${max} páginas`);
}

export async function main(argv = process.argv.slice(2), { api = gh, log = console.log, agora = () => new Date() } = {}) {
  const opt = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : null; };
  const repo = opt('repo') || process.env.GITHUB_REPOSITORY || 'TonyWatanabe-dev/pokemon-price-hunter';
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--repo' || argv[i] === '--sha' || argv[i] === '--sessao') { i++; continue; }
    if (!argv[i].startsWith('--')) pos.push(argv[i]);
  }
  const n = Number(String(pos[0] ?? '').replace(/^#/, ''));
  const sha = opt('sha');
  const mostrarComando = argv.includes('--mostrar-comando');
  const exigirLock = argv.includes('--exigir-lock');
  const sessao = opt('sessao');
  const uso = 'uso: node tools/pode-integrar.mjs <pr> [--repo dono/repo] [--sha <head>] [--sessao <id>] [--exigir-lock] [--json] [--mostrar-comando]';
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) { log('uso inválido — repositório inválido'); return CODIGOS.USO; }
  if (!Number.isInteger(n) || n <= 0 || pos.length !== 1) { log(uso); return CODIGOS.USO; }
  if (sha != null && !/^[0-9a-f]{40}$/.test(sha)) { log('uso inválido — --sha precisa ser o SHA completo (40 hex)'); return CODIGOS.USO; }
  if (argv.includes('--sessao') && !/^[A-Za-z0-9._:\/@-]{3,120}$/.test(sessao || '')) { log('uso inválido — --sessao inválido'); return CODIGOS.USO; }

  const falhas = [];
  const ler = async (oque, fn) => { try { return await fn(); } catch (e) { falhas.push(`${oque} não lido(a): ${msgErro(e)}`); return null; } };
  const lidoEm = agora().toISOString();
  const refMain = () => api(['api', `repos/${repo}/git/ref/heads/${BASE}`]).then((r) => { const s = r?.object?.sha; if (!/^[0-9a-f]{40}$/.test(s || '')) throw new Error('ref sem sha'); return s; });

  const mainSha = await ler('SHA da main', refMain);
  const pr = await ler(`PR #${n}`, () => api(['api', `repos/${repo}/pulls/${n}`]));
  const protecao = await ler('proteção da main', () => api(['api', `repos/${repo}/branches/${BASE}/protection`]));
  const head = pr?.head?.sha;
  const viva = pr?.state === 'open' && pr?.merged === false && /^[0-9a-f]{40}$/.test(head || '');
  let checkRuns = null; let compare = null; let arquivos = null; const dependencias = {}; let lock; let lockErro = null;
  if (viva) {
    checkRuns = await ler('check-runs', () => paginado(api, `repos/${repo}/commits/${head}/check-runs?filter=all`, (r) => r?.check_runs));
    compare = await ler('compare com a main', () => api(['api', `repos/${repo}/compare/${BASE}...${head}`]));
    arquivos = await ler('arquivos da PR', () => paginado(api, `repos/${repo}/pulls/${n}/files`, (r) => r, MAX_ARQUIVOS / 100));
    try { lock = await lerLock(api, repo); } catch (e) { lock = null; lockErro = msgErro(e); }
    for (const { numero } of dependenciasDeclaradas(pr.body, n)) {
      try { dependencias[numero] = { tipo: 'pr', dado: await api(['api', `repos/${repo}/pulls/${numero}`]) }; } catch (e) {
        if (!/HTTP 404/.test(String(e?.message || e))) { dependencias[numero] = null; continue; }
        try { dependencias[numero] = { tipo: 'issue', dado: await api(['api', `repos/${repo}/issues/${numero}`]) }; } catch { dependencias[numero] = null; }
      }
    }
  }
  const prFinal = pr ? await ler(`releitura da PR #${n}`, () => api(['api', `repos/${repo}/pulls/${n}`])) : null;
  const mainShaFinal = pr ? await ler('releitura da main', refMain) : null;
  // `falhas` só entra quando a leitura correspondente é necessária (PR fechada não precisa de check-runs)
  const res = avaliar({ pr, prFinal, checkRuns, compare, protecao, arquivos, dependencias, mainSha, mainShaFinal, lidoEm, falhas, shaEsperado: sha, repo, mostrarComando, lock, lockErro, sessao, exigirLock });

  if (argv.includes('--json')) {
    log(JSON.stringify({ pr: n, repo, ...res, aviso: 'resultado vale só no instante da leitura; PODE não é autorização de merge', ...(res.comando ? { avisoComando: AVISO_COMANDO } : {}) }, null, 2));
    return res.codigo;
  }
  log(`PR #${n} · head ${curto(res.head)} → ${res.estado}  (código ${res.codigo})`);
  log(`  lido em ${lidoEm} (UTC) · main ${mainSha || '?'}`);
  for (const c of res.checks) log(`  ${c.nome.padEnd(11)} ${c.status === 'completed' ? c.conclusion : c.status || 'ausente'}${c.id ? ` (rodada ${c.id}; ${c.rodadas} no SHA)` : ''}`);
  for (const d of res.dependencias) log(`  dependência #${d.numero}: ${d.situacao}`);
  if (res.lock) log(`  lock de merge: ${descreverLock(res.lock)}${res.lock.seu ? ' (seu)' : ''}`);
  for (const m of res.motivos) log(`  ✗ ${m}`);
  for (const m of res.evidencia) log(`  ? ${m}`);
  for (const m of res.revisao) log(`  ⚑ ${m}`);
  for (const a of res.avisos) log(`  ! ${a}`);
  if (res.estado === ESTADOS.PODE) log('\nPODE = critérios técnicos satisfeitos NESTE instante. Não é autorização de merge e não enxerga dependências funcionais não declaradas.');
  if (res.estado === ESTADOS.REVISAO) log('\nTécnico ok, mas há marcador de risco: só um humano decide. Esta ferramenta não exibe comando neste estado.');
  if (res.comando) {
    log(`\n${AVISO_COMANDO}`);
    log(`  ${res.comando}`);
    log(`  (antes: node tools/pode-integrar.mjs ${n} --sha ${res.head}; depois: node tools/merge-audit.mjs --prs ${n})`);
  } else if (res.estado === ESTADOS.PODE && !mostrarComando) log('Comando de merge omitido (use --mostrar-comando; exige autorização humana explícita).');
  return res.codigo;
}

if (process.argv[1]?.endsWith('pode-integrar.mjs')) process.exitCode = await main();
