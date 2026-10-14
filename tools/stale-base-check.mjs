// Alerta de PR com base desatualizada que pode desfazer código (#667; incidente de 13/10: #555 e #576 reverteram #536 e #575).
// Compara o efeito do PR na main atual (merge simulado com `git merge-tree`, sem gravar nada) com o que entrou na main
// depois do ponto de partida da branch. Falha quando o PR remove, nos mesmos arquivos, linhas que a main ganhou depois
// desse ponto: sinal típico de arquivo regravado a partir de cópia antiga (revert silencioso).
// Ponto de partida = pai do commit mais antigo da cadeia de primeiro pai da branch que não está na main; por isso
// "Update branch" (merge da main na branch) não esconde o revert feito depois. Linha removida e readicionada em outro
// lugar do mesmo diff (mover/renomear) não conta; linhas sem letra ou dígito (`}`, `);`, vazias) são ignoradas.
// Remoção intencional: incluir `[remocao-intencional]` na mensagem de um commit da branch (vira aviso, sai 0).
// Uso: node tools/stale-base-check.mjs [--base origin/main] [--head HEAD] [--repo .]
//   Sai 0 = ok/sem risco · 1 = remoção suspeita · 2 = erro (refs/histórico ausentes: falha fechado).
// Só leitura; precisa do histórico das duas pontas (no CI: checkout com fetch-depth: 0). Sem rede, sem secrets.
import { spawnSync } from 'node:child_process';

export const MARCADOR = '[remocao-intencional]';
const LIMITE_POR_ARQUIVO = 20;

