// Community Manager — classificador de mensagens suspeitas (issue #643). Exemplos positivos e negativos de cada regra,
// texto vazio/não-string, unicode (largura total, invisíveis, homógrafos), lista de hosts das lojas e isolamento:
// módulo puro, sem imports, rede, env nem ação automática.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  classificarMensagem, hostsDeLojas, socialHabilitado, REGRAS, NIVEIS, HOSTS_CONHECIDOS_PADRAO, ENCURTADORES, SOCIAL_ENABLED_DEFAULT,
} from '../src/agents/social/moderacao.js';
import { DESTINATION_HOSTS } from '../api/_lib/affiliates.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let n = 0;
const test = (name, fn) => { try { fn(); n++; } catch (e) { console.error(`✗ ${name}`); throw e; } };
const regras = (r) => [...new Set(r.motivos.map((m) => m.regra))].sort();
const stores = JSON.parse(fs.readFileSync(path.join(root, 'config/stores.json'), 'utf8'));
const LOJAS = { hostsConhecidos: hostsDeLojas(stores) };
const c = (t, o) => classificarMensagem(t, o);
const casa = (t, regra, nivel, o) => { const r = c(t, o); assert.ok(regras(r).includes(regra), `${JSON.stringify(t)} devia casar ${regra}: ${JSON.stringify(r)}`); if (nivel) assert.equal(r.nivel, nivel, t); return r; };
const naoCasa = (t, regra, o) => { const r = c(t, o); assert.ok(!regras(r).includes(regra), `${JSON.stringify(t)} não devia casar ${regra}: ${JSON.stringify(r)}`); return r; };
const ok = (t, o) => assert.deepEqual(c(t, o), { nivel: 'ok', motivos: [] }, t);

// ---- Entrada vazia, não-string e formato ----
test('texto vazio, só espaços e não-string viram ok sem motivos, sem lançar', () => {
  for (const t of ['', '   ', '\n\t', '​​', undefined, null, 42, {}, [], true]) assert.deepEqual(c(t), { nivel: 'ok', motivos: [] });
  for (const o of [null, 'x', [], 7]) assert.doesNotThrow(() => c('bit.ly/x', o));
});

test('mensagem comum de oferta é ok', () => {
  ok('Bom dia! Alguém sabe se a ETB de Fogo Fantasmagórico volta ao estoque?');
  ok('Achei a ETB por R$ 349,90 em https://www.copagloja.com.br/etb-x — valeu a dica do site!');
  ok('o site aceita pix? e a loja da copag aceita?');
  ok('EAN 7896048202047, CNPJ 10.368.321/0001-05, R$ 1.299,90 em 13/10/2026, carta 191/191.');
  ok('ok.valeu kkk');
});

test('resultado tem o formato { nivel, motivos: [{ regra, nivel, descricao, trecho }] }', () => {
  const r = c('Me manda um Pix de R$ 50 e veja bit.ly/abc');
  assert.deepEqual(Object.keys(r).sort(), ['motivos', 'nivel']);
  assert.ok(NIVEIS.includes(r.nivel));
  for (const m of r.motivos) {
    assert.deepEqual(Object.keys(m).sort(), ['descricao', 'nivel', 'regra', 'trecho']);
    assert.equal(m.nivel, REGRAS[m.regra].nivel); assert.equal(m.descricao, REGRAS[m.regra].descricao);
    assert.ok(m.trecho.length > 0 && m.trecho.length <= 80);
  }
  assert.equal(r.nivel, 'golpe', 'nível = regra mais grave');
});

// ---- Pix / pagamento antecipado ----
test('pix-antecipado: positivos', () => {
  for (const t of [
    'Me manda um Pix que eu envio hoje',
    'Vendo ETB, minha chave Pix é 11987654321',
    'chave pix: fulano@email.com',
    'faz o pix pra mim que eu reservo',
    'Pix antecipado e eu mando o código de rastreio',
    'pagamento adiantado, envio em 3 dias',
    'Só com sinal na frente',
    'manda o PIX para essa conta',
    'não tenho mais na loja, me manda um pix que eu separo',
  ]) casa(t, 'pix-antecipado', 'golpe');
});

test('pix-antecipado: negativos (dúvida, compra em loja, aviso)', () => {
  for (const t of [
    'o site aceita pix?',
    'comprei na copagloja no pix com 5% de desconto',
    'Nunca mande Pix para chave Pix de desconhecido!',
    'não faça pagamento antecipado para ninguém do grupo',
    'Pixel art da Pikachu ficou linda',
  ]) naoCasa(t, 'pix-antecipado');
});

