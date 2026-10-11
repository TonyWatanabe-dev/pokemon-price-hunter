// Tarefas sobre o executor local precisam levar o contexto que vive fora do repositório (~/pph-executor, executor.sh status).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('..', import.meta.url)));
const claude = fs.readFileSync(path.join(root, 'CLAUDE.md'), 'utf8');
const doc = fs.readFileSync(path.join(root, 'docs/executor.md'), 'utf8');

const secao = claude.split(/^## /m).find((s) => s.startsWith('Contexto local do executor'));
assert.ok(secao, 'CLAUDE.md tem a seção de contexto local do executor');
assert.match(secao, /~\/pph-executor/, 'diz onde o executor está');
assert.match(secao, /executor\.sh/, 'cita o script');
assert.match(secao, /`status`/, 'cita o comando status');
assert.match(secao, /não conclua que algo não existe/i, 'avisa para não concluir que o comando não existe');
assert.match(secao, /Não invente comandos/, 'proíbe inventar comandos');
assert.match(secao, /secrets/i, 'lembra de não expor secrets');
assert.ok(secao.length < 1500, 'contexto mínimo necessário');

assert.match(doc, /~\/pph-executor/, 'docs/executor.md documenta o caminho');
assert.match(doc, /executor\.sh status/, 'docs/executor.md documenta executor.sh status');
assert.ok(!/(token|senha|password)\s*[:=]/i.test(secao + doc), 'sem credenciais no contexto');
console.log('OK — contexto local do executor presente em CLAUDE.md e docs/executor.md');
