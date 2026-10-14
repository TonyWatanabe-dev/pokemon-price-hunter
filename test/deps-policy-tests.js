// Política de dependências (docs/dependencias.md, #665). Sem rede: só lê package.json, package-lock.json e o doc.
// Falha se aparecer pacote no lock (ou dependência direta) sem linha no inventário do doc, dependência declarada sem
// versão travada no lock, ou script de instalação (postinstall & cia.) no package.json ou em pacote do lock.
// Complementa test/deps-tests.js (lista APROVADAS e coerência/integridade do lock).
import assert from 'node:assert/strict';
import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let n = 0;
async function t(name, fn) { try { await fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } }
const ler = (f) => { const p = path.join(root, f); return fs.existsSync(p) ? fs.readFileSync(p, 'utf8') : null; };
const pkg = JSON.parse(ler('package.json'));
const lockTxt = ler('package-lock.json');
const lock = lockTxt == null ? null : JSON.parse(lockTxt);
const doc = ler('docs/dependencias.md');

const CAMPOS = ['dependencies', 'devDependencies', 'optionalDependencies'];
/** Scripts que o npm roda sozinho em `npm install`/`npm ci` (ciclo de vida da raiz). */
export const SCRIPTS_INSTALACAO = Object.freeze(['preinstall', 'install', 'postinstall', 'prepublish', 'preprepare', 'prepare', 'postprepare', 'dependencies']);

