// D4 — teste de navegador (Playwright) do fallback de dados do site. Fora do npm test (pesado: abre o Chromium).
// Uso: node test/d4-fallback-browser.mjs            (index.html desta pasta)
//      D4_INDEX=/caminho/index.html node test/d4-fallback-browser.mjs   (ex.: o index.html da main, para ver falhar)
// Serve localmente os handlers reais (api/pagina.mjs para o SSR, api/v1.mjs com o state.json injetado) e intercepta no
// navegador o raw.githubusercontent (ramos data e main) e o /data/state.json do deploy. Nenhuma rede real.
// Base: a cópia congelada de verdade (data/state.json da main, 07/10). "Fresca" = a mesma, com horário de agora e a oferta
// de R$ 388,00 do me05-etb trocada por R$ 111,11 (marcador). Cada cenário roda em processo próprio (o cache do _seo é de
// 10 min por processo), nas larguras 390 e 1280.
import http from 'node:http'; import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url'; import { spawnSync } from 'node:child_process';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const INDEX = process.env.D4_INDEX || path.join(ROOT, 'index.html');
const PID = 'me05-etb'; const OLD = 'R$ 388,00'; const NEW = 'R$ 111,11';
const CENAS = {
  // nome: { api: 'ok'|'503', raw: dado do ramo data, main: raw da main, dep: /data/ do deploy, ssr: state do SSR, espera }
  'api-ok-recente': { api: 'ok', raw: 'fresh', main: 'frozen', dep: 'frozen', ssr: 'fresh', espera: 'novo' },
  'api-fora-raw-ok': { api: '503', raw: 'fresh', main: 'frozen', dep: 'frozen', ssr: 'fresh', espera: 'novo' },
  'api-e-raw-fora': { api: '503', raw: 404, main: 'frozen', dep: 'frozen', ssr: 'fresh', espera: 'erro', home: true },
  'snapshot-antigo': { api: '503', raw: 'old3d', main: 'frozen', dep: 'frozen', ssr: 'old3d', espera: 'erro' },
  'snapshot-recente': { api: '503', raw: 'rede', main: 404, dep: 'fresh', ssr: 'fresh', espera: 'novo' },
  'snapshot-2h': { api: '503', raw: 'h2', main: 'frozen', dep: 'frozen', ssr: 'h2', espera: 'novo' },
  'snapshot-ausente-invalido': { api: '503', raw: 'lixo', main: 404, dep: 'semofertas', ssr: 'fresh', espera: 'erro' },
  'fonte-volta': { api: '503', raw: 503, main: 'frozen', dep: 'frozen', ssr: 'fresh', espera: 'erro', volta: true },
  'parcial-sem-horario': { api: '503', raw: 'semhorario', main: 'frozen', dep: 'frozen', ssr: 'fresh', espera: 'erro' },
  'ssr-recente-api-fora': { api: '503', raw: 404, main: 'frozen', dep: 'frozen', ssr: 'fresh', espera: 'erro', ssrTem: NEW },
  'ssr-velho-api-ok': { api: 'ok', raw: 'old3d', main: 'frozen', dep: 'frozen', ssr: 'old3d', espera: 'novo', ssrSem: true },
};

function fixtures() {
  const frozen = JSON.parse(fs.readFileSync(path.join(ROOT, 'data', 'state.json'), 'utf8'));
  const at = (min) => new Date(Date.now() - min * 6e4).toISOString();
  const shift = (min, over = {}) => { const s = structuredClone(frozen); const t = at(min);
    s.generatedAt = t; s.dataAt = t; for (const o of s.offers) { o.source_timestamp = t; o.lastSeen = t; }
    for (const o of s.offers) if (o.productId === PID && o.total === 388) { o.price = 111.11; o.total = 111.11; }
    const s2 = JSON.parse(JSON.stringify(s).replace(/:388(\.0+)?(?=[,}\]])/g, ':377.77'));   // outros 388 (me03, me02, histórico): o marcador antigo só vem da cópia de 07/10
    return Object.assign(s2, over); };
  const semofertas = shift(5); delete semofertas.offers;
  return { frozen, fresh: shift(5), h2: shift(120), old3d: shift(3 * 1440), semhorario: shift(5, { dataAt: null }), semofertas };
}

