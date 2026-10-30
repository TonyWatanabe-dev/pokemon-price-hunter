// Capa própria dos vídeos (30/10/2026): YouTube em mediaItems[].thumbnail, Instagram em instagramThumbnail, TikTok só o quadro.
import assert from 'node:assert/strict';
import { validarItem, montarPost, urlDeCapa } from '../src/agents/social/zernio.js';

const capa = 'https://raw.githubusercontent.com/o/r/b/tmp-render/M_x_thumb.jpg';
assert.equal(urlDeCapa(capa), capa);
assert.throws(() => urlDeCapa('https://exemplo.com/c.jpg'));
assert.throws(() => urlDeCapa('https://raw.githubusercontent.com/o/r/b/c.gif'));
const it = { id: 'capa-teste', quando: '2026-11-01T12:00', tipo: 'video', plataformas: ['youtube'], url: 'https://raw.githubusercontent.com/o/r/b/v.mp4', titulo: 'Abri | Opened', legenda: 'abrindo booster', capa, capaMs: 9000 };
assert.deepEqual(validarItem(it), []);
assert.ok(validarItem({ ...it, capa: 'http://x/y.jpg' }).length);
const urls = ['https://cdn/x/v.mp4'], capaUrl = 'https://cdn/x/c.jpg';
const yt = montarPost(it, { accountId: 'acc123456', plataforma: 'youtube', urls, capaUrl });
assert.equal(yt.mediaItems[0].thumbnail, capaUrl); assert.ok(!('instagramThumbnail' in yt.mediaItems[0]));
const ig = montarPost({ ...it, plataformas: ['instagram'] }, { accountId: 'acc123456', plataforma: 'instagram', urls, capaUrl });
assert.equal(ig.mediaItems[0].instagramThumbnail, capaUrl); assert.ok(!('thumbnail' in ig.mediaItems[0]));
const tt = montarPost({ ...it, plataformas: ['tiktok'] }, { accountId: 'acc123456', plataforma: 'tiktok', urls, capaUrl });
assert.ok(!('thumbnail' in tt.mediaItems[0]) && !('instagramThumbnail' in tt.mediaItems[0]));
assert.equal(tt.tiktokSettings.video_cover_timestamp_ms, 9000);
const sem = montarPost(it, { accountId: 'acc123456', plataforma: 'youtube', urls });
assert.ok(!('thumbnail' in sem.mediaItems[0]));
console.log('social-capa-tests: ok');
