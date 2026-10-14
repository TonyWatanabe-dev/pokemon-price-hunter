// Social MVP — CLI local da fila (issue #656): tools/social-fila.mjs listar/aprovar/rejeitar sobre fila, trilha e
// âncora em pasta temporária. Gate SOCIAL_ENABLED, operador validado, rejeição com motivo, decisão única, trilha
// íntegra/âncora e falha fechada sem gravar nada. Sem rede, banco, secrets nem process.env real.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { main, lerArgs, SAIDAS, FILA_PADRAO } from '../tools/social-fila.mjs';
import { enfileirar, filaVazia, paraJson, deJson } from '../src/agents/social/fila.js';
import { verificarTrilha, ultimoHash, sha256 } from '../src/agents/social/aprovacao.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tool = path.join(root, 'tools/social-fila.mjs');
let n = 0;
function t(name, fn) { try { fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } }

const NOW = '2026-10-14T12:00:00.000Z';
const DEPOIS = '2026-10-14T12:05:00.000Z';
const ENV = { SOCIAL_ENABLED: '1', TAREFAS_OPERADORES: 'dona,revisor' };

function filaBase() {
  let f = filaVazia();
  for (const [canal, chave, texto] of [['telegram', 'p1|loja-a', 'Oferta 1\nlinha 2'], ['telegram', 'p2|loja-b', 'Oferta 2'], ['instagram', 'p1|loja-a', 'Oferta 1 IG']]) {
    f = enfileirar(f, { canal, chaveDedupe: chave, texto }, { now: NOW }).fila;
  }
  return f;
}
function cenario(fn) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'social-fila-'));
  const fila = path.join(dir, 'fila.json');
  fs.writeFileSync(fila, paraJson(filaBase()));
  const arqs = { dir, fila, trilha: path.join(dir, 'trilha.json'), ancora: path.join(dir, 'trilha.ultimo-hash') };
  try { fn(arqs); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}
function io() { const out = [], err = []; return { out, err, io: { log: (s) => out.push(s), error: (s) => err.push(s) } }; }
function rodar(argv, env = ENV) { const c = io(); const code = main(argv, env, c.io); return { code, out: c.out.join('\n'), err: c.err.join('\n') }; }
const ids = (arq) => deJson(fs.readFileSync(arq, 'utf8')).itens;
const foto = (a) => [a.fila, a.trilha, a.ancora].map((f) => (fs.existsSync(f) ? fs.readFileSync(f, 'utf8') : null));

t('lerArgs: padrão em data/social; trilha e âncora ao lado da fila; erros de uso', () => {
  const o = lerArgs(['listar']);
  assert.equal(o.fila, FILA_PADRAO);
  assert.equal(o.fila, path.join(root, 'data/social/fila.json'));
  assert.equal(o.trilha, path.join(root, 'data/social/trilha.json'));
  assert.equal(o.ancora, path.join(root, 'data/social/trilha.ultimo-hash'));
  const r = lerArgs(['rejeitar', 'x:1', '--motivo', 'preço errado', '--fila', '/tmp/q/f.json']);
  assert.equal(r.id, 'x:1'); assert.equal(r.motivo, 'preço errado'); assert.equal(r.trilha, '/tmp/q/trilha.json');
  assert.throws(() => lerArgs([]), /comando desconhecido/);
  assert.throws(() => lerArgs(['publicar', 'x']), /comando desconhecido/);
  assert.throws(() => lerArgs(['aprovar']), /exige o id/);
  assert.throws(() => lerArgs(['aprovar', 'a', 'b']), /argumento desconhecido/);
  assert.throws(() => lerArgs(['listar', 'x']), /argumento desconhecido/);
  assert.throws(() => lerArgs(['listar', '--estado', 'x']), /estado desconhecido/);
  assert.throws(() => lerArgs(['rejeitar', 'x', '--motivo']), /exige um valor/);
  assert.throws(() => lerArgs(['listar', '--operador', 'dona']), /não aceita/);
});

