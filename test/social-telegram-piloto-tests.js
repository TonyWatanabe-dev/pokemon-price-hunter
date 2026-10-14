// #690 — piloto Telegram: tudo offline (fetch falso). Prévia sem rede; envio só com ENVIAR + título conferido;
// token nunca aparece na saída; sendPhoto com foto https e legenda até 1024; workflow manual e mínimo.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { main, lerArgs } from '../tools/social-telegram-piloto.mjs';
import { publicarFoto, MOTIVOS } from '../src/agents/social/telegram.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TOKEN = '123456:ABCDEFGHIJKLMNOPQRSTUVWXYZabcd';
const ENV = { SOCIAL_ENABLED: '1', SOCIAL_TELEGRAM_BOT_TOKEN: TOKEN, SOCIAL_TELEGRAM_CHAT_ID: '-1001234567890' };
let n = 0;
const t = async (name, fn) => { try { await fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } };
const io = () => { const out = []; const err = []; return { out, err, io: { log: (s) => out.push(String(s)), error: (s) => err.push(String(s)) } }; };
const json = (o, status = 200) => ({ ok: status < 300, status, json: async () => o });
const fakeFetch = (titulo = 'TCG Price Hunter | 01', envio = { ok: true, result: { message_id: 42 } }) => {
  const calls = [];
  const f = async (url, init) => { calls.push({ url, init }); return url.includes('/getChat') ? json({ ok: true, result: { title: titulo, type: 'supergroup' } }) : json(envio); };
  f.calls = calls; return f;
};

// state.json de teste com uma oferta elegível agora
const NOW = Date.now();
const st = { generatedAt: new Date(NOW).toISOString(), products: [{ id: 'me04-box36', collection: 'me04', collectionName: 'ME04', type: 'booster_box', boosters: 36, name: 'Box ME04' }],
  offers: [{ id: 'o1', productId: 'me04-box36', storeId: 'vt', storeName: 'Loja VT', url: 'https://vt.test/p', image: 'https://vt.test/img.jpg', title: 'Box', price: 900, total: 900,
    shippingKnown: true, shipping: 0, stock: 'IN_STOCK', confirmed: true, stale: false, anomalous: false, source_timestamp: new Date(NOW - 5 * 60e3).toISOString() }] };
const tmp = fs.mkdtempSync(path.join(process.env.TMPDIR || '/tmp', 'tg-piloto-'));
const stateFile = path.join(tmp, 'state.json'); fs.writeFileSync(stateFile, JSON.stringify(st));

await t('1. argumentos: modo obrigatório e valores exigidos', () => {
  assert.throws(() => lerArgs(['x']), /modo/); assert.throws(() => lerArgs(['enviar', '--titulo'])); assert.throws(() => lerArgs(['previa', '--zzz', '1']));
  assert.deepEqual(lerArgs(['enviar', '--titulo', 'G', '--confirmar', 'ENVIAR']), { modo: 'enviar', titulo: 'G', confirmar: 'ENVIAR' });
});

await t('2. prévia não usa rede nem secrets', async () => {
  const f = fakeFetch(); const c = io();
  assert.equal(await main(['previa', '--state', stateFile], {}, c.io, f), 0);
  assert.equal(f.calls.length, 0); assert.match(c.out.join('\n'), /Prévia Telegram/); assert.match(c.out.join('\n'), /img\.jpg/);
});

await t('3. enviar recusa sem ENVIAR, sem título, sem secrets ou com título errado — sem sendPhoto', async () => {
  for (const [argv, env] of [[['enviar', '--state', stateFile, '--titulo', 'TCG Price Hunter | 01'], ENV],
    [['enviar', '--state', stateFile, '--confirmar', 'ENVIAR'], ENV],
    [['enviar', '--state', stateFile, '--confirmar', 'ENVIAR', '--titulo', 'TCG Price Hunter | 01'], { SOCIAL_ENABLED: '1' }]]) {
    const f = fakeFetch(); const c = io();
    assert.equal(await main(argv, env, c.io, f), 2); assert.ok(!f.calls.some((x) => x.url.includes('sendPhoto')));
  }
  const f = fakeFetch('Grupo de teste'); const c = io();
  assert.equal(await main(['enviar', '--state', stateFile, '--confirmar', 'ENVIAR', '--titulo', 'TCG Price Hunter | 01'], ENV, c.io, f), 2);
  assert.ok(!f.calls.some((x) => x.url.includes('sendPhoto'))); assert.match(c.err.join(), /não confere/);
});