function git(cwd, args, { ok = [0] } = {}) {
  const r = spawnSync('git', ['-c', 'core.quotePath=false', ...args], { cwd, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  if (r.error) throw new Error('git indisponível: ' + r.error.message);
  if (!ok.includes(r.status)) throw new Error(`git ${args[0]} falhou (${r.status}): ${(r.stderr || '').trim().split('\n')[0]}`);
  return r;
}

/** Linha que merece comparação: tem ao menos uma letra ou dígito (ignora vazias e só pontuação, como `}` e `);`). */
export function significativa(linha) {
  return /[\p{L}\p{N}]/u.test(linha);
}

function caminho(bruto) {
  let p = bruto.replace(/\t$/, '');
  if (p.startsWith('"') && p.endsWith('"')) { try { p = JSON.parse(p); } catch { /* mantém como veio */ } }
  if (p === '/dev/null') return null;
  return p.replace(/^[ab]\//, '');
}

/** Diff unificado (`git diff -U0 --no-renames`) → { removidas: Map(arquivo antigo → linhas), adicionadas: Map(arquivo novo → linhas) }. */
export function parseDiff(texto) {
  const removidas = new Map(); const adicionadas = new Map();
  let antigo = null; let novo = null; let emHunk = false;
  const push = (m, k, v) => { if (k == null) return; if (!m.has(k)) m.set(k, []); m.get(k).push(v); };
  for (const l of String(texto || '').split('\n')) {
    if (l.startsWith('diff --git ')) { antigo = novo = null; emHunk = false; continue; }
    if (!emHunk && l.startsWith('--- ')) { antigo = caminho(l.slice(4)); continue; }
    if (!emHunk && l.startsWith('+++ ')) { novo = caminho(l.slice(4)); continue; }
    if (l.startsWith('@@')) { emHunk = true; continue; }
    if (!emHunk) continue;
    if (l.startsWith('-')) push(removidas, antigo, l.slice(1).trimEnd());
    else if (l.startsWith('+')) push(adicionadas, novo, l.slice(1).trimEnd());
  }
  return { removidas, adicionadas };
}

const contar = (linhas) => { const c = new Map(); for (const l of linhas) c.set(l, (c.get(l) || 0) + 1); return c; };

/**
 * Remoções suspeitas: linhas que o PR remove de um arquivo (efeito na main) e que a main adicionou nesse mesmo arquivo
 * depois do ponto de partida da branch, sem serem readicionadas em nenhum lugar do efeito (multiconjunto).
 * efeito/main: saídas de parseDiff. Retorna [{ arquivo, linhas: [...] }] ordenado por arquivo.
 */
export function remocoesSuspeitas(efeito, main) {
  const readicionadas = contar([...efeito.adicionadas.values()].flat());
  const out = [];
  for (const arquivo of [...efeito.removidas.keys()].sort()) {
    const daMain = contar(main.adicionadas.get(arquivo) || []);
    const linhas = [];
    for (const l of efeito.removidas.get(arquivo)) {
      if (!significativa(l) || !daMain.get(l)) continue;
      if (readicionadas.get(l)) { readicionadas.set(l, readicionadas.get(l) - 1); continue; }
      daMain.set(l, daMain.get(l) - 1);
      linhas.push(l);
    }
    if (linhas.length) out.push({ arquivo, linhas });
  }
  return out;
}

const commit = (cwd, ref) => git(cwd, ['rev-parse', '--verify', '--quiet', ref + '^{commit}'], { ok: [0, 1] }).stdout.trim();

/** Ponto de partida da branch: pai do commit mais antigo da cadeia de primeiro pai de head fora da base. */
export function pontoDePartida(cwd, base, head) {
  const proprios = git(cwd, ['rev-list', '--first-parent', head, '--not', base]).stdout.split('\n').filter(Boolean);
  if (!proprios.length) return null;
  const pai = git(cwd, ['rev-parse', '--verify', '--quiet', proprios.at(-1) + '^1^{commit}'], { ok: [0, 1] }).stdout.trim();
  if (pai && git(cwd, ['merge-base', '--is-ancestor', pai, base], { ok: [0, 1] }).status === 0) return pai;
  return git(cwd, ['merge-base', base, head]).stdout.trim();
}

/** Verificação completa num repositório local. Lança erro se refs/histórico faltarem (quem chama falha fechado). */
export function verificar({ cwd = process.cwd(), base = 'origin/main', head = 'HEAD' } = {}) {
  const b = commit(cwd, base); const h = commit(cwd, head);
  if (!b) throw new Error(`base "${base}" não encontrada (no CI, use checkout com fetch-depth: 0)`);
  if (!h) throw new Error(`head "${head}" não encontrado`);
  const inicio = pontoDePartida(cwd, b, h);
  if (!inicio) return { status: 'ok', motivo: 'head já está contido na base', suspeitas: [] };
  if (inicio === b) return { status: 'ok', motivo: 'branch atualizada: a main não mudou desde o ponto de partida', suspeitas: [] };

  const mt = git(cwd, ['merge-tree', '--write-tree', '--no-messages', b, h], { ok: [0, 1] });
  const conflito = mt.status === 1;
  const alvo = conflito ? h : mt.stdout.split('\n')[0].trim();
  const diff = (de, para, arquivos) => parseDiff(git(cwd, ['diff', '--no-color', '--no-ext-diff', '--no-renames', '-U0',
    '--src-prefix=a/', '--dst-prefix=b/', de, para, '--', ...arquivos]).stdout);

  const efeito = diff(b, alvo, []);
  const tocados = [...efeito.removidas.keys()];
  if (!tocados.length) return { status: 'ok', motivo: 'o PR não remove linhas da main', suspeitas: [], conflito };
  const main = diff(inicio, b, tocados.map((f) => ':(literal)' + f));
  const suspeitas = remocoesSuspeitas(efeito, main);
  if (!suspeitas.length) return { status: 'ok', motivo: 'nenhuma linha recente da main é removida', suspeitas, conflito };

  const msgs = git(cwd, ['log', '--format=%B', h, '--not', b]).stdout;
  const intencional = msgs.includes(MARCADOR);
  return { status: intencional ? 'aviso' : 'falha', motivo: intencional ? `remoção declarada intencional (${MARCADOR})` : 'possível revert silencioso',
    suspeitas, conflito, inicio, base: b, head: h };
}

export function relatorio(r) {
  const linhas = [];
  if (r.status === 'ok') return `✓ base da branch: ${r.motivo}.`;
  const total = r.suspeitas.reduce((s, x) => s + x.linhas.length, 0);
  linhas.push(`${r.status === 'falha' ? '✗' : '⚠'} O PR remove ${total} linha(s) que entraram na main depois do ponto de partida da branch (${r.motivo}).`);
  if (r.conflito) linhas.push('  (o merge com a main atual tem conflito; comparação feita com o head do PR)');
  for (const { arquivo, linhas: ls } of r.suspeitas) {
    linhas.push(`  ${arquivo}:`);
    for (const l of ls.slice(0, LIMITE_POR_ARQUIVO)) linhas.push(`    - ${l.trim().slice(0, 160)}`);
    if (ls.length > LIMITE_POR_ARQUIVO) linhas.push(`    … e mais ${ls.length - LIMITE_POR_ARQUIVO}`);
  }
  if (r.status === 'falha') {
    linhas.push('Atualize a branch com a main atual (git fetch origin && git merge origin/main) e reaplique só as suas mudanças');
    linhas.push('sobre a versão atual desses arquivos, sem regravá-los a partir de uma cópia antiga.');
    linhas.push(`Se a remoção for intencional, inclua ${MARCADOR} na mensagem de um commit da branch e explique no PR.`);
  }
  return linhas.join('\n');
}

const isMain = process.argv[1] && import.meta.url.endsWith(process.argv[1].replace(/\\/g, '/').split('/').pop());
if (isMain) {
  const args = process.argv.slice(2); const opt = (k, d) => { const i = args.indexOf('--' + k); return i >= 0 && args[i + 1] ? args[i + 1] : d; };
  let codigo = 2;
  try {
    const r = verificar({ cwd: opt('repo', process.cwd()), base: opt('base', 'origin/main'), head: opt('head', 'HEAD') });
    (r.status === 'falha' ? console.error : console.log)(relatorio(r));
    codigo = r.status === 'falha' ? 1 : 0;
  } catch (e) {
    console.error('✗ verificação de base desatualizada não pôde rodar: ' + e.message);
  }
  process.exit(codigo);
}
