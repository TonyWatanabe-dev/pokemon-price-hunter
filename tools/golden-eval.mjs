// Avaliação offline com casos dourados sintéticos. Uso: node tools/golden-eval.mjs [--out relatorio.json]
// Sai com 1 se houver regressão. Não é desempenho de produção.
import fs from 'node:fs';
import { runGolden } from '../src/agents/golden-eval.js';

const file = JSON.parse(fs.readFileSync(new URL('../test/golden/cases.json', import.meta.url), 'utf8'));
const report = runGolden(file);
const i = process.argv.indexOf('--out');
if (i > 0 && process.argv[i + 1]) fs.writeFileSync(process.argv[i + 1], JSON.stringify(report, null, 2) + '\n');

console.log(`Casos SINTÉTICOS (não medem produção): ${report.passed}/${report.total} ok`);
console.log(`Matching: ${report.matching.falsePositives} falso(s) positivo(s), ${report.matching.falseNegatives} falso(s) negativo(s), ${report.matching.reviewMismatches} divergência(s) de revisão`);
for (const f of report.failures) console.log(`✗ ${f.id} [${f.kind}] esperado=${JSON.stringify(f.expected)} obtido=${JSON.stringify(f.got)}`);
process.exit(report.failures.length ? 1 : 0);
