// Coerência: o lease do dispatcher não pode expirar antes do timeout do job `tarefa` (senão a vaga é liberada com o worker ainda rodando).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULTS } from '../src/agents/dispatcher.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const yaml = fs.readFileSync(path.join(root, '.github/workflows/tarefas.yml'), 'utf8');

const m = yaml.match(/^  tarefa:\s*\n([\s\S]*?)(?=^  [A-Za-z0-9_-]+:\s*$|(?![\s\S]))/m);
assert.ok(m, 'job `tarefa` não encontrado em tarefas.yml');
const t = m[1].match(/^\s+timeout-minutes:\s*(\d+)/m);
assert.ok(t, 'job `tarefa` sem timeout-minutes');
const timeout = Number(t[1]);

assert.ok(DEFAULTS.leaseMinutes >= timeout,
  `DEFAULTS.leaseMinutes (${DEFAULTS.leaseMinutes}) < timeout-minutes do job tarefa (${timeout})`);
console.log('dispatcher-lease-tests ok');