// ---- Senha / código ----
test('pedido-senha-codigo: positivos', () => {
  for (const t of [
    'Passa o código que chegou no seu SMS pra eu liberar o sorteio',
    'me manda o código de verificação do WhatsApp',
    'Qual é a sua senha do site?',
    'informe o código de 6 dígitos',
    'confirma o CVV do cartão',
    'me envia o token',
  ]) casa(t, 'pedido-senha-codigo', 'golpe');
});

test('pedido-senha-codigo: negativos', () => {
  for (const t of [
    'esqueci minha senha do e-mail, alguém ajuda?',
    'Nunca passe sua senha pra ninguém',
    'não informe código de verificação a ninguém',
    'qual o código da coleção 151? é MEW',
    'o código de rastreio chegou hoje',
  ]) naoCasa(t, 'pedido-senha-codigo');
});

// ---- Link encurtado ----
test('link-encurtado: positivos (com e sem https, maiúsculas)', () => {
  for (const t of ['olha isso https://bit.ly/3abcXYZ', 'promo: tinyurl.com/etb-barata', 'AMZN.TO/xyz', 'cutt.ly/abc).']) casa(t, 'link-encurtado', 'suspeito');
  const r = c('https://bit.ly/x'); assert.deepEqual(regras(r), ['link-encurtado'], 'encurtador não conta também como link-desconhecido');
});

test('link-encurtado: negativos (encurtador conhecido de afiliado; host conhecido)', () => {
  ok('https://meli.la/1BzQ4PU');
  naoCasa('https://www.mercadolivre.com.br/oferta', 'link-encurtado');
  naoCasa('bit.ly/x', 'link-encurtado', { hostsConhecidos: ['bit.ly'] });
});

// ---- Link desconhecido ----
test('link-desconhecido: positivos', () => {
  for (const t of [
    'compre aqui https://pokemon-promo.xyz/etb',
    'loja-barata-tcg.com.br tem tudo',
    'https://mercadolivre.com.br.golpe.xyz/MLB-123',
    'https://www.mercadolivre.com.br@golpe.xyz/oferta',
    'http://192.168.0.10/promo',
    'https://www.copagloja.com.br.promo.shop/etb',
  ]) casa(t, 'link-desconhecido', 'suspeito');
});

test('link-desconhecido: negativos (site, afiliados, lojas de config/stores.json, subdomínio)', () => {
  ok('https://tcg-price-hunter.vercel.app/produto/x');
  ok('https://tcgpricehunter.com.br/produto/x');
  ok('https://www.tcgpricehunter.com.br/produto/x');
  ok('https://produto.mercadolivre.com.br/MLB-1234567890-etb');
  ok('www.amazon.com.br/dp/B0HFNSM2T3?tag=tcgpricehunter-20');
  for (const s of stores.stores.filter((x) => x.url)) ok(`vi em ${s.url}/produto/etb`, LOJAS);
  ok('https://loja.ludostation.com.br/x', LOJAS);
});

// ---- Pré-venda sem fonte ----
test('pre-venda-sem-fonte: positivos (sem link ou só com link desconhecido)', () => {
  for (const t of ['PRÉ-VENDA Prismatic Evolutions, garanta a sua!', 'pre venda de booster box 151', 'prevenda aberta', 'encomenda antecipada de ETB']) casa(t, 'pre-venda-sem-fonte', 'suspeito');
  const r = casa('Pré-venda em https://tcg-promo.shop/pv', 'pre-venda-sem-fonte'); assert.ok(regras(r).includes('link-desconhecido'));
});

test('pre-venda-sem-fonte: negativos (com link de loja conhecida; sem a palavra)', () => {
  ok('Pré-venda oficial em https://www.copagloja.com.br/prevenda-x');
  ok('pré-venda na Ludostation: https://ludostation.com.br/pv', LOJAS);
  naoCasa('a venda começa amanhã', 'pre-venda-sem-fonte');
});

// ---- Telefone / WhatsApp de terceiros ----
test('contato-terceiro: positivos', () => {
  for (const t of [
    'Chama no zap (11) 98765-4321',
    'contato 11987654321',
    '+55 21 99876-5432 vendo cartas',
    'fala comigo no whats',
    'https://wa.me/5511987654321',
    'entra no grupo chat.whatsapp.com/AbCdEf',
  ]) casa(t, 'contato-terceiro', 'suspeito');
  assert.deepEqual(regras(c('https://wa.me/5511987654321')), ['contato-terceiro'], 'wa.me não conta também como link-desconhecido');
});

test('contato-terceiro: negativos (números que não são telefone; telefone conhecido)', () => {
  ok('Preço R$ 1.299,90, 36 boosters, carta 151/165, 2026-10-13');
  ok('a loja Copag atende no 0800 771 87 07');
  ok('SAC da loja: (11) 3333-4444', { telefonesConhecidos: ['1133334444'] });
  ok('https://produto.mercadolivre.com.br/MLB-1198765432-etb');
  naoCasa('o whats do grupo caiu?', 'contato-terceiro');
});

