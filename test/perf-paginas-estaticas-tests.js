// Lote F passo 3: páginas de texto (guia, glossário, termos, privacidade) entram pelo resumo da API, sem o state.json.
import assert from 'node:assert/strict';
import fs from 'node:fs';
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const m = html.match(/const API_VIEWS=new Set\((\[[^\]]*\])\)/);
const views = JSON.parse(m[1]);
for (const v of ['guia', 'glossario', 'termos', 'privacidade']) assert.ok(views.includes(v), v);
// os renderizadores dessas páginas não leem ofertas/fontes do estado completo
const corpo = (fn) => { const i = html.indexOf(`function ${fn}(`); const j = html.indexOf('\nfunction ', i + 10); return html.slice(i, j); };
for (const fn of ['renderGuide', 'renderGlossario', 'renderLegal']) assert.doesNotMatch(corpo(fn), /\bOFF\b|S\.(offers|sources|products|tips)\b/, fn);
console.log('perf-paginas-estaticas-tests ok');
