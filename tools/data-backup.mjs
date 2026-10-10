// Backup do ramo "data": marca o commit atual com a etiqueta data-backup/AAAA-MM-DD (UTC) e apaga as etiquetas antigas.
// Por quê: tools/push-data.sh reescreve o ramo data a cada rodada (um commit só, push -f), então não existe histórico.
// Uma etiqueta mantém o commit vivo no GitHub mesmo depois das reescritas. Ver docs/backup.md.
//
// Uso (no Actions, .github/workflows/backup-data.yml): node tools/data-backup.mjs
//   --remote origin   remoto (padrão origin)
//   --branch data     ramo dos dados (padrão data)
//   --retention 14    dias de retenção (padrão: BACKUP_RETENTION_DAYS ou 14; inválido/fora de 3–365 → 14)
//   --now <ISO>       relógio (só para teste)
//   --dry-run         valida e mostra o que faria, sem enviar nada ao remoto
//
// Regras:
// - marca o commit BUSCADO (sha fixo), nunca o nome do ramo: se o robô reescrever o ramo no meio, a etiqueta continua
//   apontando para um retrato completo e coerente;
// - uma etiqueta por dia; se a do dia já existe, não mexe nela (idempotente);
// - retrato inválido (state.json ilegível/sem generatedAt/sem offers, meta.json ilegível) não é marcado e o job falha;
// - só apaga etiquetas data-backup/AAAA-MM-DD mais velhas que a retenção, e nunca as 3 mais recentes;
// - etiqueta com outro formato (ex.: data-backup/antes-da-migracao) nunca é apagada.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import { pathToFileURL } from 'node:url';

export const PREFIX = 'data-backup/';
export const KEEP_MIN = 3;
export const RETENTION_DEFAULT = 14;
const DAY = 864e5;
const BOT = ['-c', 'user.name=price-hunter-bot', '-c', 'user.email=bot@users.noreply.github.com'];

// Invólucro fino do git: tudo o que o backup e a restauração fazem passa por aqui (os testes usam um repositório temporário).
export function makeGit(cwd = process.cwd()) {
  const run = (args, { buffer = false } = {}) => {
    const out = execFileSync('git', args, { cwd, stdio: ['ignore', 'pipe', 'pipe'], maxBuffer: 512 * 1024 * 1024 });
    return buffer ? out : out.toString('utf8').trim();
  };
  return {
    cwd, run,
    // conteúdo de um arquivo num commit; null se não existir
    show(rev, file) { try { return run(['show', `${rev}:${file}`], { buffer: true }); } catch { return null; } },
  };
}

// Dias de retenção a partir da variável do repositório. Qualquer valor estranho cai no padrão seguro.
export function retentionDays(raw) {
  const s = String(raw ?? '').trim();
  if (!/^\d+$/.test(s)) return RETENTION_DEFAULT;
  const n = Number(s);
  return n >= 3 && n <= 365 ? n : RETENTION_DEFAULT;
}

export const tagFor = (now) => PREFIX + new Date(now).toISOString().slice(0, 10);

// Data de uma etiqueta data-backup/AAAA-MM-DD; null para qualquer outro formato.
export function tagDate(name) {
  const m = /^data-backup\/(\d{4}-\d{2}-\d{2})$/.exec(name);
  if (!m) return null;
  const t = Date.parse(m[1] + 'T00:00:00Z');
  return Number.isFinite(t) && new Date(t).toISOString().slice(0, 10) === m[1] ? t : null;
}

