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

// url de vídeo renderizado (raw.githubusercontent.com)
{
  const { urlDeVideo, validarItem: vi } = await import('../src/agents/social/zernio.js');
  const assert = (await import('node:assert/strict')).default;
  const ok = 'https://raw.githubusercontent.com/TonyWatanabe-dev/pokemon-price-hunter/social/coleta-cartas/tmp-render/x.mp4';
  assert.equal(urlDeVideo(ok), ok);
  for (const ruim of ['http://raw.githubusercontent.com/a/b.mp4', 'https://evil.com/a.mp4', 'https://raw.githubusercontent.com/a/b.txt', 'lixo'])
    assert.throws(() => urlDeVideo(ruim));
  const base = { id: 'v', tipo: 'video', plataformas: ['instagram'], quando: '2026-10-18T18:00', legenda: 'oi' };
  assert.ok(!vi({ ...base, url: ok }).some((m) => /vídeo precisa|url do vídeo/.test(m)));
  assert.ok(vi({ ...base, url: 'https://evil.com/a.mp4' }).some((m) => /url do vídeo/.test(m)));
  console.log('ok social: url de vídeo');
}

{ // capa do TikTok: capaMs vira video_cover_timestamp_ms
  const v = { id: 't', quando: '2026-10-20T19:00', tipo: 'video', plataformas: ['tiktok'], arquivos: ['v.mp4'], legenda: 'oi' };
  const com = montarPost({ ...v, capaMs: 15000 }, { accountId: 'acc123456', plataforma: 'tiktok', urls: ['https://cdn/x/v.mp4'] });
  assert.equal(com.tiktokSettings.video_cover_timestamp_ms, 15000);
  const sem = montarPost(v, { accountId: 'acc123456', plataforma: 'tiktok', urls: ['https://cdn/x/v.mp4'] });
  assert.ok(!('video_cover_timestamp_ms' in sem.tiktokSettings));
  console.log('ok social: capa do TikTok');
}

{ // métricas: GET /analytics por rede, sem ids no resultado
  let pedido = '';
  const fake = async (u) => { pedido = String(u); return { ok: true, status: 200, json: async () => ({ posts: [{ _id: 'x', publishedAt: '2026-10-18T21:00:00Z', content: 'gastei R$ 766\nem pokémon', analytics: { views: 3, likes: 1, comments: 0, shares: 0 } }] }) }; };
  const cli = criarCliente({ chave: 'k'.repeat(20), fetch: fake });
  const [m] = await cli.metricas('perfil1', 'tiktok', '2026-09-19', '2026-10-19');
  assert.ok(/\/analytics\?/.test(pedido) && pedido.includes('platform=tiktok') && pedido.includes('fromDate=2026-09-19'));
  assert.deepEqual([m.views, m.curtidas, m.texto], [3, 1, 'gastei R$ 766 em pokémon']);
  assert.ok(!('id' in m) && !('_id' in m));
  await assert.rejects(() => cli.metricas('p', 'orkut'));
  console.log('ok social: métricas');
}
