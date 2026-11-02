// Renderiza achados_video.html (timeline GSAP pausada) quadro a quadro, 30 fps. Uso: node render_video.cjs <pasta_quadros> <segundos>
const { chromium } = require('playwright'); const path = require('path'); const fs = require('fs');
const dir = process.argv[2], dur = +process.argv[3] || 11; fs.mkdirSync(dir, { recursive: true });
(async () => { const b = await chromium.launch(); const p = await b.newPage({ viewport: { width: 1080, height: 1920 } });
  await p.goto('file://' + path.join(__dirname, 'achados_video.html'), { waitUntil: 'domcontentloaded' }); await p.waitForTimeout(1000); console.log('carregou', await p.evaluate(() => typeof window.seek));
  for (let i = 0; i < dur * 30; i++) { await p.evaluate((t) => window.seek(t), i / 30); await p.screenshot({ path: path.join(dir, String(i).padStart(4, '0') + '.jpg'), type: 'jpeg', quality: 90 }); }
  await b.close(); console.log('ok'); })();
