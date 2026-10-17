// Agenda editorial: YouTube Shorts e capa de Reel (Zernio).
import assert from 'node:assert/strict';
import { validarItem, montarPost, criarCliente, PLATAFORMAS } from '../src/agents/social/zernio.js';

assert.ok(PLATAFORMAS.includes('youtube'));
const base = { id: 'yt-teste', quando: '2026-10-17T19:00', tipo: 'video', plataformas: ['youtube'], arquivos: ['v.mp4'], legenda: 'abrindo booster #pokemontcg' };
assert.ok(validarItem(base).includes('YouTube precisa de titulo'));
assert.ok(validarItem({ ...base, titulo: 'x'.repeat(101) }).some((p) => p.includes('100 caracteres')));
assert.ok(validarItem({ ...base, tipo: 'carrossel', titulo: 'ok', arquivos: ['a.jpg', 'b.jpg'] }).some((p) => p.includes('YouTube só recebe vídeo')));
const ok = { ...base, titulo: 'Abri 1 booster de 30 Anos e saiu carta de R$ 602', tags: ['pokemon tcg', 'pokemon 30 anos'] };
assert.deepEqual(validarItem(ok), []);

const yt = montarPost(ok, { accountId: 'acc123456', plataforma: 'youtube', urls: ['https://cdn/x/v.mp4'] });
assert.equal(yt.platforms[0].platform, 'youtube');
assert.equal(yt.platforms[0].platformSpecificData.title, ok.titulo);
assert.equal(yt.platforms[0].platformSpecificData.madeForKids, false);
assert.equal(yt.platforms[0].platformSpecificData.visibility, 'public');
assert.deepEqual(yt.tags, ok.tags);
assert.ok(!('tiktokSettings' in yt));

const ig = montarPost({ ...ok, plataformas: ['instagram'], capaMs: 12000 }, { accountId: 'acc123456', plataforma: 'instagram', urls: ['https://cdn/x/v.mp4'] });
assert.equal(ig.platforms[0].platformSpecificData.thumbOffset, 12000);
assert.ok(!('tags' in ig));

// contas: só rede e nome, nada de id ou token
const cli = criarCliente({ chave: 'zk_teste_1234567890abcdef', fetch: async () => ({ ok: true, status: 200, json: async () => ({ accounts: [{ _id: 'abc', platform: 'youtube', username: 'tcgpricehunter', accessToken: 'segredo' }] }) }) });
const cs = await cli.contas('perfil1');
assert.deepEqual(cs, [{ rede: 'youtube', usuario: 'tcgpricehunter', ativa: true }]);
console.log('social-youtube-tests: ok');
