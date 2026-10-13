// Social MVP — fila editorial, calendário e kill switch (issue #635): idempotência por chaveDedupe + canal, janela de
// repetição, limites por dia/intervalo, pausa (SOCIAL_PAUSA), desligado por padrão (SOCIAL_ENABLED), transições
// inválidas (publicado sempre recusado) e JSON corrompido. Módulo puro: sem rede, banco, secrets nem process.env.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  SOCIAL_ENABLED_DEFAULT, ESTADOS, TRANSICOES, PADROES, filaVazia, habilitado, pausado, enfileirar, transicionar,
  aprovar, rejeitar, agendar, paraJson, deJson, validarFila,
} from '../src/agents/social/fila.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let n = 0;
function t(name, fn) { try { fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } }
const NOW = '2026-10-13T12:00:00.000Z';
const ms = (s) => Date.parse(s);
const mais = (h, base = NOW) => new Date(ms(base) + h * 3600e3).toISOString();
const ON = { SOCIAL_ENABLED: '1' };
const congelar = (o) => JSON.parse(JSON.stringify(o));
// Fila com n itens aprovados no canal, criados 1 minuto um do outro antes de NOW.
function aprovados(qtd, canal = 'telegram', base = filaVazia()) {
  let f = base;
  for (let i = 0; i < qtd; i++) {
    const r = enfileirar(f, { canal, chaveDedupe: `oferta-${canal}-${i}`, texto: `Rascunho ${i}` }, { now: mais(-1 + i / 60) });
    f = aprovar(r.fila, r.item.id, { now: NOW }).fila;
  }
  return f;
}

// ---- Desligado por padrão e kill switch ----
t('desligado por padrão: SOCIAL_ENABLED ausente ou diferente de 1/true', () => {
  assert.equal(SOCIAL_ENABLED_DEFAULT, false);
  for (const env of [undefined, null, {}, { SOCIAL_ENABLED: '' }, { SOCIAL_ENABLED: '0' }, { SOCIAL_ENABLED: 'false' }, { SOCIAL_ENABLED: 'sim' }]) assert.equal(habilitado(env), false);
  for (const v of ['1', 'true', ' TRUE ']) assert.equal(habilitado({ SOCIAL_ENABLED: v }), true);
});
t('desligado não agenda nada e devolve a fila intacta', () => {
  const f = aprovados(2);
  for (const env of [undefined, {}, { SOCIAL_ENABLED: '0' }]) {
    const r = agendar(f, { canal: 'telegram', now: NOW, env });
    assert.equal(r.status, 'desligado'); assert.deepEqual(r.sugestoes, []);
    assert.ok(r.fila.itens.every((i) => i.agendadoPara === null));
  }
});
t('pausado: lista de canais ou "todos"', () => {
  assert.equal(pausado('telegram', {}), false);
  assert.equal(pausado('telegram', { SOCIAL_PAUSA: '' }), false);
  assert.equal(pausado('telegram', { SOCIAL_PAUSA: 'instagram' }), false);
  assert.equal(pausado('telegram', { SOCIAL_PAUSA: 'instagram, Telegram' }), true);
  assert.equal(pausado('whatsapp', { SOCIAL_PAUSA: 'instagram;whatsapp' }), true);
  assert.equal(pausado('qualquer', { SOCIAL_PAUSA: 'TODOS' }), true);
  assert.equal(pausado('tele', { SOCIAL_PAUSA: 'telegram' }), false, 'não casa por prefixo');
});
t('fila pausada não agenda; outro canal segue', () => {
  const f = aprovados(1, 'instagram', aprovados(1, 'telegram'));
  const env = { ...ON, SOCIAL_PAUSA: 'telegram' };
  const p = agendar(f, { canal: 'telegram', now: NOW, env });
  assert.equal(p.status, 'pausado'); assert.deepEqual(p.sugestoes, []);
  assert.ok(p.fila.itens.every((i) => i.agendadoPara === null));
  assert.equal(agendar(f, { canal: 'instagram', now: NOW, env }).sugestoes.length, 1);
  assert.equal(agendar(f, { canal: 'instagram', now: NOW, env: { ...ON, SOCIAL_PAUSA: 'todos' } }).status, 'pausado');
});

