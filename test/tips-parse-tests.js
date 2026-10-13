// Pistas (src/tips.js): parsePelando, parseTelegram e channelOf com HTML de exemplo (corpo vazio,
// item sem preço, canal inválido). Sem rede e sem banco.
import assert from 'node:assert/strict';
import { parsePelando, parseTelegram, channelOf } from '../src/tips.js';

const t = (name, fn) => { try { fn(); } catch (e) { e.message = `${name}: ${e.message}`; throw e; } };
const post = (id, inner) => `<div class="tgme_widget_message_wrap"><div data-post="canal/${id}">${inner}<time datetime="2026-10-01T10:00:00+00:00"></time></div></div>`;
const textDiv = (s) => `<div class="tgme_widget_message_text">${s}</div>`;

t('telegram: corpo vazio é descartado, posts válidos continuam', () => {
  const html = post(1, textDiv('')) + post(2, '<div class="tgme_widget_message_photo"></div>') + post(3, textDiv('Blister Pokémon R$ 39,90'));
  const r = parseTelegram(html, 'canal');
  assert.equal(r.length, 1);
  assert.equal(r[0].key, 'tg:canal/3');
  assert.equal(r[0].price, 39.9);
});

t('telegram: item sem preço mantém price nulo', () => {
  const r = parseTelegram(post(4, textDiv('Booster Pokémon chegou na loja')), 'canal');
  assert.equal(r.length, 1);
  assert.equal(r[0].price, null);
});

t('telegram: html vazio ou sem posts devolve lista vazia', () => {
  assert.deepEqual(parseTelegram('', 'canal'), []);
  assert.deepEqual(parseTelegram('<html></html>', 'canal'), []);
});

t('pelando: item sem preço mantém price nulo', () => {
  const r = parsePelando('<a href="/d/lata-pokemon-wxyz">Lata Pokémon</a> sem valor informado');
  assert.equal(r.length, 1);
  assert.equal(r[0].price, null);
  assert.equal(r[0].url, 'https://www.pelando.com.br/d/lata-pokemon-wxyz');
});

t('pelando: html vazio ou sem promoções devolve lista vazia', () => {
  assert.deepEqual(parsePelando(''), []);
  assert.deepEqual(parsePelando('<p>nada</p>'), []);
});

t('channelOf: normaliza @, links t.me e formatos inválidos', () => {
  assert.equal(channelOf('@canal_pokemon'), 'canal_pokemon');
  assert.equal(channelOf(' https://t.me/s/canal_pokemon?before=10 '), 'canal_pokemon');
  assert.equal(channelOf('https://telegram.me/canal_pokemon'), 'canal_pokemon');
  assert.equal(channelOf(''), '');
  assert.ok(!/^[A-Za-z0-9_]{4,}$/.test(channelOf('@ab')), 'canal curto');
  assert.ok(!/^[A-Za-z0-9_]{4,}$/.test(channelOf('canal inválido!')), 'caracteres inválidos');
});
