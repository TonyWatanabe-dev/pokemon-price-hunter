// Vigia: grupo do WhatsApp parado (24/10/2026). 4 rodadas concluídas seguidas com falha → degradado com whatsapp_parado.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { whatsappIssues, evaluate, RULES, CODE_LABEL } from '../src/ops-watch.js';

const r = (min, conclusion) => ({ status: 'completed', conclusion, createdAt: new Date(Date.parse('2026-10-24T15:00:00Z') - min * 60e3).toISOString(), event: 'schedule' });
assert.equal(RULES.WA_FAILED, 4);
assert.equal(whatsappIssues([r(0, 'failure'), r(30, 'failure'), r(60, 'failure'), r(90, 'failure')])[0].code, 'whatsapp_parado');
assert.deepEqual(whatsappIssues([r(0, 'failure'), r(30, 'failure'), r(60, 'success'), r(90, 'failure')]), [], 'um sucesso no meio: não avisa');
assert.deepEqual(whatsappIssues([r(0, 'failure'), r(30, 'failure'), r(60, 'failure')]), [], 'menos de 4 rodadas: não avisa');
assert.deepEqual(whatsappIssues([r(0, 'skipped'), r(30, 'skipped'), r(60, 'skipped'), r(90, 'skipped')]), [], 'kill switch (pulada): não avisa');
assert.deepEqual(whatsappIssues(null), [], 'sem leitura: não avisa');
assert.ok(CODE_LABEL.whatsapp_parado);
const now = '2026-10-24T15:05:00Z';
const ev = evaluate({ now, stateGeneratedAt: '2026-10-24T15:00:00Z', meta: null, runs: [], waRuns: [r(0, 'failure'), r(30, 'failure'), r(60, 'failure'), r(90, 'failure')] });
assert.equal(ev.status, 'degradado'); assert.ok(ev.reasons.some((x) => x.code === 'whatsapp_parado'));
const wf = readFileSync(new URL('../.github/workflows/watchdog.yml', import.meta.url), 'utf8');
assert.match(wf, /--workflow social-whatsapp-auto\.yml/); assert.match(wf, /--wa-runs wd\/wa-runs\.json/);
const waAuto = readFileSync(new URL('../.github/workflows/social-whatsapp-auto.yml', import.meta.url), 'utf8');
assert.match(waAuto, /if: success\(\) && hashFiles\('social\/wa-sessao\.bin'\) != ''/, 'cache da sessão só é salvo após sucesso');
const waScript = readFileSync(new URL('../tools/social-whatsapp.mjs', import.meta.url), 'utf8');
assert.match(waScript, /Não persistir credenciais após falha/);
assert.doesNotMatch(waScript, /try \{ if \(o\.modo === 'enviar' && fs\.readdirSync\(dir\)\.length\) salvar\(\); \}/, 'falhas não podem salvar sessão possivelmente inválida');
console.log('✓ vigia-whatsapp: falhas seguidas alertam; cache da sessão só avança após sucesso');
