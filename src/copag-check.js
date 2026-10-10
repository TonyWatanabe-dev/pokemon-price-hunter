// Verificação diária do preço Copag: confere a fonte registrada. Divergência vira revisão; o valor oficial só muda por decisão humana.
import { readJson, writeJson, configPath } from './db.js';
import { get } from './http.js';
import { parseProductPage } from './adapters/jsonld.js';
import { copagStatus } from './score.js';
import { isCopagUrl } from './copag-policy.js';

export async function copagCheck({ log = console.log } = {}) {
  const cat = readJson(configPath('catalog.json')); const report = [];
  for (const [id, c] of Object.entries(cat.copag || {})) {
    const p = { id, copag: c };
    const st = copagStatus(p);
    // Confere toda fonte oficial da Copag, mesmo vencida (> 30 dias): a conferência que bate é o que renova a validade.
    if (c.confidence !== 'OFICIAL' || !(c.msrp > 0) || !isCopagUrl(c.source_url)) { report.push({ id, status: 'NÃO CONFIRMADO', reason: st.reason }); continue; }
    if (c.manual) { report.push({ id, status: st.confirmed ? 'MANUAL' : 'MANUAL ' + st.status.toUpperCase(), msrp: c.msrp }); continue; } // tabela confirmada à mão, fonte sem leitura automática
    try {
      const page = parseProductPage((await get(c.source_url)).text, c.source_url);
      const seen = page?.price?.base ?? null;
      c.last_check = { at: new Date().toISOString(), pagePrice: seen, matches: seen === c.msrp };
      report.push({ id: p.id, status: seen === c.msrp ? 'OK' : 'REVISAR', msrp: c.msrp, pagePrice: seen });
    } catch (e) { report.push({ id: p.id, status: 'FONTE INDISPONÍVEL', error: e.message }); }
  }
  writeJson(configPath('catalog.json'), cat);
  for (const r of report.filter((x) => x.status !== 'NÃO CONFIRMADO')) log(`${r.id}: ${r.status}${r.pagePrice != null ? ` (página ${r.pagePrice} × cadastro ${r.msrp})` : ''}`);
  log(`${report.filter((r) => r.status === 'NÃO CONFIRMADO').length} produtos sem preço Copag confirmado.`);
  return report;
}
if (process.argv[1]?.endsWith('copag-check.js')) await copagCheck();
