// #690 — WhatsApp (automação não oficial por decisão do proprietário): legenda, sessão cifrada, grupo exato, regras
// mais espaçadas e fluxo de envio com conexão falsa (sem Baileys, sem rede).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { legendaWhatsApp, cifrarSessao, decifrarSessao, acharGrupo } from '../src/agents/social/whatsapp.js';
import { planejar, REGRAS_WHATSAPP, REGRAS } from '../src/agents/social/auto.js';
import { main, lerArgs } from '../tools/social-whatsapp.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CHAVE = 'k'.repeat(40);
const NOW = Date.parse('2026-10-14T15:00:00Z');
const iso = (min) => new Date(NOW - min * 60e3).toISOString();
let n = 0;
const t = async (name, fn) => { try { await fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } };

await t('1. legenda: negrito do WhatsApp e entidades desfeitas', () => {
  assert.equal(legendaWhatsApp('🇧🇷 <b>Box &amp; Cia</b>\n\nDe <b>R$ 13,00</b> ❌'), '🇧🇷 *Box & Cia*\n\nDe *R$ 13,00* ❌');
});

await t('2. sessão: cifra/decifra; chave errada ou curta falha', () => {
  const b = cifrarSessao({ 'creds.json': '{"a":1}' }, CHAVE);
  assert.deepEqual(decifrarSessao(b, CHAVE), { 'creds.json': '{"a":1}' });
  assert.ok(!b.toString('utf8').includes('creds'), 'conteúdo não aparece em claro');
  assert.throws(() => decifrarSessao(b, 'x'.repeat(40)));
  assert.throws(() => cifrarSessao({}, 'curta'));
});

await t('3. grupo: só título exato e único', () => {
  const g = { a: { id: '1@g.us', subject: 'TCG Price Hunter | 01' }, b: { id: '2@g.us', subject: 'Outro' } };
  assert.equal(acharGrupo(g, 'TCG Price Hunter | 01'), '1@g.us');
  assert.equal(acharGrupo(g, 'TCG Price Hunter'), null);
  assert.equal(acharGrupo({ ...g, c: { id: '3@g.us', subject: 'Outro' } }, 'Outro'), null, 'ambíguo: não posta');
});

await t('4. regras do WhatsApp: 30 min, 1 nova por rodada, teto de 20/24 h; Telegram inalterado', () => {
  const c = (id, f = iso(5000)) => ({ item: { ofertaId: id }, oferta: { firstSeen: f }, afiliado: false });
  assert.equal(REGRAS.intervaloMin, 5); assert.equal(REGRAS.maxDia, undefined);
  assert.deepEqual(planejar([c('a')], [{ ofertaId: 'x', at: iso(20) }], { now: NOW, regras: REGRAS_WHATSAPP }).enviar, []);
  assert.equal(planejar([c('a')], [{ ofertaId: 'x', at: iso(31) }], { now: NOW, regras: REGRAS_WHATSAPP }).enviar.length, 1);
  assert.equal(planejar([c('n1', iso(5)), c('n2', iso(5))], [], { now: NOW, regras: REGRAS_WHATSAPP }).enviar.length, 1);
  const cheio = Array.from({ length: 20 }, (_, i) => ({ ofertaId: 'o' + i, at: iso(40 + i) }));
  assert.match(planejar([c('n', iso(5))], cheio, { now: NOW, regras: REGRAS_WHATSAPP }).motivo, /teto/);
});

// ---------------------------------------------------------------- ferramenta com conexão falsa
const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'wa-'));
const st = { generatedAt: new Date(NOW).toISOString(), products: [{ id: 'me04-box36', collection: 'me04', collectionName: 'ME04', type: 'booster_box', boosters: 36, name: 'Box ME04' }],
  offers: [{ id: 'o1', productId: 'me04-box36', storeId: 'l', storeName: 'Loja', url: 'https://l.test/p', image: 'https://l.test/i.jpg', title: 'Box ME04', price: 900, total: 900,
    shippingKnown: true, shipping: 0, stock: 'IN_STOCK', confirmed: true, stale: false, anomalous: false, firstSeen: iso(5000), source_timestamp: iso(5) }] };
const stateFile = path.join(tmp, 'state.json'); fs.writeFileSync(stateFile, JSON.stringify(st));
const io = () => { const out = []; const err = []; return { out, err, io: { log: (s) => out.push(String(s)), error: (s) => err.push(String(s)) } }; };
const fakeCon = (grupos = { a: { id: '1@g.us', subject: 'TCG Price Hunter | 01' } }) => {
  const env = []; let fechou = false;
  const conectar = async (dir) => { fs.writeFileSync(path.join(dir, 'creds.json'), '{"novo":true}'); return {
    sock: () => ({ groupFetchAllParticipating: async () => grupos, sendMessage: async (jid, m) => { env.push({ jid, m }); return { key: { id: 'MSG1' } }; } }),
    fechar: async () => { fechou = true; } }; };
  return { conectar, env, fechou: () => fechou };
};
const fetchImg = async () => ({ ok: true, arrayBuffer: async () => new Uint8Array([1, 2, 3]).buffer });
const ENV = { SOCIAL_ENABLED: '1', SOCIAL_WHATSAPP_AUTO: '1', SOCIAL_WHATSAPP_CHAVE: CHAVE };

