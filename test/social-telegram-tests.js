// Social MVP — adaptador Telegram em modo simulação (issue #650): dry-run por padrão, recusa sem SOCIAL_ENABLED,
// com canal pausado, sem item aprovado ou sem token/chat do chamador; envio real só com simular:false + fetch
// injetado. Só fetch falso: nenhum acesso à rede. O token nunca aparece no resultado.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { filaVazia, enfileirar, aprovar, rejeitar } from '../src/agents/social/fila.js';
import { SOCIAL_ENABLED_DEFAULT, MOTIVOS, TEXTO_MAX, montarRequisicao, publicar } from '../src/agents/social/telegram.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let n = 0;
async function t(name, fn) { try { await fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } }
const NOW = '2026-10-14T12:00:00.000Z';
const TOKEN = '123456789:AAFakeTokenSomenteParaTeste_xyz-0123';
const ON = { SOCIAL_ENABLED: 'true' };
const BASE = { env: ON, token: TOKEN, chatId: '@tcgpricehunter' };

function item({ canal = 'telegram', texto = 'Booster X por R$ 29,90\nhttps://tcgpricehunter.com.br/p/x', estado = 'aprovado' } = {}) {
  const r = enfileirar(filaVazia(), { canal, chaveDedupe: 'oferta-1', texto }, { now: NOW });
  if (estado === 'rascunho') return r.item;
  return (estado === 'aprovado' ? aprovar : rejeitar)(r.fila, r.item.id, { now: NOW }).item;
}

// fetch falso: grava as chamadas e devolve a resposta configurada.
function fakeFetch(resposta = { ok: true, status: 200, json: async () => ({ ok: true, result: { message_id: 42 } }) }) {
  const chamadas = [];
  const f = async (url, init) => {
    chamadas.push({ url, init });
    if (resposta instanceof Error) throw resposta;
    return resposta;
  };
  f.chamadas = chamadas;
  return f;
}
const semToken = (r) => assert.ok(!JSON.stringify(r).includes(TOKEN) && !JSON.stringify(r).includes('AAFakeToken'), 'token vazou');

