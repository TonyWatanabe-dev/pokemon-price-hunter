// Alertas por usuário no Telegram (src/telegram-usuario.js, src/firestore-rest.js, integração em src/inbox.js).
// Firestore e Telegram falsos, sem rede e sem secrets: vínculo de uso único com validade, /start, /parar, /status,
// offset idempotente, entrega só com opt-in, cooldown, dedupe e limite por usuário, isolamento entre usuários,
// kill switch desligado por padrão, regras do Firestore e UI.
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const tg = await import('../src/telegram-usuario.js');
const fr = await import('../src/firestore-rest.js');
const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
let n = 0; const fails = [];
const t = async (name, fn) => { try { await fn(); n++; } catch (e) { fails.push(`✗ ${name}\n  ${e.stack.split('\n').slice(0, 3).join('\n  ')}`); } };

// ------------------------------------------------------------------ falsos
/** Firestore falso com a mesma interface de firestoreClient (pré-condição updateTime, máscara apaga campo ausente). */
function fakeFs(docs = {}) {
  let v = 1; const db = new Map(Object.entries(docs).map(([uid, data]) => [uid, { data: structuredClone(data), updateTime: 't' + v++ }]));
  const calls = { patch: 0, falharPatch: 0 };
  return {
    db, calls,
    touch(uid, patch) { const d = db.get(uid); Object.assign(d.data, patch); d.updateTime = 't' + v++; },
    async getUser(uid) { const d = db.get(uid); return d ? { uid, data: structuredClone(d.data), updateTime: d.updateTime } : null; },
    async patchUser(uid, campos, mascara, { updateTime } = {}) {
      calls.patch++;
      if (calls.falharPatch > 0) { calls.falharPatch--; throw new fr.FirestoreError('falha simulada', 503); }
      const d = db.get(uid); if (!d) throw new fr.FirestoreError('não existe', 404);
      if (updateTime && d.updateTime !== updateTime) throw new fr.FirestoreError('pré-condição', 400);
      for (const m of mascara) { if (m in campos) d.data[m] = structuredClone(campos[m]); else delete d.data[m]; }
      d.updateTime = 't' + v++; return { updateTime: d.updateTime };
    },
    async linkedUsers({ chatId, limit = 500 } = {}) {
      return [...db.entries()].filter(([, d]) => (chatId != null ? d.data.telegram?.chatId === chatId : d.data.telegram?.chatId > 0))
        .slice(0, limit).map(([uid, d]) => ({ uid, data: structuredClone(d.data), updateTime: d.updateTime })).sort((a, b) => a.uid.localeCompare(b.uid));
    },
  };
}
/** Telegram falso: grava cada sendMessage (chat, texto). status por chat permite simular 403/500. */
function fakeTelegram({ status = {} } = {}) {
  const sent = [];
  const fetch = async (url, init) => {
    const b = JSON.parse(init.body || '{}');
    if (/getMe$/.test(url)) return new Response(JSON.stringify({ ok: true, result: { username: 'TcgPriceHunterBot' } }));
    const s = status[b.chat_id] || 200;
    if (s !== 200) return new Response(JSON.stringify({ ok: false, description: 'x' }), { status: s });
    sent.push({ chat: b.chat_id, text: b.text, url: b.reply_markup?.inline_keyboard?.[0]?.[0]?.url });
    return new Response(JSON.stringify({ ok: true, result: { message_id: sent.length } }));
  };
  return { sent, fetch };
}

const NOW = new Date('2026-10-15T15:00:00Z');
const SEG = 'a'.repeat(32); const HASH = tg.sha256hex(SEG);
const msg = (text, { chat = 111, date = NOW.getTime() / 1000, type = 'private' } = {}) => ({ message_id: 1, date, text, chat: { id: chat, type } });
const replies = () => { const out = []; return { out, reply: async (chat, text) => { out.push({ chat, text }); } }; };
const offer = (o) => ({ stock: 'IN_STOCK', matchConfidence: 0.95, anomalous: false, stale: false, confirmed: true, discount: null, perBooster: null, storeName: 'Loja', priceKindLabel: 'Pix', shipping: 0, shippingKnown: true, ...o });
const products = {
  p1: { id: 'p1', type: 'etb', collection: 'c1', collectionName: 'Coleção 1', typeLabel: 'ETB', copagConfirmed: false, msrp: null },
  p2: { id: 'p2', type: 'booster-box', collection: 'c2', collectionName: 'Coleção 2', typeLabel: 'Booster Box', copagConfirmed: false, msrp: null },
};
const offers = [offer({ id: 'o1', productId: 'p1', total: 90, url: 'https://loja/p1' }), offer({ id: 'o2', productId: 'p2', total: 500, url: 'https://loja/p2' })];
const ligadoA = { chatId: 111, ligadoEm: '2026-10-15T12:00:00.000Z', hash: HASH, envios: {}, dia: '', nDia: 0 };

