// Frescor dos dados da Amazon (config/afiliados/amazon.json): updatedAt e capturedAt precisam ser datas válidas e não
// futuras; acima de MAX_DIAS_AVISO dias só avisa (os preços não são atualizados automaticamente). Sem rede e sem banco.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const doc = JSON.parse(fs.readFileSync(path.join(ROOT, 'config/afiliados/amazon.json'), 'utf8'));
const MAX_DIAS_AVISO = 30;
const DIA_MS = 24 * 60 * 60 * 1000;
const FORMATOS = {
  updatedAt: /^\d{4}-\d{2}-\d{2}$/,
  capturedAt: /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?Z$/,
};
let n = 0;
const t = (name, fn) => { try { fn(); } catch (e) { e.message = `${name}: ${e.message}`; throw e; } n++; };

// Valida formato, data real (sem rolagem de 31/02) e não futura; devolve a idade em dias.
function idadeDias(valor, campo, agora = Date.now()) {
  assert.equal(typeof valor, 'string', `${campo}: ausente`);
  assert.match(valor, FORMATOS[campo], `${campo}: formato inválido (${valor})`);
  const ms = Date.parse(valor);
  assert.ok(Number.isFinite(ms), `${campo}: data inválida (${valor})`);
  assert.equal(new Date(ms).toISOString().slice(0, 10), valor.slice(0, 10), `${campo}: data inexistente (${valor})`);
  assert.ok(ms <= agora, `${campo}: data futura (${valor})`);
  return (agora - ms) / DIA_MS;
}
const avisa = (campo, dias) => {
  if (dias > MAX_DIAS_AVISO) console.warn(`AVISO: ${campo} com ${Math.floor(dias)} dias (limite ${MAX_DIAS_AVISO}); recapturar os preços da Amazon.`);
};

t('o validador rejeita data futura e formato inválido', () => {
  const agora = Date.parse('2026-10-13T00:00:00Z');
  assert.throws(() => idadeDias('2026-10-14', 'updatedAt', agora), /futura/);
  assert.throws(() => idadeDias('2026-10-13T12:00:00Z', 'capturedAt', agora), /futura/);
  assert.throws(() => idadeDias('13/10/2026', 'updatedAt', agora), /formato/);
  assert.throws(() => idadeDias('2026-02-31', 'updatedAt', agora), /inexistente/);
  assert.throws(() => idadeDias('2026-10-10 20:31', 'capturedAt', agora), /formato/);
  assert.throws(() => idadeDias(undefined, 'updatedAt', agora), /ausente/);
  assert.equal(idadeDias('2026-10-12', 'updatedAt', agora) < 2, true);
});

t('updatedAt do arquivo: válido e não futuro', () => avisa('updatedAt', idadeDias(doc.updatedAt, 'updatedAt')));

t('capturedAt de cada link: válido e não futuro', () => {
  assert.ok(Array.isArray(doc.links) && doc.links.length > 0);
  for (const l of doc.links) avisa(`capturedAt (${l.asin})`, idadeDias(l.capturedAt, 'capturedAt'));
});

console.log(`amazon-freshness-tests: ${n} ok`);
