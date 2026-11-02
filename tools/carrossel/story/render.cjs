// Renderiza achados.html em JPG 1080x1920. Uso: node render.cjs [saida.jpg]
const { chromium } = require('playwright'); const path = require('path');
(async () => { const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1080, height: 1920 } });
  await p.goto('file://' + path.join(__dirname, 'achados.html'), { waitUntil: 'load' }); await p.evaluate(() => document.fonts.ready.then(() => 1));
  await p.screenshot({ path: process.argv[2] || path.join(__dirname, 'achados.jpg'), type: 'jpeg', quality: 92 }); await b.close(); console.log('ok'); })();