// ------------------------------------------------------------------ vínculo
await t('token: formato <uid>_<32 hex>, até 64 caracteres; comandos com @bot', () => {
  assert.deepEqual(tg.parseToken('abcDEF123_' + SEG), { uid: 'abcDEF123', segredo: SEG });
  for (const x of ['', 'abc', 'abc_' + 'A'.repeat(32), 'a-b_' + SEG, 'x'.repeat(32) + '_' + SEG, 'abc_' + SEG + '0']) assert.equal(tg.parseToken(x), null, x);
  assert.ok(('x'.repeat(28) + '_' + SEG).length <= 64, 'uid do Firebase (28) + segredo cabe no start');
  assert.deepEqual(tg.parseComando('/start abc_' + SEG), { cmd: 'start', arg: 'abc_' + SEG });
  assert.deepEqual(tg.parseComando('/parar@TcgPriceHunterBot'), { cmd: 'parar', arg: '' });
  assert.equal(tg.parseComando('oi /start'), null); assert.equal(tg.parseComando('/startx'), null); assert.equal(tg.parseComando('https://loja/x'), null);
});

await t('/start com token válido liga o chat à conta e consome o pedido (uso único)', async () => {
  const f = fakeFs({ A: { alerts: [], telegramPedido: { hash: HASH, criadoEm: NOW.getTime() - 5 * 60e3 } } });
  const r = replies();
  assert.equal(await tg.tratarComando(msg('/start A_' + SEG), { fs: f, reply: r.reply }), 'ligado');
  const d = f.db.get('A').data;
  assert.equal(d.telegram.chatId, 111); assert.equal(d.telegram.hash, HASH); assert.equal('telegramPedido' in d, false, 'pedido apagado');
  assert.equal(r.out[0].chat, 111); assert.match(r.out[0].text, /Alertas ligados/);
  // Mesmo token de outro chat: já foi usado.
  assert.equal(await tg.tratarComando(msg('/start A_' + SEG, { chat: 222 }), { fs: f, reply: r.reply }), 'invalido');
  assert.equal(f.db.get('A').data.telegram.chatId, 111, 'outro chat não sequestra o vínculo');
});

await t('/start: pedido expirado (> 30 min pela hora da mensagem), hash errado, sem pedido, conta inexistente, grupo', async () => {
  const f = fakeFs({ A: { telegramPedido: { hash: HASH, criadoEm: NOW.getTime() - 31 * 60e3 } }, B: { telegramPedido: { hash: tg.sha256hex('b'.repeat(32)), criadoEm: NOW.getTime() } }, C: {} });
  const r = replies(); const go = (m) => tg.tratarComando(m, { fs: f, reply: r.reply });
  assert.equal(await go(msg('/start A_' + SEG)), 'expirado');
  assert.equal(await go(msg('/start A_' + SEG, { date: (NOW.getTime() - 60 * 60e3 - 3 * 60e3) / 1000 })), 'expirado', 'mensagem anterior à criação');
  assert.equal(await go(msg('/start B_' + SEG)), 'invalido');
  assert.equal(await go(msg('/start C_' + SEG)), 'invalido');
  assert.equal(await go(msg('/start Z_' + SEG)), 'invalido');
  assert.equal(await go(msg('/start nada')), 'invalido');
  assert.equal(await go(msg('/start')), 'ajuda');
  assert.equal(await go(msg('/start B_' + SEG, { chat: -100, type: 'group' })), 'privado');
  for (const uid of ['A', 'B', 'C']) assert.equal(f.db.get(uid).data.telegram, undefined, `${uid} continua desligado`);
  // Rodada lenta: a mensagem foi enviada dentro do prazo e lida 40 min depois → vale (a validade conta pela mensagem).
  const g = fakeFs({ A: { telegramPedido: { hash: HASH, criadoEm: NOW.getTime() - 20 * 60e3 } } });
  assert.equal(await tg.tratarComando(msg('/start A_' + SEG), { fs: g, reply: r.reply }), 'ligado');
});

