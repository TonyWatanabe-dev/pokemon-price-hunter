// Vigia: issue "(sem detalhe)" (26 de 26 incidentes entre 15/10 e 25/10/2026, ex.: #913). O resumo chega ao job
// `incidente` com estado e fatos, mas sem motivo válido. A mensagem passa a dizer POR QUE ficou sem motivo (sem a lista,
// lista vazia ou código fora do formato, mostrando o código recebido, sanitizado), para diagnosticar sem os logs do
// Actions. Ação (create/comment/close/none) e impressão digital NÃO mudam.
import assert from 'node:assert/strict';
import { planIncident, parseResumo, semDetalhe, fingerprintMarker, INCIDENT_MARKER, TRUSTED_AUTHOR } from '../src/ops-incident.js';

const NOW = '2026-10-25T00:22:18.792Z';
const base = { v: 1, now: NOW, status: 'degradado', previousStatus: null, facts: { dataGeneratedAt: '2026-10-25T00:15:25.248Z', dataAgeMin: 7 } };
const body = (over) => planIncident({ resumo: JSON.stringify({ ...base, ...over }) }).body;

// motivo válido: igual a antes
assert.match(body({ reasonsDetail: [{ code: 'fonte_degradada', text: 'Mercado Livre bloqueada' }] }), /- `fonte_degradada`: Mercado Livre bloqueada/);
// sem a lista / lista vazia / código fora do formato: diz qual dos três
assert.match(body({}), /- \(sem detalhe: o resumo da checagem chegou sem a lista de motivos \(reasonsDetail\)\)/);
assert.match(body({ reasonsDetail: [] }), /chegou com a lista de motivos vazia/);
const mascarado = body({ reasonsDetail: [{ code: 'fonte***degradada', text: 'x' }, { code: 'X-ruim', text: 'y' }, null] });
assert.match(mascarado, /3 motivo\(s\) recebido\(s\), 3 descartado\(s\) por código fora do formato \[a-z_\]: "fonte\*\*\*degradada", "X-ruim", "object"/);
// texto vindo dos dados continua sanitizado: sem marcador, sem menção, sem crase quebrando o Markdown
const hostil = semDetalhe({ received: 1, discarded: ['<!-- vigia:incidente -->@dono`x`'] });
assert.ok(!hostil.includes('<!--') && !hostil.includes('`') && !/@dono/.test(hostil), hostil);
assert.equal(semDetalhe(null), 'o resumo da checagem chegou sem a lista de motivos (reasonsDetail)');

// ação e impressão digital não mudam
const p = planIncident({ resumo: JSON.stringify({ ...base, reasonsDetail: [{ code: 'fonte***degradada', text: 'x' }] }) });
assert.equal(p.type, 'create'); assert.equal(p.fingerprint, 'degradado:'); assert.match(p.body, /<!-- vigia:estado status=degradado codigos= -->/);
const aberta = { number: 913, state: 'open', author: TRUSTED_AUTHOR, body: `${INCIDENT_MARKER}\n${fingerprintMarker('degradado', [])}` };
assert.equal(planIncident({ resumo: JSON.stringify({ ...base, reasonsDetail: [{ code: 'fonte***degradada' }] }), openIssues: [aberta] }).type, 'none', 'mesma impressão digital da #913: não repete');
assert.deepEqual(parseResumo(JSON.stringify({ ...base, reasonsDetail: [{ code: 'sync_falhando', text: 't' }] })).reasons, [{ code: 'sync_falhando', text: 't' }]);
console.log('vigia-sem-detalhe-tests: ok');
