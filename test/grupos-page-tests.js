// Grupos de ofertas: convites iguais no servidor e no site, página /comunidade (as rotas /grupos, /grupo e /zap
// seguem indo direto ao WhatsApp: são o link da bio), links com safeUrl + noopener, botão/barra; sem etiqueta de afiliado (aviso geral no rodapé).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { GRUPOS } from '../api/_lib/grupos.mjs';

const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const html = read('index.html');
const lit = html.match(/^const GRUPOS=(\{.*\});$/m);
assert.ok(lit, 'index.html: const GRUPOS não encontrado');
assert.deepEqual(JSON.parse(lit[1]), { ...GRUPOS }, 'index.html e api/_lib/grupos.mjs com os mesmos convites');
assert.match(GRUPOS.whatsapp, /^https:\/\/chat\.whatsapp\.com\/[A-Za-z0-9]+$/);
assert.match(GRUPOS.telegram, /^https:\/\/t\.me\/\+[A-Za-z0-9_-]+$/);

const vj = JSON.parse(read('vercel.json'));
assert.ok(vj.rewrites.some((r) => r.source === '/comunidade' && r.destination === '/api/pagina?t=grupos'), '/comunidade abre a página');
for (const s of ['/grupos', '/grupo', '/zap']) assert.equal(vj.redirects.find((r) => r.source === s)?.destination, GRUPOS.whatsapp, `${s} (link da bio) segue indo direto ao WhatsApp`);

assert.match(html, /comunidade:"grupos"/, 'rota /comunidade no site');
assert.match(html, /grupos:"comunidade"/, 'caminho da view grupos');
assert.match(html, /data-go="grupos" href="\/comunidade"/, 'item Grupos no menu');
assert.match(html, /function renderGrupos\(\)/);
assert.match(html, /function grpUI\(\)/, 'botão flutuante e barra do celular');
for (const k of ['whatsapp', 'telegram']) assert.ok(html.includes(`href="\${esc(safeUrl(GRUPOS.${k}))}" target="_blank" rel="noopener"`), `link ${k} com safeUrl e noopener`);
assert.doesNotMatch(html.match(/function renderGrupos\(\)\{[\s\S]*?\n\}/)[0], /afiliad/i, 'regra 17/10: sem etiqueta de afiliado na página (aviso geral fica no rodapé)');
assert.match(read('api/pagina.mjs'), /grupos: \['\/comunidade'/, 'página pré-renderizada com título e descrição');
assert.match(read('api/sitemap.mjs'), /\['comunidade', 'monthly'/, '/comunidade no sitemap');
console.log('✓ Grupos de ofertas: convites, rota, menu, botão e página');
