// Página /entrar (anúncios → grupo de ofertas): rota, build, convites iguais aos oficiais, CSP (sem script inline),
// sem urgência ou números inventados e medição de cliques por origem.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { GRUPOS } from '../api/_lib/grupos.mjs';

const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const html = read('entrar.html');
const js = read('assets/web/entrar-v4.js');

const vj = JSON.parse(read('vercel.json'));
assert.ok(vj.rewrites.some((r) => r.source === '/entrar' && r.destination === '/entrar.html'), '/entrar abre entrar.html');
assert.match(JSON.parse(read('package.json')).scripts.build, /\bentrar\.html\b/, 'build copia entrar.html para public/');

const links = [...html.matchAll(/href="(https:\/\/(?:chat\.whatsapp\.com|t\.me)\/[^"]+)"/g)].map((m) => m[1]);
assert.ok(links.length >= 3, 'botões do grupo presentes');
for (const l of links) assert.ok(Object.values(GRUPOS).includes(l), `convite ${l} igual ao de api/_lib/grupos.mjs`);
assert.ok(links.includes(GRUPOS.whatsapp) && links.includes(GRUPOS.telegram));
for (const m of html.matchAll(/<a [^>]*target="_blank"[^>]*>/g)) assert.match(m[0], /rel="noopener"/, 'links externos com noopener');

// CSP do site só aceita script do próprio domínio (sem inline); o JS da página é arquivo versionado.
assert.doesNotMatch(html.replace(/<script[^>]*\ssrc="[^"]+"[^>]*><\/script>/g, ''), /<script/i, 'sem script inline');
assert.match(html, /src="\/assets\/web\/entrar-v4\.js"/);
assert.match(html, /<meta name="robots" content="noindex, follow">/, 'página de anúncio fora do índice');

// Honestidade: nada de escassez ou contagem inventada; a prova vem da API e some se não houver dado.
assert.doesNotMatch(html + js, /vagas|ao vivo|últimas|esgota em|\d+\+ (membros|colecionadores)/i, 'sem urgência/contagem inventada');
assert.match(js, /\/api\/v1\/produtos\/' \+ id \+ '\/estatisticas/, 'preços vêm da API do site');
assert.match(js, /alto < baixo \* 1\.15\) return null/, 'só mostra diferença relevante');
assert.match(js, /getElementById\('prova'\)\.hidden = false/, 'seção de prova só aparece com dados');
assert.match(html, /<section id="prova" hidden>/);

// Medição: visita e clique por canal, posição e origem (utm).
assert.match(js, /track\('entrar_view'/);
assert.match(js, /track\('group_click', \{ canal: a\.dataset\.canal, origem: 'entrar:' \+ origem/);
for (const pos of ['topo', 'fim', 'fixa']) assert.match(html, new RegExp(`data-pos="${pos}"`));
console.log('✓ Página /entrar: rota, convites, CSP, honestidade e medição');
// Ícone do WhatsApp único (symbol) reutilizado em todos os botões; imagem do topo versionada.
assert.match(html, /<symbol id="wa"/);
assert.equal((html.match(/<use href="#wa"\/>/g) || []).length, 3, 'mesmo ícone nos 3 botões do WhatsApp');
assert.ok(fs.existsSync(new URL('../assets/web/entrar-cartas-v1.webp', import.meta.url)));
// 23/10: botão antes da imagem (aparece sem rolar no celular), Telegram no topo e ofertas de hoje vindas da API.
assert.ok(html.indexOf('id="cta1"') < html.indexOf('class="hero"'), 'botão do topo vem antes da imagem');
assert.match(html, /data-canal="telegram" data-pos="topo"/, 'Telegram também no topo');
assert.match(html, /<section id="hoje" class="hoje" hidden>/, 'ofertas de hoje começam ocultas');
assert.match(js, /\/api\/v1\/oportunidades\?limite=6&ordem=score/, 'ofertas de hoje vêm da API');
assert.match(js, /getElementById\('hoje'\)\.hidden = false/);
console.log('✓ Página /entrar: botão no topo, Telegram e ofertas de hoje');