t('listar: funciona desligado (só leitura), mostra itens, filtra por estado e não grava nada', () => cenario((a) => {
  const antes = foto(a);
  const r = rodar(['listar', '--fila', a.fila], {});
  assert.equal(r.code, SAIDAS.OK, r.err);
  assert.match(r.out, /fila: 3 item\(ns\)/);
  assert.match(r.out, /trilha: 0 evento\(s\), íntegra/);
  assert.match(r.out, /\[telegram\] rascunho/);
  assert.match(r.out, /Oferta 1$/m, 'mostra só a primeira linha do texto');
  assert.match(rodar(['listar', '--fila', a.fila, '--estado', 'aprovado']).out, /3 item\(ns\), 0 em "aprovado"/);
  assert.deepEqual(foto(a), antes);
}));

t('listar: fila ausente = vazia', () => cenario((a) => {
  const r = rodar(['listar', '--fila', path.join(a.dir, 'nao-existe', 'fila.json')]);
  assert.equal(r.code, SAIDAS.OK);
  assert.match(r.out, /fila: 0 item/);
}));

t('desligado (SOCIAL_ENABLED ausente ou inválido): aprovar/rejeitar saem com 2 e nada é gravado', () => cenario((a) => {
  const id = ids(a.fila)[0].id;
  const antes = foto(a);
  for (const env of [{ TAREFAS_OPERADORES: 'dona' }, { SOCIAL_ENABLED: 'sim', TAREFAS_OPERADORES: 'dona' }]) {
    const r = rodar(['aprovar', id, '--fila', a.fila, '--operador', 'dona'], env);
    assert.equal(r.code, SAIDAS.DESLIGADO);
    assert.match(r.err, /desligado/);
    assert.equal(rodar(['rejeitar', id, '--fila', a.fila, '--operador', 'dona', '--motivo', 'x'], env).code, SAIDAS.DESLIGADO);
  }
  assert.deepEqual(foto(a), antes);
}));

t('aprovar: grava trilha íntegra, âncora separada e estado na fila; listar mostra a decisão', () => cenario((a) => {
  const [it] = ids(a.fila);
  const r = rodar(['aprovar', it.id, '--fila', a.fila, '--operador', 'Dona', '--now', DEPOIS]);
  assert.equal(r.code, SAIDAS.OK, r.err);
  assert.match(r.out, /→ aprovado por dona/);
  assert.match(r.out, /nada publicado/);
  const trilha = JSON.parse(fs.readFileSync(a.trilha, 'utf8'));
  assert.equal(trilha.length, 1);
  assert.equal(trilha[0].acao, 'aprovar'); assert.equal(trilha[0].operador, 'dona'); assert.equal(trilha[0].itemId, it.id);
  assert.equal(trilha[0].hashTexto, sha256(it.texto)); assert.equal(trilha[0].ts, DEPOIS);
  assert.equal(fs.readFileSync(a.ancora, 'utf8').trim(), ultimoHash(trilha));
  assert.deepEqual(verificarTrilha(trilha, { ultimoHash: fs.readFileSync(a.ancora, 'utf8').trim() }), { ok: true, erros: [] });
  const depois = ids(a.fila);
  assert.equal(depois[0].estado, 'aprovado'); assert.equal(depois[0].atualizadoEm, DEPOIS); assert.equal(depois[0].motivo, null);
  assert.equal(depois[0].agendadoPara, null, 'aprovar não agenda nem publica');
  assert.deepEqual(depois.slice(1).map((x) => x.estado), ['rascunho', 'rascunho']);
  const l = rodar(['listar', '--fila', a.fila]);
  assert.match(l.out, /trilha: 1 evento\(s\), íntegra/);
  assert.match(l.out, /decisão: aprovar por dona em 2026-10-14T12:05:00.000Z/);
  assert.doesNotMatch(l.out, /!/);
  assert.equal(fs.existsSync(`${a.fila}.lock`), false, 'trava removida');
}));

