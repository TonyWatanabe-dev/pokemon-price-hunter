#!/usr/bin/env node
// Relatório do Discovery Intelligence Engine a partir do ledger (data/discovery.json) e do estado atual
// (data/state.json, config/). Uso: npm run discovery:relatorio  (HUNTER_DATA_DIR / HUNTER_CONFIG_DIR respeitados).
// Só leitura: nunca grava nem chama a rede.
import { loadLedger, scoreOf } from '../src/discovery/ledger.js';
import { inventory } from '../src/discovery/hosts.js';
import { snapshot } from '../src/discovery/index.js';

const pad = (s, n) => String(s ?? '').padEnd(n).slice(0, n);
const num = (v) => (v == null ? '-' : String(v));
const ledger = loadLedger();
const runs = ledger.runs;

console.log('== Discovery Intelligence Engine — relatório ==\n');
console.log(`Rodadas no ledger: ${runs.length} | consultas conhecidas: ${Object.keys(ledger.queries).length} | hosts vistos: ${Object.keys(ledger.hosts).length}\n`);

console.log('-- Rodadas (mais recentes por último) --');
console.log([pad('data', 20), pad('conector', 8), pad('consultas', 10), pad('hits', 6), pad('validados', 10), pad('lojas', 6), pad('candid.', 8), pad('urls', 6), pad('custo', 8), 'parou'].join(' '));
for (const r of runs) console.log([pad(r.at, 20), pad(r.connector, 8), pad(`${r.queriesRun}/${r.queriesPlanned ?? '-'}`, 10), pad(r.hits, 6), pad(r.newHosts, 10), pad(r.storesAccepted, 6), pad(r.storesCandidates, 8), pad(r.urlsAccepted, 6), pad(r.cost ? `${r.cost.estimate} ${r.cost.unit}` : '-', 8), r.stopped || ''].join(' '));

console.log('\n-- Consultas com mais rendimento (lojas + URLs aceitas; depois hits) --');
const qs = Object.entries(ledger.queries).map(([id, s]) => ({ id, ...s, accepted: (s.acceptedStores || 0) + (s.acceptedUrls || 0), score: scoreOf(s) }))
  .sort((a, b) => b.accepted - a.accepted || b.hits - a.hits || a.id.localeCompare(b.id)).slice(0, 15);
console.log([pad('consulta', 52), pad('rodadas', 8), pad('hits', 6), pad('lojas', 6), pad('urls', 6), pad('score', 7), 'última'].join(' '));
for (const q of qs) console.log([pad(q.id, 52), pad(q.runs, 8), pad(q.hits, 6), pad(q.acceptedStores, 6), pad(q.acceptedUrls, 6), pad(q.score.toFixed(2), 7), q.lastRun || '-'].join(' '));
if (!qs.length) console.log('(nenhuma consulta rodou ainda)');

console.log('\n-- Conectores --');
const last = runs.at(-1);
for (const [id, c] of Object.entries(ledger.connectors)) console.log(`${pad(id, 8)} chamadas ${num(c.calls)} | erros ${num(c.errors)} | último status ${num(c.lastStatus)} | ${c.lastAt || '-'}`);
if (last?.connectors) for (const [id, s] of Object.entries(last.connectors)) console.log(`${pad(id, 8)} ${s.available ? 'disponível' : 'indisponível: ' + s.reason} (${s.keyName})`);

console.log('\n-- Hosts por veredito --');
const byVerdict = {};
for (const [h, v] of Object.entries(ledger.hosts)) (byVerdict[v.verdict || 'sem veredito'] ||= []).push(h);
for (const [v, hs] of Object.entries(byVerdict)) console.log(`${pad(v, 14)} ${hs.length}${v === 'accepted' || v === 'candidate' ? ': ' + hs.slice(0, 20).join(', ') : ''}`);

console.log('\n-- Baseline × combinado --');
const first = runs.find((r) => r.baseline)?.baseline; const now = snapshot(inventory());
console.log([pad('', 22), pad('antes (1ª rodada)', 20), 'agora'].join(' '));
for (const k of ['knownHosts', 'offers', 'liveOffers', 'productsWithOffers']) console.log([pad(k, 22), pad(num(first?.[k]), 20), num(now[k])].join(' '));
console.log(`\nLojas aceitas (acumulado): ${runs.reduce((a, r) => a + (r.storesAccepted || 0), 0)} | candidatas: ${runs.reduce((a, r) => a + (r.storesCandidates || 0), 0)} | URLs entregues ao coletor: ${runs.reduce((a, r) => a + (r.urlsAccepted || 0), 0)}`);
console.log('Nota: "antes" é o retrato gravado na primeira rodada do ledger; "agora" lê o estado atual (state.json vem do ramo data no robô).');