// ---- Desligado por padrão, pausa e recusas ----
await t('desligado por padrão: sem SOCIAL_ENABLED recusa e não chama fetch', async () => {
  assert.equal(SOCIAL_ENABLED_DEFAULT, false);
  for (const env of [undefined, {}, { SOCIAL_ENABLED: '' }, { SOCIAL_ENABLED: 'false' }, { SOCIAL_ENABLED: 'sim' }]) {
    const f = fakeFetch();
    const r = await publicar(item(), { ...BASE, env, simular: false, fetch: f });
    assert.equal(r.ok, false); assert.equal(r.status, 'recusado'); assert.equal(r.motivo, MOTIVOS.DESLIGADO);
    assert.equal(r.requisicao, null); assert.equal(f.chamadas.length, 0);
    assert.equal(montarRequisicao(item(), { ...BASE, env }).motivo, MOTIVOS.DESLIGADO);
  }
});
await t('canal pausado (SOCIAL_PAUSA=telegram ou todos) recusa', async () => {
  for (const SOCIAL_PAUSA of ['telegram', 'TODOS', 'instagram, telegram']) {
    const f = fakeFetch();
    const r = await publicar(item(), { ...BASE, env: { ...ON, SOCIAL_PAUSA }, simular: false, fetch: f });
    assert.equal(r.motivo, MOTIVOS.PAUSADO); assert.equal(f.chamadas.length, 0);
  }
  assert.equal(montarRequisicao(item(), { ...BASE, env: { ...ON, SOCIAL_PAUSA: 'instagram' } }).ok, true);
});
await t('só item aprovado do Telegram: rascunho, rejeitado, outro canal e item malformado são recusados', async () => {
  assert.equal(montarRequisicao(item({ estado: 'rascunho' }), BASE).motivo, MOTIVOS.NAO_APROVADO);
  assert.equal(montarRequisicao(item({ estado: 'rejeitado' }), BASE).motivo, MOTIVOS.NAO_APROVADO);
  assert.equal(montarRequisicao({ ...item(), estado: 'publicado' }, BASE).motivo, MOTIVOS.NAO_APROVADO);
  assert.equal(montarRequisicao(item({ canal: 'instagram' }), BASE).motivo, MOTIVOS.OUTRO_CANAL);
  const { motivo, ...semCampo } = item();
  for (const ruim of [null, undefined, 'texto', [], {}, semCampo, { ...item(), extra: 1 }, { ...item(), estado: 'Aprovado' }]) {
    assert.equal(montarRequisicao(ruim, BASE).motivo, MOTIVOS.ITEM_INVALIDO);
  }
  assert.equal(montarRequisicao(item({ texto: '   ' }), BASE).motivo, MOTIVOS.TEXTO_INVALIDO);
  assert.ok(TEXTO_MAX >= 4000);
});
await t('sem token/chat passados pelo chamador recusa; não lê process.env', async () => {
  const antes = process.env.TELEGRAM_BOT_TOKEN;
  process.env.TELEGRAM_BOT_TOKEN = TOKEN;
  try {
    for (const token of [undefined, null, '', 'abc', 123, `${TOKEN} `, 'bot' + TOKEN]) {
      const r = montarRequisicao(item(), { ...BASE, token });
      assert.equal(r.motivo, MOTIVOS.SEM_TOKEN);
    }
    assert.equal(montarRequisicao(item(), { ...BASE, env: { ...ON, TELEGRAM_BOT_TOKEN: TOKEN }, token: undefined }).motivo, MOTIVOS.SEM_TOKEN);
  } finally {
    if (antes === undefined) delete process.env.TELEGRAM_BOT_TOKEN; else process.env.TELEGRAM_BOT_TOKEN = antes;
  }
  for (const chatId of [undefined, '', 'canal', '@ab', '12a', 1.5, {}]) assert.equal(montarRequisicao(item(), { ...BASE, chatId }).motivo, MOTIVOS.SEM_CHAT);
  for (const chatId of ['-1001234567890', -1001234567890, '@tcg_hunter']) assert.equal(montarRequisicao(item(), { ...BASE, chatId }).ok, true);
});
await t('apiBase só https sem credencial/query', async () => {
  for (const apiBase of ['http://api.telegram.org', 'https://u:p@api.telegram.org', 'https://api.telegram.org?x=1', 'nada', 'file:///etc']) {
    assert.equal(montarRequisicao(item(), { ...BASE, apiBase }).motivo, MOTIVOS.API_INVALIDA);
  }
});

// ---- Dry-run por padrão ----
await t('dry-run por padrão: devolve a requisição sendMessage e não chama fetch, mesmo com fetch injetado', async () => {
  const f = fakeFetch();
  for (const simular of [undefined, true, 'false', 0, null]) {
    const r = await publicar(item(), { ...BASE, fetch: f, ...(simular === undefined ? {} : { simular }) });
    assert.equal(r.ok, true); assert.equal(r.status, 'simulado');
    assert.equal(r.requisicao.method, 'POST');
    assert.equal(r.requisicao.url, 'https://api.telegram.org/bot***/sendMessage');
    assert.deepEqual(JSON.parse(r.requisicao.body), { chat_id: '@tcgpricehunter', text: item().texto });
    semToken(r);
  }
  assert.equal(f.chamadas.length, 0);
  assert.deepEqual(montarRequisicao(item(), BASE), await publicar(item(), BASE));
});
await t('texto vai puro (sem parse_mode) e chatId numérico vira string', async () => {
  const r = montarRequisicao(item({ texto: '*negrito* <b>x</b> [link](https://x.y)' }), { ...BASE, chatId: -100123 });
  const body = JSON.parse(r.requisicao.body);
  assert.deepEqual(Object.keys(body).sort(), ['chat_id', 'text']);
  assert.equal(body.chat_id, '-100123'); assert.equal(body.text, '*negrito* <b>x</b> [link](https://x.y)');
});
await t('não muta o item recebido', async () => {
  const it = item(); const copia = JSON.parse(JSON.stringify(it));
  await publicar(it, { ...BASE, simular: false, fetch: fakeFetch() });
  assert.deepEqual(it, copia);
});

