// Redes sociais do TCG Price Hunter no site (pedido do dono, 17/10): rodapé de todas as páginas, página /comunidade
// e sameAs no JSON-LD da Organization. Os links são iguais no servidor e no site e abrem em nova aba com noopener.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { REDES } from '../api/_lib/grupos.mjs';

const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const html = read('index.html');
const lit = html.match(/^const REDES=(\{.*\});$/m);
assert.ok(lit, 'index.html: const REDES não encontrado');
assert.deepEqual(JSON.parse(lit[1]), { ...REDES }, 'index.html e api/_lib/grupos.mjs com os mesmos perfis');
assert.deepEqual(Object.keys(REDES), ['instagram', 'tiktok', 'youtube']);
assert.match(REDES.instagram, /^https:\/\/www\.instagram\.com\/tcgpricehunter151\/$/);
assert.match(REDES.tiktok, /^https:\/\/www\.tiktok\.com\/@tcgpricehunter$/);
assert.match(REDES.youtube, /^https:\/\/www\.youtube\.com\/channel\/UC[\w-]{22}$/);

// Links externos passam por safeUrl (test/outbound-links-tests.js), então o rodapé recebe os links pelo script.
assert.match(html.match(/<footer class="foot">[\s\S]*?<\/footer>/)[0], /<p class="foot-social" id="foot-social"><\/p>/, 'rodapé com o espaço das redes');
const rl = html.match(/^const redesLinks=.*$/m)?.[0] || '';
const ARROBA = { instagram: '@tcgpricehunter151', tiktok: '@tcgpricehunter', youtube: 'TCG Price Hunter' };
for (const k of Object.keys(REDES)) {
  assert.ok(rl.includes(`<a class="rede" href="\${esc(safeUrl(REDES.${k}))}" target="_blank" rel="noopener" data-rede="${k}">\${ic("${k}-logo")}<span>${ARROBA[k]}</span>`), `link ${k}: ícone + @, safeUrl e noopener`);
  assert.match(html, new RegExp(`<symbol id="i-${k}-logo" viewBox="0 0 256 256">`), `ícone ${k} no sprite`);
}
assert.match(html, /function footRedes\(\)\{[^\n]*redesLinks\(\)[^\n]*<a class="rede" href="\/comunidade" data-go="grupos">/, 'rodapé: redes + grupos');
assert.match(html, /async function load\(\)\{\n  footRedes\(\);/, 'rodapé preenchido no início, mesmo sem preços');
assert.match(html.match(/function renderGrupos\(\)\{[\s\S]*?\n\}/)[0], /Siga também[\s\S]*redesLinks\(\)/, '/comunidade lista as redes');
assert.match(html, /track\("social_click",\{rede:rl\.dataset\.rede\}\)/, 'clique em rede contado no Analytics');

const pg = read('api/pagina.mjs');
assert.match(pg, /sameAs: Object\.values\(REDES\)/, 'JSON-LD Organization com sameAs');
assert.match(pg, /extA\(REDES\.instagram, 'Instagram'\)/, 'página pré-renderizada /comunidade com as redes');
console.log('✓ Redes sociais: rodapé, /comunidade, Analytics e JSON-LD');
