// Verificação diária do preço Copag: confere a fonte registrada. Divergência vira revisão; o valor oficial só muda por decisão humana.
import { readJson, writeJson, configPath } from './db.js';
import { get } from './http.js';
import { parseProductPage } from './adapters/jsonld.js';
import { copagStatus } from './score.js';

export async function copagCheck({ log = console.log } = {}) {
  const cat = readJson(configPath('catalog.json')); const report = [];
  for (const p of cat.products) {
    const st = copagStatus({ copag: { ...cat.defaults.copag, ...(p.copag || {}) } });
    if (!st.confirmed) { report.push({ id: p.id, status: 'NÃO CONFIRMADO' }); continue; }
    try {
      const page = parseProductPage((await get(p.copag.source_url)).text, p.copag.source_url);
      const seen = page?.price?.base ?? null;
      p.copag.last_check = { at: new Date().toISOString(), pagePrice: seen, matches: seen === p.copag.msrp };
      report.push({ id: p.id, status: seen === p.copag.msrp ? 'OK' : 'REVISAR', msrp: p.copag.msrp, pagePrice: seen });
    } catch (e) { report.push({ id: p.id, status: 'FONTE INDISPONÍVEL', error: e.message }); }
  }
  writeJson(configPath('catalog.json'), cat);
  for (const r of report.filter((x) => x.status !== 'NÃO CONFIRMADO')) log(`${r.id}: ${r.status}${r.pagePrice != null ? ` (página ${r.pagePrice} × cadastro ${r.msrp})` : ''}`);
  log(`${report.filter((r) => r.status === 'NÃO CONFIRMADO').length} produtos sem preço Copag confirmado.`);
  return report;
}
if (process.argv[1]?.endsWith('copag-check.js')) await copagCheck();