// ---- Unicode ----
test('unicode: largura total, invisíveis e acentos não escondem a regra', () => {
  casa('ｂｉｔ．ｌｙ/abc', 'link-encurtado');
  casa('b​it.ly/abc', 'link-encurtado');
  casa('ME MANDA UM PİX', 'pix-antecipado');
  casa('Mé mánda um píx agora', 'pix-antecipado');
  casa('passa a ＳＥＮＨＡ', 'pedido-senha-codigo');
  casa('ｐｒé-ｖｅｎｄａ', 'pre-venda-sem-fonte');
  ok('Olá 👋 treinadores! Charizard ex ✨ está lindo 🔥');
  ok('日本語のポケモンカード、いいね');
});

test('unicode: homógrafos de host conhecido viram link-desconhecido', () => {
  casa('mercadolívre.com.br/oferta', 'link-desconhecido');
  casa('https://аmazon.com.br/dp/X', 'link-desconhecido');          // "а" cirílico
  casa('copаgloja.com.br/etb', 'link-desconhecido');                        // "а" cirílico
});

// ---- Listas de hosts ----
test('hostsDeLojas usa config/stores.json e aceita lista de URLs/hosts; entrada ruim vira []', () => {
  const hs = hostsDeLojas(stores);
  assert.ok(hs.includes('copagloja.com.br') && hs.every((h) => !h.startsWith('www.')));
  assert.deepEqual(hostsDeLojas(['https://www.Loja.com.br/x', 'loja.com.br', 'outra.net']), ['loja.com.br', 'outra.net']);
  for (const x of [null, undefined, 'x', 3, {}, { stores: 'x' }]) assert.deepEqual(hostsDeLojas(x), []);
});

test('hosts padrão cobrem os destinos de afiliado aceitos e os links da Amazon versionados', () => {
  for (const h of DESTINATION_HOSTS) ok(`https://${h}/x`);
  const amazon = JSON.parse(fs.readFileSync(path.join(root, 'config/afiliados/amazon.json'), 'utf8'));
  for (const l of amazon.links || []) ok(l.url);
  assert.ok(!ENCURTADORES.some((e) => HOSTS_CONHECIDOS_PADRAO.includes(e)), 'encurtador genérico não pode ser conhecido por padrão');
});

// ---- Desativado por padrão e isolamento ----
test('SOCIAL_ENABLED ausente = desligado; só "1"/"true" liga', () => {
  assert.equal(SOCIAL_ENABLED_DEFAULT, false);
  for (const env of [undefined, null, {}, { SOCIAL_ENABLED: '' }, { SOCIAL_ENABLED: '0' }, { SOCIAL_ENABLED: 'false' }, { SOCIAL_ENABLED: 'yes' }, { SOCIAL_ENABLED: true }]) assert.equal(socialHabilitado(env), false, JSON.stringify(env));
  assert.equal(socialHabilitado({ SOCIAL_ENABLED: '1' }), true);
  assert.equal(socialHabilitado({ SOCIAL_ENABLED: 'true' }), true);
});

test('módulo puro: sem imports, rede, env, arquivo nem ação; constantes congeladas; entrada não é alterada', () => {
  const src = fs.readFileSync(path.join(root, 'src/agents/social/moderacao.js'), 'utf8');
  const codigo = src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');   // sem comentários
  assert.doesNotMatch(codigo, /\bimport\b|\brequire\s*\(|\bfetch\s*\(|process\.env|XMLHttpRequest|WebSocket|node:/);
  for (const k of ['ban', 'delete', 'apagar', 'banir', 'sendMessage', 'responder']) assert.ok(!new RegExp(`\\b${k}\\w*\\s*\\(`, 'i').test(codigo), k);
  for (const x of [REGRAS, NIVEIS, HOSTS_CONHECIDOS_PADRAO, ENCURTADORES]) assert.ok(Object.isFrozen(x));
  const o = { hostsConhecidos: ['a.com'], telefonesConhecidos: ['11987654321'] }; const antes = JSON.stringify(o);
  c('bit.ly/x a.com (11) 98765-4321', o); assert.equal(JSON.stringify(o), antes);
  const r1 = c('Pré-venda! me manda pix, chama no zap 11987654321 bit.ly/x'); const r2 = c('Pré-venda! me manda pix, chama no zap 11987654321 bit.ly/x');
  assert.deepEqual(r1, r2, 'determinístico');
});

test('texto longo não trava (limite de 20 mil caracteres)', () => {
  const t0 = Date.now();
  c('a.'.repeat(50000) + ' pix '.repeat(20000) + '1'.repeat(100000));
  assert.ok(Date.now() - t0 < 2000);
});

console.log(`social-moderacao: ${n} testes OK`);