await t('/start repetido (mesmo update reprocessado) é idempotente; pedido trocado no meio não é consumido', async () => {
  const f = fakeFs({ A: { telegramPedido: { hash: HASH, criadoEm: NOW.getTime() } } });
  const r = replies();
  assert.equal(await tg.tratarComando(msg('/start A_' + SEG), { fs: f, reply: r.reply }), 'ligado');
  const antes = structuredClone(f.db.get('A').data);
  assert.equal(await tg.tratarComando(msg('/start A_' + SEG), { fs: f, reply: r.reply }), 'ja-ligado');
  assert.deepEqual(f.db.get('A').data, antes, 'nada muda na repetição');
  // Corrida: o site gerou outro pedido entre a leitura e a gravação → a pré-condição recusa (nada ligado).
  const g = fakeFs({ A: { telegramPedido: { hash: HASH, criadoEm: NOW.getTime() } } });
  const getUser = g.getUser; g.getUser = async (uid) => { const u = await getUser(uid); g.touch('A', { name: 'mudou' }); return u; };
  await assert.rejects(tg.tratarComando(msg('/start A_' + SEG), { fs: g, reply: r.reply }));
  assert.equal(g.db.get('A').data.telegram, undefined);
});

await t('/parar desliga todas as contas deste chat (e só deste); /status mostra; idempotente', async () => {
  const f = fakeFs({ A: { alerts: [{ p: 'p1', v: 100 }], telegram: { ...ligadoA } }, B: { alerts: [], telegram: { ...ligadoA, chatId: 222 } } });
  const r = replies(); const go = (m) => tg.tratarComando(m, { fs: f, reply: r.reply });
  assert.equal(await go(msg('/status')), 'status'); assert.match(r.out.at(-1).text, /ligados\. Você tem 1 alerta de preço/);
  assert.equal(await go(msg('/parar')), 'desligado');
  assert.equal(f.db.get('A').data.telegram, undefined); assert.equal(f.db.get('B').data.telegram.chatId, 222, 'B (outro chat) intacto');
  assert.equal(await go(msg('/parar')), 'nada'); assert.equal(await go(msg('/status')), 'nada');
  assert.ok(r.out.every((x) => x.chat === 111), 'respostas só para quem mandou');
});

// ------------------------------------------------------------------ entrega
const ctx = (f, tel, extra = {}) => ({ fs: f, token: '123:abc', fetch: tel.fetch, offers, products, now: NOW, settings: {}, maxDia: 10, ...extra });

await t('entrega só com opt-in: usuário com alerta e sem telegram não recebe nada; com telegram recebe no próprio chat', async () => {
  const f = fakeFs({ A: { alerts: [{ p: 'p1', v: 100 }], telegram: { ...ligadoA } }, B: { alerts: [{ p: 'p1', v: 100 }] }, C: { alerts: [{ p: 'p1', v: 100 }], telegram: null } });
  const tel = fakeTelegram();
  const st = await tg.entregar(ctx(f, tel));
  assert.deepEqual(st, { usuarios: 1, enviados: 1, falhas: 0, bloqueados: 0, erros: 0 });
  assert.equal(tel.sent.length, 1); assert.equal(tel.sent[0].chat, 111); assert.equal(tel.sent[0].url, 'https://loja/p1');
  assert.match(tel.sent[0].text, /PREÇO-ALVO ATINGIDO/); assert.match(tel.sent[0].text, /Seu alerta de preço/);
  const e = f.db.get('A').data.telegram.envios['usuario|p1'];
  assert.equal(e.estado, 'ok'); assert.equal(e.total, 90); assert.equal(f.db.get('A').data.telegram.nDia, 1);
  assert.equal(f.db.get('B').data.telegram, undefined);
});

