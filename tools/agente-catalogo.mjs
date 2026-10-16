// Catalog Agent (Fase 7, item 6): relatório SOMENTE LEITURA de propostas de normalização e duplicatas.
// Uso: node tools/agente-catalogo.mjs [pasta-data] [--json] [--out relatorio.json] [--as-of ISO] [--limite-matching N]
// Lê <pasta-data>/state.json, config/catalog.json e test/golden/cases.json (pré-requisito). Não grava nada além do
// --out pedido; não abre banco nem rede. Saída padrão: Markdown (para o resumo do job ou revisão humana).
import fs from 'node:fs';
import path from 'node:path';
import { catalogReport, catalogMarkdown } from '../src/agents/catalog-agent.js';
import { runGolden } from '../src/agents/golden-eval.js';

const args = process.argv.slice(2);
const opt = (k) => { const i = args.indexOf(k); return i >= 0 ? args[i + 1] : undefined; };
const valued = new Set(['--out', '--as-of', '--limite-matching']);
const positional = args.filter((a, i) => !a.startsWith('--') && !valued.has(args[i - 1]));
const dir = positional[0] || 'data';
const read = (f) => JSON.parse(fs.readFileSync(f, 'utf8'));
let state, catalog;
try { state = read(path.join(dir, 'state.json')); catalog = read(new URL('../config/catalog.json', import.meta.url)); } catch (e) {
  console.error(`Relatório não gerado: entrada ilegível (${e.message}).`); process.exit(1);
}
let golden = null;
try { golden = runGolden(read(new URL('../test/golden/cases.json', import.meta.url))); } catch { /* sem golden: pré-requisito fica não verificável */ }
const rep = catalogReport({ state, catalog, golden, asOf: opt('--as-of') || state.generatedAt, matchingLimit: Number(opt('--limite-matching') || 25) });
if (opt('--out')) fs.writeFileSync(opt('--out'), JSON.stringify(rep, null, 2) + '\n');
process.stdout.write(args.includes('--json') ? JSON.stringify(rep, null, 2) + '\n' : catalogMarkdown(rep) + '\n');
