// Social Media MVP — aprovação humana e trilha de auditoria (issue #636): desligado por padrão, operador não
// autorizado, rejeição sem motivo, dupla decisão, adulteração/remoção/reordenação da trilha e edição pós-aprovação.
// Módulo puro: sem rede, banco ou secrets.
import assert from 'node:assert/strict';
import {
  decidir, eventoAuditoria, verificarTrilha, aprovacaoValida, operadoresPadrao, socialEnabled, ultimoHash, sha256,
  SOCIAL_ENABLED_DEFAULT, HASH_INICIAL, STATUS,
} from '../src/agents/social/aprovacao.js';

let n = 0;
function t(name, fn) { try { fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } }
const NOW = '2026-10-13T12:00:00.000Z';
const OPS = ['TonyWatanabe-dev'];
const base = { enabled: true, operadores: OPS, now: NOW };
const rascunho = (id = 'post-1', texto = 'Booster X por R$ 29,90 na Loja A. #publi link de afiliado') => ({ id, texto, canal: 'telegram' });
const aprova = (item, trilha = [], extra = {}) => decidir(item, { ...base, decisao: 'aprovar', operador: 'TonyWatanabe-dev', trilha, ...extra });
const rejeita = (item, trilha = [], extra = {}) => decidir(item, { ...base, decisao: 'rejeitar', operador: 'TonyWatanabe-dev', motivo: 'preço desatualizado', trilha, ...extra });
const trilha3 = () => {
  const a = aprova(rascunho('a'));
  const b = rejeita(rascunho('b'), [a.evento]);
  const c = aprova(rascunho('c'), [a.evento, b.evento]);
  return [a.evento, b.evento, c.evento];
};
const motivos = (r) => r.erros.map((e) => e.motivo).join(' | ');

// ---- Desligado por padrão ----
t('SOCIAL_ENABLED ausente = desligado; decidir falha fechado', () => {
  assert.equal(SOCIAL_ENABLED_DEFAULT, false);
  assert.equal(socialEnabled({}), false);
  assert.equal(socialEnabled({ SOCIAL_ENABLED: '0' }), false);
  assert.equal(socialEnabled({ SOCIAL_ENABLED: 'talvez' }), false);
  assert.equal(socialEnabled({ SOCIAL_ENABLED: '1' }), true);
  assert.equal(socialEnabled({ SOCIAL_ENABLED: 'true' }), true);
  const item = rascunho();
  const r = decidir(item, { decisao: 'aprovar', operador: 'TonyWatanabe-dev', operadores: OPS, now: NOW, env: {} });
  assert.equal(r.ok, false); assert.match(r.erro, /desativado/); assert.equal(r.item, item); assert.equal(r.evento, null);
  assert.equal(decidir(item, { decisao: 'aprovar', operador: 'TonyWatanabe-dev', operadores: OPS, now: NOW, env: { SOCIAL_ENABLED: '1' } }).ok, true);
});

// ---- Operadores ----
t('operador fora da lista autorizada é recusado', () => {
  const item = rascunho();
  for (const operador of ['intruso', '', undefined, 'TonyWatanabe-dev,intruso', 'tony watanabe']) {
    const r = aprova(item, [], { operador });
    assert.equal(r.ok, false, String(operador)); assert.match(r.erro, /não autorizado/); assert.equal(r.item, item); assert.equal(r.evento, null);
  }
  assert.equal(aprova(item, [], { operadores: [] }).ok, false, 'lista vazia não autoriza ninguém');
  assert.equal(aprova(item, [], { operador: 'tonywatanabe-dev' }).ok, true, 'login sem diferenciar maiúsculas');
});

