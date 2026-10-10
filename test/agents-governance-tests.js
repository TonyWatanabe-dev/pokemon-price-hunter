// Governança de agentes (puro): ação proibida, permissão ausente, read-only, aprovação e auditoria sem segredos.
import assert from 'node:assert/strict';
import { authorize, createAuditLog, guarded, redact, ACTIONS, CLASSES } from '../src/agents/governance.js';

const test = async (name, fn) => { try { await fn(); } catch (e) { console.error(`✗ ${name}`); throw e; } };
const log = () => { const entries = []; return { entries, audit: createAuditLog({ sink: (e) => entries.push(e), now: () => new Date('2026-10-10T12:00:00Z') }) }; };

await test('ação proibida é negada mesmo com permissão e aprovação', () => {
  const r = authorize('main.push', { grants: ['main.push'], approval: { action: 'main.push', by: 'dono' } });
  assert.deepEqual([r.allowed, r.reason], [false, 'forbidden']);
});

await test('permissão ausente nega; ação desconhecida nega', () => {
  assert.equal(authorize('branch.write').reason, 'missing_permission');
  assert.equal(authorize('branch.write', { grants: ['pr.open'] }).reason, 'missing_permission');
  assert.equal(authorize('inventada', { grants: ['inventada'] }).reason, 'unknown_action');
});

await test('read-only permite leitura e bloqueia alteração e aprovação', () => {
  assert.equal(authorize('repo.read', { readOnly: true, grants: ['repo.read'] }).allowed, true);
  assert.equal(authorize('branch.write', { readOnly: true, grants: ['branch.write'] }).reason, 'read_only');
  assert.equal(authorize('deploy', { readOnly: true, grants: ['deploy'], approval: { action: 'deploy', by: 'dono' } }).reason, 'read_only');
});

await test('merge, deploy, migration de produção, secrets e notificação real exigem aprovação da própria ação', () => {
  for (const a of ['pr.merge', 'deploy', 'db.migrate.production', 'secrets.access', 'notify.real']) {
    assert.equal(ACTIONS[a], CLASSES.NEEDS_APPROVAL);
    assert.equal(authorize(a, { grants: [a] }).reason, 'approval_required');
    assert.equal(authorize(a, { grants: [a], approval: { action: 'outra', by: 'dono' } }).reason, 'approval_required');
    assert.equal(authorize(a, { grants: [a], approval: { action: a } }).reason, 'approval_required');
    assert.equal(authorize(a, { grants: [a], approval: { action: a, by: 'dono' } }).allowed, true);
  }
});

await test('auditoria registra negado, ok e falha sem segredos', async () => {
  const { entries, audit } = log();
  const ctx = { grants: ['branch.write'] };
  const den = await guarded('deploy', ctx, audit, 'publicar', async () => 'x');
  const ok = await guarded('branch.write', ctx, audit, 'ajustar doc', async () => 42);
  const bad = await guarded('branch.write', ctx, audit, 'ajustar', async () => { throw new Error('falhou com token ghp_abcdefghijklmnopqrstuvwxyz0123 e postgres://u:p@h/db'); });
  assert.deepEqual([den.denied, den.reason, ok.value, bad.reason], [true, 'missing_permission', 42, 'failed']);
  assert.deepEqual(entries.map((e) => e.result), ['denied', 'ok', 'failed']);
  const dump = JSON.stringify(entries);
  assert.ok(!dump.includes('ghp_') && !dump.includes('postgres://'));
  assert.equal(entries[2].tool, 'branch.write');
});

await test('redact esconde chaves sensíveis em objetos aninhados', () => {
  const r = redact({ a: 1, apiKey: 'abc', n: { Authorization: 'Bearer zzz', ok: 'sim' } });
  assert.deepEqual(r, { a: 1, apiKey: '[redigido]', n: { Authorization: '[redigido]', ok: 'sim' } });
});

console.log('governança de agentes: ok');