await t('isolamento: A nunca recebe alerta de B (e vice-versa), mesmo com produtos e preços diferentes', async () => {
  const f = fakeFs({
    A: { alerts: [{ p: 'p1', v: 100 }], telegram: { ...ligadoA, chatId: 111 } },
    B: { alerts: [{ p: 'p2', v: 600 }], telegram: { ...ligadoA, chatId: 222 } },
    C: { alerts: [{ p: 'p2', v: 10 }], telegram: { ...ligadoA, chatId: 333 } },
  });
  const tel = fakeTelegram();
  await tg.entregar(ctx(f, tel));
  assert.deepEqual(tel.sent.map((s) => [s.chat, s.url]).sort(), [[111, 'https://loja/p1'], [222, 'https://loja/p2']]);
  assert.deepEqual(Object.keys(f.db.get('A').data.telegram.envios), ['usuario|p1']);
  assert.deepEqual(Object.keys(f.db.get('B').data.telegram.envios), ['usuario|p2']);
  assert.deepEqual(f.db.get('C').data.telegram.envios, {}, 'alvo não atingido: nada');
});

await t('cooldown e dedupe por usuário: mesma condição não repete; preço melhor repete; depois do cooldown com oferta sumida, repete', async () => {
  const f = fakeFs({ A: { alerts: [{ p: 'p1', v: 100 }], telegram: { ...ligadoA } }, B: { alerts: [{ p: 'p1', v: 100 }], telegram: { ...ligadoA, chatId: 222 } } });
  const tel = fakeTelegram();
  await tg.entregar(ctx(f, tel)); assert.equal(tel.sent.length, 2);
  await tg.entregar(ctx(f, tel, { now: new Date(NOW.getTime() + 60e3) })); assert.equal(tel.sent.length, 2, 'sem repetição');
  // Só para A o registro some (outro usuário): B continua deduplicado pelo próprio registro.
  f.db.get('A').data.telegram.envios = {};
  await tg.entregar(ctx(f, tel, { now: new Date(NOW.getTime() + 2 * 60e3) }));
  assert.deepEqual(tel.sent.slice(2).map((s) => s.chat), [111], 'dedupe é por usuário');
  const mais = [offer({ id: 'o3', productId: 'p1', total: 80, url: 'https://loja/p1b' }), ...offers];
  await tg.entregar(ctx(f, tel, { offers: mais, now: new Date(NOW.getTime() + 3 * 60e3) }));
  assert.equal(tel.sent.length, 5, 'preço melhor (R$ 80 < R$ 90) avisa os dois de novo');
});

await t('limite diário por usuário (capPerUser ativo) e virada do dia', async () => {
  const many = Object.fromEntries(Array.from({ length: 6 }, (_, i) => [`q${i}`, { ...products.p1, id: `q${i}` }]));
  const offs = Object.keys(many).map((id, i) => offer({ id: 'x' + i, productId: id, total: 50, url: 'https://loja/' + id }));
  const f = fakeFs({ A: { alerts: Object.keys(many).map((p) => ({ p, v: 100 })), telegram: { ...ligadoA } } });
  const tel = fakeTelegram();
  await tg.entregar(ctx(f, tel, { offers: offs, products: many, maxDia: 4 }));
  assert.equal(tel.sent.length, 4); assert.equal(f.db.get('A').data.telegram.nDia, 4);
  await tg.entregar(ctx(f, tel, { offers: offs, products: many, maxDia: 4, now: new Date(NOW.getTime() + 3600e3) }));
  assert.equal(tel.sent.length, 4, 'limite do dia esgotado');
  await tg.entregar(ctx(f, tel, { offers: offs, products: many, maxDia: 4, now: new Date(NOW.getTime() + 24 * 3600e3) }));
  assert.equal(tel.sent.length, 6, 'dia novo: o resto sai');
});

