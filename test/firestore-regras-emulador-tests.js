// Regras do Firestore no emulador (Fase 4, isolamento): o teste de comportamento roda só no workflow
// .github/workflows/firestore-regras.yml (Java + firebase-tools). Aqui, sem rede nem Java, confere que o workflow
// existe, está fixado por SHA, tem permissão mínima, não usa secrets, instala versões fixas fora do package.json
// e roda o script no emulador de um projeto demo-; e que firebase/test/casos.mjs cobre os casos exigidos.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CASOS, SEMENTE, A, B } from '../firebase/test/casos.mjs';

const ler = (p) => fs.readFileSync(new URL(`../${p}`, import.meta.url), 'utf8');
let n = 0;
function t(nome, fn) { try { fn(); n++; } catch (e) { console.error('✗ ' + nome); throw e; } }

const wf = ler('.github/workflows/firestore-regras.yml');
const script = ler('firebase/test/regras-emulador.mjs');
const regras = ler('firebase/firestore.rules');

t('1. workflow roda em pull_request/push que alteram firebase/** ou o teste, e em workflow_dispatch', () => {
  for (const ev of ['pull_request', 'push']) {
    const bloco = wf.split(new RegExp(`^  ${ev}:\\s*$`, 'm'))[1]?.split(/^  \S/m)[0] || '';
    assert.match(bloco, /'firebase\/\*\*'/, `${ev}: firebase/**`);
    assert.match(bloco, /'test\/firestore-regras-emulador-tests\.js'/, `${ev}: este teste`);
    assert.match(bloco, /'\.github\/workflows\/firestore-regras\.yml'/, `${ev}: o próprio workflow`);
  }
  assert.match(wf, /^  workflow_dispatch:/m);
});

