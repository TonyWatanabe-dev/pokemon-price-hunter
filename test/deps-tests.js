// Dependências aprovadas (auditoria de segurança, docs/auditorias/seguranca.md §4 T5). Só lê package.json e
// package-lock.json: o lock tem de ser coerente com o package.json (mesmas faixas, versão instalada dentro da faixa,
// árvore fechada, tudo do registro npm com integridade sha512) e só entram as dependências desta lista. Dependência
// nova (de produção ou não) exige atualizar APROVADAS aqui, na mesma PR, para passar por revisão. A lista guarda só
// nomes: o Dependabot pode subir a versão de `pg` sem mexer neste teste.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let n = 0;
async function t(name, fn) { try { await fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } }
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'), 'utf8'));

/** Dependências diretas aprovadas, por campo do package.json. Campo ausente aqui = nenhuma permitida. */
export const APROVADAS = Object.freeze({
  dependencies: Object.freeze(['pg']),
  devDependencies: Object.freeze([]),
  optionalDependencies: Object.freeze([]),
  peerDependencies: Object.freeze([]),
  bundleDependencies: Object.freeze([]),
});
const CAMPOS = Object.keys(APROVADAS);
const nomes = (v) => (Array.isArray(v) ? v : Object.keys(v || {}));

/** Dependências do package.json fora da lista aprovada (ex.: "dependencies: axios"). */
export function naoAprovadas(p, aprovadas = APROVADAS) {
  const fora = [];
  for (const campo of CAMPOS) for (const nome of nomes(p[campo])) if (!(aprovadas[campo] || []).includes(nome)) fora.push(`${campo}: ${nome}`);
  for (const nome of nomes(p.bundledDependencies)) fora.push(`bundledDependencies: ${nome}`);
  return fora;
}

const ver = (v) => { const m = /^(\d+)\.(\d+)\.(\d+)$/.exec(v || ''); return m ? m.slice(1).map(Number) : null; };
const cmp = (a, b) => a[0] - b[0] || a[1] - b[1] || a[2] - b[2];
/** Versão dentro da faixa: só as formas usadas nas dependências diretas (exata, ^x.y.z, ~x.y.z). Faixa diferente falha fechado. */
export function satisfaz(versao, faixa) {
  const v = ver(versao); const m = /^([\^~]?)(\d+\.\d+\.\d+)$/.exec(faixa || ''); if (!v || !m) return false;
  const base = ver(m[2]);
  if (!m[1]) return cmp(v, base) === 0;
  if (cmp(v, base) < 0) return false;
  if (m[1] === '~') return v[0] === base[0] && v[1] === base[1];
  if (base[0] > 0) return v[0] === base[0];
  return base[1] > 0 ? v[0] === 0 && v[1] === base[1] : cmp(v, base) === 0;
}

/** Caminho do pacote `nome` visto a partir de `de` no lock (resolução do Node: sobe pelos node_modules). */
function resolver(pacotes, de, nome) {
  let base = de;
  for (;;) {
    const alvo = (base ? base + '/' : '') + 'node_modules/' + nome;
    if (pacotes[alvo]) return alvo;
    if (!base) return null;
    const i = base.lastIndexOf('/node_modules/');
    base = i < 0 ? '' : base.slice(0, i);
  }
}

/** Problemas de coerência entre package.json e package-lock.json (lista vazia = coerente). */
export function incoerencias(p, l) {
  const erros = [];
  if (l.name !== p.name) erros.push(`name do lock (${l.name}) ≠ package.json (${p.name})`);
  if (l.version !== p.version) erros.push(`version do lock (${l.version}) ≠ package.json (${p.version})`);
  if (!(l.lockfileVersion >= 2) || !l.packages) return [...erros, `lockfileVersion ${l.lockfileVersion} sem "packages" (rode npm install com npm >= 7)`];
  const pacotes = l.packages; const raiz = pacotes[''] || {};
  for (const campo of [...CAMPOS.filter((c) => c !== 'bundleDependencies'), 'engines']) {
    if (JSON.stringify(raiz[campo] || {}) !== JSON.stringify(p[campo] || {})) erros.push(`${campo} do lock ≠ package.json`);
  }
  // Árvore fechada: toda dependência declarada existe no lock, dentro da faixa; nada sobra no lock.
  const alcancados = new Set(); const fila = [''];
  while (fila.length) {
    const de = fila.shift(); const info = de ? pacotes[de] : p; // na raiz valem as faixas do package.json
    const deps = { ...info.dependencies, ...info.optionalDependencies, ...(de ? {} : info.devDependencies) };
    const opcionais = new Set(Object.keys(info.optionalDependencies || {}));
    for (const [peer, faixa] of Object.entries(info.peerDependencies || {})) if (!info.peerDependenciesMeta?.[peer]?.optional) deps[peer] ??= faixa;
    for (const [nome, faixa] of Object.entries(deps)) {
      const alvo = resolver(pacotes, de, nome);
      if (!alvo) { if (!opcionais.has(nome)) erros.push(`${de || 'raiz'} → ${nome} ausente do lock`); continue; }
      if (!de && !satisfaz(pacotes[alvo].version, faixa)) erros.push(`${nome}@${pacotes[alvo].version} fora da faixa ${faixa} do package.json`);
      if (!alcancados.has(alvo)) { alcancados.add(alvo); fila.push(alvo); }
    }
  }
  for (const k of Object.keys(pacotes)) if (k && !alcancados.has(k)) erros.push(`${k} no lock sem ninguém que dependa dele`);
  for (const [k, info] of Object.entries(pacotes)) {
    if (!k) continue;
    if (info.link || !String(info.resolved || '').startsWith('https://registry.npmjs.org/')) erros.push(`${k} não vem do registro npm (${info.resolved || 'link/sem resolved'})`);
    if (!/^sha512-[A-Za-z0-9+/]+=*$/.test(info.integrity || '')) erros.push(`${k} sem integrity sha512`);
  }
  return erros;
}

