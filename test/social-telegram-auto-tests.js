// #690 — envio automático: regras do proprietário (5 min, nova sai na hora, 24 h, afiliado primeiro), travas e diário.
// Offline: fetch falso.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { planejar, registrar, REGRAS } from '../src/agents/social/auto.js';
import { main } from '../tools/social-telegram-auto.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOKEN = '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcd';
const ENV = { SOCIAL_ENABLED: '1', SOCIAL_AUTO: '1', SOCIAL_TELEGRAM_BOT_TOKEN: TOKEN, SOCIAL_TELEGRAM_CHAT_ID: '-100123' };
const NOW = Date.parse('2026-10-14T15:00:00Z'); const iso = (minAtras) => new Date(NOW - minAtras * 60e3).toISOString();   // 12h em Brasília
let n = 0;
const t = async (name, fn) => { try { await fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } };
const c = (id, { firstSeen = iso(5000), afiliado = false } = {}) => ({ item: { ofertaId: id }, oferta: { firstSeen }, afiliado });

await t('1. intervalo de 5 min entre mensagens', () => {
  assert.deepEqual(planejar([c('a')], [{ ofertaId: 'x', at: iso(2) }], { now: NOW }).enviar, []);
  assert.equal(planejar([c('a')], [{ ofertaId: 'x', at: iso(6) }], { now: NOW }).enviar[0].item.ofertaId, 'a');
  assert.equal(planejar([c('a'), c('b')], [], { now: NOW }).enviar.length, 1, 'uma por rodada');
});

await t('2. oferta nova no radar fura o intervalo (até 3 por rodada), só uma vez', () => {
  const novas = ['n1', 'n2', 'n3', 'n4'].map((id) => c(id, { firstSeen: iso(10) }));
  const p = planejar([c('a'), ...novas], [{ ofertaId: 'x', at: iso(1) }], { now: NOW });
  assert.deepEqual(p.enviar.map((x) => x.item.ofertaId), ['n1', 'n2', 'n3']);
  assert.deepEqual(planejar([c('n1', { firstSeen: iso(10) })], [{ ofertaId: 'n1', at: iso(1) }], { now: NOW }).enviar, [], 'já postada: não é mais "nova"');
});

await t('3. mesma oferta no máximo 1× a cada 24 h', () => {
  assert.equal(planejar([c('a'), c('b')], [{ ofertaId: 'a', at: iso(60) }], { now: NOW }).enviar[0].item.ofertaId, 'b');
  assert.deepEqual(planejar([c('a')], [{ ofertaId: 'a', at: iso(23 * 60) }], { now: NOW }).enviar, []);
  assert.equal(planejar([c('a')], [{ ofertaId: 'a', at: iso(24 * 60 + 1) }], { now: NOW }).enviar.length, 1);
});

await t('4. diário: limpa entradas antigas e ignora lixo', () => {
  const d = registrar([{ ofertaId: 'v', at: iso(49 * 60) }, { ofertaId: 'r', at: iso(10) }, null], [{ ofertaId: 'z', at: iso(0) }], { now: NOW });
  assert.deepEqual(d.map((x) => x.ofertaId), ['r', 'z']);
  assert.equal(REGRAS.intervaloMin, 5); assert.equal(REGRAS.repetirHoras, 24);
});

await t('4b. madrugada (0h–7h BRT): só oferta nova sai', () => {
  const tres = Date.parse('2026-10-14T06:00:00Z');   // 3h em Brasília
  assert.deepEqual(planejar([c('a')], [], { now: tres }).enviar, []);
  assert.equal(planejar([c('n', { firstSeen: new Date(tres - 10 * 60e3).toISOString() })], [], { now: tres }).enviar.length, 1);
});

await t('4c. workflow dispara logo depois de cada rodada bem-sucedida do robô', () => {
  const y = fs.readFileSync(path.join(root, '.github/workflows/social-telegram-auto.yml'), 'utf8');
  assert.match(y, /workflow_run:\n {4}workflows: \['Price Hunter'\]\n {4}types: \[completed\]/);
  assert.match(y, /github\.event\.workflow_run\.conclusion == 'success'/);
});