async function cena(nome) {
  const C = CENAS[nome]; const F = fixtures();
  const body = (k) => (typeof k === 'string' && F[k] ? JSON.stringify(F[k]) : null);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'd4-')); fs.copyFileSync(INDEX, path.join(dir, 'index.html')); process.chdir(dir);
  const href = (rel) => pathToFileURL(path.join(ROOT, rel)).href;
  const realFetch = globalThis.fetch;
  globalThis.fetch = async (u, o) => { const s = String(u); if (/^http:\/\/(localhost|127\.0\.0\.1)/.test(s)) return realFetch(u, o);
    if (/raw\.githubusercontent\.com\/.+\/data\/data\/state\.json/.test(s)) return new Response(body(C.ssr), { status: 200, headers: { 'content-type': 'application/json' } });
    throw new Error('rede bloqueada: ' + s); };
  delete process.env.DATABASE_URL; delete process.env.API_DATABASE_URL;
  const { setLegacyLoader } = await import(href('api/_lib/legacy.mjs'));
  setLegacyLoader(async () => JSON.parse(body(C.ssr === 'old3d' && C.api === 'ok' ? 'fresh' : C.ssr)));
  const { default: pagina } = await import(href('api/pagina.mjs'));
  const v1mod = await import(href('api/v1.mjs'));
  const { slim } = await import(href('api/_lib/slim.mjs')); const { slugs } = await import(href('api/_seo.mjs'));
  const sl = slim(fs.readFileSync('index.html', 'utf8')); const files = Object.fromEntries(sl.arquivos.map((a) => ['/assets/web/' + a.nome, a]));
  const slug = slugs(F.frozen.products).of[PID];
  const srv = http.createServer(async (req, res) => {
    const p = new URL(req.url, 'http://x').pathname;
    try {
      if (files[p]) { res.setHeader('content-type', files[p].tipo); return res.end(files[p].conteudo); }
      if (p.startsWith('/api/v1/')) {
        if (C.api !== 'ok' && !p.endsWith('/afiliados')) { res.statusCode = 503; res.setHeader('content-type', 'application/json'); return res.end('{"error":"dados indisponíveis no momento"}'); }
        v1mod._cache.clear(); return v1mod.default({ url: req.url, method: 'GET', headers: {} }, res);
      }
      if (p === '/data/state.json') { const b = body(C.dep); res.statusCode = b ? 200 : (typeof C.dep === 'number' ? C.dep : 404); return res.end(b || '{}'); }
      if (p.startsWith('/api/') || p.startsWith('/data/') || /\.(png|svg|jpg|webp|ico|json)$/.test(p)) { res.statusCode = 404; return res.end(''); }
      const m = p.match(/^\/produto\/(.+)$/);
      req.url = '/api/pagina?' + (m ? `t=produto&slug=${m[1]}` : 't=home'); req.headers = { host: 'tcgpricehunter.com.br' }; return pagina(req, res);
    } catch (e) { res.statusCode = 500; res.end(String(e?.stack || e)); }
  });
  await new Promise((ok) => srv.listen(0, ok)); const base = `http://localhost:${srv.address().port}`;
  const out = []; const falha = (vp, msg) => out.push(`${nome} @${vp}: ${msg}`);
  // SSR × API: o HTML do servidor (antes do JS) — tem o preço novo ou nenhum preço
  const ssrHtml = await (await realFetch(`${base}/produto/${slug}`)).text();
  if (C.ssrTem && !ssrHtml.includes(C.ssrTem)) falha('ssr', `SSR sem ${C.ssrTem}`);
  if (C.ssrSem && /R\$ \d/.test((ssrHtml.match(/<div id="view">([\s\S]*?)<\/main>/) || [, ''])[1])) falha('ssr', 'SSR velho com preço no HTML');
  const { chromium } = (await import('/opt/npm-tools/node_modules/playwright/index.js')).default;
  const br = await chromium.launch();
  for (const w of [390, 1280]) {
    const ctx = await br.newContext({ viewport: { width: w, height: w < 600 ? 844 : 900 } }); const pg = await ctx.newPage();
    let raw = C.raw; const pedidos = [];
    await pg.route(/raw\.githubusercontent\.com/, (r) => { const u = r.request().url(); const ramo = /\/main\/data\//.test(u) ? C.main : raw; pedidos.push(u.replace(/^.*\.com\/[^/]+\/[^/]+\//, 'raw:'));
      if (ramo === 'rede') return r.abort(); if (ramo === 'lixo') return r.fulfill({ status: 200, contentType: 'application/json', body: '{"products":[' });
      const b = body(ramo); return b ? r.fulfill({ status: 200, contentType: 'application/json', body: b }) : r.fulfill({ status: typeof ramo === 'number' ? ramo : 404, body: '' }); });
    await pg.route(/^https?:\/\/(?!localhost)/, (r) => (/raw\.githubusercontent/.test(r.request().url()) ? r.fallback() : r.fulfill({ status: 204, body: '' })));
    const espera = async () => { await pg.waitForFunction(() => !document.querySelector('#view .ssr') && (document.querySelector('.err-state') || document.querySelector('.buy')), null, { timeout: 15000 }).catch(() => {});
      return pg.evaluate(() => ({ view: (document.querySelector('#view')?.innerText || '').replace(/\u00a0/g, ' '), erro: !!document.querySelector('.err-state'), mini: document.querySelector('#mini-t')?.innerText || '' })); };
    const confere = (r, quer, etapa) => {
      if (quer === 'novo') { if (!r.view.includes(NEW)) falha(w, `${etapa}: esperava ${NEW} (dado atual); view="${r.view.replace(/\s+/g, ' ').slice(0, 120)}"`); if (r.erro) falha(w, `${etapa}: estado de erro com fonte válida`); }
      else { if (!r.erro) falha(w, `${etapa}: esperava o estado de erro`); }
      if (process.env.D4_VERBOSE) console.error(etapa, w, r.view.split('\n').filter((l) => l.includes(OLD)).join(' | '));
      if (r.view.includes(OLD)) falha(w, `${etapa}: mostrou ${OLD} da cópia congelada de 07/10${/Ao vivo/.test(r.mini) ? ' sob "Ao vivo"' : ''}`);
      if (quer === 'erro' && /com estoque/i.test(r.view)) falha(w, `${etapa}: "com estoque" sem fonte válida`);
    };
    await pg.goto(`${base}/produto/${slug}`, { waitUntil: 'load' }); confere(await espera(), C.espera, 'produto');
    if (C.home) { await pg.goto(`${base}/`, { waitUntil: 'load' }); confere(await espera(), 'erro', 'home'); }
    if (C.volta) { raw = 'fresh';   // a fonte principal volta; a tela de erro do passo anterior continua aberta
      if (await pg.$('#retry')) await pg.click('#retry'); else falha(w, 'volta: sem botão "Tentar de novo"'); await pg.waitForFunction((n) => (document.querySelector('#view')?.innerText || '').replace(/\u00a0/g, ' ').includes(n), NEW, { timeout: 15000 }).catch(() => {}); confere(await espera(), 'novo', 'depois de "Tentar de novo"'); }
    if (process.env.D4_SHOTS) await pg.screenshot({ path: path.join(process.env.D4_SHOTS, `${nome}-${w}.png`) });
    if (process.env.D4_VERBOSE) console.error(nome, w, pedidos.join(' '));
    await ctx.close();
  }
  await br.close(); srv.close(); globalThis.fetch = realFetch; fs.rmSync(dir, { recursive: true, force: true });
  process.stdout.write(JSON.stringify({ nome, falhas: out }) + '\n'); process.exit(0);
}

const arg = process.argv.find((a) => a.startsWith('--cena='));
if (arg) await cena(arg.slice(7));
else {
  let ruins = 0;
  for (const nome of Object.keys(CENAS)) {
    const r = spawnSync(process.execPath, [fileURLToPath(import.meta.url), `--cena=${nome}`], { encoding: 'utf8', env: process.env, timeout: 180000, maxBuffer: 1 << 24 });
    let res; try { res = JSON.parse(r.stdout.trim().split('\n').pop()); } catch { res = { nome, falhas: [`não rodou (exit ${r.status}): ${(r.stderr || '').slice(-300)}`] }; }
    console.log(`${res.falhas.length ? 'FALHA' : 'ok   '} ${nome}${res.falhas.length ? '\n  - ' + res.falhas.join('\n  - ') : ''}`);
    ruins += res.falhas.length ? 1 : 0;
  }
  console.log(`d4-fallback-browser: ${Object.keys(CENAS).length - ruins}/${Object.keys(CENAS).length} cenários ok (${path.relative(ROOT, INDEX) || INDEX})`);
  process.exit(ruins ? 1 : 0);
}
