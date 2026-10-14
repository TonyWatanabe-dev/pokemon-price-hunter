// Social Media MVP — métricas (issue #649): contrato de eventos, registro desligado por padrão, agregação por
// canal/dia no fuso local, métrica sem fonte = null, tipos reservados recusados, duplicados/inválidos isolados e
// adaptadores da fila e da trilha de auditoria. Módulo puro: sem rede, banco ou secrets.
import assert from 'node:assert/strict';
import {
  evento, registrar, agregar, deFila, deTrilha, motivoInvalido, TIPOS, RESERVADOS, METRICAS, VERSAO,
} from '../src/agents/social/metricas.js';
import { enfileirar, filaVazia } from '../src/agents/social/fila.js';
import { decidir } from '../src/agents/social/aprovacao.js';

let n = 0;
function t(name, fn) { try { fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } }
const ON = { SOCIAL_ENABLED: '1' };
const ev = (tipo, canal, itemId, ts) => evento({ tipo, canal, itemId, ts });

// ---- Contrato ----
t('contrato: tipos do MVP, reservados e forma do evento', () => {
  assert.deepEqual(TIPOS, ['rascunho_criado', 'aprovado', 'rejeitado', 'pausado']);
  assert.deepEqual(RESERVADOS, ['publicado', 'clique']);
  assert.deepEqual(METRICAS, [...TIPOS, ...RESERVADOS]);
  const e = ev('aprovado', 'telegram', 'p1', '2026-10-14T12:00:00.000Z');
  assert.deepEqual({ ...e }, { v: VERSAO, tipo: 'aprovado', canal: 'telegram', itemId: 'p1', ts: '2026-10-14T12:00:00.000Z' });
  assert.ok(Object.isFrozen(e));
  assert.equal(evento({ tipo: 'pausado', canal: 'instagram', now: Date.parse('2026-10-14T12:00:00Z') }).ts, '2026-10-14T12:00:00.000Z');
  assert.equal(evento({ tipo: 'pausado', canal: 'instagram', ts: '2026-10-14T12:00:00.000Z' }).itemId, null);
});

t('contrato: evento inválido lança; reservado é recusado', () => {
  for (const tipo of RESERVADOS) assert.throws(() => ev(tipo, 'telegram', 'p1', '2026-10-14T12:00:00.000Z'), /reservado/);
  assert.throws(() => ev('curtida', 'telegram', 'p1', '2026-10-14T12:00:00.000Z'), /tipo desconhecido/);
  assert.throws(() => ev('aprovado', 'Telegram!', 'p1', '2026-10-14T12:00:00.000Z'), /canal/);
  assert.throws(() => ev('aprovado', 'telegram', 'p1', '2026-10-14'), /ts/);
  assert.throws(() => ev('aprovado', 'telegram', 'p1', '2026-02-30T00:00:00.000Z'), /ts/);
  assert.throws(() => evento({ tipo: 'aprovado', canal: 'telegram', ts: '2026-10-14T12:00:00.000Z' }), /itemId obrigatório/);
  assert.throws(() => evento({ tipo: 'pausado', canal: 'telegram' }), /ts/);
  assert.equal(motivoInvalido(null), 'evento não é objeto');
  assert.equal(motivoInvalido({ v: 2, tipo: 'aprovado', canal: 'telegram', itemId: 'p', ts: '2026-10-14T12:00:00.000Z' }), 'versão desconhecida');
});

// ---- Registro ----
t('registrar: SOCIAL_ENABLED ausente = desligado, nada é registrado', () => {
  const lista = [];
  for (const env of [{}, { SOCIAL_ENABLED: '0' }, { SOCIAL_ENABLED: 'talvez' }, undefined]) {
    const r = registrar(lista, { tipo: 'pausado', canal: 'telegram', now: '2026-10-14T12:00:00Z' }, env && { env });
    assert.equal(r.status, 'desligado'); assert.equal(r.eventos, lista); assert.equal(r.evento, null);
  }
  assert.equal(lista.length, 0);
});