await t('retry sem duplicação: falha no envio desfaz a reserva (próxima rodada tenta); falha na confirmação nunca reenvia', async () => {
  const f = fakeFs({ A: { alerts: [{ p: 'p1', v: 100 }], telegram: { ...ligadoA } } });
  const ruim = fakeTelegram({ status: { 111: 500 } });
  const st = await tg.entregar(ctx(f, ruim));
  assert.equal(st.falhas, 1); assert.deepEqual(f.db.get('A').data.telegram.envios, {}, 'reserva desfeita'); assert.equal(f.db.get('A').data.telegram.nDia, 0);
  const bom = fakeTelegram();
  await tg.entregar(ctx(f, bom)); assert.equal(bom.sent.length, 1, 'a rodada seguinte entrega');
  // Confirmação falha depois do envio: a reserva ('enviando') fica e conta como enviado.
  const g = fakeFs({ A: { alerts: [{ p: 'p1', v: 100 }], telegram: { ...ligadoA } } });
  const tel = fakeTelegram(); const patch = g.patchUser; let k = 0;
  g.patchUser = async (...a) => { if (++k === 2) throw new fr.FirestoreError('caiu', 503); return patch(...a); };
  const s2 = await tg.entregar(ctx(g, tel)); assert.equal(s2.erros, 1); assert.equal(tel.sent.length, 1);
  assert.equal(g.db.get('A').data.telegram.envios['usuario|p1'].estado, 'enviando');
  await tg.entregar(ctx(g, tel, { now: new Date(NOW.getTime() + 60e3) })); assert.equal(tel.sent.length, 1, 'não duplica');
  // Reserva falha (documento mudou / Firestore fora): não envia nada.
  const h = fakeFs({ A: { alerts: [{ p: 'p1', v: 100 }], telegram: { ...ligadoA } } }); h.calls.falharPatch = 1;
  const t3 = fakeTelegram(); const s3 = await tg.entregar(ctx(h, t3)); assert.equal(t3.sent.length, 0); assert.equal(s3.erros, 1);
});

await t('desligou no site entre a leitura e a reserva: pré-condição recusa e nada é enviado', async () => {
  const f = fakeFs({ A: { alerts: [{ p: 'p1', v: 100 }], telegram: { ...ligadoA } } });
  const lu = f.linkedUsers; f.linkedUsers = async (o) => { const r = await lu(o); f.touch('A', { telegram: null }); return r; };
  const tel = fakeTelegram(); await tg.entregar(ctx(f, tel));
  assert.equal(tel.sent.length, 0); assert.equal(f.db.get('A').data.telegram, null, 'continua desligado');
});

await t('403 (bloqueou o bot) desliga o vínculo; Telegram fora em sequência para de tentar na rodada', async () => {
  const f = fakeFs({ A: { alerts: [{ p: 'p1', v: 100 }], telegram: { ...ligadoA } } });
  const tel = fakeTelegram({ status: { 111: 403 } });
  const st = await tg.entregar(ctx(f, tel)); assert.equal(st.bloqueados, 1); assert.equal(f.db.get('A').data.telegram, undefined);
  const docs = Object.fromEntries(['A', 'B', 'C', 'D'].map((u, i) => [u, { alerts: [{ p: 'p1', v: 100 }], telegram: { ...ligadoA, chatId: 10 + i } }]));
  const g = fakeFs(docs); let chamadas = 0; const fora = async () => { chamadas++; return new Response('{}', { status: 502 }); };
  await tg.entregar({ ...ctx(g, { fetch: fora }) }); assert.equal(chamadas, 2, 'CHANNEL_DOWN_AFTER = 2');
  for (const u of Object.keys(docs)) assert.deepEqual(g.db.get(u).data.telegram.envios, {}, `${u}: tenta na próxima rodada`);
});

await t('regras do usuário: só { p, v } válidos, até 50; produto desconhecido ignorado', () => {
  const r = tg.regrasDoUsuario([{ p: 'p1', v: 100 }, { p: '', v: 1 }, { p: 'p2', v: -1 }, { p: 'p2', v: '9' }, null, ...Array.from({ length: 60 }, () => ({ p: 'p2', v: 5 }))]);
  assert.equal(r.length, 46, 'só as 50 primeiras entradas contam (limite da página)'); assert.deepEqual(r[0], { id: 'usuario', label: 'Seu alerta de preço', mode: 'target', filter: { productId: 'p1' }, maxPrice: 100 });
  assert.deepEqual(tg.planejar({ alerts: [{ p: 'nao-existe', v: 1e6 }], telegram: ligadoA }, { offers, products, now: NOW }).enviar, []);
});