// ---------------------------------------------------------------- ferramenta
const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'tg-auto-'));
const st = { generatedAt: new Date(NOW).toISOString(), products: [{ id: 'me04-box36', collection: 'me04', collectionName: 'ME04', type: 'booster_box', boosters: 36, name: 'Box ME04' }],
  offers: ['o1', 'o2'].map((id, i) => ({ id, productId: 'me04-box36', storeId: 'loja' + i, storeName: 'Loja ' + i, url: `https://l${i}.test/p`, image: `https://l${i}.test/i.jpg`, title: 'Box ME04', price: 900 + i, total: 900 + i,
    shippingKnown: true, shipping: 0, stock: 'IN_STOCK', confirmed: true, stale: false, anomalous: false, firstSeen: iso(5000), source_timestamp: iso(5) })) };
const stateFile = path.join(tmp, 'state.json'); fs.writeFileSync(stateFile, JSON.stringify(st));
const json = (o) => ({ ok: true, status: 200, json: async () => o });
const fake = (titulo = 'TCG Price Hunter | 01', envio = { ok: true, result: { message_id: 7 } }) => {
  const calls = []; const f = async (url, init) => { calls.push({ url, init }); return url.includes('/getChat') ? json({ ok: true, result: { title: titulo } }) : json(envio); };
  f.calls = calls; return f;
};
const io = () => { const out = []; const err = []; return { out, err, io: { log: (s) => out.push(String(s)), error: (s) => err.push(String(s)) } }; };
const args = (diario) => ['--state', stateFile, '--diario', diario, '--titulo', 'TCG Price Hunter | 01'];

await t('5. kill switch: sem SOCIAL_AUTO=1 não chama a API', async () => {
  const f = fake(); const x = io();
  assert.equal(await main(args(path.join(tmp, 'd0.json')), { ...ENV, SOCIAL_AUTO: '0' }, x.io, f), 0);
  assert.equal(f.calls.length, 0); assert.match(x.out.join(), /desligado/);
});

await t('6. rodada: envia uma, grava no diário; rodada seguinte respeita os 5 min', async () => {
  const d = path.join(tmp, 'd1.json'); const f = fake(); const x = io();
  assert.equal(await main(args(d), ENV, x.io, f, () => NOW), 0);
  assert.equal(f.calls.filter((c) => c.url.includes('/sendPhoto')).length, 1);
  assert.deepEqual(JSON.parse(fs.readFileSync(d, 'utf8')).map((e) => e.messageId), [7]);
  const f2 = fake(); assert.equal(await main(args(d), ENV, io().io, f2, () => NOW + 60e3), 0);
  assert.equal(f2.calls.length, 0, 'dentro de 5 min: nenhuma chamada');
  const f3 = fake(); assert.equal(await main(args(d), ENV, io().io, f3, () => NOW + 6 * 60e3), 0);
  const body = JSON.parse(f3.calls.find((c) => c.url.includes('/sendPhoto')).init.body);
  assert.notEqual(body.photo, JSON.parse(f.calls.find((c) => c.url.includes('/sendPhoto')).init.body).photo, 'a segunda rodada manda a outra oferta');
  assert.equal(body.parse_mode, 'HTML');
});

await t('7. título errado não envia; falha da API não entra no diário e não vaza token', async () => {
  const d = path.join(tmp, 'd2.json'); const f = fake('Grupo de teste');
  assert.equal(await main(args(d), ENV, io().io, f, () => NOW), 2);
  assert.ok(!f.calls.some((c) => c.url.includes('/sendPhoto')));
  const x = io(); const f2 = fake('TCG Price Hunter | 01', { ok: false, description: `erro ${TOKEN}` });
  assert.equal(await main(args(d), ENV, x.io, f2, () => NOW), 1);
  assert.ok(!fs.existsSync(d) || JSON.parse(fs.readFileSync(d, 'utf8')).length === 0);
  assert.ok(![...x.out, ...x.err].join().includes(TOKEN));
});

await t('8. workflow: kill switch por variável, só leitura, sem interpolação no shell', () => {
  const y = fs.readFileSync(path.join(root, '.github/workflows/social-telegram-auto.yml'), 'utf8').split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
  assert.match(y, /if: vars\.SOCIAL_AUTO == '1'/);
  assert.match(y, /^permissions:\n {2}contents: read$/m); assert.doesNotMatch(y, /: write/);
  for (const run of y.split('run: |').slice(1)) assert.doesNotMatch(run.split(/\n {6}- /)[0], /\$\{\{/);
});

console.log(`✓ Telegram automático (#690): ${n} grupos passaram`);