t('rejeitar: exige motivo; motivo vai redigido para trilha e fila; encadeia na trilha existente', () => cenario((a) => {
  const [i1, i2] = ids(a.fila);
  assert.equal(rodar(['aprovar', i1.id, '--fila', a.fila, '--operador', 'dona', '--now', NOW]).code, SAIDAS.OK);
  const antes = foto(a);
  const sem = rodar(['rejeitar', i2.id, '--fila', a.fila, '--operador', 'revisor']);
  assert.equal(sem.code, SAIDAS.ERRO);
  assert.match(sem.err, /rejeição exige motivo/);
  assert.deepEqual(foto(a), antes, 'recusa não grava nada');
  const r = rodar(['rejeitar', i2.id, '--fila', a.fila, '--motivo', 'preço errado token=ghp_abcdefghijklmnopqrstuvwxyz0123456789', '--now', DEPOIS], { ...ENV, SOCIAL_OPERADOR: 'revisor' });
  assert.equal(r.code, SAIDAS.OK, r.err);
  const trilha = JSON.parse(fs.readFileSync(a.trilha, 'utf8'));
  assert.equal(trilha.length, 2);
  assert.equal(trilha[1].hashAnterior, trilha[0].hash);
  assert.equal(trilha[1].operador, 'revisor');
  assert.match(trilha[1].motivo, /^preço errado/);
  assert.doesNotMatch(trilha[1].motivo, /ghp_abcdefghij/);
  assert.equal(verificarTrilha(trilha, { ultimoHash: fs.readFileSync(a.ancora, 'utf8').trim() }).ok, true);
  const f = ids(a.fila);
  assert.equal(f[1].estado, 'rejeitado');
  assert.equal(f[1].motivo, trilha[1].motivo);
  assert.doesNotMatch(fs.readFileSync(a.fila, 'utf8'), /ghp_abcdefghij/);
}));

t('operador: ausente, fora da lista ou com formato inválido é recusado sem gravar', () => cenario((a) => {
  const id = ids(a.fila)[0].id;
  const antes = foto(a);
  assert.match(rodar(['aprovar', id, '--fila', a.fila]).err, /operador ausente/);
  assert.match(rodar(['aprovar', id, '--fila', a.fila, '--operador', 'intruso']).err, /operador não autorizado/);
  assert.match(rodar(['aprovar', id, '--fila', a.fila, '--operador', 'dona;rm']).err, /operador não autorizado/);
  // Sem TAREFAS_OPERADORES, vale o dono do repositório (como no tarefas.yml).
  assert.match(rodar(['aprovar', id, '--fila', a.fila, '--operador', 'dona'], { SOCIAL_ENABLED: '1', GITHUB_REPOSITORY: 'outra/repo' }).err, /não autorizado/);
  assert.deepEqual(foto(a), antes);
  assert.equal(rodar(['aprovar', id, '--fila', a.fila, '--operador', 'dona'], { SOCIAL_ENABLED: 'true', GITHUB_REPOSITORY: 'dona/repo' }).code, SAIDAS.OK);
}));

t('decisão única e item inexistente: segunda decisão recusada; nada muda', () => cenario((a) => {
  const id = ids(a.fila)[0].id;
  assert.equal(rodar(['aprovar', id, '--fila', a.fila, '--operador', 'dona']).code, SAIDAS.OK);
  const antes = foto(a);
  const r = rodar(['rejeitar', id, '--fila', a.fila, '--operador', 'revisor', '--motivo', 'mudei de ideia']);
  assert.equal(r.code, SAIDAS.ERRO);
  assert.match(r.err, /já decidido/);
  assert.match(rodar(['aprovar', 'nao-existe', '--fila', a.fila, '--operador', 'dona']).err, /item inexistente/);
  assert.deepEqual(foto(a), antes);
}));