t('lista padrão = TAREFAS_OPERADORES ou dono do repo', () => {
  assert.deepEqual(operadoresPadrao({ GITHUB_REPOSITORY: 'TonyWatanabe-dev/pokemon-price-hunter' }), ['tonywatanabe-dev']);
  assert.deepEqual(operadoresPadrao({ TAREFAS_OPERADORES: 'a, B ,', GITHUB_REPOSITORY: 'dono/x' }), ['a', 'b']);
  assert.deepEqual(operadoresPadrao({}), []);
  const env = { SOCIAL_ENABLED: '1', GITHUB_REPOSITORY: 'dono/x' };
  assert.equal(decidir(rascunho(), { decisao: 'aprovar', operador: 'dono', now: NOW, env }).ok, true);
  assert.equal(decidir(rascunho(), { decisao: 'aprovar', operador: 'outro', now: NOW, env }).ok, false);
});

// ---- Decisão ----
t('aprovação gera evento encadeado com hash do texto e só o login do operador', () => {
  const item = rascunho();
  const r = aprova(item);
  assert.equal(r.ok, true); assert.equal(r.item.status, STATUS.APROVADO); assert.equal(item.status, undefined, 'entrada não é mutada');
  assert.deepEqual(Object.keys(r.evento).sort(), ['acao', 'hash', 'hashAnterior', 'hashTexto', 'itemId', 'motivo', 'operador', 'ts', 'v']);
  assert.equal(r.evento.ts, NOW); assert.equal(r.evento.operador, 'tonywatanabe-dev'); assert.equal(r.evento.acao, 'aprovar');
  assert.equal(r.evento.itemId, 'post-1'); assert.equal(r.evento.hashTexto, sha256(item.texto)); assert.equal(r.evento.hashAnterior, HASH_INICIAL);
  assert.ok(!JSON.stringify(r.evento).includes(item.texto), 'o texto não vai para a trilha, só o hash');
  assert.ok(Object.isFrozen(r.evento) && Object.isFrozen(r.item));
  assert.equal(r.item.aprovacao.evento, r.evento.hash);
  assert.equal(aprovacaoValida(r.item), true); assert.equal(aprovacaoValida(r.item, { trilha: [r.evento] }), true);
});

t('rejeição exige motivo; motivo passa pelo redact', () => {
  const item = rascunho();
  for (const motivo of [undefined, '', '   ']) {
    const r = rejeita(item, [], { motivo });
    assert.equal(r.ok, false); assert.match(r.erro, /motivo/); assert.equal(r.evento, null);
  }
  const r = rejeita(item, [], { motivo: 'contato fulano@exemplo.com com token=abc12345 vazou' });
  assert.equal(r.ok, true); assert.equal(r.item.status, STATUS.REJEITADO);
  assert.ok(!r.evento.motivo.includes('fulano@exemplo.com') && !r.evento.motivo.includes('abc12345'), r.evento.motivo);
  assert.equal(aprovacaoValida(r.item), false, 'rejeitado não vale como aprovado');
  assert.equal(verificarTrilha([r.evento]).ok, true);
});

t('entradas inválidas falham fechado', () => {
  assert.equal(aprova(null).ok, false);
  assert.equal(aprova({ id: 'x' }).ok, false);
  assert.equal(aprova({ texto: 'sem id' }).ok, false);
  assert.equal(decidir(rascunho(), { ...base, decisao: 'publicar', operador: 'TonyWatanabe-dev' }).ok, false);
  assert.equal(aprova(rascunho(), [], { now: 'ontem' }).ok, false);
  assert.equal(decidir(rascunho()).ok, false);
});

t('item já decidido não muda (status no item ou evento na trilha)', () => {
  const r1 = aprova(rascunho());
  for (const r2 of [aprova(r1.item, [r1.evento]), rejeita(r1.item, [r1.evento])]) {
    assert.equal(r2.ok, false); assert.match(r2.erro, /já decidido/); assert.equal(r2.item, r1.item); assert.equal(r2.evento, null);
  }
  const r3 = rejeita(rascunho(), [r1.evento]);
  assert.equal(r3.ok, false, 'mesmo id já está na trilha'); assert.match(r3.erro, /já decidido/);
  const forjado = { ...rascunho(), status: STATUS.RASCUNHO, aprovacao: { decisao: 'aprovar' } };
  assert.equal(aprova(forjado).ok, false);
});

