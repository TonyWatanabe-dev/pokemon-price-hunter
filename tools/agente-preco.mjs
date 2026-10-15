// Price Intelligence Agent (Fase 7, item 8): relatório SOMENTE LEITURA que explica variações do menor preço diário
// e possíveis anomalias, com incerteza. Não define preço oficial, referência, score nem alerta. Uso:
//   node tools/agente-preco.mjs [pasta-data] [--json] [--out relatorio.json] [--as-of ISO] [--produto id,id]
// Lê <pasta-data>/hist/*.json, <pasta-data>/state.json e <pasta-data>/meta.json (janela de desconfiança).
// Não grava nada além do --out pedido; não abre banco nem rede.
import fs from 'node:fs';
import path from 'node:path';
import { priceIntelReport, priceIntelMarkdown } from '../src/agents/price-intel.js';

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const valued = new Set(['--out', '--as-of', '--produto']);
const dir = args.filter((a, i) => !a.startsWith('--') && !valued.has(args[i - 1]))[0] || 'data';
const maybe = (f) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return null; } };
const state = maybe(path.join(dir, 'state.json'));
const meta = maybe(path.join(dir, 'meta.json'));
const hist = {};
let files = [];
try { files = fs.readdirSync(path.join(dir, 'hist')).filter((f) => f.endsWith('.json')); } catch (e) { console.error(`Relatório não gerado: ${path.join(dir, 'hist')} ilegível (${e.message}).`); process.exit(1); }
for (const f of files) { const h = maybe(path.join(dir, 'hist', f)); if (h) hist[h.productId || f.replace(/\.json$/, '')] = h; }
const cases = maybe(new URL('../test/golden/cases.json', import.meta.url));
const temporalGoldenCases = (cases?.temporal || []).length;
const rep = priceIntelReport({ hist, state, distrust: meta?.distrust || null, asOf: opt('--as-of') || state?.generatedAt, temporalGoldenCases,
  only: opt('--produto') ? opt('--produto').split(',') : null });
if (opt('--out')) fs.writeFileSync(opt('--out'), JSON.stringify(rep, null, 2) + '\n');
process.stdout.write(args.includes('--json') ? JSON.stringify(rep, null, 2) + '\n' : priceIntelMarkdown(rep));