t('falha fechada: trilha alterada, evento removido no fim, âncora ausente ou fila corrompida bloqueiam a decisão', () => cenario((a) => {
  const [i1, i2, i3] = ids(a.fila);
  assert.equal(rodar(['aprovar', i1.id, '--fila', a.fila, '--operador', 'dona']).code, SAIDAS.OK);
  assert.equal(rodar(['aprovar', i2.id, '--fila', a.fila, '--operador', 'dona']).code, SAIDAS.OK);
  const [fila, trilha, ancora] = foto(a);
  const ev = JSON.parse(trilha);
  const tentar = () => rodar(['aprovar', i3.id, '--fila', a.fila, '--operador', 'dona']);
  const casos = [
    ['evento alterado', () => fs.writeFileSync(a.trilha, JSON.stringify([{ ...ev[0], operador: 'revisor' }, ev[1]])), /trilha de auditoria inválida/],
    ['remoção no fim', () => fs.writeFileSync(a.trilha, JSON.stringify([ev[0]])), /âncora/],
    ['âncora ausente', () => fs.rmSync(a.ancora), /âncora ausente/],
    ['âncora inválida', () => fs.writeFileSync(a.ancora, 'xyz\n'), /âncora inválida/],
    ['trilha corrompida', () => fs.writeFileSync(a.trilha, '[{'), /trilha corrompida/],
    ['fila corrompida', () => fs.writeFileSync(a.fila, '{"versao":1,"itens":[{}]}'), /social\/fila/],
  ];
  for (const [nome, estraga, erro] of casos) {
    fs.writeFileSync(a.fila, fila); fs.writeFileSync(a.trilha, trilha); fs.writeFileSync(a.ancora, ancora);
    estraga();
    const depoisDeEstragar = foto(a);
    const r = tentar();
    assert.equal(r.code, SAIDAS.ERRO, nome);
    assert.match(r.err, erro, nome);
    assert.deepEqual(foto(a), depoisDeEstragar, `${nome}: nada gravado`);
  }
  fs.writeFileSync(a.fila, fila); fs.writeFileSync(a.trilha, JSON.stringify([{ ...ev[0], operador: 'revisor' }, ev[1]])); fs.writeFileSync(a.ancora, ancora);
  const l = rodar(['listar', '--fila', a.fila]);
  assert.equal(l.code, SAIDAS.ERRO, 'listar sinaliza trilha inválida');
  assert.match(l.out, /INVÁLIDA/);
}));

t('listar avisa texto alterado depois da aprovação e divergência entre fila e trilha', () => cenario((a) => {
  const [i1] = ids(a.fila);
  assert.equal(rodar(['aprovar', i1.id, '--fila', a.fila, '--operador', 'dona']).code, SAIDAS.OK);
  const f = deJson(fs.readFileSync(a.fila, 'utf8'));
  f.itens[0].texto = 'Oferta 1 editada';
  f.itens[1].estado = 'rejeitado'; f.itens[1].motivo = 'à mão';
  fs.writeFileSync(a.fila, paraJson(f));
  const l = rodar(['listar', '--fila', a.fila]);
  assert.match(l.out, /texto alterado depois da decisão/);
  assert.match(l.out, /item decidido sem evento na trilha/);
}));

t('trava: fila em uso recusa decisão e não remove a trava alheia', () => cenario((a) => {
  const id = ids(a.fila)[0].id;
  fs.writeFileSync(`${a.fila}.lock`, '');
  const antes = foto(a);
  const r = rodar(['aprovar', id, '--fila', a.fila, '--operador', 'dona']);
  assert.equal(r.code, SAIDAS.ERRO);
  assert.match(r.err, /fila em uso/);
  assert.deepEqual(foto(a), antes);
  assert.equal(fs.existsSync(`${a.fila}.lock`), true);
}));

t('CLI real: processo isolado, env mínimo, aprova e lista; publicar não existe', () => cenario((a) => {
  const id = ids(a.fila)[0].id;
  const env = { PATH: process.env.PATH, SOCIAL_ENABLED: '1', TAREFAS_OPERADORES: 'dona', SOCIAL_OPERADOR: 'dona' };
  const run = (args) => spawnSync(process.execPath, [tool, ...args], { cwd: root, encoding: 'utf8', env });
  const r = run(['aprovar', id, '--fila', a.fila]);
  assert.equal(r.status, 0, r.stderr);
  const l = run(['listar', '--fila', a.fila, '--estado', 'aprovado']);
  assert.equal(l.status, 0);
  assert.match(l.stdout, /1 em "aprovado"/);
  assert.equal(run(['publicar', id, '--fila', a.fila]).status, 1);
  assert.equal(spawnSync(process.execPath, [tool, 'aprovar', id, '--fila', a.fila], { cwd: root, encoding: 'utf8', env: { PATH: process.env.PATH } }).status, SAIDAS.DESLIGADO);
}));

console.log(`social-fila-cli: ${n} testes ok`);
