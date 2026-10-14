// Social Media MVP — calendário de lançamentos do catálogo (issue #658). Data só com campo + fonte https no catálogo (sem
// data = não agenda), data/fonte inválida recusada com motivo, slots D-7/D-1/D0 no fuso do site, nunca no passado,
// desligado por padrão, rascunhos idempotentes na fila editorial e nada publicado. Sem rede e sem banco.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { datasDeLancamento, sugerirSlots, enfileirarLancamentos, CAMPOS, PADROES, SLOTS, MOTIVOS, SOCIAL_ENABLED_DEFAULT } from '../src/agents/social/lancamentos.js';
import { validarFila, aprovar, agendar } from '../src/agents/social/fila.js';
import { AVISO_COMPRA } from '../src/agents/social/rascunho.js';

let n = 0;
const test = (name, fn) => { try { fn(); n++; } catch (e) { console.error(`✗ ${name}`); throw e; } };
const LIGADO = { SOCIAL_ENABLED: '1' };
const FONTE = 'https://www.pokemon.com/br/novidades';
const T0 = Date.parse('2026-10-14T12:00:00Z');
const col = (id, o = {}) => ({ id, name: `Coleção ${id}`, series: 'Megaevolução', aliases: [id], ...o });
const datada = (id, data, o = {}) => col(id, { release_date: data, release_date_source: FONTE, ...o });
const cat = (...collections) => ({ collections, products: [] });

test('desligado por padrão, campos e padrões explícitos', () => {
  assert.equal(SOCIAL_ENABLED_DEFAULT, false);
  assert.deepEqual({ ...CAMPOS }, { data: 'release_date', fonte: 'release_date_source' });
  assert.deepEqual({ ...PADROES }, { janelaDias: 30, horaLocal: 10, fusoMin: -180 });
  assert.deepEqual(SLOTS.map((s) => [s.tipo, s.diasAntes]), [['anuncio', 7], ['vespera', 1], ['lancamento', 0]]);
});

test('catálogo real: sem campo de data nenhuma coleção é agendada', () => {
  const real = JSON.parse(readFileSync(new URL('../config/catalog.json', import.meta.url), 'utf8'));
  const r = datasDeLancamento(real);
  const comData = real.collections.filter((c) => c.release_date != null).length;
  assert.equal(r.lancamentos.length + r.recusadas.length, comData);
  assert.equal(r.semData.length, real.collections.length - comData);
  if (comData === 0) assert.deepEqual(sugerirSlots(real, { now: T0, env: LIGADO }).slots, []);
});

test('expõe data só com campo e fonte https; inválidos recusados com motivo', () => {
  const r = datasDeLancamento(cat(
    datada('me06', '2026-11-20'), col('me05'), col('me04', { release_date: '' }),
    datada('x1', '2026-02-30'), datada('x2', '20/11/2026'), datada('x3', '2026-11-20', { release_date_source: 'http://inseguro.com' }),
    datada('x4', '2026-11-20', { release_date_source: undefined }), { name: 'sem id', release_date: '2026-11-20' }, null,
    datada('me03', '2026-10-30'),
  ));
  assert.deepEqual(r.lancamentos.map((l) => [l.colecao, l.data]), [['me03', '2026-10-30'], ['me06', '2026-11-20']]);
  assert.deepEqual(r.lancamentos[1], { colecao: 'me06', nome: 'Coleção me06', serie: 'Megaevolução', data: '2026-11-20', fonte: FONTE });
  assert.deepEqual(r.semData, ['me05', 'me04']);
  assert.deepEqual(r.recusadas, [
    { colecao: 'x1', motivo: MOTIVOS.DATA_INVALIDA }, { colecao: 'x2', motivo: MOTIVOS.DATA_INVALIDA },
    { colecao: 'x3', motivo: MOTIVOS.SEM_FONTE }, { colecao: 'x4', motivo: MOTIVOS.SEM_FONTE },
    { colecao: '#7', motivo: MOTIVOS.COLECAO_INVALIDA }, { colecao: '#8', motivo: MOTIVOS.COLECAO_INVALIDA },
  ]);
});

test('não infere data de coleção combinada nem da série', () => {
  const r = datasDeLancamento(cat(datada('a', '2026-11-01'), col('ab', { combines: ['a', 'b'] })));
  assert.deepEqual(r.lancamentos.map((l) => l.colecao), ['a']);
  assert.deepEqual(r.semData, ['ab']);
});