t('registrar: ligado acrescenta sem mutar e recusa duplicado por item', () => {
  const lista = [];
  const a = registrar(lista, { tipo: 'rascunho_criado', canal: 'telegram', itemId: 'p1', now: '2026-10-14T12:00:00Z' }, { env: ON });
  assert.equal(a.status, 'registrado'); assert.equal(a.eventos.length, 1); assert.equal(lista.length, 0);
  const b = registrar(a.eventos, { tipo: 'rascunho_criado', canal: 'telegram', itemId: 'p1', now: '2026-10-14T13:00:00Z' }, { env: ON });
  assert.equal(b.status, 'duplicado'); assert.equal(b.eventos, a.eventos);
  const p1 = registrar(a.eventos, { tipo: 'pausado', canal: 'telegram', now: '2026-10-14T13:00:00Z' }, { env: ON });
  const p2 = registrar(p1.eventos, { tipo: 'pausado', canal: 'telegram', now: '2026-10-14T14:00:00Z' }, { env: ON });
  assert.equal(p2.status, 'registrado', 'pausas em instantes distintos contam'); assert.equal(p2.eventos.length, 3);
  assert.throws(() => registrar([], { tipo: 'publicado', canal: 'telegram', itemId: 'p1', now: '2026-10-14T12:00:00Z' }, { env: ON }), /reservado/);
});

// ---- Agregação ----
t('agregar: por canal e dia local (America/Sao_Paulo), ordem estável', () => {
  const eventos = [
    ev('rascunho_criado', 'telegram', 'a', '2026-10-14T02:59:00.000Z'), // 13/10 23:59 em SP
    ev('rascunho_criado', 'telegram', 'b', '2026-10-14T03:00:00.000Z'), // 14/10 00:00 em SP
    ev('aprovado', 'telegram', 'b', '2026-10-14T15:00:00.000Z'),
    ev('rejeitado', 'telegram', 'a', '2026-10-14T15:30:00.000Z'),
    ev('rascunho_criado', 'instagram', 'c', '2026-10-14T12:00:00.000Z'),
    ev('pausado', 'instagram', null, '2026-10-14T12:30:00.000Z'),
  ];
  const r = agregar(eventos);
  assert.deepEqual(r.fontes, TIPOS);
  assert.deepEqual(r.linhas.map((l) => [l.canal, l.dia]), [['instagram', '2026-10-14'], ['telegram', '2026-10-13'], ['telegram', '2026-10-14']]);
  const tg14 = r.linhas[2];
  assert.deepEqual(tg14.contagens, { rascunho_criado: 1, aprovado: 1, rejeitado: 1, pausado: 0, publicado: null, clique: null });
  assert.equal(tg14.taxaAprovacao, 0.5);
  assert.equal(r.linhas[0].taxaAprovacao, null, 'sem decisão no dia = taxa ausente, não 0');
  assert.equal(r.linhas[0].contagens.pausado, 1);
  assert.equal(r.porCanal.telegram.contagens.rascunho_criado, 2);
  assert.deepEqual(Object.keys(r.porCanal), ['instagram', 'telegram']);
  assert.equal(r.total.contagens.rascunho_criado, 3); assert.equal(r.total.taxaAprovacao, 0.5);
  assert.deepEqual(r.ignorados, []);
  assert.deepEqual(agregar(eventos, { fusoMin: 0 }).linhas.map((l) => l.dia), ['2026-10-14', '2026-10-14']);
  assert.deepEqual(agregar(eventos, { canal: 'instagram' }).linhas.map((l) => l.canal), ['instagram']);
  assert.deepEqual(agregar([]).linhas, []);
});

t('agregar: métrica sem fonte = null, nunca 0; publicado/clique sempre ausentes', () => {
  const eventos = [ev('rascunho_criado', 'telegram', 'a', '2026-10-14T12:00:00.000Z'), ev('aprovado', 'telegram', 'a', '2026-10-14T13:00:00.000Z')];
  const r = agregar(eventos, { fontes: ['rascunho_criado'] });
  assert.deepEqual(r.fontes, ['rascunho_criado']);
  assert.deepEqual(r.linhas[0].contagens, { rascunho_criado: 1, aprovado: null, rejeitado: null, pausado: null, publicado: null, clique: null });
  assert.equal(r.linhas[0].taxaAprovacao, null);
  assert.deepEqual(r.ignorados, [{ indice: 1, motivo: 'tipo sem fonte declarada: aprovado' }]);
  assert.equal(agregar(eventos, { fontes: ['aprovado'] }).total.taxaAprovacao, null, 'sem fonte de rejeição não há taxa');
  assert.equal(agregar(eventos).total.taxaAprovacao, 1);
  assert.throws(() => agregar(eventos, { fontes: ['publicado'] }), /reservada/);
  assert.throws(() => agregar(eventos, { fontes: ['clique', 'aprovado'] }), /reservada/);
  assert.throws(() => agregar(eventos, { fontes: ['curtida'] }), /desconhecida/);
  assert.throws(() => agregar(eventos, { fontes: 'aprovado' }), /fontes/);
});