// ------------------------------------------------------------------ kill switch, contexto e inbox
await t('kill switch: desligado por padrão e sem configuração (falha fechada)', async () => {
  assert.equal(tg.contexto({}), null);
  assert.equal(tg.contexto({ ALERTAS_TELEGRAM_USUARIO: 'true', TELEGRAM_BOT_TOKEN: 'x', FIREBASE_SERVICE_ACCOUNT: '{}' }), null);
  assert.equal(tg.contexto({ ALERTAS_TELEGRAM_USUARIO: '1', TELEGRAM_BOT_TOKEN: 'x' }), null, 'sem conta de serviço');
  assert.equal(tg.contexto({ ALERTAS_TELEGRAM_USUARIO: '1', FIREBASE_SERVICE_ACCOUNT: '{}' }), null, 'sem token');
  assert.equal(tg.contexto({ ALERTAS_TELEGRAM_USUARIO: '1', TELEGRAM_BOT_TOKEN: 'x', FIREBASE_SERVICE_ACCOUNT: '{"client_email":"a"}' }), null, 'conta inválida');
  const tel = fakeTelegram(); const c = tg.contexto({ ALERTAS_TELEGRAM_USUARIO: '1', TELEGRAM_BOT_TOKEN: '1:x', ALERTAS_TELEGRAM_USUARIO_MAX_DIA: '999' }, { fs: fakeFs(), fetch: tel.fetch });
  assert.ok(c); assert.equal(c.maxDia, 50, 'teto do limite diário'); assert.equal(await c.bot(), 'TcgPriceHunterBot');
});

await t('inbox: offset avança e é persistido; comandos de terceiros só com o recurso ligado; o chat do dono segue igual', async () => {
  const env = { ...process.env }; process.env.TELEGRAM_BOT_TOKEN = '1:x'; process.env.TELEGRAM_CHAT_ID = '999';
  const realFetch = globalThis.fetch; const enviados = [];
  const updates = [{ update_id: 10, message: msg('/start A_' + SEG, { chat: 111 }) }, { update_id: 11, message: msg('/status', { chat: 111 }) }, { update_id: 12, message: msg('/start', { chat: 999 }) }];
  globalThis.fetch = async (url, init) => {
    const b = JSON.parse(init.body);
    if (/getUpdates/.test(url)) return new Response(JSON.stringify({ ok: true, result: updates.filter((u) => u.update_id >= (b.offset || 0)) }));
    enviados.push(b); return new Response(JSON.stringify({ ok: true, result: {} }));
  };
  try {
    const { processInbox } = await import('../src/inbox.js');
    // Desligado: nada para o chat 111 (como antes), offset avança.
    const st = {}; await processInbox(st, {}, () => null);
    assert.equal(st.offset, 13); assert.equal(enviados.length, 0);
    // Ligado: /start e /status de 111 tratados; reprocessar os mesmos updates (offset não gravado) é idempotente.
    const f = fakeFs({ A: { alerts: [], telegramPedido: { hash: HASH, criadoEm: NOW.getTime() } } });
    const usuario = tg.contexto({ ALERTAS_TELEGRAM_USUARIO: '1', TELEGRAM_BOT_TOKEN: '1:x' }, { fs: f, fetch: globalThis.fetch });
    for (const rodada of [1, 2]) {
      const s = {}; const r = await processInbox(s, {}, () => null, () => {}, { usuario });
      assert.equal(s.offset, 13); assert.equal(r.comandos, 3, `rodada ${rodada}`);
    }
    assert.equal(f.db.get('A').data.telegram.chatId, 111);
    const textos = enviados.map((e) => `${e.chat_id}:${e.text.split('\n')[0]}`);
    assert.deepEqual(textos, [`111:${tg.TEXTOS.LIGADO.split('\n')[0]}`, '111:Alertas no Telegram: ligados. Você tem 0 alertas de preço.', `999:${tg.TEXTOS.AJUDA}`,
      `111:${tg.TEXTOS.JA_LIGADO}`, '111:Alertas no Telegram: ligados. Você tem 0 alertas de preço.', `999:${tg.TEXTOS.AJUDA}`]);
    // Erro do Firestore: responde "tente de novo" sem derrubar a rodada.
    const quebrado = { tratar: async () => { throw new Error('x'); } };
    enviados.length = 0; await processInbox({}, {}, () => null, () => {}, { usuario: quebrado });
    assert.ok(enviados.every((e) => e.text === tg.TEXTOS.ERRO));
  } finally { globalThis.fetch = realFetch; process.env.TELEGRAM_BOT_TOKEN = env.TELEGRAM_BOT_TOKEN; process.env.TELEGRAM_CHAT_ID = env.TELEGRAM_CHAT_ID; if (env.TELEGRAM_BOT_TOKEN === undefined) delete process.env.TELEGRAM_BOT_TOKEN; if (env.TELEGRAM_CHAT_ID === undefined) delete process.env.TELEGRAM_CHAT_ID; }
});