// Etiquetas data-backup/* no remoto: [{ name, sha, commit }] (commit = alvo final, também para etiqueta anotada).
export function listBackupTags(git, remote = 'origin') {
  const out = git.run(['ls-remote', '--tags', remote, `refs/tags/${PREFIX}*`]);
  const map = new Map();
  for (const line of out.split('\n').filter(Boolean)) {
    const [sha, ref] = line.split('\t');
    const peeled = ref.endsWith('^{}');
    const name = ref.replace(/^refs\/tags\//, '').replace(/\^\{\}$/, '');
    const e = map.get(name) || { name, sha: null, commit: null };
    if (peeled) e.commit = sha; else { e.sha = sha; e.commit ??= sha; }
    map.set(name, e);
  }
  return [...map.values()].sort((a, b) => (a.name < b.name ? 1 : -1));
}

// Confere um retrato do ramo data num commit. Não muda nada.
export function validateSnapshot(git, rev) {
  const errors = []; const warnings = []; const info = {};
  const json = (file) => {
    const buf = git.show(rev, file);
    if (!buf) { errors.push(`${file} ausente`); return null; }
    try { return JSON.parse(buf.toString('utf8')); } catch (e) { errors.push(`${file} ilegível (${e.message})`); return null; }
  };
  const state = json('data/state.json');
  if (state) {
    if (!state.generatedAt || !Number.isFinite(Date.parse(state.generatedAt))) errors.push('state.json sem generatedAt válido');
    if (!Array.isArray(state.offers)) errors.push('state.json sem a lista offers');
    info.generatedAt = state.generatedAt ?? null;
    info.offers = Array.isArray(state.offers) ? state.offers.length : null;
    info.products = Array.isArray(state.products) ? state.products.length : null;
    if (info.offers === 0) warnings.push('state.json com zero ofertas');
  }
  const meta = json('data/meta.json');
  if (meta) {
    if (typeof meta !== 'object' || Array.isArray(meta)) errors.push('meta.json não é um objeto');
    info.ops = !!meta?.ops?.last;
    info.lastRunId = meta?.ops?.last?.runId ?? null;
    if (!info.ops) warnings.push('meta.json sem ops.last');
  }
  return { ok: errors.length === 0, errors, warnings, info };
}

// Quais etiquetas datadas apagar: mais velhas que a retenção, menos as KEEP_MIN mais recentes.
export function planPrune(names, { now, retention = RETENTION_DEFAULT, keep = KEEP_MIN } = {}) {
  const today = Date.parse(new Date(now).toISOString().slice(0, 10) + 'T00:00:00Z');
  const dated = names.map((name) => ({ name, t: tagDate(name) })).filter((x) => x.t != null).sort((a, b) => b.t - a.t);
  const protectedNames = new Set(dated.slice(0, Math.max(keep, KEEP_MIN)).map((x) => x.name));
  return dated.filter((x) => !protectedNames.has(x.name) && (today - x.t) / DAY > retention).map((x) => x.name);
}

export function runBackup({ git, remote = 'origin', branch = 'data', now = new Date().toISOString(), retention = RETENTION_DEFAULT, dryRun = false, log = console.log } = {}) {
  const tag = tagFor(now);
  // 1) Busca o commit atual do ramo dos dados e fixa o sha (é ele que será marcado).
  const local = `refs/data-backup/${branch}`;
  git.run(['fetch', '-q', '--no-tags', '--depth', '1', remote, `+refs/heads/${branch}:${local}`]);
  const commit = git.run(['rev-parse', `${local}^{commit}`]);
  log(`Ramo ${branch}: ${commit}`);

  let tags = listBackupTags(git, remote);
  const existing = tags.find((x) => x.name === tag);
  let status;
  let check = null;
  if (existing) {
    status = 'exists';
    log(`${tag} já existe (${existing.commit.slice(0, 12)}): nada a marcar hoje.`);
  } else {
    // 2) Valida antes de marcar.
    check = validateSnapshot(git, commit);
    for (const w of check.warnings) log(`Aviso: ${w}`);
    if (!check.ok) {
      log(`Retrato inválido, NÃO marcado: ${check.errors.join('; ')}`);
      return { status: 'invalid', tag, commit, errors: check.errors, pruned: [], check };
    }
    const msg = [`Backup do ramo ${branch}`, `generatedAt: ${check.info.generatedAt}`, `ofertas: ${check.info.offers}`,
      `produtos: ${check.info.products}`, `ops.last.runId: ${check.info.lastRunId ?? '-'}`].join('\n');
    if (dryRun) log(`[simulação] criaria ${tag} → ${commit}`);
    else {
      git.run([...BOT, 'tag', '-a', '-f', '-m', msg, tag, commit]);
      git.run(['push', '-q', remote, `refs/tags/${tag}:refs/tags/${tag}`]);
      log(`${tag} criada → ${commit} (${check.info.offers} ofertas, dados de ${check.info.generatedAt}).`);
    }
    status = 'created';
    tags = [{ name: tag, sha: null, commit }, ...tags];
  }

  // 3) Retenção (só depois de um retrato garantido para hoje).
  const pruned = planPrune(tags.map((x) => x.name), { now, retention });
  if (pruned.length) {
    if (dryRun) log(`[simulação] apagaria: ${pruned.join(', ')}`);
    else {
      git.run(['push', '-q', remote, ...pruned.map((n) => `:refs/tags/${n}`)]);
      for (const n of pruned) { try { git.run(['tag', '-d', n]); } catch { /* não existia localmente */ } }
      log(`Apagadas (mais de ${retention} dias): ${pruned.join(', ')}`);
    }
  }
  return { status, tag, commit, errors: [], pruned, check, kept: tags.map((x) => x.name).filter((n) => !pruned.includes(n)) };
}

function arg(argv, name) { const i = argv.indexOf(name); return i >= 0 ? argv[i + 1] : undefined; }

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const argv = process.argv.slice(2);
  const retention = retentionDays(arg(argv, '--retention') ?? process.env.BACKUP_RETENTION_DAYS);
  const lines = [];
  const log = (s) => { console.log(s); lines.push(s); };
  let r;
  try {
    r = runBackup({ git: makeGit(), remote: arg(argv, '--remote') || 'origin', branch: arg(argv, '--branch') || 'data',
      now: arg(argv, '--now') || new Date().toISOString(), retention, dryRun: argv.includes('--dry-run'), log });
  } catch (e) {
    log(`Backup falhou: ${(e.stderr?.toString() || e.message).trim()}`);
    r = { status: 'error' };
  }
  if (process.env.GITHUB_STEP_SUMMARY) {
    const head = { created: '✅ Retrato marcado', exists: '✅ Retrato do dia já existia', invalid: '❌ Retrato inválido (não marcado)', error: '❌ Backup falhou' }[r.status];
    fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, `### ${head}\n\nRetenção: ${retention} dias (mínimo ${KEEP_MIN} etiquetas)\n\n` + lines.map((l) => `- ${l}`).join('\n') + '\n');
  }
  if (r.status === 'invalid' || r.status === 'error') process.exitCode = 1;
}
