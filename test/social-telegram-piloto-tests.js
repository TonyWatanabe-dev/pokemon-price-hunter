// #690 — piloto Telegram: tudo offline (fetch falso). Prévia sem rede; envio só com ENVIAR + título conferido;
// token nunca aparece na saída; sendPhoto com foto https e legenda até 1024; workflow manual e mínimo.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { main, lerArgs, escolher, gerarCard, linkDe, fotoAcervo } from '../tools/social-telegram-piloto.mjs';
import { montarLegenda, precoAnterior } from '../src/agents/social/legenda.js';
import { spawnSync } from 'node:child_process';
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

await t('8. legenda no formato aprovado: De só com preço anterior real, centavos, escape, divulgação só com afiliado', () => {
  const l = montarLegenda({ titulo: 'Blister <b>ME04</b> & Cia', atual: 11, anterior: 13, loja: 'Loja Oficial', link: 'https://meli.la/18VoNnj', afiliado: true });
  assert.equal(l.parseMode, 'HTML');
  assert.equal(l.texto, '🇧🇷 <b>Blister ME04 &amp; Cia</b>\n\nDe <b>R$ 13,00</b> ❌\nPor <b>R$ 11,00</b> ✅\n\nLoja Oficial\nhttps://meli.la/18VoNnj\n\nLink de afiliado: podemos receber comissão, sem custo extra para você.');
  const s = montarLegenda({ titulo: 'X', atual: 13.99, anterior: 10, loja: 'L', link: 'https://l.test/p' }).texto;
  assert.doesNotMatch(s, /De |afiliado/, 'anterior menor que o atual não vira "De"; sem afiliado sem divulgação');
  assert.match(s, /Por <b>R\$ 13,99<\/b> ✅/); assert.doesNotMatch(s, /\d{2}:\d{2}/, 'sem horário');
  assert.equal(precoAnterior({ price: 11, listPrice: 13 }), 13); assert.equal(precoAnterior({ price: 11, listPrice: null }), null); assert.equal(precoAnterior({ price: 11, listPrice: 11 }), null);
  assert.throws(() => montarLegenda({ titulo: 'X', atual: 1, loja: 'L', link: 'http://x' }));
  assert.ok(montarLegenda({ titulo: 'a'.repeat(5000), atual: 1, loja: 'L', link: 'https://x.test/p' }).texto.length <= 1024);
});

await t('9. link: afiliado do anúncio tem prioridade na escolha e vira o link do post', () => {
  const st2 = structuredClone(st);
  st2.offers.push({ ...st.offers[0], id: 'o2', storeId: 'ml', storeName: 'Mercado Livre', price: 950, total: 950, url: 'https://produto.mercadolivre.com.br/MLB-1234567890-x', listPrice: 1000 });
  const af = { anuncios: { MLB1234567890: 'https://meli.la/abc' } };
  assert.deepEqual(linkDe(st2.offers[1], af), { link: 'https://meli.la/abc', afiliado: true });
  assert.deepEqual(linkDe(st2.offers[0], af), { link: 'https://vt.test/p', afiliado: false });
  const e = escolher(st2, { afiliados: af });
  assert.equal(e.item.ofertaId, 'o2'); assert.equal(e.afiliado, true);
  assert.match(e.item.texto, /https:\/\/meli\.la\/abc/); assert.match(e.item.texto, /De <b>R\$ 1\.000,00<\/b> ❌/);
  assert.equal(escolher(st2, { afiliados: {} }).item.ofertaId, 'o1', 'sem afiliado mantém a ordem da prévia');
});

await t('10. card: arquivo vai em multipart com parse_mode HTML; falha do card cai na foto original', async () => {
  const f = fakeFetch(); const item = { id: 'i1', canal: 'telegram', chaveDedupe: 'k', texto: '<b>oi</b>', estado: 'aprovado', criadoEm: new Date().toISOString(), atualizadoEm: new Date().toISOString(), agendadoPara: null, motivo: null };
  const r = await publicarFoto(item, { env: { SOCIAL_ENABLED: '1' }, token: TOKEN, chatId: '-100', arquivo: new Uint8Array([255, 216, 255]), parseMode: 'HTML', fetch: f, simular: false });
  assert.equal(r.ok, true);
  const fd = f.calls[0].init.body; assert.ok(fd instanceof FormData);
  assert.equal(fd.get('parse_mode'), 'HTML'); assert.equal(fd.get('caption'), '<b>oi</b>'); assert.ok(fd.get('photo') instanceof Blob);
  const falha = async () => ({ ok: false, status: 404 });
  assert.equal(await gerarCard('https://x.test/f.jpg', path.join(tmp, 'c.jpg'), falha), null);
  const img = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) });
  assert.equal(await gerarCard('https://x.test/f.jpg', path.join(tmp, 'c.jpg'), img, () => ({ status: 3 })), null, 'foto sem fundo branco: original');
});

