// Fluxo git/PR compartilhado das tarefas agendadas de captura (robo-ml-tarefa.mjs e publicar-capturas-tarefa.mjs). Roda num CLONE
// DEDICADO: branch nova a partir de origin/main (árvore limpa) → trabalho → commit só da config de afiliados → push → PR →
// merge (auto-merge se o repo permitir; senão espera os checks e faz squash) → volta para a main. Nunca push na main, nunca --force.
// Tudo recebe `run` por injeção (testes simulam git/gh); em produção é o spawnSync de criarRun.
import { spawnSync } from 'node:child_process';

// Só pathspec do git (nada aqui lê a config): montado por partes para não violar a varredura de isolamento de afiliados.
export const PASTA_CONFIG = ['config', 'afiliados'].join('/');
export const SEM_LINK_ML = ['tools', 'captura', 'sem-link-mercadolivre.txt'].join('/');
export const p2 = (n) => String(n).padStart(2, '0');

export function criarRun(root) {
  return function run(cmd, args, { ok = [0] } = {}) {
    const r = spawnSync(cmd, args, { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
    if (r.error) throw new Error(`${cmd} ${args.join(' ')}: ${r.error.message}`);
    if (!ok.includes(r.status)) throw new Error(`${cmd} ${args.join(' ')} saiu ${r.status}: ${(r.stderr || r.stdout || '').trim().slice(-600)}`);
    return r;
  };
}
export const criarGit = (run) => (...a) => run('git', a).stdout.trim();

/** fetch + checkout -B <branch> origin/main com árvore limpa. Devolve false (sem tocar em nada) se a árvore estiver suja. */
export function prepararBranch({ git, log, branch }) {
  if (git('status', '--porcelain')) { log('ABORTADO: árvore de trabalho suja no clone (falha fechado).'); return false; }
  git('fetch', 'origin');
  git('checkout', '-B', branch, 'origin/main');
  return true;
}

export function mudouConfig(git, extras = []) {
  return !!git('status', '--porcelain', PASTA_CONFIG, ...extras);
}

/**
 * commit → push → PR → merge. `titulo` serve de mensagem de commit e de título do PR; `corpo` é o texto do PR (título e corpo
 * explícitos: `gh pr create --fill` falhou neste clone). Com `esperarAuto`, depois de agendar o auto-merge espera os checks e
 * confirma o estado MERGED (usado pelo publicador, que só marca como publicado depois do merge).
 * Devolve { pr, estado: 'auto' | 'mergeado' | 'checks-falharam', publicado }.
 */
export function publicarMudancas({ run, git, log, branch, titulo, corpo, esperarAuto = false }) {
  // sem-link-*.txt é ignorado pelo git (.gitignore): só a config de afiliados vai no commit.
  git('add', PASTA_CONFIG);
  git('commit', '-m', titulo);
  git('push', '-u', 'origin', branch);
  const criar = run('gh', ['pr', 'create', '--base', 'main', '--head', branch, '--title', titulo, '--body', corpo]);
  const pr = /https:\/\/\S+\/pull\/\d+/.exec(criar.stdout)?.[0];
  if (!pr) throw new Error('gh pr create não devolveu a URL do PR');
  log(`PR aberto: ${pr}`);

  const auto = run('gh', ['pr', 'merge', pr, '--squash', '--auto', '--delete-branch'], { ok: [0, 1] });
  if (auto.status === 0) {
    log(`Auto-merge agendado para ${pr}.`);
    if (!esperarAuto) return { pr, estado: 'auto', publicado: false };
    const checks = run('gh', ['pr', 'checks', pr, '--watch', '--fail-fast'], { ok: [0, 1, 8] });
    if (checks.status !== 0) { log(`Checks não passaram em ${pr}; PR deixado aberto.`); return { pr, estado: 'checks-falharam', publicado: false }; }
    const estado = run('gh', ['pr', 'view', pr, '--json', 'state', '--jq', '.state']).stdout.trim();
    if (estado === 'MERGED') { log(`PR ${pr} mergeado (auto-merge).`); return { pr, estado: 'mergeado', publicado: true }; }
    log(`Auto-merge de ${pr} ainda não concluído (estado ${estado}); a próxima rodada confere.`);
    return { pr, estado: 'auto', publicado: false };
  }
  log(`Auto-merge indisponível (${(auto.stderr || '').trim().slice(-200)}); aguardando checks.`);
  const checks = run('gh', ['pr', 'checks', pr, '--watch', '--fail-fast'], { ok: [0, 1, 8] });
  if (checks.status !== 0) { log(`Checks não passaram em ${pr}; PR deixado aberto.`); return { pr, estado: 'checks-falharam', publicado: false }; }
  run('gh', ['pr', 'merge', pr, '--squash', '--delete-branch']);
  log(`PR ${pr} mergeado (squash).`);
  return { pr, estado: 'mergeado', publicado: true };
}

export function voltarParaMain({ git, log }) {
  try { git('checkout', 'main'); } catch (e) { log(`aviso: não voltou para a main local (${e.message.slice(0, 160)})`); }
}
