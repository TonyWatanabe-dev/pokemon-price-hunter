// Social MVP — adaptador Instagram em modo simulação (issue #651): dry-run por padrão, fetch injetado, recusa sem
// SOCIAL_ENABLED, com canal pausado, sem item aprovado ou sem token do chamador; token nunca aparece no resultado.
// Só fetch falso: nenhum acesso real à rede, banco, secrets ou process.env.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { filaVazia, enfileirar, aprovar, rejeitar } from '../src/agents/social/fila.js';
import {
  CANAL, GRAPH_HOST, GRAPH_VERSAO, TOKEN_MASCARA, ETAPAS, CREATION_ID_PENDENTE, montarRequisicoes, publicarInstagram,
} from '../src/agents/social/instagram.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let n = 0;
async function t(name, fn) { try { await fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } }
const NOW = '2026-10-14T12:00:00.000Z';
const ON = { SOCIAL_ENABLED: '1' };
const TOKEN = 'IGQVJfakeTokenSoParaTeste123456';
const BASE = { env: ON, token: TOKEN, igUserId: '17841400000000000', imagemUrl: 'https://cdn.exemplo.com/oferta.jpg' };
const congelar = (o) => JSON.parse(JSON.stringify(o));

function itemNo(canal = 'instagram', estado = 'aprovado', texto = 'Booster Pokémon TCG por R$ 29,90 — tcgpricehunter') {
  const r = enfileirar(filaVazia(), { canal, chaveDedupe: 'oferta-1', texto }, { now: NOW });
  if (estado === 'aprovado') return aprovar(r.fila, r.item.id, { now: NOW }).item;
  if (estado === 'rejeitado') return rejeitar(r.fila, r.item.id, { now: NOW, motivo: 'fora do tom' }).item;
  return r.item;
}

// fetch falso: registra as chamadas e responde na ordem dada.
function fetchFalso(respostas) {
  const chamadas = [];
  const fn = async (url, init) => {
    chamadas.push({ url, init });
    const r = respostas[chamadas.length - 1];
    if (r instanceof Error) throw r;
    return { ok: r.status >= 200 && r.status < 300, status: r.status, json: async () => { if (r.corpo === undefined) throw new Error('sem json'); return r.corpo; } };
  };
  fn.chamadas = chamadas;
  return fn;
}
const sucesso = () => fetchFalso([{ status: 200, corpo: { id: '17900000000000001' } }, { status: 200, corpo: { id: '17800000000000002' } }]);

await t('dry-run por padrão: devolve as duas requisições do fluxo oficial sem chamar fetch', async () => {
  const f = sucesso();
  const r = await publicarInstagram(itemNo(), { ...BASE, fetch: f });
  assert.equal(r.ok, true);
  assert.equal(r.status, 'simulado');
  assert.equal(f.chamadas.length, 0);
  assert.deepEqual(r.requisicoes.map((q) => q.etapa), [...ETAPAS]);
  const [c, p] = r.requisicoes;
  assert.equal(c.metodo, 'POST');
  assert.equal(c.url, `https://${GRAPH_HOST}/${GRAPH_VERSAO}/${BASE.igUserId}/media`);
  assert.equal(c.corpo.image_url, BASE.imagemUrl);
  assert.equal(c.corpo.caption, itemNo().texto);
  assert.equal(p.url, `https://${GRAPH_HOST}/${GRAPH_VERSAO}/${BASE.igUserId}/media_publish`);
  assert.equal(p.corpo.creation_id, CREATION_ID_PENDENTE);
  for (const q of r.requisicoes) assert.equal(q.corpo.access_token, TOKEN_MASCARA);
  assert.ok(!JSON.stringify(r).includes(TOKEN), 'token não pode aparecer no dry-run');
});

await t('montarRequisicoes é síncrono, simulado e equivalente ao dry-run', async () => {
  const r = montarRequisicoes(itemNo(), BASE);
  assert.equal(r.status, 'simulado');
  assert.deepEqual(r.requisicoes, (await publicarInstagram(itemNo(), BASE)).requisicoes);
  assert.equal(CANAL, 'instagram');
});

await t('qualquer dryRun diferente de false continua simulando', async () => {
  for (const dryRun of [undefined, true, 0, 'false', null]) {
    const f = sucesso();
    const r = await publicarInstagram(itemNo(), { ...BASE, dryRun, fetch: f });
    assert.equal(r.status, 'simulado');
    assert.equal(f.chamadas.length, 0);
  }
});