await t('10b. acervo: foto revisada do produto tem prioridade e dispensa download', async () => {
  const dir = fs.mkdtempSync(path.join(tmp, 'acervo-')); fs.writeFileSync(path.join(dir, 'me05-etb.webp'), 'x');
  assert.equal(fotoAcervo('me05-etb', dir), path.join(dir, 'me05-etb.webp'));
  assert.equal(fotoAcervo('../etc/passwd', dir), null); assert.equal(fotoAcervo('me05-box36', dir), null);
  let baixou = false; let arg = null;
  const f = async () => { baixou = true; return { ok: false }; };
  const out = path.join(tmp, 'acv.jpg'); fs.writeFileSync(out, 'jpg');
  const r = await gerarCard('https://x.test/f.jpg', out, f, (cmd, a) => { arg = a; return { status: 0 }; }, 'me05-etb', dir);
  assert.ok(r instanceof Uint8Array); assert.equal(baixou, false); assert.equal(arg[arg.indexOf('--foto') + 1], path.join(dir, 'me05-etb.webp'));
  await gerarCard('https://x.test/f.jpg', out, f, () => ({ status: 0 }), 'me05-box36', dir);
  assert.equal(baixou, true, 'sem acervo: baixa a foto da loja');
});

const temPillow = spawnSync('python3', ['-c', 'import PIL'], { encoding: 'utf8' }).status === 0;
if (temPillow) await t('11. social-card.py: recorta foto de fundo branco e gera JPEG 1080; foto sem fundo branco devolve 3', () => {
  const py = (code) => spawnSync('python3', ['-c', code], { encoding: 'utf8' });
  const branca = path.join(tmp, 'b.png'); const cheia = path.join(tmp, 'c.png'); const out = path.join(tmp, 'card.jpg');
  assert.equal(py(`from PIL import Image,ImageDraw;i=Image.new('RGB',(400,600),'white');ImageDraw.Draw(i).rectangle((100,80,300,520),fill=(200,30,30));i.save('${branca}');Image.new('RGB',(400,600),(90,60,40)).save('${cheia}')`).status, 0);
  const card = path.join(root, 'tools/social-card.py');
  assert.equal(spawnSync('python3', [card, '--foto', branca, '--saida', out]).status, 0);
  assert.equal(py(`from PIL import Image;i=Image.open('${out}');assert i.size==(1080,1080) and i.format=='JPEG';assert i.getpixel((540,600))[0]>150`).status, 0, 'produto no centro do card');
  assert.equal(spawnSync('python3', [card, '--foto', cheia, '--saida', out + '2']).status, 3);
  const r = py(`import sys;sys.dont_write_bytecode=True;import importlib.util as u
s=u.spec_from_file_location('c','${card}');c=u.module_from_spec(s);s.loader.exec_module(c)
from PIL import Image,ImageDraw;m=Image.new('L',(800,800),0);d=ImageDraw.Draw(m);d.rectangle((40,40,300,160),fill=255);d.rectangle((250,250,700,740),fill=255)
o=c.so_produto(m);assert o.getpixel((100,100))==0,'logo solto removido';assert o.getpixel((500,500))==255,'produto mantido'
d.rectangle((5,250,240,740),fill=255);assert c.so_produto(m).getpixel((100,500))==255,'kit: segundo item grande fica'`);
  assert.equal(r.status, 0, r.stderr);
  const rgba = path.join(tmp, 'acervo.png'); const outa = path.join(tmp, 'card-a.jpg');
  assert.equal(py(`from PIL import Image,ImageDraw;i=Image.new('RGBA',(300,500),(0,0,0,0));ImageDraw.Draw(i).rectangle((20,20,280,480),fill=(250,250,250,255));i.save('${rgba}')`).status, 0);
  assert.equal(spawnSync('python3', [card, '--foto', rgba, '--saida', outa]).status, 0, 'foto do acervo (transparente, até branca) vira card sem recorte');
  assert.equal(py(`from PIL import Image;i=Image.open('${outa}').convert('RGB');assert min(i.getpixel((540,600)))>230,'produto branco preservado'`).status, 0);
});
else console.log('(social-card.py não testado: Pillow ausente neste ambiente)');

console.log(`✓ Piloto Telegram (#690): ${n} grupos passaram`);
