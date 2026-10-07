// Diagnóstico: baixa páginas de produto (respeitando robots.txt) para inspecionar o HTML bruto.
import { mkdirSync, writeFileSync } from 'node:fs';
import { get } from '../src/http.js';
import { guard } from '../src/adapters/common.js';
const out = process.argv[2] || 'dump'; mkdirSync(out, { recursive: true });
const urls = (process.env.DUMP_URLS || '').split(/\s+/).filter(Boolean);
let i = 0;
for (const u of urls) {
  i++;
  try { await guard(u); const r = await get(u); writeFileSync(`${out}/${String(i).padStart(2, '0')}.html`, `<!-- ${u} -> ${r.url} -->\n` + r.text); console.log('ok', u); }
  catch (e) { console.log('falhou', u, e.message); }
}