// ---- Enfileirar: idempotência e janela de repetição ----
t('enfileirar cria rascunho sem mutar a fila recebida', () => {
  const f0 = filaVazia(); const antes = congelar(f0);
  const r = enfileirar(f0, { canal: 'telegram', chaveDedupe: ' produto-1 ', texto: 'Booster X por R$ 30' }, { now: NOW });
  assert.deepEqual(f0, antes);
  assert.equal(r.status, 'enfileirado'); assert.equal(r.fila.itens.length, 1);
  assert.deepEqual(r.item, { id: `telegram:produto-1:${NOW}`, canal: 'telegram', chaveDedupe: 'produto-1', texto: 'Booster X por R$ 30', estado: 'rascunho', criadoEm: NOW, atualizadoEm: NOW, agendadoPara: null, motivo: null });
  assert.equal(enfileirar(null, { canal: 'telegram', chaveDedupe: 'a' }, { now: NOW }).item.texto, '');
});
t('idempotente: mesma chave + canal devolve a fila inalterada', () => {
  const r1 = enfileirar(filaVazia(), { canal: 'telegram', chaveDedupe: 'k', texto: 'a' }, { now: NOW });
  const r2 = enfileirar(r1.fila, { canal: 'telegram', chaveDedupe: 'k', texto: 'a' }, { now: NOW });
  assert.equal(r2.status, 'duplicado'); assert.deepEqual(r2.fila, r1.fila); assert.deepEqual(r2.item, r1.item);
  assert.equal(paraJson(r2.fila), paraJson(r1.fila));
});
t('janela de repetição: recusa dentro de 24 h, aceita depois; outro canal é independente', () => {
  const r1 = enfileirar(filaVazia(), { canal: 'telegram', chaveDedupe: 'k' }, { now: NOW });
  assert.equal(enfileirar(r1.fila, { canal: 'telegram', chaveDedupe: 'k', texto: 'outro texto' }, { now: mais(23.99) }).status, 'duplicado');
  const depois = enfileirar(r1.fila, { canal: 'telegram', chaveDedupe: 'k' }, { now: mais(24) });
  assert.equal(depois.status, 'enfileirado'); assert.equal(depois.fila.itens.length, 2);
  assert.equal(enfileirar(depois.fila, { canal: 'telegram', chaveDedupe: 'k' }, { now: mais(30) }).status, 'duplicado', 'conta a partir do item mais recente');
  assert.equal(enfileirar(r1.fila, { canal: 'instagram', chaveDedupe: 'k' }, { now: NOW }).status, 'enfileirado');
});
t('janela configurável e item rejeitado também bloqueia repetição dentro dela', () => {
  const r1 = enfileirar(filaVazia(), { canal: 'telegram', chaveDedupe: 'k' }, { now: NOW, janelaHoras: 2 });
  assert.equal(enfileirar(r1.fila, { canal: 'telegram', chaveDedupe: 'k' }, { now: mais(1.5), janelaHoras: 2 }).status, 'duplicado');
  assert.equal(enfileirar(r1.fila, { canal: 'telegram', chaveDedupe: 'k' }, { now: mais(2), janelaHoras: 2 }).status, 'enfileirado');
  const rej = rejeitar(r1.fila, r1.item.id, { now: NOW, motivo: 'texto ruim' }).fila;
  assert.equal(enfileirar(rej, { canal: 'telegram', chaveDedupe: 'k' }, { now: mais(1) }).status, 'duplicado');
});
t('entrada inválida lança', () => {
  const ok = { canal: 'telegram', chaveDedupe: 'k' };
  assert.throws(() => enfileirar(filaVazia(), ok, {}), /now/);
  assert.throws(() => enfileirar(filaVazia(), ok, { now: 'ontem' }), /now/);
  for (const item of [null, [], 'x', { ...ok, canal: '' }, { ...ok, canal: 'Telegram' }, { ...ok, canal: 'a b' }, { ...ok, chaveDedupe: '  ' }, { ...ok, chaveDedupe: 1 }, { ...ok, texto: 5 }, { ...ok, texto: 'x'.repeat(4001) }])
    assert.throws(() => enfileirar(filaVazia(), item, { now: NOW }), /social\/fila/);
  for (const janelaHoras of [0, -1, NaN, '24']) assert.throws(() => enfileirar(filaVazia(), ok, { now: NOW, janelaHoras }), /janelaHoras/);
  assert.throws(() => enfileirar({ versao: 1 }, ok, { now: NOW }), /fila/);
});