// ------------------------------------------------------------------ cliente REST do Firestore (sem rede)
await t('firestore-rest: JWT RS256 verificável, codec de valores, máscara e pré-condição na URL, token não vaza no erro', async () => {
  const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
  const pem = privateKey.export({ type: 'pkcs8', format: 'pem' });
  const sa = fr.parseServiceAccount(JSON.stringify({ client_email: 'robo@demo.iam.gserviceaccount.com', private_key: pem, project_id: 'demo-tcgph', token_uri: 'https://mal.example/token' }));
  assert.ok(sa); assert.equal(fr.parseServiceAccount('nada'), null); assert.equal(fr.parseServiceAccount(JSON.stringify({ client_email: 'a@b', private_key: pem, project_id: 'X Y' })), null);
  const jwt = fr.signJwt(sa, 1000); const [h, b, s] = jwt.split('.');
  assert.ok(crypto.verify('RSA-SHA256', Buffer.from(`${h}.${b}`), publicKey, Buffer.from(s, 'base64url')));
  assert.deepEqual(JSON.parse(Buffer.from(b, 'base64url')), { iss: sa.clientEmail, scope: fr.SCOPE, aud: fr.TOKEN_URI, iat: 1000, exp: 4600 });
  const v = { a: 1, b: 1.5, c: 'x', d: null, e: true, f: [1, { g: 'h' }], i: { 'usuario|p1': { at: 'z' } } };
  assert.deepEqual(fr.decodeFields(fr.encodeFields(v)), v);
  const calls = [];
  const fetch = async (url, init) => {
    calls.push({ url, init });
    if (url === fr.TOKEN_URI) { assert.match(String(init.body), /grant_type=urn%3Aietf/); return new Response(JSON.stringify({ access_token: 'segredo-tk', expires_in: 3600 })); }
    if (init.method === 'GET') return url.endsWith('/users/naoexiste') ? new Response('{}', { status: 404 }) : new Response(JSON.stringify({ name: 'projects/demo-tcgph/databases/(default)/documents/users/A', fields: fr.encodeFields({ telegram: { chatId: 111 } }), updateTime: 'U1' }));
    if (init.method === 'PATCH') return url.includes('falha') ? new Response(JSON.stringify({ error: { status: 'FAILED_PRECONDITION' } }), { status: 400 }) : new Response(JSON.stringify({ updateTime: 'U2' }));
    return new Response(JSON.stringify([{ document: { name: '.../users/B', fields: {}, updateTime: 'U3' } }, { readTime: 'x' }, { document: { name: '.../users/A', fields: {}, updateTime: 'U4' } }]));
  };
  const c = fr.firestoreClient({ serviceAccount: sa, fetch });
  assert.deepEqual(await c.getUser('A'), { uid: 'A', data: { telegram: { chatId: 111 } }, updateTime: 'U1' });
  assert.equal(await c.getUser('naoexiste'), null);
  assert.deepEqual(await c.patchUser('A', {}, ['telegram', 'telegramPedido'], { updateTime: 'U1' }), { updateTime: 'U2' });
  const pu = new URL(calls.at(-1).url);
  assert.deepEqual(pu.searchParams.getAll('updateMask.fieldPaths'), ['telegram', 'telegramPedido']); assert.equal(pu.searchParams.get('currentDocument.updateTime'), 'U1');
  assert.equal(calls.at(-1).init.headers.authorization, 'Bearer segredo-tk');
  assert.equal(calls.filter((x) => x.url === fr.TOKEN_URI).length, 1, 'token reaproveitado');
  await assert.rejects(c.patchUser('falha', {}, ['telegram']), (e) => e instanceof fr.FirestoreError && !/segredo-tk/.test(e.message) && /FAILED_PRECONDITION/.test(e.message));
  await assert.rejects(c.patchUser('A', {}, ['telegram.chatId']), /máscara/); await assert.rejects(c.getUser('../x'), /uid/);
  assert.deepEqual((await c.linkedUsers({ chatId: 111 })).map((u) => u.uid), ['A', 'B']);
  const q = JSON.parse(calls.at(-1).init.body).structuredQuery;
  assert.deepEqual(q.where.fieldFilter, { field: { fieldPath: 'telegram.chatId' }, op: 'EQUAL', value: { integerValue: '111' } });
  assert.ok(calls.every((x) => !x.url.includes('mal.example')), 'token_uri do JSON é ignorado');
});