t('2. ações fixadas por SHA de 40 caracteres com # vN, incluindo setup-java', () => {
  const uses = [...wf.matchAll(/^\s*-?\s*uses:\s*(\S+)\s*(#\s*(\S+))?/gm)];
  assert.ok(uses.length >= 3);
  for (const u of uses) {
    assert.match(u[1], /^[\w.-]+\/[\w.-]+@[0-9a-f]{40}$/, `${u[1]} sem SHA fixo`);
    assert.match(u[3] || '', /^v\d+(\.\d+){0,2}$/, `${u[1]} sem comentário de versão`);
  }
  assert.ok(uses.some((u) => u[1].startsWith('actions/setup-java@')), 'setup-java');
  assert.match(wf, /java-version:\s*'2[1-9]'/, 'Java 21+ (exigido pelo emulador)');
});

t('3. permissões mínimas, sem secrets, sem publicar regras, sem credencial persistida', () => {
  const perm = wf.match(/^permissions:[ \t]*\n((?:[ \t]+.+\n)+)/m)?.[1] || '';
  assert.deepEqual(perm.trim().split('\n').map((l) => l.trim()), ['contents: read']);
  assert.equal((wf.match(/^\s*permissions:/gm) || []).length, 1, 'sem permissões extras por job');
  assert.doesNotMatch(wf.replace(/^#.*$/gm, ''), /secrets\.|GITHUB_TOKEN|github\.token/);
  assert.doesNotMatch(wf, /firebase[^\n]*\bdeploy\b|\blogin\b/, 'nunca publica nem faz login');
  assert.match(wf, /persist-credentials: false/);
  assert.doesNotMatch(wf, /:\s*write\b/);
});

t('4. ferramentas com versão fixa, --no-save e --ignore-scripts em diretório isolado (fora do package.json)', () => {
  for (const v of ['FIREBASE_TOOLS', 'RULES_UNIT_TESTING', 'FIREBASE_SDK']) assert.match(wf, new RegExp(`${v}: '\\d+\\.\\d+\\.\\d+'`), v);
  assert.match(wf, /npm install --prefix "\$FB" --no-save --no-audit --no-fund --ignore-scripts/);
  for (const p of ['firebase-tools@\\$FIREBASE_TOOLS', '@firebase/rules-unit-testing@\\$RULES_UNIT_TESTING', 'firebase@\\$FIREBASE_SDK']) assert.match(wf, new RegExp(`"${p}"`));
  assert.match(wf, /FB="\$RUNNER_TEMP\/fb"/);
  const pkg = JSON.parse(ler('package.json'));
  for (const campo of ['dependencies', 'devDependencies', 'optionalDependencies']) {
    for (const nome of ['firebase-tools', '@firebase/rules-unit-testing', 'firebase']) assert.equal(pkg[campo]?.[nome], undefined, `${nome} no package.json`);
  }
});

t('5. roda o script no emulador só do Firestore, projeto demo-, com as regras versionadas', () => {
  assert.match(wf, /emulators:exec --only firestore --project demo-tcgph/);
  assert.match(wf, /regras-emulador\.mjs' '\$GITHUB_WORKSPACE\/firebase\/firestore\.rules'/);
  assert.match(script, /projectId: 'demo-tcgph'/);
  assert.match(script, /from '@firebase\/rules-unit-testing'/);
  assert.match(script, /assertSucceeds/); assert.match(script, /assertFails/);
  assert.match(script, /::notice title=Regras Firestore no emulador::/, 'resumo como anotação');
  assert.match(script, /process\.exit\(falhas\.length \? 1 : 0\)/, 'falha o job se algum caso divergir');
  assert.match(script, /clearFirestore\(\)/, 'cada caso em banco zerado');
  // controle negativo: regras sem checagem de dono rodam no mesmo script e precisam ser reprovadas
  assert.match(wf, /CONTROLE_NEGATIVO: '1'/);
  assert.match(wf, /sed 's\/request\.auth != null \\&\\& request\.auth\.uid == uid\/request\.auth != null\/g' firestore\.rules/);
  assert.match(wf, /regras-emulador\.mjs' '\$RUNNER_TEMP\/afrouxadas\.rules'/);
  assert.ok(regras.includes('request.auth != null && request.auth.uid == uid'), 'o sed do controle negativo ainda encontra a checagem de dono');
  assert.match(script, /r\.grupo === 'outro-usuario'/);
});

const tem = (f) => CASOS.some(f);
t('6. casos cobrem dono, outro usuário, anônimo e outros caminhos', () => {
  assert.ok(SEMENTE[`users/${A}`] && SEMENTE[`users/${B}`], 'A e B existem antes de cada caso');
  assert.equal(new Set(CASOS.map((c) => c.id)).size, CASOS.length, 'ids únicos');
  for (const c of CASOS) {
    assert.ok(['permitido', 'negado'].includes(c.esperado), c.id);
    assert.ok(['get', 'list', 'set', 'merge', 'update', 'delete'].includes(c.op), c.id);
  }
  // A lê e escreve users/A
  for (const op of ['get', 'merge', 'update', 'delete']) assert.ok(tem((c) => c.quem === A && c.op === op && c.caminho === `users/${A}` && c.esperado === 'permitido'), `A ${op} users/A permitido`);
  // A não lê nem escreve users/B
  for (const op of ['get', 'set', 'merge', 'update', 'delete']) assert.ok(tem((c) => c.quem === A && c.op === op && c.caminho === `users/${B}` && c.esperado === 'negado'), `A ${op} users/B negado`);
  assert.ok(tem((c) => c.quem === A && c.op === 'list' && c.caminho === 'users' && c.esperado === 'negado'), 'A não lista users');
  // Anônimo: nada
  const anon = CASOS.filter((c) => c.quem === 'anon');
  assert.ok(anon.length >= 4 && anon.every((c) => c.esperado === 'negado'), 'anônimo sempre negado');
  for (const op of ['get', 'list', 'set', 'delete']) assert.ok(anon.some((c) => c.op === op), `anônimo ${op}`);
  // Outros caminhos: subcoleção do próprio usuário e coleções fora de users, leitura e escrita
  const fora = CASOS.filter((c) => !/^users(\/[^/]+)?$/.test(c.caminho));
  assert.ok(fora.length >= 5 && fora.every((c) => c.esperado === 'negado'), 'fora de users/{uid}: negado');
  assert.ok(fora.some((c) => c.caminho.startsWith(`users/${A}/`) && c.op === 'get'), 'subcoleção leitura');
  assert.ok(fora.some((c) => c.caminho.startsWith(`users/${A}/`) && c.op === 'set'), 'subcoleção escrita');
  for (const op of ['get', 'list', 'set', 'delete']) assert.ok(fora.some((c) => !c.caminho.startsWith('users') && c.op === op), `outra coleção ${op}`);
  // Permitido só no próprio users/{uid}
  for (const c of CASOS.filter((x) => x.esperado === 'permitido')) assert.equal(c.caminho, `users/${c.quem}`, `${c.id}: permitido fora do próprio documento`);
});

t('7. casos seguem os campos e limites que firebase/firestore.rules define (não inventam regras)', () => {
  const campos = JSON.parse(regras.match(/keys\(\)\.hasOnly\((\[[^\]]*\])\)/)[1].replace(/'/g, '"'));
  const lim = (k) => Number(regras.match(new RegExp(`data\\.${k}\\.size\\(\\) <= (\\d+)`))[1]);
  for (const c of CASOS.filter((x) => x.esperado === 'permitido' && x.dados)) {
    for (const k of Object.keys(c.dados)) assert.ok(campos.includes(k), `${c.id}: campo ${k} fora da lista das regras`);
  }
  for (const d of Object.values(SEMENTE).slice(0, 2)) assert.deepEqual(Object.keys(d).sort(), [...campos].sort(), 'perfil semeado = campos das regras');
  assert.ok(tem((c) => c.esperado === 'negado' && c.quem === A && Object.keys(c.dados || {}).some((k) => !campos.includes(k))), 'campo desconhecido negado');
  for (const k of ['favorites', 'alerts']) {
    assert.ok(tem((c) => c.esperado === 'permitido' && c.dados?.[k]?.length === lim(k)), `${k} no limite (${lim(k)}) permitido`);
    assert.ok(tem((c) => c.esperado === 'negado' && c.quem === A && c.caminho === `users/${A}` && c.dados?.[k]?.length === lim(k) + 1), `${k} acima do limite negado`);
  }
  // as regras ainda são as que os casos assumem: só users/{uid} ao dono, e o resto negado
  assert.match(regras, /match \/users\/\{uid\}/);
  assert.match(regras, /match \/\{document=\*\*\}\s*\{\s*allow read, write: if false;/);
});

console.log(`firestore-regras-emulador-tests: ${n} testes ok`);