// ---- Transições ----
t('estados e transições permitidas', () => {
  assert.deepEqual([...ESTADOS], ['rascunho', 'aprovado', 'rejeitado', 'publicado']);
  assert.deepEqual([...TRANSICOES.rascunho], ['aprovado', 'rejeitado']);
  const r = enfileirar(filaVazia(), { canal: 'telegram', chaveDedupe: 'k' }, { now: NOW });
  const a = aprovar(r.fila, r.item.id, { now: mais(1) });
  assert.equal(a.item.estado, 'aprovado'); assert.equal(a.item.atualizadoEm, mais(1)); assert.equal(r.fila.itens[0].estado, 'rascunho', 'não muta');
  const j = rejeitar(r.fila, r.item.id, { now: mais(1), motivo: 'preço sem fonte' });
  assert.equal(j.item.estado, 'rejeitado'); assert.equal(j.item.motivo, 'preço sem fonte');
});
t('transição para publicado é sempre recusada', () => {
  const r = enfileirar(filaVazia(), { canal: 'telegram', chaveDedupe: 'k' }, { now: NOW });
  const a = aprovar(r.fila, r.item.id, { now: NOW }).fila;
  for (const f of [r.fila, a]) assert.throws(() => transicionar(f, r.item.id, 'publicado', { now: NOW }), /publicado/);
});
t('transições inválidas lançam', () => {
  const r = enfileirar(filaVazia(), { canal: 'telegram', chaveDedupe: 'k' }, { now: NOW });
  const a = aprovar(r.fila, r.item.id, { now: NOW }).fila;
  const j = rejeitar(r.fila, r.item.id, { now: NOW }).fila;
  assert.throws(() => aprovar(a, r.item.id, { now: NOW }), /aprovado → aprovado/);
  assert.throws(() => rejeitar(a, r.item.id, { now: NOW }), /aprovado → rejeitado/);
  assert.throws(() => aprovar(j, r.item.id, { now: NOW }), /rejeitado → aprovado/);
  assert.throws(() => transicionar(r.fila, r.item.id, 'rascunho', { now: NOW }), /rascunho → rascunho/);
  assert.throws(() => transicionar(r.fila, r.item.id, 'arquivado', { now: NOW }), /estado desconhecido/);
  assert.throws(() => aprovar(r.fila, 'nao-existe', { now: NOW }), /inexistente/);
  assert.throws(() => aprovar(r.fila, r.item.id, {}), /now/);
  assert.throws(() => rejeitar(r.fila, r.item.id, { now: NOW, motivo: 3 }), /motivo/);
});

