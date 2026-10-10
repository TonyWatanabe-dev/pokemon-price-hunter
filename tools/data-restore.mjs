// Restauração dos retratos do ramo data guardados em etiquetas data-backup/AAAA-MM-DD (ver tools/data-backup.mjs e docs/backup.md).
// Só lê do remoto e grava numa pasta local. Nunca envia nada (sem push), nunca mexe no ramo data.
//
// Uso:
//   node tools/data-restore.mjs --list                       etiquetas disponíveis (mais nova primeiro)
//   node tools/data-restore.mjs --verify <etiqueta>          confere o retrato (JSONs, ofertas, produtos, generatedAt, meta.ops)
//   node tools/data-restore.mjs --to <pasta> <etiqueta>      SIMULAÇÃO: mostra o que seria extraído
//   node tools/data-restore.mjs --to <pasta> <etiqueta> --apply   extrai data/ para <pasta>/data (pasta precisa estar vazia)
// <etiqueta> aceita o nome completo (data-backup/2026-10-09) ou só a data (2026-10-09). --remote <nome> troca o remoto (padrão origin).
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { makeGit, listBackupTags, validateSnapshot, PREFIX } from './data-backup.mjs';

export const tagName = (t) => (String(t).startsWith(PREFIX) ? String(t) : PREFIX + t);

// Busca a etiqueta (só leitura) e devolve o sha do commit do retrato.
export function fetchTag(git, tag, remote = 'origin') {
  const name = tagName(tag);
  if (!/^data-backup\/[\w.-]+$/.test(name)) throw new Error(`etiqueta inválida: ${name}`);
  const local = `refs/data-restore/${name.slice(PREFIX.length)}`;
  git.run(['fetch', '-q', '--no-tags', '--depth', '1', remote, `+refs/tags/${name}:${local}`]);
  return git.run(['rev-parse', `${local}^{commit}`]);
}

// Arquivos de data/ no commit: [{ path, mode, sha, size }]
export function snapshotFiles(git, commit) {
  const out = git.run(['ls-tree', '-r', '-l', '-z', commit, '--', 'data']);
  return out.split('\0').filter(Boolean).map((l) => {
    const [meta, file] = l.split('\t'); const [mode, type, sha, size] = meta.trim().split(/\s+/);
    return { path: file, mode, type, sha, size: Number(size) };
  }).filter((f) => f.type === 'blob');
}

export function verify(git, tag, remote = 'origin') {
  const commit = fetchTag(git, tag, remote);
  const check = validateSnapshot(git, commit);
  const files = snapshotFiles(git, commit);
  const hist = git.show(commit, 'data/history.jsonl');
  return {
    tag: tagName(tag), commit, ...check,
    info: { ...check.info, files: files.length, bytes: files.reduce((s, f) => s + f.size, 0),
      histFiles: files.filter((f) => f.path.startsWith('data/hist/')).length,
      historyLines: hist ? hist.toString('utf8').split('\n').filter(Boolean).length : 0 },
  };
}

// Extrai data/ do retrato em <dir>/data. Sem apply, só diz o que faria.
export function restoreTo(git, tag, dir, { remote = 'origin', apply = false } = {}) {
  const v = verify(git, tag, remote);
  if (!v.ok) throw new Error(`retrato inválido (${v.tag}): ${v.errors.join('; ')}`);
  const files = snapshotFiles(git, v.commit);
  const target = path.resolve(dir, 'data');
  if (apply) {
    if (fs.existsSync(target) && fs.readdirSync(target).length) throw new Error(`${target} já existe e não está vazia: escolha uma pasta vazia`);
    for (const f of files) {
      const out = path.join(path.resolve(dir), f.path);
      if (!out.startsWith(target + path.sep)) throw new Error(`caminho fora de data/: ${f.path}`);
      fs.mkdirSync(path.dirname(out), { recursive: true });
      fs.writeFileSync(out, git.run(['cat-file', 'blob', f.sha], { buffer: true }));
    }
  }
  return { ...v, target, written: apply ? files.length : 0, files: files.map((f) => f.path) };
}

function main(argv) {
  const git = makeGit();
  const i = argv.indexOf('--remote'); const remote = i >= 0 ? argv[i + 1] : 'origin';
  if (argv.includes('--list')) {
    const tags = listBackupTags(git, remote);
    if (!tags.length) { console.log('Nenhuma etiqueta data-backup/* no remoto.'); return; }
    for (const t of tags) console.log(`${t.name}\t${t.commit}`);
    console.log(`${tags.length} etiqueta(s).`);
    return;
  }
  const show = (v) => {
    console.log(`${v.tag} → ${v.commit}`);
    console.log(`  generatedAt: ${v.info.generatedAt}  ofertas: ${v.info.offers}  produtos: ${v.info.products}  meta.ops: ${v.info.ops ? 'sim' : 'não'}`);
    console.log(`  arquivos: ${v.info.files} (${(v.info.bytes / 1e6).toFixed(1)} MB; hist/: ${v.info.histFiles}; history.jsonl: ${v.info.historyLines} linhas)`);
    for (const w of v.warnings) console.log(`  aviso: ${w}`);
    for (const e of v.errors) console.log(`  ERRO: ${e}`);
  };
  const vi = argv.indexOf('--verify');
  if (vi >= 0) {
    const v = verify(git, argv[vi + 1], remote); show(v);
    console.log(v.ok ? 'Retrato válido.' : 'Retrato INVÁLIDO.');
    if (!v.ok) process.exitCode = 1;
    return;
  }
  const ti = argv.indexOf('--to');
  if (ti >= 0) {
    const dir = argv[ti + 1]; const tag = argv[ti + 2];
    if (!dir || !tag || tag.startsWith('--')) throw new Error('uso: --to <pasta> <etiqueta> [--apply]');
    const apply = argv.includes('--apply');
    const r = restoreTo(git, tag, dir, { remote, apply }); show(r);
    if (apply) console.log(`Extraídos ${r.written} arquivos em ${r.target}. Nada foi enviado ao remoto.`);
    else console.log(`SIMULAÇÃO: ${r.files.length} arquivos iriam para ${r.target}. Repita com --apply para extrair.`);
    return;
  }
  console.log('Uso: --list | --verify <etiqueta> | --to <pasta> <etiqueta> [--apply]  (opcional: --remote <nome>)');
  process.exitCode = 2;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try { main(process.argv.slice(2)); } catch (e) { console.error('Restauração falhou:', (e.stderr?.toString() || e.message).trim()); process.exitCode = 1; }
}
