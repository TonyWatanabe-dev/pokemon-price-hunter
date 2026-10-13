// Atraso de detecção do sync (docs/auditorias/frescor-sync.md §3/§4): o sync roda DEPOIS de publicar e só é conferido
// na rodada seguinte (syncStatus compara max(last_seen_at) com o generatedAt da rodada anterior). Fixa o comportamento atual.
import assert from 'node:assert/strict';
import { syncStatus } from '../src/db-health.js';

let n = 0; const t = async (name, fn) => { try { await fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } };
const iso = (base, min) => new Date(Date.parse(base) + min * 6e4).toISOString();
const G1 = '2026-10-09T10:00:00.000Z'; // rodada N-1: sync concluído, o banco tem G1
const G2 = iso(G1, 15);                // rodada N: o sync falha, o banco continua em G1
const G3 = iso(G2, 15);                // rodada N+1
const health = (lastSeenAt) => ({ status: 'ok', lastSeenAt, engineAt: null, engineRunAt: null });

await t('sync falho na rodada N: ok na N (comparada à N-1) e atrasado só na N+1', () => {
  const naN = syncStatus(health(G1), G1);
  assert.equal(naN.status, 'ok'); assert.equal(naN.lagMin, 0);
  const naN1 = syncStatus(health(G1), G2);
  assert.equal(naN1.status, 'atrasado'); assert.equal(naN1.lagMin, 15);
  assert.equal(naN1.prevGeneratedAt, G2); assert.equal(naN1.lastSeenAt, G1);
});

await t('sync falho continua atrasado nas rodadas seguintes, com lag crescente', () => {
  assert.equal(syncStatus(health(G1), G3).status, 'atrasado');
  assert.equal(syncStatus(health(G1), G3).lagMin, 30);
});

await t('sync que volta a funcionar na N+1 zera o atraso na N+2', () => {
  assert.equal(syncStatus(health(G3), G3).status, 'ok');
});

console.log(`✓ Atraso de detecção do sync: ${n} grupos passaram`);
