// Verificação diária do preço Copag: confere a fonte registrada. Divergência vira revisão; o valor oficial só muda por decisão humana.
// O resultado (last_check por produto) vai para data/copag-check.json (ramo data), nunca para config/: a main é protegida e
// só aceita PR, então mudança do robô em config/ derrubava a rodada no push (rodada de 24/10/2026 12:29 UTC).
import { readJson, writeJson, configPath, dataPath } from './db.js';
import { get } from './http.js';
import { parseProductPage } from './adapters/jsonld.js';
import { copagStatus } from './score.js';

export async function copagCheck({ log = console.log } = {}) {
  const cat = readJson(configPath('catalog.json')); const report = []; const checks = {};
  for (const [id, c] of Object.entries(cat.copag || {})) {
    const p = { id, copag: c };
    const st = copagStatus(p);
    if (!st.confirmed || c.confidence !== 'OFICIAL') { report.push({ id, status: st.confirmed ? 'CATÁLOGO' : 'NÃO CONFIRMADO' }); continue; }
    if (c.manual) { report.push({ id, status: 'MANUAL', msrp: c.msrp }); continue; } // tabela confirmada à mão, fonte sem leitura automática
    try {
      const page = parseProductPage((await get(c.source_url)).text, c.source_url);
      const seen = page?.price?.base ?? null;
      checks[id] = { at: new Date().toISOString(), msrp: c.msrp, pagePrice: seen, matches: seen === c.msrp, source_url: c.source_url };
      report.push({ id: p.id, status: seen === c.msrp ? 'OK' : 'REVISAR', msrp: c.msrp, pagePrice: seen });
    } catch (e) { report.push({ id: p.id, status: 'FONTE INDISPONÍVEL', error: e.message }); }
  }
  const prev = readJson(dataPath('copag-check.json'), {});
  writeJson(dataPath('copag-check.json'), { ...prev, ...checks });
  for (const r of report.filter((x) => x.status !== 'NÃO CONFIRMADO')) log(`${r.id}: ${r.status}${r.pagePrice != null ? ` (página ${r.pagePrice} × cadastro ${r.msrp})` : ''}`);
  log(`${report.filter((r) => r.status === 'NÃO CONFIRMADO').length} produtos sem preço Copag confirmado.`);
  return report;
}
if (process.argv[1]?.endsWith('copag-check.js')) await copagCheck();
