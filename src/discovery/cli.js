// `npm run discovery`: uma rodada do Discovery Intelligence Engine. Sai sempre com 0 (a descoberta é melhor-esforço e
// nunca derruba o passo diário do hunter.yml); erros ficam no log e no ledger (data/discovery.json). DISCOVERY_STRICT=1
// faz uma rodada sem sucesso sair com 1 (para depuração manual).
import { runDiscovery } from './index.js';

const r = await runDiscovery({ log: console.log });
if (r.skipped) console.log(`DIE: rodada pulada (${r.skipped}).`);
if (!r.ok) { console.log(`DIE: rodada sem sucesso: ${r.error || 'erro'}`); if (process.env.DISCOVERY_STRICT === '1') process.exit(1); }
