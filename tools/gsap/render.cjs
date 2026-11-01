// Renderiza a timeline GSAP de hit.html quadro a quadro (1080x1920, fundo transparente) em PNGs.
// Uso: node render.js <config.json> <pasta-saida> [fps=30] [prévia: t1,t2,...]
const { chromium } = require('playwright');
const fs = require('fs'), path = require('path');
const [cfgArq, out, fpsArg, so] = process.argv.slice(2);
const cfg = JSON.parse(fs.readFileSync(cfgArq, 'utf8')); const fps = Number(fpsArg || 30);
fs.mkdirSync(out, { recursive: true });
(async () => {
  const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1080, height: 1920 } });
  p.on('pageerror', (e) => console.error('erro na página:', e.message));
  await p.addInitScript((c) => { window.CFG = c; }, cfg);
  await p.goto('file://' + path.join(__dirname, 'hit.html'), { waitUntil: 'domcontentloaded' });
  await p.evaluate(() => document.fonts.ready.then(() => document.fonts.size));
  const tempos = so ? so.split(',').map(Number) : Array.from({ length: Math.round(cfg.dur * fps) }, (_, i) => i / fps);
  for (const [i, t] of tempos.entries()) {
    await p.evaluate((t) => { window.tl.seek(t, false); return 1; }, t);
    await p.screenshot({ path: `${out}/${so ? 'p_' + t : String(i).padStart(5, '0')}.png`, omitBackground: true });
  }
  await b.close(); console.log('quadros', tempos.length);
})();