// ------------------------------------------------------------------ regras, workflow, UI e documentação
await t('regras do Firestore: telegram só null/inalterado pela conta; pedido com hash + criadoEm a até 2 min', () => {
  const r = fs.readFileSync(path.join(root, 'firebase/firestore.rules'), 'utf8');
  assert.match(r, /hasOnly\(\[[^\]]*'telegramPedido','telegram'\]\)/);
  assert.match(r, /telegramOk\(\) && pedidoOk\(\)/);
  assert.match(r, /request\.resource\.data\.get\('telegram', null\) == null/);
  assert.match(r, /p\.hash\.matches\('\^\[0-9a-f\]\{64\}\$'\)/);
  assert.match(r, /math\.abs\(p\.criadoEm - request\.time\.toMillis\(\)\) <= 120000/);
  assert.equal(tg.SKEW_MS, 120000, 'mesma tolerância no robô');
});

await t('workflow: Secret e variáveis só na etapa da caça; nada novo de permissão', () => {
  const wf = fs.readFileSync(path.join(root, '.github/workflows/hunter.yml'), 'utf8');
  assert.equal((wf.match(/FIREBASE_SERVICE_ACCOUNT: \$\{\{ secrets\.FIREBASE_SERVICE_ACCOUNT \}\}/g) || []).length, 1);
  assert.equal((wf.match(/FIREBASE_SERVICE_ACCOUNT/g) || []).length, 2, 'uma etapa só');
  assert.match(wf, /ALERTAS_TELEGRAM_USUARIO: \$\{\{ vars\.ALERTAS_TELEGRAM_USUARIO \}\}/);
  assert.match(wf, /^permissions:\n  contents: write\n  actions: read\n/m);
});

await t('UI: botão em /alertas com os três estados, acessível, sem segredo persistido no documento', () => {
  const page = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
  for (const s of ['Ativar alertas no Telegram', 'Aguardando confirmação', 'Ligado', 'Desligar alertas no Telegram', 'Já confirmei']) assert.ok(page.includes(s), s);
  assert.match(page, /<section class="panel" id="tgbox" aria-labelledby="tg-h">/);
  assert.match(page, /role="status" aria-live="polite">\$\{st\}/);
  assert.match(page, /saveField\("telegramPedido",\{hash:await sha256hex\(sec\),criadoEm:Date\.now\(\)\}/, 'só o hash vai para o Firestore');
  assert.match(page, /saveField\("telegram",null/);
  assert.match(page, /https:\/\/t\.me\/\$\{b\}\?start=\$\{u\}_\$\{s\}/);
  assert.match(page, /rel="noopener noreferrer"/);
  assert.match(page, /\$\{tgBox\(\)\}<\/div>`;\n\}/, 'bloco na página de alertas');
  assert.match(page, /número da conversa com o nosso bot/, 'política de privacidade');
});

await t('documentação: arquitetura, configuração e limitações', () => {
  const d = fs.readFileSync(path.join(root, 'docs/alertas-telegram-usuario.md'), 'utf8');
  for (const s of ['ALERTAS_TELEGRAM_USUARIO', 'FIREBASE_SERVICE_ACCOUNT', 'TELEGRAM_BOT_TOKEN', 'SOCIAL_TELEGRAM_BOT_TOKEN', 'getUpdates', '/parar', 'Limitações']) assert.ok(d.includes(s), s);
});

if (fails.length) { console.error(fails.join('\n')); process.exit(1); }
console.log(`alertas-telegram-usuario-tests: ${n} testes ok`);
