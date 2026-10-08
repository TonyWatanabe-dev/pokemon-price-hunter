// Paridade visual da FASE 4: cada página pela API × pelo state.json (?fonte=state), desktop e celular.
// Uso: node tools/page-parity.mjs http://localhost:8791 <pasta-de-saída>   (servidor: tools/local-server.mjs)
// FASE 4: cada página migrada pela API × a mesma página pelo state.json (?fonte=state). Desktop e celular.
import { createRequire } from 'node:module'; const { chromium } = createRequire(process.env.PW_ROOT || (process.cwd() + '/x.js'))('playwright-core');   // PW_ROOT: pasta com playwright-core
const base = process.argv[2]; const out = process.argv[3];
const b = await chromium.launch({ executablePath: process.env.CHROMIUM || undefined });
const R = { pages: {}, mobile: {} };
async function open(path, q, vp = { width: 1280, height: 900 }) {
  const ctx = await b.newContext({ viewport: vp }); const pg = await ctx.newPage();
  const errs = []; pg.on('pageerror', (e) => errs.push(e.message));
  const bytes = {}; pg.on('response', async (r) => { const u = new URL(r.url()); if (u.pathname.startsWith('/api/') || u.pathname.startsWith('/data/')) { try { const k = u.pathname + (u.pathname.startsWith('/api/v1/site') ? u.search.replace(/&?fonte=state/, '') : ''); bytes[k] = (bytes[k] || 0) + (await r.body()).length; } catch {} } });
  await pg.route('**/raw.githubusercontent.com/**', (r) => r.abort());
  await pg.route('**/*.{png,jpg,jpeg,webp,gif}', (r) => (new URL(r.request().url()).host.includes('localhost') ? r.continue() : r.abort()));
  const sep = path.includes('?') ? '&' : '?';
  await pg.goto(base + path + (q ? sep + q : ''), { waitUntil: 'networkidle' });
  await pg.waitForFunction(() => !document.querySelector('#view .skel'), null, { timeout: 15000 }).catch(() => {});
  await pg.waitForTimeout(300);
  return { pg, ctx, errs, bytes };
}
const txt = (pg, sel) => pg.evaluate((s) => [...document.querySelectorAll(s)].map((e) => e.innerText.replace(/\s+/g, ' ').trim()), sel);
async function scrollAll(pg) { for (let i = 0; i < 12; i++) { await pg.evaluate(() => scrollTo(0, document.body.scrollHeight)); await pg.waitForTimeout(250); } await pg.waitForLoadState('networkidle'); }
async function compare(name, path, { sel, act } = {}) {
  const A = await open(path, ''); const B = await open(path, 'fonte=state');
  for (const X of [A, B]) { if (act) await act(X.pg); await scrollAll(X.pg); }
  const sels = sel || ['h1', '.opp-head p', '.prods > .deals .deal', '.filters select option:checked', '.fchip', 'details.more summary'];
  const res = { bytes: { api: A.bytes, state: B.bytes }, errors: { api: A.errs, state: B.errs }, sections: {} };
  for (const s of sels) { const a = await txt(A.pg, s), c = await txt(B.pg, s); res.sections[s] = { same: JSON.stringify(a) === JSON.stringify(c), n: a.length, ...(JSON.stringify(a) !== JSON.stringify(c) ? { diff: a.map((x, i) => (x !== c[i] ? { i, api: x, state: c[i] } : null)).filter(Boolean).slice(0, 4), nState: c.length } : {}) }; }
  res.slim = await A.pg.evaluate(() => !!(typeof S !== 'undefined' && S && S.slim));
  await A.pg.screenshot({ path: `${out}/p4-${name}.png`, fullPage: false });
  R.pages[name] = res; await A.ctx.close(); await B.ctx.close();
}
// slugs
const probe = await open('/', ''); const slugs = await probe.pg.evaluate(() => ({ top: SLUG['me04-blister4'], ml: SLUG['sv1-booster'] || null, col: (S.collections || []).map((c) => c.name) }));
await probe.ctx.close();
const pick = async (pg, sel, v) => { await pg.selectOption(sel, v).catch(() => {}); await pg.waitForTimeout(400); await pg.waitForLoadState('networkidle'); };
await compare('produtos-padrao', '/produtos');
await compare('produtos-etb', '/produtos', { act: async (pg) => { await pg.click('.fchip[data-g="ETB"]'); await pg.waitForTimeout(400); await pg.waitForLoadState('networkidle'); } });
await compare('produtos-abrir', '/produtos', { act: async (pg) => { await pg.click('#seg button[data-v="abrir"]'); await pg.waitForTimeout(400); await pg.waitForLoadState('networkidle'); } });
await compare('produtos-loja-preco', '/produtos', { act: async (pg) => { await pg.evaluate(() => { document.querySelector('#xf').open = true; }); await pick(pg, '#f-store', 'mercadolivre'); await pg.fill('#f-max', '300'); await pg.dispatchEvent('#f-max', 'change'); await pg.waitForTimeout(500); await pg.waitForLoadState('networkidle'); } });
await compare('produtos-semref', '/produtos', { sel: ['details.more .deal'], act: async (pg) => { await pg.evaluate(() => { const d = document.querySelector('details.more'); if (d) d.open = true; }); await pg.waitForTimeout(800); await pg.waitForLoadState('networkidle'); } });
const PSEL = ['h1', '.pp-type', '.card.buy', '.msum dt', '.cmp4', '.solist .so, .solist > *', '.pp-meta', '.crumbs'];
await compare('produto-top', `/produto/${slugs.top}`, { sel: PSEL });
await compare('produto-ml', `/produto/${slugs.ml}`, { sel: PSEL });
await compare('produto-inexistente', '/produto/nao-existe-xyz', { sel: ['h3', 'h1'] });
await compare('colecao', '/colecao/caos-ascendente', { sel: ['h1', '.opp-head p', '.deal', '.grpnav a, .gnav a'] });
await compare('tipo', '/tipo/treinador-avancado-etb', { sel: ['h1', '.opp-head p', '.deal'] });
await compare('busca', '/', { sel: ['.page-title h2', '.deal', '.qchip', '.tipgrid > *'], act: async (pg) => { await pg.fill('#tq', 'etb'); await pg.press('#tq', 'Enter'); await pg.waitForTimeout(800); await pg.waitForLoadState('networkidle'); } });
// produto: histórico do gráfico (API = Price Engine; state = arquivo hist/)
{ const A = await open(`/produto/${slugs.top}`, ''); await A.pg.waitForTimeout(1200); R.hist = { api: await txt(A.pg, '#hist .hstats, #hist .hnote'), fetched: Object.keys(A.bytes) }; await A.ctx.close(); }
// celular
for (const [name, path] of [['produtos', '/produtos'], ['produto', `/produto/${slugs.top}`], ['colecao', '/colecao/caos-ascendente']]) {
  const M = await open(path, '', { width: 390, height: 844 });
  R.mobile[name] = { overflowX: await M.pg.evaluate(() => document.documentElement.scrollWidth - innerWidth), cards: (await txt(M.pg, '.deal, .solist > *')).length, errors: M.errs };
  await M.pg.screenshot({ path: `${out}/p4-mobile-${name}.png` }); await M.ctx.close();
}
console.log(JSON.stringify(R)); await b.close();