await t('5. args: modos e obrigatórios; número no formato 55...', () => {
  assert.throws(() => lerArgs(['x', '--sessao', 's']));
  assert.throws(() => lerArgs(['parear', '--sessao', 's', '--numero', '11999']));
  assert.equal(lerArgs(['parear', '--sessao', 's', '--numero', '5511927405250']).numero, '5511927405250');
});

await t('6. enviar: kill switch e sessão ausente não conectam', async () => {
  const f = fakeCon(); const a = ['enviar', '--sessao', path.join(tmp, 'nao.bin'), '--state', stateFile, '--diario', path.join(tmp, 'd.json'), '--titulo', 'TCG Price Hunter | 01'];
  assert.equal(await main(a, { ...ENV, SOCIAL_WHATSAPP_AUTO: '0' }, io().io, { conectar: f.conectar, fetchFn: fetchImg, now: () => NOW }), 0);
  assert.equal(await main(a, ENV, io().io, { conectar: f.conectar, fetchFn: fetchImg, now: () => NOW }), 2);
  assert.equal(f.env.length, 0);
});

await t('7. enviar: posta imagem + legenda no grupo certo, grava diário e regrava a sessão cifrada', async () => {
  const sessao = path.join(tmp, 's.bin'); fs.writeFileSync(sessao, cifrarSessao({ 'creds.json': '{"velho":true}' }, CHAVE));
  const diario = path.join(tmp, 'd1.json'); const f = fakeCon(); const x = io();
  const a = ['enviar', '--sessao', sessao, '--state', stateFile, '--diario', diario, '--titulo', 'TCG Price Hunter | 01'];
  assert.equal(await main(a, ENV, x.io, { conectar: f.conectar, fetchFn: fetchImg, now: () => NOW, esperar: async () => {} }), 0);
  assert.equal(f.env.length, 1); assert.equal(f.env[0].jid, '1@g.us');
  assert.ok(Buffer.isBuffer(f.env[0].m.image)); assert.match(f.env[0].m.caption, /^🇧🇷 \*Box ME04\*/); assert.doesNotMatch(f.env[0].m.caption, /<b>/);
  assert.deepEqual(JSON.parse(fs.readFileSync(diario, 'utf8')).map((d) => d.messageId), ['MSG1']);
  assert.deepEqual(decifrarSessao(fs.readFileSync(sessao), CHAVE), { 'creds.json': '{"novo":true}' }, 'sessão atualizada');
  assert.ok(f.fechou());
  const f2 = fakeCon(); assert.equal(await main(a, ENV, io().io, { conectar: f2.conectar, fetchFn: fetchImg, now: () => NOW + 10 * 60e3, esperar: async () => {} }), 0);
  assert.equal(f2.env.length, 0, '30 min ainda não passaram: nem conecta');
});

await t('8. enviar: grupo com outro nome não recebe nada', async () => {
  const sessao = path.join(tmp, 's2.bin'); fs.writeFileSync(sessao, cifrarSessao({ 'creds.json': '{}' }, CHAVE));
  const f = fakeCon({ a: { id: '9@g.us', subject: 'Grupo de teste' } });
  const a = ['enviar', '--sessao', sessao, '--state', stateFile, '--diario', path.join(tmp, 'd2.json'), '--titulo', 'TCG Price Hunter | 01'];
  assert.equal(await main(a, ENV, io().io, { conectar: f.conectar, fetchFn: fetchImg, now: () => NOW, esperar: async () => {} }), 2);
  assert.equal(f.env.length, 0);
});

await t('9. workflows: manuais/automático com kill switch, só leitura, chave só por secret, sem interpolação no shell', () => {
  for (const nome of ['social-whatsapp-parear.yml', 'social-whatsapp-auto.yml']) {
    const y = fs.readFileSync(path.join(root, '.github/workflows', nome), 'utf8').split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
    assert.match(y, /^permissions:\n {2}contents: read$/m); assert.doesNotMatch(y, /: write/);
    assert.match(y, /group: social-whatsapp\n/);
    assert.match(y, /@whiskeysockets\/baileys@\d/);
    for (const run of y.split('run: |').slice(1)) assert.doesNotMatch(run.split(/\n {6}- /)[0], /\$\{\{/);
  }
  assert.match(fs.readFileSync(path.join(root, '.github/workflows/social-whatsapp-auto.yml'), 'utf8'), /if: vars\.SOCIAL_WHATSAPP_AUTO == '1'/);
});

console.log(`✓ WhatsApp (#690): ${n} grupos passaram`);