// ---- Agendar: limites, intervalo, passado ----
t('respeita intervalo mínimo e limite por dia; excedente vai para o dia seguinte (fuso -03:00)', () => {
  const r = agendar(aprovados(4), { canal: 'telegram', now: NOW, porDia: 3, intervaloMin: 120, env: ON });
  assert.equal(r.status, 'ok');
  // 12:00Z = 09:00 local; o 4º item cai à 00:00 local do dia seguinte (03:00Z), ainda dentro da janela de 24 h.
  assert.deepEqual(r.sugestoes.map((s) => s.quando), [NOW, mais(2), mais(4), '2026-10-14T03:00:00.000Z']);
  assert.deepEqual(r.semVaga, []);
  assert.equal(r.fila.itens.filter((i) => i.agendadoPara).length, 4);
  for (let i = 1; i < r.sugestoes.length; i++) assert.ok(ms(r.sugestoes[i].quando) - ms(r.sugestoes[i - 1].quando) >= 120 * 60e3);
});
t('sem vaga dentro da janela: itens ficam em semVaga, sem horário', () => {
  const r = agendar(aprovados(5), { canal: 'telegram', now: NOW, porDia: 2, intervaloMin: 60, janelaHoras: 6, env: ON });
  assert.equal(r.sugestoes.length, 2); assert.equal(r.semVaga.length, 3);
  assert.equal(r.fila.itens.filter((i) => i.agendadoPara === null).length, 3);
});
t('conta os já agendados no limite por dia e no intervalo', () => {
  let f = agendar(aprovados(1), { canal: 'telegram', now: NOW, env: ON }).fila;   // ocupa 12:00Z
  for (const k of ['novo-1', 'novo-2', 'novo-3']) { const r = enfileirar(f, { canal: 'telegram', chaveDedupe: k }, { now: NOW }); f = aprovar(r.fila, r.item.id, { now: NOW }).fila; }
  const r2 = agendar(f, { canal: 'telegram', now: mais(0.5), porDia: 2, intervaloMin: 120, env: ON });
  // 12:30Z conflita com 12:00Z (intervalo) → 14:00Z; o dia local fica cheio (2) → 00:00 local (03:00Z) e 05:00Z.
  assert.deepEqual(r2.sugestoes.map((s) => s.quando), [mais(2), '2026-10-14T03:00:00.000Z', '2026-10-14T05:00:00.000Z']);
  assert.deepEqual(r2.semVaga, []);
});
t('nunca agenda no passado; segundos são arredondados para o próximo minuto', () => {
  const now = '2026-10-13T12:00:30.500Z';
  const r = agendar(aprovados(1), { canal: 'telegram', now, env: ON });
  assert.equal(r.sugestoes[0].quando, '2026-10-13T12:01:00.000Z');
  assert.ok(r.sugestoes.every((s) => ms(s.quando) >= ms(now)));
});
t('só agenda aprovados sem horário do próprio canal; rascunho e rejeitado ficam de fora', () => {
  let f = aprovados(1, 'instagram', aprovados(1));
  const rasc = enfileirar(f, { canal: 'telegram', chaveDedupe: 'rasc' }, { now: NOW }); f = rasc.fila;
  const rej = enfileirar(f, { canal: 'telegram', chaveDedupe: 'rej' }, { now: NOW }); f = rejeitar(rej.fila, rej.item.id, { now: NOW }).fila;
  const r = agendar(f, { canal: 'telegram', now: NOW, env: ON });
  assert.equal(r.sugestoes.length, 1);
  assert.ok(r.sugestoes[0].id.startsWith('telegram:oferta-telegram-0'));
  assert.equal(agendar(r.fila, { canal: 'telegram', now: NOW, env: ON }).sugestoes.length, 0, 'reagendar não duplica');
});
t('não muta a fila e o resultado é determinístico', () => {
  const f = aprovados(3); const antes = congelar(f);
  const a = agendar(f, { canal: 'telegram', now: NOW, env: ON });
  const b = agendar(f, { canal: 'telegram', now: NOW, env: ON });
  assert.deepEqual(f, antes); assert.deepEqual(a, b);
});
t('parâmetros inválidos do agendador lançam', () => {
  const f = aprovados(1);
  assert.throws(() => agendar(f, { canal: 'Tele gram', now: NOW, env: ON }), /canal/);
  assert.throws(() => agendar(f, { canal: 'telegram', env: ON }), /now/);
  for (const porDia of [0, 1.5, -1, '3']) assert.throws(() => agendar(f, { canal: 'telegram', now: NOW, porDia, env: ON }), /porDia/);
  for (const intervaloMin of [-1, NaN]) assert.throws(() => agendar(f, { canal: 'telegram', now: NOW, intervaloMin, env: ON }), /intervaloMin/);
  for (const janelaHoras of [0, Infinity]) assert.throws(() => agendar(f, { canal: 'telegram', now: NOW, janelaHoras, env: ON }), /janelaHoras/);
  for (const fusoMin of [-721, 841, 0.5]) assert.throws(() => agendar(f, { canal: 'telegram', now: NOW, fusoMin, env: ON }), /fusoMin/);
  assert.equal(PADROES.janelaRepeticaoHoras, 24);
});

