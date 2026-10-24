// WhatsApp: mais anúncios no dia (pedido do dono em 23/10/2026). Telegram fica igual.
import assert from 'node:assert/strict';
import { planejar, REGRAS, REGRAS_WHATSAPP } from '../src/agents/social/auto.js';

const NOW = Date.parse('2026-10-23T18:00:00Z'); // 15h em Brasília
const iso = (min) => new Date(NOW - min * 60e3).toISOString();
const c = (id) => ({ item: { ofertaId: id }, oferta: { firstSeen: iso(5000) }, afiliado: false });

assert.equal(REGRAS_WHATSAPP.maxDia, 34);
assert.equal(planejar([c('a')], [{ ofertaId: 'a', at: iso(6 * 60 + 1) }], { now: NOW, regras: REGRAS_WHATSAPP }).enviar.length, 1);
assert.equal(planejar([c('a')], [{ ofertaId: 'a', at: iso(5 * 60) }], { now: NOW, regras: REGRAS_WHATSAPP }).enviar.length, 0);
assert.equal(planejar([c('a')], [{ ofertaId: 'a', at: iso(48 * 60) }], { now: NOW, regras: REGRAS }).enviar.length, 0);
const d = (n) => Array.from({ length: n }, (_, i) => ({ ofertaId: 'o' + i, at: iso(40 + i) }));
assert.equal(planejar([c('b')], d(33), { now: NOW, regras: REGRAS_WHATSAPP }).enviar.length, 1);
assert.match(planejar([c('b')], d(34), { now: NOW, regras: REGRAS_WHATSAPP }).motivo, /teto de 34/);
console.log('social-whatsapp-reenvio: ok');
