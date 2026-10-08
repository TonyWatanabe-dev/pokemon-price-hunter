// Servidor local para testes de navegador: página (index.html) + /api/v1 (banco em API_DATABASE_URL) + /data/state.json.
// Uso: API_DATABASE_URL=... node tools/local-server.mjs <pasta-com-index-e-data> <raiz-do-repo> <porta>
// Servidor local: página + /api/v1 (banco local) + /data/state.json; cabeçalhos (CSP) do vercel.json.
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
const [root, repo, port] = process.argv.slice(2);
const cfg = JSON.parse(fs.readFileSync(repo + '/vercel.json')); const hdr = Object.fromEntries(cfg.headers[0].headers.map((h) => [h.key, h.value]));
const st = JSON.parse(fs.readFileSync(root + '/data/state.json', 'utf8'));
const { setLegacyLoader } = await import(repo + '/api/_lib/legacy.mjs'); setLegacyLoader(async () => st);
const { default: api } = await import(repo + '/api/v1.mjs');
const log = []; globalThis.__log = log;
http.createServer(async (req, res) => {
  log.push(req.url);
  if (req.url === '/__log') { res.writeHead(200, { 'content-type': 'application/json' }); return res.end(JSON.stringify(log.splice(0))); }
  if (req.url.startsWith('/api/v1/')) { for (const [k, v] of Object.entries(hdr)) res.setHeader(k, v); return api(req, res); }
  let f = path.join(root, decodeURIComponent(req.url.split('?')[0]));
  if (!fs.existsSync(f) || fs.statSync(f).isDirectory()) { if (req.url.startsWith('/data/')) { res.writeHead(404); return res.end(); } f = path.join(root, 'index.html'); }
  res.writeHead(200, { ...hdr, 'content-type': f.endsWith('.html') ? 'text/html' : f.endsWith('.json') ? 'application/json' : 'application/octet-stream' }); res.end(fs.readFileSync(f));
}).listen(Number(port));
