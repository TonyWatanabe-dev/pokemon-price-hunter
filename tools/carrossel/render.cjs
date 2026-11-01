// Renderiza as lâminas de laminas.json em JPG 1080x1350 (out/<carrossel>_<n>.jpg). Uso: node render.cjs [C1 C2 ...]
const { chromium } = require('playwright'); const fs = require('fs'), path = require('path');
const L = JSON.parse(fs.readFileSync(path.join(__dirname, 'laminas.json'), 'utf8')); const quais = process.argv.slice(2).length ? process.argv.slice(2) : Object.keys(L);
fs.mkdirSync(path.join(__dirname, 'out'), { recursive: true });
(async () => {
  const b = await chromium.launch();
  for (const c of quais) for (const [i, lam] of L[c].entries()) {
    const p = await b.newPage({ viewport: { width: 1080, height: 1350 } }); p.on('pageerror', (e) => console.error(c, i, e.message));
    await p.addInitScript((x) => { window.LAM = x; }, lam);
    await p.goto('file://' + path.join(__dirname, 'lamina.html'), { waitUntil: 'load' });
    await p.evaluate(() => document.fonts.ready.then(() => 1));
    await p.screenshot({ path: path.join(__dirname, 'out', `${c}_${i + 1}.jpg`), type: 'jpeg', quality: 92 }); await p.close();
  }
  await b.close(); console.log('ok', quais.join(' '));
})();
