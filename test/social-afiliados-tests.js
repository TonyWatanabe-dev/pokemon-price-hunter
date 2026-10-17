// Social Media MVP — links de afiliado dos rascunhos (issue #642): config/social-afiliados.json e
// src/agents/social/afiliados.js. Confere hosts válidos/inválidos por marketplace, http recusado, marketplace sem link
// (Shopee pendente), que o link geral nunca vira link de anúncio, que config inválida é erro, que o módulo vem desligado
// e que não toca rede nem ranking. Sem rede e sem banco.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { validarLink, parseConfig, loadConfig, linkParaPost, HOSTS, MARKETPLACES, socialEnabled, SOCIAL_ENABLED_DEFAULT } from '../src/agents/social/afiliados.js';
import { DESTINATION_HOSTS } from '../api/_lib/affiliates.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
let n = 0;
const test = (name, fn) => { try { fn(); n++; } catch (e) { console.error(`✗ ${name}`); throw e; } };
const ML = 'https://meli.la/1BzQ4PU';
const AMZ = 'https://link.amazon/B0bVBmGRD';
const SHP = 'https://s.shopee.com.br/8fTCnyee7e';
const OFERTA_ML = 'https://produto.mercadolivre.com.br/MLB-1234567890-booster-box-_JM';
const OFERTA_AMZ = 'https://www.amazon.com.br/dp/B0HFNSM2T3';
const entrada = (o = {}) => ({ marketplace: 'mercadolivre', url: ML, tipo: 'geral', origem: '#560', validado: false, ...o });

test('config do repositório: links gerais da #560, intactos, sem Shopee', () => {
  const raw = JSON.parse(read('config/social-afiliados.json'));
  assert.deepEqual(raw.links, [
    { marketplace: 'mercadolivre', url: ML, tipo: 'geral', origem: '#560', validado: false },
    { marketplace: 'amazon', url: AMZ, tipo: 'geral', origem: '#560', validado: false },
    { marketplace: 'shopee', url: SHP, tipo: 'geral', origem: '#560', validado: false },
  ]);
  const cfg = loadConfig();
  assert.deepEqual(Object.keys(cfg.links).sort(), ['amazon', 'mercadolivre', 'shopee']);
  assert.equal(cfg.links.mercadolivre.url, ML);
  assert.equal(cfg.links.amazon.url, AMZ);
  assert.equal(cfg.links.shopee.url, SHP);
  assert.equal(JSON.parse(read('config/affiliates.json')).mercadolivre.geral.url, ML, 'mesmo link geral do site');
});

test('hosts por marketplace', () => {
  assert.deepEqual([...HOSTS.mercadolivre].sort(), [...DESTINATION_HOSTS].sort(), 'ML usa os hosts de api/_lib/affiliates.mjs');
  assert.deepEqual([...HOSTS.amazon].sort(), ['amazon.com.br', 'amzn.to', 'link.amazon']);
  assert.deepEqual(MARKETPLACES, ['mercadolivre', 'amazon', 'shopee']);
});

test('validarLink: hosts válidos devolvem a URL intacta', () => {
  for (const [url, mk] of [[ML, 'mercadolivre'], ['https://www.mercadolivre.com.br/social/x?matt=1', 'mercadolivre'], [OFERTA_ML, 'mercadolivre'],
    [AMZ, 'amazon'], ['https://amzn.to/3AbCdEf', 'amazon'], ['https://amazon.com.br/dp/B0HFNSM2T3?tag=x-20', 'amazon']]) {
    assert.equal(validarLink(url, mk), url, url);
  }
});

test('validarLink: host inválido, host de outro marketplace e truques são recusados', () => {
  for (const [url, mk] of [
    ['https://evil.com/x', 'mercadolivre'], ['https://meli.la.evil.com/x', 'mercadolivre'], ['https://evilmeli.la/x', 'mercadolivre'],
    [AMZ, 'mercadolivre'], [ML, 'amazon'], ['https://amazon.com/dp/x', 'amazon'], ['https://link.amazon.evil.com/x', 'amazon'],
    ['https://user:pw@link.amazon/x', 'amazon'], ['https://link.amazon:444/x', 'amazon'], [' https://link.amazon/x', 'amazon'],
    ['https://link.amazon/x y', 'amazon'], ['https://link.amazon/x"y', 'amazon'], ['https://link.amazon', 'amazon'], ['https://link.amazon/', 'amazon'],
    ['//link.amazon/x', 'amazon'], ['javascript:alert(1)', 'amazon'], ['data:text/html,x', 'amazon'], ['', 'amazon'], [null, 'amazon'], [1, 'amazon'], [{}, 'amazon'],
    [ML, 'desconhecido'], [ML, undefined], [ML, 'toString'], [ML, '__proto__'],
  ]) assert.equal(validarLink(url, mk), null, `${String(url)} @ ${String(mk)}`);
});

test('validarLink: http recusado', () => {
  assert.equal(validarLink('http://meli.la/1BzQ4PU', 'mercadolivre'), null);
  assert.equal(validarLink('http://link.amazon/B0bVBmGRD', 'amazon'), null);
  assert.throws(() => parseConfig({ links: [entrada({ url: 'http://meli.la/1BzQ4PU' })] }), /url recusada/);
});

