// Portão do aviso imediato de falha do hunter.yml (extraído da PR #15): avisa só na transição para falha; qualquer
// dúvida (gh com erro, lista ausente/ilegível/vazia) = avisa. Puro: sem rede, sem gh, sem Telegram.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { gate } from '../tools/failure-alert-gate.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let n = 0; const t = async (name, fn) => { try { await fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } };
const iso = (base, min) => new Date(Date.parse(base) + min * 6e4).toISOString();
const NOW = '2026-10-09T12:00:00.000Z';

await t('1. portão: anterior falhou → não avisa; anterior ok → avisa; erro/lista vazia → avisa; cancelada não conta', () => {
  const r = (id, conclusion, min, status = 'completed') => ({ databaseId: id, status, conclusion, createdAt: iso(NOW, min), updatedAt: iso(NOW, min + 6) });
  const cur = r(10, '', 0, 'in_progress');
  assert.equal(gate([cur, r(9, 'failure', -15), r(8, 'success', -30)], 10).decision, 'skip');
  assert.equal(gate([cur, r(9, 'timed_out', -15)], 10).decision, 'skip');
  assert.equal(gate([cur, r(9, 'startup_failure', -15)], 10).decision, 'skip');
  assert.equal(gate([cur, r(9, 'success', -15), r(8, 'failure', -30)], 10).decision, 'send', 'primeira falha avisa já');
  assert.equal(gate([cur, r(9, 'cancelled', -15), r(8, 'failure', -30)], 10).decision, 'skip', 'cancelada é ignorada');
  assert.equal(gate([cur, r(9, 'skipped', -15), r(8, 'success', -30)], 10).decision, 'send');
  assert.equal(gate([cur, r(9, 'failure', -15, 'in_progress')], 10).decision, 'send', 'só conta rodada concluída');
  assert.equal(gate([cur], 10).decision, 'send', 'sem anterior');
  assert.equal(gate([], 10).decision, 'send', 'lista vazia');
  assert.equal(gate(null, 10).decision, 'send'); assert.equal(gate('erro', 10).decision, 'send'); assert.equal(gate({}, 10).decision, 'send');
  assert.equal(gate([null, { databaseId: 9, status: 'completed', conclusion: 'failure', createdAt: 'lixo' }], 10).decision, 'send', 'item ilegível não silencia');
  assert.equal(gate([r(11, 'failure', 5), cur, r(9, 'success', -15)], 10).decision, 'send', 'rodada mais nova que a atual não conta');
  assert.equal(gate([r(9, 'failure', -15)], 10).decision, 'skip', 'atual fora da lista: usa a última concluída');
  assert.match(gate([cur, r(9, 'failure', -15)], 10).reason, /rodada anterior 9 também falhou/);
});

await t('2. CLI: arquivo com erro do gh, ausente ou ilegível → "send"; nunca falha; motivo só no stderr', () => {
  const r = (id, conclusion, min, status = 'completed') => ({ databaseId: id, status, conclusion, createdAt: iso(NOW, min), updatedAt: iso(NOW, min + 6) });
  const cur = r(10, '', 0, 'in_progress');
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gate-'));
  const cli = (args) => execFileSync(process.execPath, ['tools/failure-alert-gate.mjs', ...args], { cwd: root, stdio: ['ignore', 'pipe', 'pipe'] }).toString().trim();
  try {
    fs.writeFileSync(path.join(tmp, 'erro.json'), 'erro\n'); assert.equal(cli(['--runs', path.join(tmp, 'erro.json'), '--current', '10']), 'send');
    assert.equal(cli(['--runs', path.join(tmp, 'nao-existe.json'), '--current', '10']), 'send');
    assert.equal(cli([]), 'send', 'sem argumentos');
    fs.writeFileSync(path.join(tmp, 'ok.json'), JSON.stringify([cur, r(9, 'failure', -15)])); assert.equal(cli(['--runs', path.join(tmp, 'ok.json'), '--current', '10']), 'skip');
    fs.writeFileSync(path.join(tmp, 'ok2.json'), JSON.stringify([cur, r(9, 'success', -15)])); assert.equal(cli(['--runs', path.join(tmp, 'ok2.json'), '--current', '10']), 'send');
  } finally { fs.rmSync(tmp, { recursive: true, force: true }); }
});

await t('3. hunter.yml: aviso imediato mantido, portão antes do envio, gh com o token do workflow e actions: read, falha do gh = avisa', () => {
  const y = fs.readFileSync(path.join(root, '.github/workflows/hunter.yml'), 'utf8');
  assert.match(y, /permissions:\s*\n\s*contents: write\s*\n\s*actions: read/);
  const step = y.slice(y.indexOf('- name: Avisar falha no Telegram'));
  assert.match(step, /if: failure\(\)/); assert.match(step, /GH_TOKEN: \$\{\{ github\.token \}\}/);
  assert.match(step, /\[ -n "\$TELEGRAM_BOT_TOKEN" \] \|\| exit 0/, 'sem Telegram, nada muda');
  assert.match(step, /gh run list[^\n]*--workflow hunter\.yml[\s\S]*\|\| echo 'erro' > "\$R"/, 'erro do gh vira lista ilegível (= avisa)');
  assert.match(step, /decision=\$\(node tools\/failure-alert-gate\.mjs --runs "\$R" --current "\$GITHUB_RUN_ID" \|\| true\)/);
  assert.match(step, /\[ "\$decision" = "skip" \] && exit 0\n\s*curl -s --max-time 20[^\n]*sendMessage/, 'só "skip" explícito silencia');
  assert.doesNotMatch(step, /(echo|printf)[^\n]*(TELEGRAM_BOT_TOKEN|GH_TOKEN|secrets\.)/, 'nenhum segredo impresso');
});

console.log(`✓ Portão do aviso imediato de falha: ${n} grupos passaram`);