test('catálogo corrompido falha fechado', () => {
  for (const c of [null, {}, { collections: 'x' }, []]) assert.throws(() => datasDeLancamento(c), /catálogo sem lista/);
});

test('nome vindo do catálogo vira texto puro', () => {
  const [l] = datasDeLancamento(cat(datada('z', '2026-11-01', { name: '<b>Caos</b> https://golpe.example @fulano' }))).lancamentos;
  assert.equal(l.nome, 'Caos fulano');
});

test('desligado (SOCIAL_ENABLED ausente ou diferente de 1/true) não sugere slots', () => {
  const c = cat(datada('me06', '2026-10-20'));
  for (const env of [undefined, {}, { SOCIAL_ENABLED: '0' }, { SOCIAL_ENABLED: 'sim' }]) {
    const r = sugerirSlots(c, { now: T0, env });
    assert.equal(r.status, 'desligado');
    assert.deepEqual(r.slots, []);
  }
});

test('slots D-7, D-1 e D0 às 10 h de Brasília, dentro da janela e nunca no passado', () => {
  const r = sugerirSlots(cat(datada('me06', '2026-10-24')), { now: T0, env: LIGADO });
  assert.equal(r.status, 'ok');
  assert.deepEqual(r.slots.map((s) => [s.tipo, s.quando]), [
    ['anuncio', '2026-10-17T13:00:00.000Z'], ['vespera', '2026-10-23T13:00:00.000Z'], ['lancamento', '2026-10-24T13:00:00.000Z'],
  ]);
  assert.deepEqual(r.slots.map((s) => s.chaveDedupe), ['lancamento:me06:2026-10-24:anuncio', 'lancamento:me06:2026-10-24:vespera', 'lancamento:me06:2026-10-24:lancamento']);
  // D-7 já passou: só véspera e dia.
  assert.deepEqual(sugerirSlots(cat(datada('me06', '2026-10-18')), { now: T0, env: LIGADO }).slots.map((s) => s.tipo), ['vespera', 'lancamento']);
  // Lançamento hoje: 10 h local (13 h UTC) ainda não passou às 12 h UTC; às 14 h UTC já passou.
  assert.deepEqual(sugerirSlots(cat(datada('me06', '2026-10-14')), { now: T0, env: LIGADO }).slots.map((s) => s.tipo), ['lancamento']);
  assert.deepEqual(sugerirSlots(cat(datada('me06', '2026-10-14')), { now: Date.parse('2026-10-14T14:00:00Z'), env: LIGADO }).slots, []);
  // Lançamento passado ou além da janela não agenda.
  assert.deepEqual(sugerirSlots(cat(datada('me06', '2026-09-01')), { now: T0, env: LIGADO }).slots, []);
  assert.deepEqual(sugerirSlots(cat(datada('me06', '2027-01-30')), { now: T0, env: LIGADO }).slots, []);
  assert.equal(sugerirSlots(cat(datada('me06', '2027-01-30')), { now: T0, env: LIGADO, janelaDias: 120 }).slots.length, 3);
});

test('horário e fuso configuráveis; parâmetros inválidos lançam', () => {
  const [s] = sugerirSlots(cat(datada('me06', '2026-10-24')), { now: T0, env: LIGADO, horaLocal: 18, fusoMin: 0 }).slots;
  assert.equal(s.quando, '2026-10-17T18:00:00.000Z');
  const c = cat(datada('me06', '2026-10-24'));
  for (const o of [{ janelaDias: 0 }, { janelaDias: NaN }, { horaLocal: 24 }, { horaLocal: 9.5 }, { fusoMin: 900 }, { fusoMin: -1.5 }]) {
    assert.throws(() => sugerirSlots(c, { now: T0, env: LIGADO, ...o }), /inválido/);
  }
  assert.throws(() => sugerirSlots(c, { now: 'ontem', env: LIGADO }), /now inválido/);
});

test('texto do rascunho: data em pt-BR, aviso de compra, sem URL nem preço', () => {
  const slots = sugerirSlots(cat(datada('me06', '2026-10-24', { name: 'Escuridão Absoluta' })), { now: T0, env: LIGADO }).slots;
  assert.equal(slots[0].texto, `Lançamento chegando: Escuridão Absoluta sai em 24/10/2026.\nData conforme o catálogo do TCG Price Hunter; pode mudar.\n${AVISO_COMPRA}`);
  assert.match(slots[1].texto, /^É amanhã: Escuridão Absoluta sai em 24\/10\/2026\./);
  assert.match(slots[2].texto, /^Lançamento hoje \(24\/10\/2026\): Escuridão Absoluta\./);
  for (const s of slots) { assert.doesNotMatch(s.texto, /https?:|R\$/); assert.equal(s.fonte, FONTE); }
});

