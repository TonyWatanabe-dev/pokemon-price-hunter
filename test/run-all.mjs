// Executor da suíte: descobre test/*-tests.js e roda cada um em sequência, parando na primeira falha (como o
// antigo "a && b && c" do package.json). Arquivos importados por outro teste (await import('./x-tests.js')) não
// rodam de novo. Para adicionar um teste basta criar test/<nome>-tests.js: NÃO edite o package.json (a lista única
// gerava conflito em quase toda PR paralela). ORDEM_HISTORICA preserva a ordem anterior; arquivos novos vêm depois,
// em ordem alfabética. Uso: node test/run-all.mjs [--listar]
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
export const ORDEM_HISTORICA = Object.freeze([
  'deploy-safety-tests.js',
  'firebase-key-tests.js',
  'run-tests.js',
  'collectors-tests.js',
  'ml-tests.js',
  'core-tests.js',
  'price-engine-tests.js',
  'db-tests.js',
  'price-db-tests.js',
  'stock-events-db-tests.js',
  'stock-events-guard-tests.js',
  'reference-tests.js',
  'reference-db-tests.js',
  'reference-policy-tests.js',
  'market-dedup-tests.js',
  'market-composition-tests.js',
  'opportunity-engine-tests.js',
  'opportunity-db-tests.js',
  'opportunity-contract-tests.js',
  'opportunities-page-tests.js',
  'home-page-tests.js',
  'account-page-tests.js',
  'malformed-data-tests.js',
  'score-consistency-tests.js',
  'alerts-opportunity-tests.js',
  'ops-detection-tests.js',
  'freshness-tests.js',
  'api-tests.js',
  'agents-orchestrator-tests.js',
  'agents-db-tests.js',
  'agents-integration-tests.js',
  'review-tests.js',
  'urlguard-tests.js',
  'alerts-reliability-tests.js',
  'offer-key-tests.js',
  'copag-status-tests.js',
  'history-quality-tests.js',
  'stores-tests.js',
  'shipping-quote-tests.js',
  'shipping-quote-db-tests.js',
  'a11y-dynamic-tests.js',
  'alerts-idempotency-tests.js',
  'user-isolation-db-tests.js',
  'ux-confianca-tests.js',
  'trust-ux-tests.js',
  'offer-freshness-tests.js',
  'export-csv-tests.js',
  'executor-context-tests.js',
  'golden-eval-tests.js',
  'search-product-flow-tests.js',
  'gate-tests.js',
  'duplicates-tests.js',
  'adapter-contract-tests.js',
  'integrity-db-tests.js',
  'domain-model-tests.js',
  'migrations-static-tests.js',
  'availability-tests.js',
  'amazon-links-tests.js',
  'redact-tests.js',
  'jsonld-recovery-tests.js',
  'http-security-tests.js',
  'agents-governance-tests.js',
  'url-quality-tests.js',
  'http-retry-tests.js',
  'tls-tests.js',
  'search-accent-db-tests.js',
  'copag-vencimento-tests.js',
  'agents-release-governor-tests.js',
  'release-executor-bridge-tests.js',
  'workflow-security-tests.js',
  'tarefas-workflow-tests.js',
  'dispatcher-tests.js',
  'esforco-tests.js',
  'telemetria-tests.js',
  'burnin-tests.js',
  'revisor-workflow-tests.js',
  'release-audit-github-tests.js',
  'ux-lote-a-tests.js',
]);
const IMPORT_RE = /import\(?\s*['"]\.\/([\w.-]+-tests\.m?js)['"]/g;

/** Arquivos da suíte: *-tests.(m)js de test/, sem os importados por outro teste; ordem histórica, depois alfabética. */
export function descobrir(pasta = dir) {
  const js = fs.readdirSync(pasta).filter((f) => /\.m?js$/.test(f));
  const testes = js.filter((f) => /-tests\.m?js$/.test(f));
  const importados = new Set();
  for (const f of js) for (const m of fs.readFileSync(path.join(pasta, f), 'utf8').matchAll(IMPORT_RE)) if (m[1] !== f) importados.add(m[1]);
  const raiz = testes.filter((f) => !importados.has(f));
  const hist = ORDEM_HISTORICA.filter((f) => raiz.includes(f));
  return [...hist, ...raiz.filter((f) => !hist.includes(f)).sort()];
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const lista = descobrir();
  if (process.argv.includes('--listar')) { console.log(lista.join('\n')); process.exit(0); }
  for (const f of lista) {
    const r = spawnSync(process.execPath, [path.join(dir, f)], { stdio: 'inherit' });
    if (r.status !== 0) { console.error('✗ suíte interrompida em test/' + f + ' (código ' + (r.status ?? r.signal) + ')'); process.exit(r.status || 1); }
  }
  console.log('✓ Suíte completa: ' + lista.length + ' arquivos de teste');
}
