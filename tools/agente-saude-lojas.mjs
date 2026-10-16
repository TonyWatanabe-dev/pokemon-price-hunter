// Marketplace Health Agent (Fase 7, item 7): relatório SOMENTE LEITURA da saúde das lojas, com propostas de ajuste
// que nunca contornam bloqueio. Uso:
//   node tools/agente-saude-lojas.mjs [pasta-data] [--json] [--out relatorio.json] [--as-of ISO]
// Lê <pasta-data>/sources.json (obrigatório), <pasta-data>/meta.json e <pasta-data>/state.json (opcionais) e
// config/stores.json. Não grava nada além do --out pedido; não abre banco nem rede.
import fs from 'node:fs';
import path from 'node:path';
import { marketplaceHealthReport, marketplaceHealthMarkdown } from '../src/agents/marketplace-health.js';

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const valued = new Set(['--out', '--as-of']);
const dir = args.filter((a, i) => !a.startsWith('--') && !valued.has(args[i - 1]))[0] || 'data';
const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
const maybe = (f) => { try { return read(f); } catch { return null; } };
let sources;
try { sources = read(path.join(dir, 'sources.json')); } catch (e) { console.error(`Relatório não gerado: sources.json ilegível (${e.message}).`); process.exit(1); }
const meta = maybe(path.join(dir, 'meta.json'));
const state = maybe(path.join(dir, 'state.json'));
const stores = maybe(new URL('../config/stores.json', import.meta.url));
const rep = marketplaceHealthReport({ sources, meta, state, stores, asOf: opt('--as-of') || state?.generatedAt || meta?.ops?.last?.generatedAt });
if (opt('--out')) fs.writeFileSync(opt('--out'), JSON.stringify(rep, null, 2) + '\n');
process.stdout.write(args.includes('--json') ? JSON.stringify(rep, null, 2) + '\n' : marketplaceHealthMarkdown(rep));