await t('desligado por padrão: SOCIAL_ENABLED ausente ou inválido recusa', async () => {
  for (const env of [undefined, {}, { SOCIAL_ENABLED: '' }, { SOCIAL_ENABLED: '0' }, { SOCIAL_ENABLED: 'sim' }]) {
    const f = sucesso();
    const r = await publicarInstagram(itemNo(), { ...BASE, env, dryRun: false, fetch: f });
    assert.equal(r.status, 'recusado');
    assert.match(r.motivo, /SOCIAL_ENABLED/);
    assert.deepEqual(r.requisicoes, []);
    assert.equal(f.chamadas.length, 0);
    assert.equal(montarRequisicoes(itemNo(), { ...BASE, env }).status, 'recusado');
  }
});

await t('kill switch: canal instagram ou "todos" pausado recusa; outro canal pausado não', async () => {
  for (const pausa of ['instagram', 'todos', 'telegram, INSTAGRAM']) {
    const r = await publicarInstagram(itemNo(), { ...BASE, env: { ...ON, SOCIAL_PAUSA: pausa } });
    assert.equal(r.status, 'recusado');
    assert.match(r.motivo, /pausado/);
  }
  assert.equal((await publicarInstagram(itemNo(), { ...BASE, env: { ...ON, SOCIAL_PAUSA: 'telegram' } })).status, 'simulado');
});

await t('sem aprovação recusa: rascunho, rejeitado, publicado ou item de outro canal', async () => {
  for (const it of [itemNo('instagram', 'rascunho'), itemNo('instagram', 'rejeitado'), { ...itemNo(), estado: 'publicado' }]) {
    const f = sucesso();
    const r = await publicarInstagram(it, { ...BASE, dryRun: false, fetch: f });
    assert.equal(r.status, 'recusado');
    assert.match(r.motivo, /não aprovado/);
    assert.equal(f.chamadas.length, 0);
  }
  assert.match((await publicarInstagram(itemNo('telegram'), BASE)).motivo, /canal instagram/);
});

await t('item fora do formato da fila, sem texto ou com legenda longa demais recusa', async () => {
  for (const it of [null, undefined, 'x', [], {}, { ...itemNo(), extra: 1 }, { ...itemNo(), criadoEm: 'ontem' }]) {
    assert.equal((await publicarInstagram(it, BASE)).motivo, 'item inválido');
  }
  assert.match((await publicarInstagram(itemNo('instagram', 'aprovado', '   '), BASE)).motivo, /sem texto/);
  assert.match((await publicarInstagram(itemNo('instagram', 'aprovado', 'a'.repeat(2201)), BASE)).motivo, /2200/);
  assert.equal((await publicarInstagram(itemNo('instagram', 'aprovado', 'a'.repeat(2200)), BASE)).status, 'simulado');
});

await t('sem token do chamador recusa; o adaptador não lê token do env', async () => {
  const env = { ...ON, IG_ACCESS_TOKEN: TOKEN, INSTAGRAM_TOKEN: TOKEN };
  for (const token of [undefined, null, '', '   ', 123, 'com espaço']) {
    const r = await publicarInstagram(itemNo(), { ...BASE, env, token });
    assert.equal(r.status, 'recusado');
    assert.match(r.motivo, /token/);
  }
});