t('decisão recusa trilha anterior adulterada', () => {
  const tr = trilha3();
  const r = aprova(rascunho('d'), [tr[0], tr[2]]);
  assert.equal(r.ok, false); assert.match(r.erro, /trilha/);
});

// ---- Trilha ----
t('trilha íntegra verifica; vazia também', () => {
  const tr = trilha3();
  assert.equal(verificarTrilha([]).ok, true);
  assert.deepEqual(verificarTrilha(tr), { ok: true, erros: [] });
  assert.equal(tr[1].hashAnterior, tr[0].hash); assert.equal(tr[2].hashAnterior, tr[1].hash);
  assert.equal(verificarTrilha(tr, { ultimoHash: ultimoHash(tr) }).ok, true);
  for (const x of [null, undefined, 'x', {}]) assert.equal(verificarTrilha(x).ok, false);
});

t('adulteração de qualquer campo é detectada', () => {
  const tr = trilha3();
  for (const [campo, valor] of [['operador', 'intruso'], ['acao', null], ['itemId', 'z'], ['hashTexto', sha256('outro')], ['ts', '2026-10-14T00:00:00.000Z'], ['motivo', 'outro motivo']]) {
    for (const i of [0, 1, 2]) {
      const alt = tr.map((e) => ({ ...e }));
      alt[i][campo] = campo === 'acao' ? (alt[i].acao === 'aprovar' ? 'rejeitar' : 'aprovar') : valor;
      const r = verificarTrilha(alt);
      assert.equal(r.ok, false, `${campo}@${i}`); assert.match(motivos(r), /alterado/);
    }
  }
  const recalculado = tr.map((e) => ({ ...e }));
  recalculado[1] = eventoAuditoria({ ...tr[1], operador: 'intruso' });   // recalcula o próprio hash, mas quebra o elo seguinte
  assert.match(motivos(verificarTrilha(recalculado)), /encadeamento/);
});

t('remoção e reordenação são detectadas', () => {
  const tr = trilha3();
  assert.match(motivos(verificarTrilha([tr[1], tr[2]])), /encadeamento/, 'remove o primeiro');
  assert.match(motivos(verificarTrilha([tr[0], tr[2]])), /encadeamento/, 'remove do meio');
  assert.match(motivos(verificarTrilha([tr[1], tr[0], tr[2]])), /encadeamento/, 'troca a ordem');
  assert.match(motivos(verificarTrilha([tr[0], tr[2], tr[1]])), /encadeamento/, 'troca a ordem no fim');
  assert.match(motivos(verificarTrilha([tr[0], tr[1]], { ultimoHash: ultimoHash(tr) })), /âncora/, 'remove o último com âncora');
  const dup = [tr[0], eventoAuditoria({ ...tr[0], hashAnterior: tr[0].hash })];
  assert.match(motivos(verificarTrilha(dup)), /mais de uma vez/, 'dupla decisão forjada');
});

// ---- Edição pós-aprovação ----
t('editar o texto depois de aprovado invalida a aprovação', () => {
  const r = aprova(rascunho());
  const editado = { ...r.item, texto: r.item.texto + ' (agora com desconto extra!)' };
  assert.equal(aprovacaoValida(editado), false);
  assert.equal(aprovacaoValida(editado, { trilha: [r.evento] }), false);
  const reescrito = { ...editado, aprovacao: { ...r.item.aprovacao, hashTexto: sha256(editado.texto) } };
  assert.equal(aprovacaoValida(reescrito), true, 'sem trilha só confere item × hash');
  assert.equal(aprovacaoValida(reescrito, { trilha: [r.evento] }), false, 'com trilha, o hash forjado não confere com o evento');
  assert.equal(aprovacaoValida(r.item, { trilha: [] }), false, 'aprovação sem evento na trilha não vale');
  assert.equal(aprovacaoValida(null), false); assert.equal(aprovacaoValida(rascunho()), false);
});

console.log(`social-aprovacao: ${n} testes ok`);