// ---- Envio com fetch injetado (falso) ----
await t('envio real exige fetch injetado; não cai no fetch global', async () => {
  const original = globalThis.fetch; let usou = false;
  globalThis.fetch = async () => { usou = true; throw new Error('não deveria chamar'); };
  try {
    for (const fetch of [undefined, null, 'fetch']) {
      const r = await publicar(item(), { ...BASE, simular: false, fetch });
      assert.equal(r.status, 'recusado'); assert.equal(r.motivo, MOTIVOS.SEM_FETCH);
    }
  } finally { globalThis.fetch = original; }
  assert.equal(usou, false);
});
await t('simular:false + fetch falso: monta a chamada real e devolve message_id', async () => {
  const f = fakeFetch();
  const r = await publicar(item(), { ...BASE, simular: false, fetch: f });
  assert.equal(r.ok, true); assert.equal(r.status, 'enviado'); assert.equal(r.messageId, 42); assert.equal(r.itemId, item().id);
  assert.equal(f.chamadas.length, 1);
  const { url, init } = f.chamadas[0];
  assert.equal(url, `https://api.telegram.org/bot${TOKEN}/sendMessage`);
  assert.equal(init.method, 'POST'); assert.equal(init.headers['content-type'], 'application/json');
  assert.deepEqual(JSON.parse(init.body), { chat_id: '@tcgpricehunter', text: item().texto });
  assert.ok(init.signal instanceof AbortSignal);
  semToken(r);
});
await t('falha da API ou de rede: sem retentativa, sem lançar e sem vazar token', async () => {
  const casos = [
    [{ ok: false, status: 401, json: async () => ({ ok: false, description: `Unauthorized bot${TOKEN}` }) }, /HTTP 401: Unauthorized/],
    [{ ok: true, status: 200, json: async () => ({ ok: false, description: 'Bad Request: chat not found' }) }, /chat not found/],
    [{ ok: false, status: 502, json: async () => { throw new Error('html'); } }, /HTTP 502/],
    [new Error(`fetch failed https://api.telegram.org/bot${TOKEN}/sendMessage`), /fetch failed/],
  ];
  for (const [resp, re] of casos) {
    const f = fakeFetch(resp);
    const r = await publicar(item(), { ...BASE, simular: false, fetch: f });
    assert.equal(r.ok, false); assert.equal(r.status, 'falhou'); assert.match(r.motivo, re);
    assert.equal(f.chamadas.length, 1, 'sem retentativa');
    semToken(r);
  }
});
await t('recusa vem antes do fetch: item não aprovado com simular:false não envia', async () => {
  const f = fakeFetch();
  const r = await publicar(item({ estado: 'rascunho' }), { ...BASE, simular: false, fetch: f });
  assert.equal(r.motivo, MOTIVOS.NAO_APROVADO); assert.equal(f.chamadas.length, 0);
});

// ---- Isolamento ----
await t('módulo: sem process.env, sem fetch global e reusa fila.js', async () => {
  const src = fs.readFileSync(path.join(root, 'src/agents/social/telegram.js'), 'utf8');
  assert.ok(!/process\.env/.test(src), 'não lê ambiente');
  assert.ok(!/(?<![.\w])fetch\s*\(|globalThis/.test(src), 'só fetch injetado');
  assert.ok(/from '\.\/fila\.js'/.test(src), 'reusa fila.js');
  const imports = [...src.matchAll(/^import .* from '([^']+)'/gm)].map((m) => m[1]).sort();
  assert.deepEqual(imports, ['../../redact.js', './fila.js']);
});

console.log(`social-telegram-tests: ${n} ok`);
