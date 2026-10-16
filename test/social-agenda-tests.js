// Agenda editorial (Zernio): validação dos itens, corpo do POST e a agenda da semana 1 coerente com os arquivos.
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { validarItem, montarPost, criarCliente, FUSO } from '../src/agents/social/zernio.js';

const ag = JSON.parse(readFileSync('config/social/agenda/semana1.json', 'utf8'));
for (const sem of ['semana1', 'semana2']) {
  const g = JSON.parse(readFileSync(`config/social/agenda/${sem}.json`, 'utf8'));
  for (const it of g.itens) {
    assert.deepEqual(validarItem(it), [], `${it.id}: ${validarItem(it).join('; ')}`);
    for (const a of it.arquivos ?? []) assert.ok(existsSync(join(g.pasta, a)), `${it.id}: falta ${a}`);
    if (it.legenda && !it.plataformas.includes('tiktok')) assert.match(it.legenda, /grupo do WhatsApp/, `${it.id}: CTA do Zap`);
  }
}
for (const it of ag.itens) {
  assert.deepEqual(validarItem(it), [], `${it.id}: ${validarItem(it).join('; ')}`);
  for (const a of it.arquivos ?? []) assert.ok(existsSync(join(ag.pasta, a)), `${it.id}: falta ${a}`);
}
assert.equal(new Set(ag.itens.map((i) => i.id)).size, ag.itens.length, 'ids únicos');

assert.ok(validarItem({ id: 'x-tik', tipo: 'carrossel', quando: '2026-10-19T12:00', plataformas: ['tiktok'], arquivos: ['a.jpg', 'b.jpg'], legenda: 'oi' }).includes('TikTok só recebe vídeo nesta agenda'));
assert.ok(validarItem({ id: 'x-url', tipo: 'imagem', quando: '2026-10-19T12:00', plataformas: ['instagram'], arquivos: ['a.jpg'], legenda: 'veja https://x.com' }).some((p) => p.includes('URL')));

const car = ag.itens.find((i) => i.tipo === 'carrossel');
const corpo = montarPost(car, { accountId: 'acc123456', plataforma: 'instagram', urls: ['https://cdn/x/1.jpg', 'https://cdn/x/2.jpg'], simular: true });
assert.equal(corpo.timezone, FUSO);
assert.equal(corpo.scheduledFor, `${car.quando}:00`);
assert.equal(corpo.dryRun, true);
assert.equal(corpo.mediaItems[0].type, 'image');
assert.ok(!('publishNow' in corpo), 'agendado, não publica na hora');
const st = montarPost(ag.itens.find((i) => i.tipo === 'story'), { accountId: 'acc123456', plataforma: 'instagram', urls: ['https://cdn/x/s.jpg'] });
assert.equal(st.platforms[0].platformSpecificData.contentType, 'story');
const vid = { ...ag.itens.find((i) => i.tipo === 'video'), arquivos: ['v.mp4'] };
const tk = montarPost(vid, { accountId: 'acc123456', plataforma: 'tiktok', urls: ['https://cdn/x/v.mp4'] });
assert.equal(tk.tiktokSettings.video_made_with_ai, false);
assert.equal(tk.mediaItems[0].type, 'video');

// cliente: a chave nunca aparece em erro
const chave = 'zk_teste_1234567890abcdef';
const cli = criarCliente({ chave, fetch: async () => ({ ok: false, status: 401, json: async () => ({ message: `bad key ${chave}` }) }) });
await assert.rejects(cli.conta('instagram', 'p'), (e) => !e.message.includes(chave));
assert.throws(() => criarCliente({ chave: 'curta', fetch }), /chave/);
console.log('social-agenda-tests: ok');
