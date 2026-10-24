// Top 3 / Top 10 do site nos grupos (24/10/2026): dados da API, legendas só com o link do site, falha fechada,
// arte sem link de produto e envios (Telegram e WhatsApp) com rede e conexão falsas.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { itensDaApi, legenda, legendaTelegram, arteHtml, nomeCurto, quando, tipoDaHora, slotAgora, SITE } from '../src/agents/social/top.js';
import { main, lerArgs, fotoDe, vez } from '../tools/social-top.mjs';
import { cifrarSessao } from '../src/agents/social/whatsapp.js';

const raiz = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const API = JSON.parse(fs.readFileSync(path.join(raiz, 'test/fixtures/oportunidades-top.json'), 'utf8'));
const io = () => { const out = []; return { out, io: { log: (s) => out.push(String(s)), error: (s) => out.push('ERRO ' + s) } }; };

// dados
const AGORA = Date.parse('2026-10-24T20:10:00Z');
const api = (r, t) => itensDaApi(r, t, AGORA);
const d3 = api(API, 'top3');
assert.equal(d3.itens.length, 3);
assert.equal(d3.quando, '24/10 às 16h56');
assert.deepEqual(d3.itens.map((i) => i.id), ['me04-blister3', 'me03-blister4', 'me05-etb'], 'mesma ordem da API (Opportunity Score)');
assert.equal(nomeCurto({ name: 'Escuridão Absoluta - Treinador Avançado (ETB)' }), 'ETB');
assert.equal(nomeCurto({ name: 'Escuridão Absoluta - Box Pokémon ex Mega Greninja ex' }), 'Box ex Mega Greninja ex');
assert.equal(quando('2026-10-25T00:05:00Z'), '24/10 às 21h05', 'horário de Brasília');
assert.equal(api({ ...API, data: API.data.slice(0, 5) }, 'top10').erro, 'só 5 oportunidades válidas para um top10');
assert.match(api({ ...API, meta: { ...API.meta, freshness: { status: 'pausado' } } }, 'top3').erro, /frescor/);
assert.ok(api({ data: API.data.map((x) => ({ ...x, stock: 'out_of_stock' })), meta: API.meta }, 'top3').erro, 'sem estoque não entra');
assert.ok(api(null, 'top3').erro);
assert.match(api({ ...API, meta: { updated_at: API.meta.updated_at } }, 'top3').erro, /sem informação/, 'sem freshness: não posta');
assert.match(itensDaApi(API, 'top3', AGORA + 7 * 3600e3).erro, /mais de 6 h/, 'ranking velho: não posta');
// diário do WhatsApp: não repete, respeita o teto e (com regra de intervalo) espera
const at = (min) => new Date(AGORA - min * 60e3).toISOString();
assert.deepEqual(vez([{ ofertaId: 'x', at: at(10) }], 'top3:h', AGORA), { pode: true, esperaMs: 0 }, 'WhatsApp sem intervalo mínimo');
assert.deepEqual(vez([{ ofertaId: 'x', at: at(10) }], 'top3:h', AGORA, { intervaloMin: 30 }), { pode: true, esperaMs: 20 * 60e3 });
assert.deepEqual(vez([{ ofertaId: 'x', at: at(40) }], 'top3:h', AGORA), { pode: true, esperaMs: 0 });
assert.equal(vez([{ ofertaId: 'top3:h', at: at(40) }], 'top3:h', AGORA).pode, false);
assert.equal(vez(Array.from({ length: 70 }, (_, k) => ({ ofertaId: 'o' + k, at: at(40 + k) })), 'top3:h', AGORA).pode, false);

