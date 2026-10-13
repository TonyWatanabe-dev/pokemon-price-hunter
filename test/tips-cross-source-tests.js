// tipHits: mesma pista (produto + preço) de fontes diferentes gera um só alerta; preço diferente gera outro.
import assert from 'node:assert/strict';
import { tipHits, dispatchTips } from '../src/alerts.js';

const mk = (id, price, source) => ({ id, source, isNew: true, productId: 'p1', msrp: 100, price, discount: 1 - price / 100, label: 'x', collectionName: 'c', url: 'https://x/' + id });
const now = new Date('2026-10-13T12:00:00Z');
const send = { telegram: async () => true };

// mesma batida: duas fontes, mesmo preço → uma; preço diferente → outra
let hits = tipHits([mk('a', 50, 'pelando'), mk('b', 50, 'telegram'), mk('c', 40, 'telegram')], {}, { now: now.getTime() });
assert.deepEqual(hits.map((h) => h.id), ['a', 'c']);

// depois de enviado, outra fonte com o mesmo preço é ignorada dentro da janela
const sent = {};
await dispatchTips([hits[0]], sent, { send, now });
assert.ok(sent['tipp|p1|50']);
assert.deepEqual(tipHits([mk('d', 50, 'telegram')], sent, { now: now.getTime() + 3600000 }), []);
assert.deepEqual(tipHits([mk('e', 45, 'telegram')], sent, { now: now.getTime() + 3600000 }).map((h) => h.id), ['e']);
// fora da janela volta a avisar
assert.equal(tipHits([mk('f', 50, 'telegram')], sent, { now: now.getTime() + 25 * 3600000 }).length, 1);