await t('1. package.json só tem as dependências aprovadas (e todas as aprovadas estão lá)', () => {
  assert.deepEqual(naoAprovadas(pkg), [], 'dependência fora da lista APROVADAS de test/deps-tests.js');
  assert.deepEqual(Object.keys(pkg.dependencies || {}).sort(), [...APROVADAS.dependencies].sort(), 'lista de produção desatualizada');
});

await t('2. package-lock.json coerente com o package.json', () => {
  assert.deepEqual(incoerencias(pkg, lock), [], 'lock incoerente (rode npm install e confira o diff)');
  assert.equal(lock.packages['node_modules/pg'] && !lock.packages['node_modules/pg'].dev, true, 'pg é dependência de produção no lock');
});

await t('3. o detector recusa dependência nova em qualquer campo', () => {
  assert.deepEqual(naoAprovadas({ dependencies: { pg: '^8.0.0', axios: '^1.0.0' } }), ['dependencies: axios']);
  assert.deepEqual(naoAprovadas({ devDependencies: { eslint: '^9.0.0' }, optionalDependencies: { 'pg-native': '^3.0.0' } }),
    ['devDependencies: eslint', 'optionalDependencies: pg-native']);
  assert.deepEqual(naoAprovadas({ bundledDependencies: ['pg'] }), ['bundledDependencies: pg']);
  assert.deepEqual(naoAprovadas({ dependencies: { pg: '^8.0.0' } }), []);
});

await t('4. o detector acusa lock fora de sincronia, pacote órfão, faltando ou fora do registro', () => {
  const clone = () => structuredClone(lock);
  const novoDep = { ...pkg, dependencies: { ...pkg.dependencies, axios: '^1.0.0' } };
  assert.ok(incoerencias(novoDep, lock).some((e) => e.startsWith('dependencies do lock')), 'package.json com dep nova e lock antigo');
  assert.ok(incoerencias(novoDep, lock).some((e) => e.includes('axios ausente')));
  const faixa = { ...pkg, dependencies: { pg: '^9.0.0' } }; const l1 = clone(); l1.packages[''].dependencies = { pg: '^9.0.0' };
  assert.deepEqual(incoerencias(faixa, l1), [`pg@${lock.packages['node_modules/pg'].version} fora da faixa ^9.0.0 do package.json`]);
  const l2 = clone(); l2.packages['node_modules/left-pad'] = { version: '1.3.0', resolved: 'https://registry.npmjs.org/left-pad/-/left-pad-1.3.0.tgz', integrity: 'sha512-AAAA' };
  assert.deepEqual(incoerencias(pkg, l2), ['node_modules/left-pad no lock sem ninguém que dependa dele']);
  const l3 = clone(); delete l3.packages['node_modules/split2'];
  assert.deepEqual(incoerencias(pkg, l3), ['node_modules/pgpass → split2 ausente do lock']);
  const l4 = clone(); l4.packages['node_modules/xtend'].resolved = 'git+https://example.com/xtend.git';
  assert.deepEqual(incoerencias(pkg, l4), ['node_modules/xtend não vem do registro npm (git+https://example.com/xtend.git)']);
  const l5 = clone(); delete l5.packages['node_modules/xtend'].integrity;
  assert.deepEqual(incoerencias(pkg, l5), ['node_modules/xtend sem integrity sha512']);
  assert.deepEqual(incoerencias({ ...pkg, version: '9.9.9' }, lock), [`version do lock (${lock.version}) ≠ package.json (9.9.9)`]);
  assert.deepEqual(incoerencias(pkg, { ...lock, lockfileVersion: 1, packages: undefined }), ['lockfileVersion 1 sem "packages" (rode npm install com npm >= 7)']);
  // dependência opcional ausente (pg-cloudflare) não é erro; peer opcional (pg-native) também não
  const l6 = clone(); delete l6.packages['node_modules/pg-cloudflare'];
  assert.deepEqual(incoerencias(pkg, l6), []);
});

await t('5. faixas: exata, ^ e ~; forma desconhecida falha fechado', () => {
  assert.equal(satisfaz('8.23.1', '^8.23.1'), true); assert.equal(satisfaz('8.30.0', '^8.23.1'), true);
  assert.equal(satisfaz('8.23.0', '^8.23.1'), false); assert.equal(satisfaz('9.0.0', '^8.23.1'), false);
  assert.equal(satisfaz('0.2.5', '^0.2.1'), true); assert.equal(satisfaz('0.3.0', '^0.2.1'), false); assert.equal(satisfaz('0.0.4', '^0.0.3'), false);
  assert.equal(satisfaz('2.0.9', '~2.0.0'), true); assert.equal(satisfaz('2.1.0', '~2.0.0'), false);
  assert.equal(satisfaz('1.0.5', '1.0.5'), true); assert.equal(satisfaz('1.0.6', '1.0.5'), false);
  for (const f of ['*', 'latest', '>=1.0.0', '1.x', 'github:a/b', 'file:../x', '']) assert.equal(satisfaz('1.0.0', f), false, f);
});

console.log(`OK — dependências aprovadas: ${n} testes`);