// legendas: só o link do site, desconto nunca arredondado para cima, data dos preços
const l3 = legenda('top3', d3);
assert.match(l3, /🥇 \*Blister Triplo Caos Ascendente\*: R\$ 29,90 no Pix, 30% abaixo do sugerido Copag/);
assert.match(l3, /🥈 \*Blister Quádruplo Equilíbrio Perfeito\*: R\$ 41,80 no Pix, 25% abaixo\n/);
assert.match(l3, /🥉 \*ETB Escuridão Absoluta\*: R\$ 299,00, 25% abaixo/);
const l10 = legenda('top10', api(API, 'top10'));
assert.match(l10, /De blister a R\$ 11,90 a ETB a R\$ 299,00/);
for (const l of [l3, l10]) {
  assert.equal((l.match(/\S*tcgpricehunter\.com\.br\S*/g) || []).join(), SITE, 'um link só, o do site');
  assert.doesNotMatch(l, /https?:\/\/|\/produto\//, 'sem link de produto ou loja');
  assert.match(l, /_Preços de 24\/10 às 16h56\. Podem mudar a qualquer momento\._/);
}
// referência de mercado é dita como tal; Copag só quando é a Copag
const mercado = { ...d3, itens: [d3.itens[0], { ...d3.itens[1], copag: false }, d3.itens[2]] };
assert.match(legenda('top3', mercado), /🥈 .*25% abaixo da referência de mercado/);
assert.equal(legendaTelegram('*A & B* <x> _Preços de hoje._'), '<b>A &amp; B</b> &lt;x&gt; <i>Preços de hoje.</i>');

// arte: dados escapados, selo certo, sem link de produto
const a = { fonte: 'file:///f.woff2', logo: 'file:///l.webp', foto: (i) => `file:///${i.id}.webp` };
const h3 = arteHtml('top3', d3, a);
assert.match(h3, /R\$ 29,90/); assert.match(h3, /−30%<small>DO SUGERIDO/); assert.match(h3, /Preços de 24\/10 às 16h56/);
assert.doesNotMatch(h3, /\/produto\//);
assert.match(arteHtml('top3', mercado, a), /−25%<small>DO MERCADO/);
assert.match(arteHtml('top10', api(API, 'top10'), a), /−31,3%/, 'uma casa decimal, para baixo');
assert.ok(!arteHtml('top3', { ...d3, itens: [{ ...d3.itens[0], colecao: '<script>' }, d3.itens[1], d3.itens[2]] }, a).includes('<script>'));
// foto: acervo revisado; sem acervo, a da loja; sem nada, o logo da coleção
assert.match(fotoDe({ id: 'me04-blister3' }), /assets\/social\/produtos\/me04-blister3\.webp$/);
assert.equal(fotoDe({ id: 'nao-existe', imagem: 'https://x.test/a.png' }), 'https://x.test/a.png');
assert.match(fotoDe({ id: 'nao-existe', imagem: 'http://x.test/a.png', colecaoCodigo: 'me05' }), /logos\/colecoes\/me05\.webp$/);
assert.equal(tipoDaHora(Date.parse('2026-10-25T00:07:00Z')), 'top10');
assert.equal(tipoDaHora(Date.parse('2026-10-24T12:07:00Z')), 'top3');

// horário em vigor: 1ª tentativa e reservas (+30 min, +1 h) caem na mesma chave; fora dos horários, nada
assert.deepEqual(slotAgora(Date.parse('2026-10-24T22:07:00Z')), { tipo: 'top3', chave: '2026-10-24:19' });
assert.deepEqual(slotAgora(Date.parse('2026-10-24T23:07:00Z')), { tipo: 'top3', chave: '2026-10-24:19' }, 'reserva +1 h');
assert.deepEqual(slotAgora(Date.parse('2026-10-25T00:37:00Z')), { tipo: 'top10', chave: '2026-10-24:21' }, 'Top 10 de 24/10 mesmo depois da meia-noite UTC');
assert.deepEqual(slotAgora(Date.parse('2026-10-25T01:07:00Z')), { tipo: 'top10', chave: '2026-10-24:21' });
assert.equal(slotAgora(Date.parse('2026-10-24T14:07:00Z')), null, '11h: nenhum horário');
assert.equal(slotAgora(Date.parse('2026-10-25T02:07:00Z')), null, '23h: nenhum horário');
// argumentos
assert.throws(() => lerArgs(['arte', '--tipo', 'top5', '--dir', 'x']), /top3\|top10/);
assert.throws(() => lerArgs(['whatsapp', '--tipo', 'top3', '--dir', 'x', '--titulo', 'G']), /--sessao/);

// arte de ponta a ponta (render falso) e envios com rede/conexão falsas
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'top-'));
let html = '';
{
  const { out, io: o } = io();
  const fetchFn = async () => ({ ok: true, headers: { get: () => 'image/png' }, arrayBuffer: async () => new ArrayBuffer(8) });
  const r = await main(['arte', '--tipo', 'top3', '--dir', dir, '--json', path.join(raiz, 'test/fixtures/oportunidades-top.json')], {}, o,
    { now: () => AGORA, fetchFn, render: async (h, s) => { html = h; fs.writeFileSync(s, 'JPG'); } });
  assert.equal(r, 0, out.join('\n'));
  assert.ok(fs.existsSync(path.join(dir, 'top3.jpg')) && fs.readFileSync(path.join(dir, 'top3.txt'), 'utf8') === l3);
  assert.match(html, /rubik-v1\.woff2/);
}
{ // dado velho: não gera nada
  const { out, io: o } = io(); const f = path.join(dir, 'velho.json');
  fs.writeFileSync(f, JSON.stringify({ ...API, meta: { ...API.meta, freshness: { status: 'pausado' } } }));
  assert.equal(await main(['arte', '--tipo', 'top10', '--dir', dir, '--json', f], {}, o, { now: () => AGORA, render: async () => assert.fail('não renderiza') }), 2);
  assert.match(out.join(), /sem post/);
}
{ // Telegram: título do chat confere, foto multipart com legenda HTML e token nunca aparece
  const chamadas = []; const { out, io: o } = io(); const token = '123456:' + 'a'.repeat(30);
  const fetchFn = async (url, op) => {
    chamadas.push({ url, op });
    if (url.includes('/getChat')) return { ok: true, json: async () => ({ ok: true, result: { title: 'Grupo' } }) };
    return { ok: true, json: async () => ({ ok: true, result: { message_id: 7 } }) };
  };
  assert.equal(await main(['telegram', '--tipo', 'top3', '--dir', dir, '--titulo', 'Grupo'], { SOCIAL_ENABLED: '1', SOCIAL_TELEGRAM_BOT_TOKEN: token, SOCIAL_TELEGRAM_CHAT_ID: '-100' }, o, { fetchFn }), 0, out.join());
  const fd = chamadas[1].op.body;
  assert.equal(fd.get('parse_mode'), 'HTML'); assert.match(fd.get('caption'), /<b>TOP 3 DO SITE AGORA<\/b>/);
  assert.ok(!out.join().includes(token));
  assert.equal(await main(['telegram', '--tipo', 'top3', '--dir', dir, '--titulo', 'Outro'], { SOCIAL_ENABLED: '1', SOCIAL_TELEGRAM_BOT_TOKEN: token, SOCIAL_TELEGRAM_CHAT_ID: '-100' }, io().io, { fetchFn }), 2, 'grupo errado: recusa');
  assert.equal(await main(['telegram', '--tipo', 'top3', '--dir', dir, '--titulo', 'Grupo'], {}, io().io, { fetchFn: () => assert.fail('desligado não chama a rede') }), 0);
}
{ // WhatsApp: grupo exato, imagem + legenda, diário registrado (conta no teto de 24 h), sessão regravada
  const CHAVE = 'k'.repeat(40); const sessao = path.join(dir, 'sessao.bin'); const diario = path.join(dir, 'diario.json');
  fs.writeFileSync(sessao, cifrarSessao({ 'creds.json': '{}' }, CHAVE)); fs.writeFileSync(diario, '[]');
  const enviados = [];
  const conectar = async () => ({ sock: () => ({ groupFetchAllParticipating: async () => ({ a: { id: 'g@g.us', subject: 'TCG Price Hunter | 01' } }), sendMessage: async (jid, m) => { enviados.push({ jid, m }); return { key: { id: 'M1' } }; } }), fechar: async () => {} });
  const { out, io: o } = io();
  const r = await main(['whatsapp', '--tipo', 'top3', '--dir', dir, '--sessao', sessao, '--diario', diario, '--titulo', 'TCG Price Hunter | 01'], { SOCIAL_ENABLED: '1', SOCIAL_WHATSAPP_CHAVE: CHAVE }, o,
    { conectar, esperar: async () => {}, now: () => Date.parse('2026-10-24T20:10:00Z') });
  assert.equal(r, 0, out.join());
  assert.equal(enviados[0].jid, 'g@g.us'); assert.equal(enviados[0].m.caption, l3); assert.ok(Buffer.isBuffer(enviados[0].m.image));
  assert.deepEqual(JSON.parse(fs.readFileSync(diario, 'utf8')).map((x) => x.ofertaId), ['top3:2026-10-24T20']);
}
{ // reserva: horário já enviado nos dois canais → "nao"; falta um → "sim"; Telegram com chave não repete
  const tg = path.join(dir, 'tg.json'); const wa = path.join(dir, 'wa.json');
  fs.writeFileSync(tg, JSON.stringify([{ ofertaId: 'top3:2026-10-24:19' }])); fs.writeFileSync(wa, JSON.stringify([{ ofertaId: 'top3:2026-10-24:19' }]));
  const p = async () => { const x = io(); await main(['pendente', '--tipo', 'top3', '--chave', '2026-10-24:19', '--tg', tg, '--wa', wa], {}, x.io); return x.out.join(); };
  assert.equal(await p(), 'nao');
  fs.writeFileSync(wa, '[]'); assert.equal(await p(), 'sim');
  const token = '123456:' + 'b'.repeat(30); let fotos = 0;
  const fetchFn = async (url) => { if (url.includes('/getChat')) return { ok: true, json: async () => ({ ok: true, result: { title: 'Grupo' } }) }; fotos++; return { ok: true, json: async () => ({ ok: true, result: { message_id: 9 } }) }; };
  const env = { SOCIAL_ENABLED: '1', SOCIAL_TELEGRAM_BOT_TOKEN: token, SOCIAL_TELEGRAM_CHAT_ID: '-100' };
  const d2 = path.join(dir, 'tg2.json');
  const a = ['telegram', '--tipo', 'top3', '--dir', dir, '--titulo', 'Grupo', '--chave', '2026-10-24:19', '--diario', d2];
  assert.equal(await main(a, env, io().io, { fetchFn }), 0); assert.equal(fotos, 1);
  assert.equal(await main(a, env, io().io, { fetchFn }), 0); assert.equal(fotos, 1, 'mesma chave: não envia de novo');
  assert.deepEqual(JSON.parse(fs.readFileSync(d2, 'utf8')).map((x) => x.ofertaId), ['top3:2026-10-24:19']);
  assert.throws(() => lerArgs(['pendente', '--tipo', 'top3', '--chave', 'X Y']), /chave/);
}
fs.rmSync(dir, { recursive: true, force: true });
console.log('✓ Top 3 / Top 10 do site: dados, legendas, arte e envios');
