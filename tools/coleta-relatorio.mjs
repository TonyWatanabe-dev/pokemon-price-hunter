// Relatório de diagnóstico da coleta por loja, a partir de data/sources.json (ou de um arquivo passado na linha de
// comando): plataforma, status, quem barrou (waf) e resumo da última falha, agrupado por waf. Só leitura, sem rede.
//   node tools/coleta-relatorio.mjs [caminho/sources.json] [--json]
// O diagnóstico é observação da resposta ao nosso agente honesto (UA identificado, robots.txt respeitado): serve para
// decidir o que pausar, retirar ou pedir liberação ao lojista — nunca para contornar WAF, CAPTCHA ou limite.
import fs from 'node:fs';
import { dataPath } from '../src/db.js';

const WAF_ORDER = ['cloudflare', 'akamai', 'datadome', 'perimeterx', 'imperva', 'sucuri', 'aws-waf', 'generic-403', 'timeout', 'dns', 'tls', 'unknown', '—'];
const esc = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\s+/g, ' ').trim();

/** Linhas do relatório: uma por loja, ordenadas por waf (ordem fixa) e depois por id. Sem valores de cookie: só nomes. */
export function linhas(sources) {
  const rows = Object.entries(sources || {}).map(([id, s]) => {
    const f = s?.lastFailure && typeof s.lastFailure === 'object' ? s.lastFailure : null;
    const waf = s?.status === 'ACTIVE' ? '—' : f?.waf || (s?.netCode === 'TIMEOUT' ? 'timeout' : /ENOTFOUND|EAI_AGAIN/.test(s?.netCode || '') ? 'dns' : /CERT|SSL|TLS/.test(s?.netCode || '') ? 'tls' : s?.httpStatus === 403 ? 'generic-403' : s?.status ? 'unknown' : '—');
    const parts = f ? [f.status ? `HTTP ${f.status}` : null, f.errorCode, f.server ? `server=${f.server}` : null, f.cfRay ? `cf-ray=${f.cfRay}…` : null, f.setCookieNames?.length ? `cookies=${f.setCookieNames.join(',')}` : null, f.elapsedMs != null ? `${f.elapsedMs} ms` : null, f.bodyHead ? `"${f.bodyHead.slice(0, 80)}"` : null].filter(Boolean)
      : [s?.httpStatus ? `HTTP ${s.httpStatus}` : null, s?.netCode || null].filter(Boolean);
    return { id, loja: s?.name || id, plataforma: s?.platform || s?.platformHint || '—', dica: s?.platformHint || null, status: s?.status || '—', waf, falha: parts.join(' · ') || (s?.reason ? String(s.reason).slice(0, 80) : '—'), em: f?.at || s?.lastCheck || null, anuncios: s?.listings ?? null, casados: s?.matched ?? null };
  });
  const k = (w) => { const i = WAF_ORDER.indexOf(w); return i < 0 ? WAF_ORDER.length : i; };
  return rows.sort((a, b) => k(a.waf) - k(b.waf) || a.id.localeCompare(b.id));
}

/** Markdown: um bloco por waf com tabela (loja, plataforma, status, última falha, anúncios/casados). */
export function markdown(sources, agora = new Date().toISOString()) {
  const rows = linhas(sources); const out = [`# Diagnóstico da coleta (${agora})`, ''];
  const groups = new Map(); for (const r of rows) (groups.get(r.waf) || groups.set(r.waf, []).get(r.waf)).push(r);
  out.push(`Lojas: ${rows.length}. Por waf: ${[...groups].map(([w, g]) => `${w} ${g.length}`).join(', ')}.`, '');
  for (const [waf, g] of groups) {
    out.push(`## ${waf === '—' ? 'sem falha (ACTIVE)' : waf} (${g.length})`, '', '| loja | plataforma | status | última falha | anúncios/casados |', '|---|---|---|---|---|');
    for (const r of g) out.push(`| ${esc(r.loja)} | ${esc(r.plataforma)}${r.dica && r.dica !== r.plataforma ? ` (dica: ${esc(r.dica)})` : ''} | ${esc(r.status)} | ${esc(r.falha)} | ${r.anuncios ?? '—'}/${r.casados ?? '—'} |`);
    out.push('');
  }
  return out.join('\n');
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = process.argv.slice(2); const asJson = args.includes('--json');
  const file = args.find((a) => !a.startsWith('--')) || dataPath('sources.json');
  let sources; try { sources = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { console.error(`não consegui ler ${file}: ${e.message}`); process.exit(2); }
  process.stdout.write(asJson ? JSON.stringify(linhas(sources), null, 2) + '\n' : markdown(sources) + '\n');
}
