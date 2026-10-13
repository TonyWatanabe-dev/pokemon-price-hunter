// Completude: todo código de falha emitido por evaluateStatus (degradado/parado) tem rótulo em CODE_LABEL.
// Divergência da auditoria: só 'desconhecido' (dados_indisponiveis, meta_ausente, ops_ausente) fica sem rótulo, de propósito: decide() nunca avisa nesse estado.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CODE_LABEL } from '../src/ops-watch.js';

const SEM_ROTULO = new Set(['dados_indisponiveis', 'meta_ausente', 'ops_ausente']);
const src = fs.readFileSync(new URL('../src/ops-watch.js', import.meta.url), 'utf8');
const body = src.slice(src.indexOf('function evaluateStatus('), src.indexOf('const EMPTY'));
const emitidos = new Set();
for (const m of body.matchAll(/add\(\s*'([a-z_]+)'/g)) emitidos.add(m[1]);
for (const m of body.matchAll(/add\(\s*[^'(),]*\?\s*'([a-z_]+)'\s*:\s*'([a-z_]+)'/g)) { emitidos.add(m[1]); emitidos.add(m[2]); }

assert.ok(emitidos.size >= 14, 'a varredura do código emitido deve achar os códigos conhecidos');
for (const c of emitidos) {
  if (SEM_ROTULO.has(c)) assert.ok(!(c in CODE_LABEL), `${c} (desconhecido) não precisa de rótulo`);
  else assert.ok(typeof CODE_LABEL[c] === 'string' && CODE_LABEL[c], `código ${c} emitido por evaluateStatus sem CODE_LABEL`);
}
for (const c of Object.keys(CODE_LABEL)) assert.ok(emitidos.has(c), `CODE_LABEL tem ${c}, que evaluateStatus não emite`);
console.log('ok - ops-codigos: todo código do Vigia tem rótulo');