/** Linhas da tabela "## Inventário": Map nome → { tipo, motivo }. */
export function inventario(md) {
  const mapa = new Map();
  const secao = String(md || '').split(/^## /m).find((s) => s.startsWith('Inventário'));
  for (const linha of (secao || '').split('\n')) {
    const m = /^\|\s*`([^`]+)`\s*\|([^|]*)\|(.*)\|\s*$/.exec(linha);
    if (m) mapa.set(m[1], { tipo: m[2].trim(), motivo: m[3].trim() });
  }
  return mapa;
}

/** Nome do pacote a partir da chave do lock ("node_modules/a/node_modules/@b/c" → "@b/c"). */
const nomeDoLock = (k) => k.slice(k.lastIndexOf('node_modules/') + 'node_modules/'.length);
const diretas = (p) => CAMPOS.flatMap((c) => Object.keys(p[c] || {}));

/** Pacotes sem registro no inventário, registros obsoletos e tipo direta/transitiva errado. */
export function semRegistro(p, l, inv) {
  const erros = [];
  const noLock = new Set(Object.keys(l?.packages || {}).filter(Boolean).map(nomeDoLock));
  const dir = new Set(diretas(p));
  for (const nome of [...new Set([...dir, ...noLock])].sort()) {
    const r = inv.get(nome);
    if (!r) { erros.push(`${nome} sem linha em docs/dependencias.md`); continue; }
    if (!r.motivo) erros.push(`${nome} sem motivo em docs/dependencias.md`);
    if (dir.has(nome) !== r.tipo.startsWith('direta')) erros.push(`${nome}: tipo "${r.tipo}" não bate com o package.json`);
  }
  for (const nome of inv.keys()) if (!noLock.has(nome) && !dir.has(nome)) erros.push(`${nome} em docs/dependencias.md mas fora do package-lock.json`);
  return erros;
}

/** Dependências sem versão travada no lock (lista vazia = tudo travado). */
export function semLock(p, l) {
  if (!l) return ['package-lock.json ausente'];
  if (!(l.lockfileVersion >= 2) || !l.packages) return [`lockfileVersion ${l.lockfileVersion} sem "packages"`];
  const erros = [];
  for (const nome of diretas(p)) if (!l.packages['node_modules/' + nome]?.version) erros.push(`${nome} sem versão no package-lock.json`);
  for (const [k, info] of Object.entries(l.packages)) if (k && !info.version) erros.push(`${k} sem versão no package-lock.json`);
  return erros;
}

/** Scripts de instalação na raiz e pacotes do lock com hasInstallScript. */
export function scriptsInstalacao(p, l) {
  const erros = Object.keys(p.scripts || {}).filter((s) => SCRIPTS_INSTALACAO.includes(s)).map((s) => `package.json tem script "${s}"`);
  for (const [k, info] of Object.entries(l?.packages || {})) if (k && info.hasInstallScript) erros.push(`${k} tem script de instalação`);
  return erros;
}

await t('1. todo pacote do lock e toda dependência direta estão em docs/dependencias.md, com motivo', () => {
  assert.ok(doc, 'docs/dependencias.md ausente');
  const inv = inventario(doc);
  assert.ok(inv.size > 0, 'tabela "## Inventário" vazia ou ilegível');
  assert.deepEqual(semRegistro(pkg, lock, inv), [], 'atualize o inventário em docs/dependencias.md');
});

await t('2. toda dependência declarada tem versão travada no package-lock.json', () => {
  assert.deepEqual(semLock(pkg, lock), []);
});

await t('3. nenhum script de instalação (postinstall & cia.) na raiz nem no lock', () => {
  assert.deepEqual(scriptsInstalacao(pkg, lock), []);
});

await t('4. o detector acusa pacote sem registro, registro obsoleto, motivo vazio e tipo errado', () => {
  const inv = inventario(doc);
  const l1 = structuredClone(lock); l1.packages['node_modules/left-pad'] = { version: '1.3.0' };
  assert.deepEqual(semRegistro(pkg, l1, inv), ['left-pad sem linha em docs/dependencias.md']);
  assert.deepEqual(semRegistro({ ...pkg, devDependencies: { eslint: '^9.0.0' } }, lock, inv), ['eslint sem linha em docs/dependencias.md']);
  const l2 = structuredClone(lock); delete l2.packages['node_modules/xtend'];
  assert.deepEqual(semRegistro(pkg, l2, inv), ['xtend em docs/dependencias.md mas fora do package-lock.json']);
  const md = '## Inventário\n| Pacote | Tipo | Motivo |\n| --- | --- | --- |\n| `pg` | transitiva | |\n';
  const l3 = { packages: { '': {}, 'node_modules/pg': { version: '8.0.0' } } };
  assert.deepEqual(semRegistro({ dependencies: { pg: '^8.0.0' } }, l3, inventario(md)),
    ['pg sem motivo em docs/dependencias.md', 'pg: tipo "transitiva" não bate com o package.json']);
  const l4 = { packages: { '': {}, 'node_modules/a/node_modules/@b/c': { version: '1.0.0' } } };
  assert.deepEqual(semRegistro({}, l4, new Map()), ['@b/c sem linha em docs/dependencias.md']);
  assert.equal(inventario('# sem tabela').size, 0);
});

await t('5. o detector acusa lock ausente, antigo e dependência sem versão travada', () => {
  assert.deepEqual(semLock(pkg, null), ['package-lock.json ausente']);
  assert.deepEqual(semLock(pkg, { lockfileVersion: 1 }), ['lockfileVersion 1 sem "packages"']);
  assert.deepEqual(semLock({ ...pkg, dependencies: { ...pkg.dependencies, axios: '^1.0.0' } }, lock), ['axios sem versão no package-lock.json']);
  const l = structuredClone(lock); delete l.packages['node_modules/split2'].version;
  assert.deepEqual(semLock(pkg, l), ['node_modules/split2 sem versão no package-lock.json']);
});

await t('6. o detector acusa postinstall/prepare na raiz e hasInstallScript no lock', () => {
  assert.deepEqual(scriptsInstalacao({ scripts: { test: 'x', postinstall: 'node x.js', prepare: 'y' } }, lock),
    ['package.json tem script "postinstall"', 'package.json tem script "prepare"']);
  const l = structuredClone(lock); l.packages['node_modules/pg-protocol'].hasInstallScript = true;
  assert.deepEqual(scriptsInstalacao(pkg, l), ['node_modules/pg-protocol tem script de instalação']);
  assert.deepEqual(scriptsInstalacao({ scripts: { build: 'x', hunt: 'y' } }, null), []);
});

console.log(`OK — política de dependências: ${n} testes`);