// ---- Serialização ----
t('paraJson/deJson: ida e volta estável', () => {
  const f = agendar(aprovados(2), { canal: 'telegram', now: NOW, env: ON }).fila;
  const s = paraJson(f);
  assert.ok(s.endsWith('\n'));
  assert.deepEqual(deJson(s), f);
  assert.equal(paraJson(deJson(s)), s);
  // Ordem dos campos na entrada não altera a saída.
  const embaralhada = { itens: f.itens.map((i) => Object.fromEntries(Object.entries(i).reverse())), versao: 1 };
  assert.equal(paraJson(embaralhada), s);
  assert.equal(paraJson(filaVazia()), '{\n  "versao": 1,\n  "itens": []\n}\n');
});
t('JSON corrompido ou com forma inesperada lança; nunca aceita parcialmente', () => {
  const s = paraJson(aprovados(2));
  const base = JSON.parse(s);
  const mut = (fn) => { const o = JSON.parse(s); fn(o); return JSON.stringify(o); };
  const ruins = [
    undefined, '', '{', s.slice(0, -10), 'null', '[]', '"x"', '{}',
    JSON.stringify({ versao: 2, itens: base.itens }),
    JSON.stringify({ versao: 1, itens: {} }),
    JSON.stringify({ versao: 1, itens: [], extra: true }),
    mut((o) => { o.itens[1].estado = 'arquivado'; }),
    mut((o) => { o.itens[1].criadoEm = '2026-13-01T00:00:00.000Z'; }),
    mut((o) => { o.itens[1].atualizadoEm = '2020-01-01T00:00:00.000Z'; }),
    mut((o) => { o.itens[1].canal = 'Telegram'; }),
    mut((o) => { o.itens[1].chaveDedupe = ''; }),
    mut((o) => { o.itens[1].texto = null; }),
    mut((o) => { o.itens[1].motivo = 1; }),
    mut((o) => { o.itens[1].agendadoPara = 'amanhã'; }),
    mut((o) => { o.itens[1].estado = 'rascunho'; o.itens[1].agendadoPara = NOW; }),
    mut((o) => { delete o.itens[1].motivo; }),
    mut((o) => { o.itens[1].link = 'https://exemplo'; }),
    mut((o) => { o.itens[1].id = o.itens[0].id; }),
    mut((o) => { o.itens[1] = null; }),
    s.replace('"motivo"', '"__proto__": {}, "motivo"'),
  ];
  for (const r of ruins) assert.throws(() => deJson(r), /social\/fila/, String(r).slice(0, 80));
  assert.throws(() => paraJson({ versao: 1, itens: [{}] }), /item 0/);
  assert.throws(() => validarFila(null), /fila/);
});

// ---- Isolamento ----
t('módulo puro: sem imports, rede, process.env nem publicação', () => {
  const src = fs.readFileSync(path.join(root, 'src/agents/social/fila.js'), 'utf8');
  assert.ok(!/^\s*import\s/m.test(src) && !/\bimport\(/.test(src) && !/\brequire\(/.test(src), 'sem dependências');
  assert.ok(!/\bfetch\s*\(|process\.env|https?:\/\//.test(src), 'sem rede/ambiente/URLs');
});

console.log(`social-fila-tests: ${n} ok`);