test('Shopee: só o link curto do Portal de Afiliados; URL comum da Shopee não vira link do canal nem substitui a oferta', () => {
  assert.deepEqual([...HOSTS.shopee], ['s.shopee.com.br']);
  assert.equal(validarLink(SHP, 'shopee'), SHP);
  assert.equal(validarLink(SHP, 'mercadolivre'), null, 'link da Shopee não serve para outro marketplace');
  assert.equal(validarLink('https://shopee.com.br/x', 'shopee'), null);
  assert.throws(() => parseConfig({ links: [entrada({ marketplace: 'shopee', url: 'https://shopee.com.br/x' })] }), /url recusada/);
  const url = 'https://shopee.com.br/Booster-Box-i.1.2';
  assert.deepEqual(linkParaPost({ marketplace: 'shopee', urlOferta: url }), { marketplace: 'shopee', urlOferta: url, linkCanal: { marketplace: 'shopee', url: SHP, tipo: 'geral', origem: '#560', validado: false } }, 'URL da oferta intacta; link geral separado');
  assert.equal(linkParaPost({ marketplace: 'outra', urlOferta: url }).linkCanal, null);
  assert.equal(linkParaPost({ marketplace: 'mercadolivre', urlOferta: OFERTA_ML }, parseConfig({ links: [] })).linkCanal, null);
});

test('link geral nunca vira link de anúncio', () => {
  const ml = linkParaPost({ marketplace: 'mercadolivre', urlOferta: OFERTA_ML });
  assert.equal(ml.urlOferta, OFERTA_ML, 'link do post é a URL original da oferta');
  assert.deepEqual(ml.linkCanal, { marketplace: 'mercadolivre', url: ML, tipo: 'geral', origem: '#560', validado: false });
  const amz = linkParaPost({ marketplace: 'amazon', urlOferta: OFERTA_AMZ });
  assert.equal(amz.urlOferta, OFERTA_AMZ);
  assert.equal(amz.linkCanal.url, AMZ);
  // Mesmo com oferta de outra loja ou URL sem afiliado, nada é anexado ou reescrito.
  const comQuery = 'https://produto.mercadolivre.com.br/MLB-1234567890-x-_JM?pdp_filters=item_id%3AMLB1234567890#a';
  assert.equal(linkParaPost({ marketplace: 'mercadolivre', urlOferta: comQuery }).urlOferta, comQuery);
  // O resultado é cópia: mexer nele não altera a config.
  const cfg = loadConfig(); const r = linkParaPost({ marketplace: 'amazon', urlOferta: OFERTA_AMZ }, cfg);
  r.linkCanal.url = 'https://evil.com/x';
  assert.equal(cfg.links.amazon.url, AMZ);
  assert.ok(Object.isFrozen(cfg.links.amazon));
});

test('linkParaPost: urlOferta inválida é erro (não gera post com link duvidoso)', () => {
  for (const urlOferta of [undefined, null, '', 'javascript:alert(1)', ' https://x.com/a', 'nao-e-url', 42]) {
    assert.throws(() => linkParaPost({ marketplace: 'mercadolivre', urlOferta }), /urlOferta inválida/, String(urlOferta));
  }
  assert.throws(() => linkParaPost(), /urlOferta inválida/);
});

test('config inválida → erro', () => {
  for (const raw of [null, [], 'x', {}, { links: {} }, { links: [null] }, { links: [[]] }]) assert.throws(() => parseConfig(raw), /social-afiliados/, JSON.stringify(raw));
  assert.throws(() => parseConfig({ links: [entrada({ marketplace: 'ebay' })] }), /marketplace desconhecido/);
  assert.throws(() => parseConfig({ links: [entrada(), entrada()] }), /repetido/);
  assert.throws(() => parseConfig({ links: [entrada({ tipo: 'anuncio' })] }), /tipo inválido/);
  assert.throws(() => parseConfig({ links: [entrada({ origem: ' ' })] }), /origem ausente/);
  assert.throws(() => parseConfig({ links: [entrada({ validado: 'false' })] }), /validado/);
  assert.throws(() => parseConfig({ links: [entrada({ url: 'https://evil.com/x' })] }), /url recusada/);
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'social-afil-'));
  try {
    const f = path.join(tmp, 'c.json');
    assert.throws(() => loadConfig({ file: f }), /não foi possível ler/, 'arquivo ausente');
    fs.writeFileSync(f, '{ links: ');
    assert.throws(() => loadConfig({ file: f }), /não foi possível ler/, 'JSON inválido');
    fs.writeFileSync(f, JSON.stringify({ links: [entrada({ url: 'http://meli.la/x' })] }));
    assert.throws(() => loadConfig({ file: f }), /url recusada/);
    fs.writeFileSync(f, JSON.stringify({ links: [entrada()] }));
    assert.equal(loadConfig({ file: f }).links.mercadolivre.url, ML);
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

test('desativado por padrão (SOCIAL_ENABLED ausente = desligado)', () => {
  assert.equal(SOCIAL_ENABLED_DEFAULT, false);
  assert.equal(socialEnabled({}), false);
  for (const v of ['', '0', 'false', 'no', 'sim']) assert.equal(socialEnabled({ SOCIAL_ENABLED: v }), false, v);
  for (const v of ['1', 'true', ' TRUE ']) assert.equal(socialEnabled({ SOCIAL_ENABLED: v }), true, v);
  assert.equal(socialEnabled(null), false);
});

test('módulo puro: sem rede, sem banco, fora do ranking', () => {
  const src = read('src/agents/social/afiliados.js');
  for (const re of [/\bfetch\s*\(/, /node:https?/, /from 'pg'/, /process\.env\.(?!SOCIAL)/, /writeFileSync|appendFileSync/]) assert.doesNotMatch(src, re, String(re));
  const ranking = ['api/_lib/offer-rank.mjs', 'src/score.js', ...fs.readdirSync(path.join(root, 'src/core')).filter((f) => f.endsWith('.js')).map((f) => `src/core/${f}`)];
  for (const f of ranking) assert.doesNotMatch(read(f), /social-afiliados|social\/afiliados/, f);
});

console.log(`social-afiliados: ${n} testes ok`);
