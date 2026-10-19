// Todo tipo que o robô reconhece (TYPE_LABEL) precisa de categoria no banco: um tipo sem categoria derruba a
// sincronização inteira (incidente de 19/10/2026: "tipo sem categoria: colecao_especial").
import assert from 'node:assert/strict';
import { TYPE_LABEL } from '../src/match.js';
import { categoryOf } from '../src/core/taxonomy.js';
for (const t of Object.keys(TYPE_LABEL)) assert.doesNotThrow(() => categoryOf(t), `tipo sem categoria: ${t}`);
console.log('taxonomia-tipos-tests ok');
