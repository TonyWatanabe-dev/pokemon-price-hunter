// Regra M2 da exclusão de conta ("criar users/{uid} só com createdAt e termsAt"): conferência ESTÁTICA dos casos de
// test/exclusao-regras-m2-casos.mjs, que seguem o formato de firebase/test/casos.mjs e vão para lá na PR da regra.
// O comportamento só é provado no workflow firestore-regras.yml (emulador do Firestore); aqui não há Java nem rede.
// Enquanto firebase/firestore.rules não tiver a M2, este teste registra a lacuna e impede que os casos entrem em
// casos.mjs sem a regra (o CI de regras quebraria); quando a regra entrar, exige que os casos entrem junto.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CASOS, SEMENTE } from '../firebase/test/casos.mjs';
import { CASOS_M2, LACUNA_HOJE } from './exclusao-regras-m2-casos.mjs';

const regras = fs.readFileSync(new URL('../firebase/firestore.rules', import.meta.url), 'utf8');
let n = 0; const t = (nome, fn) => { try { fn(); n++; } catch (e) { console.error('✗ ' + nome); throw e; } };
const campos = JSON.parse(regras.match(/keys\(\)\.hasOnly\((\[[^\]]*\])\)/)[1].replace(/'/g, '"'));
const lim = (k) => Number(regras.match(new RegExp(`data\\.${k}\\.size\\(\\) <= (\\d+)`))[1]);
const existe = (c) => Object.hasOwn(SEMENTE, c.caminho);
const dentroDasRegras = (d) => Object.keys(d).every((k) => campos.includes(k)) && ['favorites', 'alerts'].every((k) => !(k in d) || d[k].length <= lim(k));

t('1. formato igual ao de firebase/test/casos.mjs (ops, esperado, ids únicos e sem colidir)', () => {
  const ids = CASOS_M2.map((c) => c.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const c of CASOS_M2) {
    assert.ok(['permitido', 'negado'].includes(c.esperado), c.id);
    assert.ok(['set', 'merge', 'update'].includes(c.op), c.id);
    assert.equal(typeof c.grupo, 'string'); assert.ok(c.dados && typeof c.dados === 'object', c.id);
    assert.ok(!CASOS.some((x) => x.id === c.id && JSON.stringify(x) !== JSON.stringify(c)), `${c.id} já existe em casos.mjs com outro conteúdo`);
  }
});

t('2. só o próprio documento (controle negativo do workflow não muda nenhum caso) e permitido só dentro de campos/limites', () => {
  for (const c of CASOS_M2) {
    assert.equal(c.caminho, `users/${c.quem}`, `${c.id}: sempre o próprio uid`);
    assert.notEqual(c.grupo, 'outro-usuario'); assert.notEqual(c.quem, 'anon');
    if (c.esperado === 'permitido') assert.ok(dentroDasRegras(c.dados), `${c.id}: campo ou limite fora das regras`);
  }
  assert.ok(!existe({ caminho: 'users/novo' }), "'novo' não pode estar na SEMENTE (casos de criação)");
  assert.ok(CASOS_M2.some((c) => existe(c) && c.esperado === 'permitido' && c.op === 'merge') && CASOS_M2.some((c) => existe(c) && c.op === 'update' && c.esperado === 'permitido'), 'documento existente: parcial segue permitido');
  for (const k of ['createdAt', 'termsAt']) assert.ok(CASOS_M2.some((c) => !existe(c) && c.esperado === 'negado' && dentroDasRegras(c.dados) && !(k in c.dados) && Object.keys(c.dados).length > 2), `criação sem ${k} negada`);
  assert.ok(CASOS_M2.some((c) => !existe(c) && c.op === 'merge' && c.esperado === 'permitido' && c.dados.createdAt && c.dados.termsAt), 'cadastro (merge completo) permitido');
  assert.ok(CASOS_M2.some((c) => !existe(c) && c.op === 'set' && c.esperado === 'permitido'), '"Continuar usando" (set na transação) permitido');
});

t('3. LACUNA_HOJE = exatamente os casos negados só pela M2 (criação parcial dentro dos campos e limites atuais)', () => {
  const lacuna = CASOS_M2.filter((c) => !existe(c) && c.esperado === 'negado' && dentroDasRegras(c.dados) && !(c.dados.createdAt && c.dados.termsAt)).map((c) => c.id).sort();
  assert.deepEqual(lacuna, [...LACUNA_HOJE].sort());
});

const m2 = /allow create:[^;]*keys\(\)\.hasAll\(\['createdAt',\s*'termsAt'\]\)/.test(regras);
t('4. estado da regra: sem M2, casos da lacuna fora de casos.mjs; com M2, todos os casos dentro', () => {
  if (!m2) {
    for (const id of LACUNA_HOJE) assert.ok(!CASOS.some((c) => c.id === id), `${id} em casos.mjs sem a regra M2: o CI de regras falharia`);
    assert.match(regras, /allow create, update:/, 'regra atual: create e update juntos (sem exigência de perfil completo)');
  } else {
    for (const c of CASOS_M2) assert.ok(CASOS.some((x) => JSON.stringify(x) === JSON.stringify(c)), `M2 publicada sem o caso ${c.id} em firebase/test/casos.mjs`);
  }
});

console.log(`exclusao-regras-m2-tests: ${n} grupos ok; regra M2 ${m2 ? 'presente em firebase/firestore.rules' : `AUSENTE de firebase/firestore.rules (NÃO validada; ${LACUNA_HOJE.length} casos de criação parcial aguardam a regra e o emulador do Firestore)`}`);
