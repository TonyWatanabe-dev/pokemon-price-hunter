// Pistas (src/tips.js): os links extraídos de HTML de exemplo nunca levam a tag de afiliado do site
// nem parâmetros/hosts de afiliado. Sem rede e sem banco.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parsePelando, parseTelegram } from '../src/tips.js';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const tag = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/afiliados/amazon.json'), 'utf8')).tag;
const t = (name, fn) => { try { fn(); } catch (e) { e.message = `${name}: ${e.message}`; throw e; } };
const AFIL_HOST = /(^|\.)(amzn\.to|meli\.la|s\.shopee\.com\.br|shope\.ee)$/i;

const pelando = `<a href="/d/booster-box-pokemon-abcd">Booster Box Pokémon</a> R$ 199,90
<a href="https://www.pelando.com.br/d/lata-pokemon-wxyz">Lata Pokémon</a> R$ 59,90`;
const tg = `<div class="tgme_widget_message_wrap"><div data-post="canal/10"><div class="tgme_widget_message_text">Blister Pokémon R$ 39,90
<a href="https://www.amazon.com.br/dp/B0TEST?tag=outrem-20">link</a></div><time datetime="2026-10-01T10:00:00+00:00"></time></div></div>`;

t('pelando: urls sem tag nem host de afiliado', () => {
  const r = parsePelando(pelando); assert.equal(r.length, 2);
  for (const x of r) { const u = new URL(x.url); assert.equal(u.hostname, 'www.pelando.com.br'); assert.ok(!u.search.includes('tag=')); }
});

t('telegram: link extraído é o do post, sem a tag do site', () => {
  const r = parseTelegram(tg, 'canal'); assert.equal(r.length, 1);
  for (const u of [r[0].url, r[0].postUrl]) {
    const x = new URL(u);
    assert.ok(!u.includes(`tag=${tag}`), 'tag do site presente');
    assert.ok(!AFIL_HOST.test(x.hostname), 'host de afiliado');
  }
});

t('telegram: tag do site nunca é injetada em links de loja', () => {
  const html = tg.replace('tag=outrem-20', 'th=1');
  const r = parseTelegram(html, 'canal');
  assert.ok(!r[0].url.includes(`tag=${tag}`));
});
console.log('tips-links-tests ok');
