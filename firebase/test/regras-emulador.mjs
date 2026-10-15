// Teste de COMPORTAMENTO de firebase/firestore.rules no emulador do Firestore (projeto demo-, sem rede real).
// Roda só no workflow .github/workflows/firestore-regras.yml (precisa de Java + firebase-tools), dentro de
// `firebase emulators:exec`; fica fora do `npm test`. Uso: node regras-emulador.mjs <caminho/firestore.rules>
// Cada caso de casos.mjs roda num banco zerado e semeado. Saída: uma linha por caso, resumo como ::notice:: e
// cada divergência como ::error:: (anotações do GitHub Actions). Código 1 se algum caso divergir.
import fs from 'node:fs';
import { initializeTestEnvironment, assertSucceeds, assertFails } from '@firebase/rules-unit-testing';
import { CASOS, SEMENTE } from './casos.mjs';

const rulesPath = process.argv[2];
if (!rulesPath) { console.error('uso: node regras-emulador.mjs <firestore.rules>'); process.exit(2); }
const [host, port] = (process.env.FIRESTORE_EMULATOR_HOST || '127.0.0.1:8080').split(':');

const env = await initializeTestEnvironment({
  projectId: 'demo-tcgph',
  firestore: { rules: fs.readFileSync(rulesPath, 'utf8'), host, port: Number(port) },
});

function executar(db, c) {
  switch (c.op) {
    case 'get': return db.doc(c.caminho).get();
    case 'list': return db.collection(c.caminho).get();
    case 'set': return db.doc(c.caminho).set(c.dados);
    case 'merge': return db.doc(c.caminho).set(c.dados, { merge: true });
    case 'update': return db.doc(c.caminho).update(c.dados);
    case 'delete': return db.doc(c.caminho).delete();
    default: throw new Error(`op desconhecida: ${c.op}`);
  }
}

const resultados = [];
for (const c of CASOS) {
  await env.clearFirestore();
  await env.withSecurityRulesDisabled(async (ctx) => {
    const db = ctx.firestore();
    for (const [p, d] of Object.entries(SEMENTE)) await db.doc(p).set(d);
  });
  const ctx = c.quem === 'anon' ? env.unauthenticatedContext() : env.authenticatedContext(c.quem);
  const p = executar(ctx.firestore(), c);
  let ok = true; let erro = '';
  try {
    if (c.esperado === 'permitido') await assertSucceeds(p); else await assertFails(p);
  } catch (e) { ok = false; erro = String(e?.message || e).split('\n')[0]; }
  resultados.push({ ...c, ok, erro });
  console.log(`${ok ? 'ok ' : 'ERRO'} ${c.grupo.padEnd(16)} ${c.id.padEnd(20)} ${c.quem.padEnd(9)} ${c.op.padEnd(6)} ${c.caminho} → ${c.esperado}${ok ? '' : ` (${erro})`}`);
}
await env.cleanup();

const falhas = resultados.filter((r) => !r.ok);
const porGrupo = {};
for (const r of resultados) {
  const g = (porGrupo[r.grupo] ||= { ok: 0, total: 0 });
  g.total++; if (r.ok) g.ok++;
}
const grupos = Object.entries(porGrupo).map(([g, v]) => `${g} ${v.ok}/${v.total}`).join(', ');
// CONTROLE_NEGATIVO=1: regras propositalmente afrouxadas; divergência é o esperado (vira notice, não error).
const controle = process.env.CONTROLE_NEGATIVO === '1';
const nivel = controle ? 'notice' : 'error';
const titulo = controle ? 'Controle negativo: divergência esperada' : 'Regra Firestore divergente';
for (const f of falhas) console.log(`::${nivel} title=${titulo}::${f.id}: ${f.quem} ${f.op} ${f.caminho} deveria ser ${f.esperado} (${f.erro})`);
if (controle) {
  // Sem a checagem de dono, TODO caso do grupo outro-usuario tem de divergir, e nenhum caso de outro grupo.
  // Sucesso (código 0) só nessa condição: um erro de infraestrutura não passa por "regra reprovada".
  const esperadas = resultados.filter((r) => r.grupo === 'outro-usuario').map((r) => r.id).sort();
  const vistas = falhas.map((f) => f.id).sort();
  const ok = JSON.stringify(esperadas) === JSON.stringify(vistas);
  console.log(`::${ok ? 'notice' : 'error'} title=Controle negativo::regras sem checagem de dono ${ok ? 'reprovadas como esperado' : 'NÃO reprovadas como esperado'}: divergiram ${vistas.join(' ') || 'nenhum'} (esperado ${esperadas.join(' ')})`);
  process.exit(ok ? 0 : 1);
}
console.log(`::notice title=Regras Firestore no emulador::${resultados.length - falhas.length}/${resultados.length} casos conforme esperado (${grupos})`);
const permitidos = resultados.filter((r) => r.esperado === 'permitido').map((r) => r.id).join(' ');
const negados = resultados.filter((r) => r.esperado === 'negado').map((r) => r.id).join(' ');
console.log(`::notice title=Casos permitidos::${permitidos}`);
console.log(`::notice title=Casos negados::${negados}`);
process.exit(falhas.length ? 1 : 0);