t('agregar: inválidos e duplicados ficam de fora e são listados', () => {
  const ok = ev('aprovado', 'telegram', 'a', '2026-10-14T12:00:00.000Z');
  const r = agregar([
    ok, { ...ok }, null,
    { v: 1, tipo: 'publicado', canal: 'telegram', itemId: 'a', ts: '2026-10-14T12:00:00.000Z' },
    { v: 1, tipo: 'clique', canal: 'telegram', itemId: 'a', ts: '2026-10-14T12:00:00.000Z' },
    { v: 1, tipo: 'aprovado', canal: 'telegram', itemId: 'b', ts: 'ontem' },
  ]);
  assert.equal(r.total.contagens.aprovado, 1);
  assert.equal(r.total.contagens.publicado, null); assert.equal(r.total.contagens.clique, null);
  assert.deepEqual(r.ignorados.map((i) => i.indice), [1, 2, 3, 4, 5]);
  assert.match(r.ignorados[0].motivo, /duplicado/);
  assert.match(r.ignorados[2].motivo, /reservado/);
  assert.throws(() => agregar(null), /lista/);
  assert.throws(() => agregar([], { canal: 'X Y' }), /canal/);
  assert.throws(() => agregar([], { fusoMin: 1.5 }), /fusoMin/);
});

// ---- Adaptadores dos módulos existentes ----
t('deFila: rascunho_criado pelo criadoEm; fila inválida lança', () => {
  let f = filaVazia();
  f = enfileirar(f, { canal: 'telegram', chaveDedupe: 'k1', texto: 'x' }, { now: '2026-10-14T12:00:00.000Z' }).fila;
  f = enfileirar(f, { canal: 'instagram', chaveDedupe: 'k2', texto: 'y' }, { now: '2026-10-14T13:00:00.000Z' }).fila;
  const r = deFila(f);
  assert.deepEqual(r.fontes, ['rascunho_criado']);
  assert.deepEqual(r.eventos.map((e) => [e.tipo, e.canal, e.ts]), [['rascunho_criado', 'telegram', '2026-10-14T12:00:00.000Z'], ['rascunho_criado', 'instagram', '2026-10-14T13:00:00.000Z']]);
  const a = agregar(r.eventos, { fontes: r.fontes });
  assert.equal(a.total.contagens.rascunho_criado, 2); assert.equal(a.total.contagens.aprovado, null);
  assert.throws(() => deFila({ versao: 9, itens: [] }));
});

t('deTrilha: decisões com canal informado; sem canal é ignorado; trilha adulterada lança', () => {
  const base = { enabled: true, operadores: ['op'], operador: 'op', now: '2026-10-14T12:00:00.000Z' };
  const a = decidir({ id: 'a', texto: 'A' }, { ...base, decisao: 'aprovar' });
  const b = decidir({ id: 'b', texto: 'B' }, { ...base, decisao: 'rejeitar', motivo: 'preço velho', trilha: [a.evento] });
  const trilha = [a.evento, b.evento];
  const r = deTrilha(trilha, { a: 'telegram' });
  assert.deepEqual(r.fontes, ['aprovado', 'rejeitado']);
  assert.deepEqual(r.eventos.map((e) => [e.tipo, e.canal, e.itemId]), [['aprovado', 'telegram', 'a']]);
  assert.deepEqual(r.ignorados, [{ indice: 1, motivo: 'canal do item desconhecido' }]);
  const todos = deTrilha(trilha, { a: 'telegram', b: 'telegram' });
  assert.equal(agregar(todos.eventos, { fontes: todos.fontes }).total.taxaAprovacao, 0.5);
  assert.deepEqual(deTrilha(trilha, { a: 'Tele gram' }).ignorados.map((i) => i.motivo), ['canal inválido', 'canal do item desconhecido']);
  assert.throws(() => deTrilha([{ ...a.evento, acao: 'rejeitar' }], { a: 'telegram' }), /trilha/);
  assert.throws(() => deTrilha(null), /trilha/);
});

console.log(`social-metricas: ${n} testes ok`);
