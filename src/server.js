// API local (zero dependências) + painel. node src/server.js -> http://localhost:8787
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { readJson, writeJson, readJsonl, dataPath, configPath, ROOT } from './db.js';

const PORT = Number(process.env.PORT || 8787);
const state = () => readJson(dataPath('state.json'), { products: [], offers: [], sources: [], bestDeals: [], collections: [] });
const send = (res, code, body, type = 'application/json; charset=utf-8') => { res.writeHead(code, { 'content-type': type, 'access-control-allow-origin': '*' }); res.end(typeof body === 'string' || Buffer.isBuffer(body) ? body : JSON.stringify(body, null, 2)); };
const readBody = (req) => new Promise((ok, bad) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => { try { ok(JSON.parse(b || '{}')); } catch (e) { bad(e); } }); });

const routes = {
  'GET /collections': () => state().collections,
  'GET /products': () => state().products,
  'GET /copag-prices': () => state().products.map((p) => ({ id: p.id, name: p.name, confirmed: p.copagConfirmed, ...p.copag, reason: p.copagReason })),
  'GET /offers': (q) => state().offers.filter((o) => !q.get('product') || o.productId === q.get('product')),
  'GET /best-deals': () => { const s = state(); const by = Object.fromEntries(s.offers.map((o) => [o.id, o])); return s.bestDeals.map((id) => by[id]); },
  'GET /price-history': (q) => { const days = Number(q.get('days') || 30); const since = Date.now() - days * 864e5; return readJsonl(dataPath('history.jsonl')).filter((h) => Date.parse(h.t) >= since && (!q.get('product') || h.productId === q.get('product'))); },
  'GET /stores': () => state().sources,
  'GET /alerts': () => readJsonl(dataPath('alerts.jsonl')).slice(-200).reverse(),
};

async function upsertRule(req) {
  const rule = await readBody(req);
  if (!rule.id || !rule.filter) throw new Error('regra precisa de id e filter');
  const w = readJson(configPath('watchlist.json'), { settings: {}, rules: [] });
  w.rules = [...w.rules.filter((r) => r.id !== rule.id), rule]; writeJson(configPath('watchlist.json'), w); return rule;
}

http.createServer(async (req, res) => {
  const u = new URL(req.url, 'http://x'); const key = `${req.method} ${u.pathname}`;
  try {
    if (req.method === 'OPTIONS') return send(res, 204, '');
    if (routes[key]) return send(res, 200, routes[key](u.searchParams));
    const m = u.pathname.match(/^\/products\/([\w-]+)$/);
    if (req.method === 'GET' && m) { const s = state(); const p = s.products.find((x) => x.id === m[1]); return p ? send(res, 200, { ...p, offers: s.offers.filter((o) => o.productId === p.id) }) : send(res, 404, { error: 'produto não encontrado' }); }
    if (req.method === 'POST' && (u.pathname === '/watchlist' || u.pathname === '/alerts')) return send(res, 201, await upsertRule(req));
    if (u.pathname === '/data/state.json') return send(res, 200, fs.readFileSync(dataPath('state.json')));
    if (u.pathname === '/' || u.pathname === '/index.html') return send(res, 200, fs.readFileSync(path.join(ROOT, 'dashboard/index.html')), 'text/html; charset=utf-8');
    send(res, 404, { error: 'rota inexistente' });
  } catch (e) { console.error(`[server] ${u.pathname}: ${e.message}`); send(res, 400, { error: e instanceof SyntaxError ? 'JSON inválido' : e.message === 'regra precisa de id e filter' ? e.message : 'pedido não pôde ser processado' }); }
}).listen(PORT, () => console.log(`Painel e API em http://localhost:${PORT}`));