await t('4. envio confirmado: uma única chamada sendPhoto com foto e legenda; token fora da saída', async () => {
  const f = fakeFetch(); const c = io();
  assert.equal(await main(['enviar', '--state', stateFile, '--confirmar', 'ENVIAR', '--titulo', 'TCG Price Hunter | 01'], ENV, c.io, f), 0);
  const envios = f.calls.filter((x) => x.url.includes('/sendPhoto'));
  assert.equal(envios.length, 1);
  const body = JSON.parse(envios[0].init.body);
  assert.equal(body.photo, 'https://vt.test/img.jpg'); assert.equal(body.chat_id, '-1001234567890'); assert.ok(body.caption.length > 0 && body.caption.length <= 1024);
  assert.match(c.out.join('\n'), /message_id 42/);
  assert.ok(![...c.out, ...c.err].join('\n').includes(TOKEN), 'token nunca impresso');
});

await t('5. falha da API não vaza token e não tenta de novo', async () => {
  const f = fakeFetch('TCG Price Hunter | 01', { ok: false, description: `bad ${TOKEN}` }); const c = io();
  assert.equal(await main(['enviar', '--state', stateFile, '--confirmar', 'ENVIAR', '--titulo', 'TCG Price Hunter | 01'], ENV, c.io, f), 1);
  assert.equal(f.calls.filter((x) => x.url.includes('/sendPhoto')).length, 1);
  assert.ok(!c.err.join().includes(TOKEN));
});

await t('6. publicarFoto: recusa foto não-https e legenda longa; simula por padrão', async () => {
  const item = { id: 'i1', canal: 'telegram', chaveDedupe: 'k', texto: 'oi', estado: 'aprovado', criadoEm: new Date().toISOString(), atualizadoEm: new Date().toISOString(), agendadoPara: null, motivo: null };
  const base = { env: { SOCIAL_ENABLED: '1' }, token: TOKEN, chatId: '-100123' };
  assert.equal((await publicarFoto(item, { ...base, foto: 'http://x/y.jpg' })).motivo, MOTIVOS.SEM_FOTO);
  assert.equal((await publicarFoto({ ...item, texto: 'a'.repeat(1025) }, { ...base, foto: 'https://x/y.jpg' })).motivo, MOTIVOS.LEGENDA_LONGA);
  const sim = await publicarFoto(item, { ...base, foto: 'https://x/y.jpg' });
  assert.equal(sim.status, 'simulado'); assert.ok(!sim.requisicao.url.includes(TOKEN));
});

await t('7. workflow: só manual, leitura, secrets só no passo de conferir/enviar, entradas por variável', () => {
  const y = fs.readFileSync(path.join(root, '.github/workflows/social-telegram-piloto.yml'), 'utf8').split('\n').filter((l) => !l.trim().startsWith('#')).join('\n');
  assert.match(y, /^on:\n {2}workflow_dispatch:/m); assert.doesNotMatch(y, /schedule:|push:|pull_request|workflow_run/);
  assert.match(y, /^permissions:\n {2}contents: read$/m); assert.doesNotMatch(y, /write/);
  const previa = y.split('- name: Prévia')[1].split('- name:')[0];
  assert.doesNotMatch(previa, /secrets\./, 'prévia sem secrets');
  for (const run of y.split('run: |').slice(1)) assert.doesNotMatch(run.split(/\n {6}- /)[0], /\$\{\{/, 'sem interpolação no shell');
});

console.log(`✓ Piloto Telegram (#690): ${n} grupos passaram`);