test('vários lançamentos: slots em ordem cronológica', () => {
  const r = sugerirSlots(cat(datada('b', '2026-10-30'), datada('a', '2026-10-24')), { now: T0, env: LIGADO });
  const qs = r.slots.map((s) => s.quando);
  assert.deepEqual(qs, [...qs].sort());
  assert.equal(r.slots.length, 6);
});

test('enfileira rascunhos na fila editorial, sem mutar a entrada e de forma idempotente', () => {
  const c = cat(datada('me06', '2026-10-24'), col('me05'));
  const r = enfileirarLancamentos(null, c, { canal: 'telegram', now: T0, env: LIGADO });
  assert.equal(r.status, 'ok');
  assert.equal(r.enfileirados.length, 3);
  assert.deepEqual(r.duplicados, []);
  assert.deepEqual(r.semData, ['me05']);
  assert.deepEqual(r.enfileirados.map((e) => [e.tipo, e.sugeridoPara]), [
    ['anuncio', '2026-10-17T13:00:00.000Z'], ['vespera', '2026-10-23T13:00:00.000Z'], ['lancamento', '2026-10-24T13:00:00.000Z'],
  ]);
  validarFila(r.fila);
  for (const it of r.fila.itens) { assert.equal(it.estado, 'rascunho'); assert.equal(it.agendadoPara, null); assert.equal(it.canal, 'telegram'); }

  const copia = JSON.stringify(r.fila);
  // Rodar de novo dias depois (ainda antes do lançamento) não duplica.
  const r2 = enfileirarLancamentos(r.fila, c, { canal: 'telegram', now: Date.parse('2026-10-20T12:00:00Z'), env: LIGADO });
  assert.equal(JSON.stringify(r.fila), copia);
  assert.deepEqual(r2.enfileirados, []);
  assert.deepEqual(r2.duplicados.map((d) => d.tipo), ['vespera', 'lancamento']);
  assert.equal(r2.fila.itens.length, 3);
  // Outro canal tem fila própria de dedupe.
  assert.equal(enfileirarLancamentos(r.fila, c, { canal: 'instagram', now: T0, env: LIGADO }).enfileirados.length, 3);
  // Adiamento no catálogo muda a chave: novo rascunho para revisão humana.
  const adiado = enfileirarLancamentos(r.fila, cat(datada('me06', '2026-10-31')), { canal: 'telegram', now: T0, env: LIGADO });
  assert.equal(adiado.enfileirados.length, 3);
});

test('desligado devolve a fila inalterada; fila corrompida ou canal inválido lançam', () => {
  const c = cat(datada('me06', '2026-10-24'));
  const r = enfileirarLancamentos(null, c, { canal: 'telegram', now: T0 });
  assert.equal(r.status, 'desligado');
  assert.deepEqual(r.fila, { versao: 1, itens: [] });
  assert.deepEqual(r.enfileirados, []);
  assert.throws(() => enfileirarLancamentos({ versao: 2, itens: [] }, c, { canal: 'telegram', now: T0, env: LIGADO }), /versão/);
  assert.throws(() => enfileirarLancamentos(null, c, { canal: 'Telegram!', now: T0, env: LIGADO }), /canal inválido/);
});

test('nada é publicado: aprovação humana e agendar() continuam obrigatórios', () => {
  const r = enfileirarLancamentos(null, cat(datada('me06', '2026-10-24')), { canal: 'telegram', now: T0, env: LIGADO });
  const sem = agendar(r.fila, { canal: 'telegram', now: T0, env: LIGADO });
  assert.deepEqual(sem.sugestoes, []);   // rascunho não aprovado não ganha horário
  const ap = aprovar(r.fila, r.enfileirados[0].id, { now: T0 });
  assert.equal(agendar(ap.fila, { canal: 'telegram', now: T0, env: LIGADO }).sugestoes.length, 1);
  assert.ok(r.fila.itens.every((it) => it.estado !== 'publicado'));
});

console.log(`social-lancamentos: ${n} testes ok`);