await t('igUserId, imagemUrl e versão inválidos recusam', async () => {
  for (const igUserId of [undefined, '', 'abc', '123/../x', 17841400000000000]) assert.match((await publicarInstagram(itemNo(), { ...BASE, igUserId })).motivo, /igUserId/);
  for (const imagemUrl of [undefined, 'http://cdn.exemplo.com/a.jpg', 'javascript:alert(1)', 'https://u:p@cdn.exemplo.com/a.jpg', 'nada']) assert.match((await publicarInstagram(itemNo(), { ...BASE, imagemUrl })).motivo, /imagemUrl/);
  for (const versao of ['21', 'v21', 'v21.0/../x', '']) assert.match((await publicarInstagram(itemNo(), { ...BASE, versao })).motivo, /versão/);
  assert.match((await publicarInstagram(itemNo(), { ...BASE, versao: 'v22.0' })).requisicoes[0].url, /\/v22\.0\//);
});

await t('modo real sem fetch injetado recusa e não usa o fetch global', async () => {
  const original = globalThis.fetch;
  let usado = false;
  globalThis.fetch = async () => { usado = true; throw new Error('não deveria chamar'); };
  try {
    const r = await publicarInstagram(itemNo(), { ...BASE, dryRun: false });
    assert.equal(r.status, 'recusado');
    assert.match(r.motivo, /fetch não injetado/);
    assert.equal(usado, false);
  } finally { globalThis.fetch = original; }
});

await t('modo real com fetch falso: cria container, publica com creation_id e devolve os ids', async () => {
  const f = sucesso();
  const r = await publicarInstagram(itemNo(), { ...BASE, dryRun: false, fetch: f });
  assert.equal(r.ok, true);
  assert.equal(r.status, 'publicado');
  assert.equal(r.creationId, '17900000000000001');
  assert.equal(r.mediaId, '17800000000000002');
  assert.equal(f.chamadas.length, 2);
  const [a, b] = f.chamadas;
  assert.equal(a.url, `https://${GRAPH_HOST}/${GRAPH_VERSAO}/${BASE.igUserId}/media`);
  assert.equal(a.init.method, 'POST');
  assert.equal(a.init.redirect, 'error');
  const ca = new URLSearchParams(a.init.body);
  assert.equal(ca.get('image_url'), BASE.imagemUrl);
  assert.equal(ca.get('caption'), itemNo().texto);
  assert.equal(ca.get('access_token'), TOKEN, 'o token vai só no corpo da requisição real');
  assert.ok(!a.url.includes(TOKEN), 'token nunca na URL');
  assert.equal(b.url, `https://${GRAPH_HOST}/${GRAPH_VERSAO}/${BASE.igUserId}/media_publish`);
  assert.equal(new URLSearchParams(b.init.body).get('creation_id'), '17900000000000001');
  assert.ok(!JSON.stringify(r).includes(TOKEN), 'token não pode voltar no resultado');
});

await t('falha na criação do container não chama a publicação e não vaza o token', async () => {
  const f = fetchFalso([{ status: 400, corpo: { error: { message: `Invalid OAuth access token ${TOKEN}` } } }]);
  const r = await publicarInstagram(itemNo(), { ...BASE, dryRun: false, fetch: f });
  assert.equal(r.status, 'erro');
  assert.equal(r.etapa, 'criar_container');
  assert.match(r.motivo, /^HTTP 400/);
  assert.equal(f.chamadas.length, 1);
  assert.ok(!JSON.stringify(r).includes(TOKEN));
});

await t('falha na publicação devolve etapa e creationId; erro de rede e resposta sem id viram erro', async () => {
  const r = await publicarInstagram(itemNo(), { ...BASE, dryRun: false, fetch: fetchFalso([{ status: 200, corpo: { id: '1790' } }, { status: 500 }]) });
  assert.equal(r.status, 'erro');
  assert.equal(r.etapa, 'publicar');
  assert.equal(r.creationId, '1790');
  assert.equal(r.motivo, 'HTTP 500');
  const rede = await publicarInstagram(itemNo(), { ...BASE, dryRun: false, fetch: fetchFalso([new Error(`ECONNRESET access_token=${TOKEN}`)]) });
  assert.equal(rede.status, 'erro');
  assert.match(rede.motivo, /falha de rede/);
  assert.ok(!JSON.stringify(rede).includes(TOKEN));
  for (const corpo of [{}, { id: 12 }, { id: 'abc' }, undefined]) {
    const x = await publicarInstagram(itemNo(), { ...BASE, dryRun: false, fetch: fetchFalso([{ status: 200, corpo }]) });
    assert.equal(x.status, 'erro');
    assert.equal(x.motivo, 'resposta sem id válido');
  }
});

await t('não muta o item nem as opções recebidas', async () => {
  const it = itemNo(); const antes = congelar(it);
  const opts = { ...BASE, env: { ...ON } }; const optsAntes = congelar(opts);
  await publicarInstagram(it, { ...opts, dryRun: false, fetch: sucesso() });
  await publicarInstagram(it, opts);
  assert.deepEqual(it, antes);
  assert.deepEqual(congelar(opts), optsAntes);
});

await t('módulo não lê process.env, não usa fetch global nem importa rede/banco', () => {
  const src = fs.readFileSync(path.join(root, 'src/agents/social/instagram.js'), 'utf8');
  const codigo = src.split('\n').filter((l) => !/^\s*(\/\/|\*|\/\*)/.test(l)).join('\n');
  assert.ok(!/process\.env/.test(codigo), 'não lê process.env');
  assert.ok(!/(?<![\w.$])fetch\(/.test(codigo), 'não usa fetch global');
  assert.ok(!/globalThis\.fetch/.test(codigo));
  assert.ok(!/from ['"](?:node:)?(?:https?|net|fs|child_process)['"]|\bpg\b|db\.js/.test(codigo), 'sem rede/fs/banco');
});

console.log(`social-instagram-tests ok (${n})`);
