// T4 da auditoria de observabilidade: dados_indisponiveis persistente avisa uma vez (3 checagens), lembra por conta própria e a recuperação limpa o contador.
import assert from 'node:assert/strict';
import { evaluate, decide, commitLedger, RULES } from '../src/ops-watch.js';

const iso = (m) => new Date(Date.parse('2026-10-09T12:00:00.000Z') + m * 6e4).toISOString();
const unk = (now) => evaluate({ now, stateGeneratedAt: null, meta: null, runs: [] });
const step = (L, ev, now, delivered = true) => { const d = decide(ev, L, now); return { d, L: commitLedger(L, ev, d, delivered, now) }; };

let L = null;
const ev0 = unk(iso(0));
assert.equal(ev0.status, 'desconhecido');
assert.ok(ev0.reasons.some((r) => r.code === 'dados_indisponiveis'));

let r = step(L, unk(iso(0)), iso(0)); L = r.L; assert.equal(r.d.notify, null);
r = step(L, unk(iso(15)), iso(15)); L = r.L; assert.equal(r.d.notify, null);
r = step(L, unk(iso(30)), iso(30)); L = r.L;
assert.equal(r.d.notify.kind, 'indisponivel'); assert.equal(L.unkCount, RULES.UNKNOWN_CONSEC);
r = step(L, unk(iso(45)), iso(45)); L = r.L; assert.equal(r.d.notify, null, 'não repete');
r = step(L, unk(iso(30 + RULES.REMIND_MIN)), iso(30 + RULES.REMIND_MIN)); L = r.L;
assert.equal(r.d.notify.kind, 'lembrete_indisponivel');

// recuperação (qualquer status conhecido) limpa o contador
const ok = { status: 'saudavel', reasons: [], facts: {} };
L = commitLedger(L, ok, { notify: null }, false, iso(500));
assert.equal(L.unkCount, 0); assert.equal(L.unkAt, null);
r = step(L, unk(iso(515)), iso(515)); assert.equal(r.d.notify, null, 'contagem recomeça');

// não entregue: tenta de novo na checagem seguinte
let M = null;
for (const m of [0, 15]) M = step(M, unk(iso(m)), iso(m)).L;
r = step(M, unk(iso(30)), iso(30), false); assert.equal(r.d.notify.kind, 'indisponivel');
assert.equal(decide(unk(iso(45)), r.L, iso(45)).notify.kind, 'indisponivel');

// outros motivos de desconhecido continuam sem avisar
const outro = { status: 'desconhecido', reasons: [{ code: 'meta_ausente', text: 'x' }], facts: {} };
let O = null; for (let i = 0; i < 5; i++) { const s = step(O, outro, iso(i)); assert.equal(s.d.notify, null); O = s.L; }
console.log('ops-desconhecido-tests ok');
