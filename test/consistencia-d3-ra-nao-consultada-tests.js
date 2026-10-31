// E6-E / D3 (auditoria T4-E): selo Reclame Aqui honesto para loja que NUNCA foi consultada.
// config/reclameaqui.json é manual (≈53 lojas); loja fora dela não foi procurada no Reclame Aqui. Antes, raOf tratava a
// ausência como NAO_ENCONTRADA e o selo dizia "RA: sem cadastro" com a dica "Não encontramos esta loja no Reclame Aqui
// (consulta em …)" — afirmação falsa em ~metade das lojas vivas. A nota do Hunter não muda (o motor já trata ausência
// como neutra); só o texto. Código real de index.html num sandbox, tabela real de config/reclameaqui.json.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const rep = JSON.parse(fs.readFileSync(new URL('../config/reclameaqui.json', import.meta.url), 'utf8'));
const cut = (a, b) => { const i = html.indexOf(a); const j = html.indexOf(b, i); assert.ok(i > 0 && j > i, `trecho ${a}`); return html.slice(i, j); };
let n = 0; const t = (nome, fn) => { try { fn(); n++; } catch (e) { e.message = `${nome}: ${e.message}`; throw e; } };
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const ctx = { esc, safeUrl: (u) => u, encodeURIComponent, String, Date, S: { reputation: { consultadoEm: rep.consultadoEm, lojas: rep.lojas } } };
vm.createContext(ctx);
vm.runInContext(cut('const RA_ST=', 'const pixOf=') + '\n;globalThis.__t={raOf,raBadge,RA_ST};', ctx);
const { raOf, raBadge } = ctx.__t;
const vis = (h) => (h.match(/<b>([^<]*)<\/b>/) || [])[1];
const tip = (h) => (h.match(/title="([^"]*)"/) || [])[1] || '';

const nunca = 'loja-que-nao-esta-na-tabela';
const naoEnc = Object.keys(rep.lojas).find((k) => rep.lojas[k].status === 'NAO_ENCONTRADA');
t('tabela real tem loja consultada e não encontrada', () => assert.ok(naoEnc));
t('loja fora da tabela não é "sem cadastro" nem "não encontrada"', () => {
  assert.notEqual(raOf(nunca).status, 'NAO_ENCONTRADA');
  for (const full of [false, true]) {
    const h = raBadge({ storeId: nunca, storeName: 'Loja Nova' }, full);
    assert.doesNotMatch(vis(h), /sem cadastro/i, 'texto visível');
    assert.doesNotMatch(tip(h), /Não encontramos|consulta em/i, 'dica não pode dizer que consultamos');
    assert.match(tip(h), /não consultamos/i);
    assert.match(h, /reclameaqui\.com\.br\/busca\/\?q=Loja%20Nova/, 'link continua levando à busca');
  }
  assert.equal(vis(raBadge({ storeId: nunca, storeName: 'X' })), 'RA: não consultado');
});
t('loja consultada e não encontrada continua "sem cadastro" com a data da consulta', () => {
  const h = raBadge({ storeId: naoEnc, storeName: 'X' });
  assert.equal(vis(h), 'RA: sem cadastro');
  assert.match(tip(h), /Não encontramos esta loja no Reclame Aqui \(consulta em \d{2}\/\d{2}\/\d{4}\)/);
});
t('loja com nota continua igual', () => {
  const k = Object.keys(rep.lojas).find((x) => rep.lojas[x].nota != null); assert.ok(k);
  assert.match(vis(raBadge({ storeId: k, storeName: 'X' })), /^RA \d/);
});
t('sem tabela de reputação carregada, nenhum selo', () => {
  ctx.S.reputation = null; assert.equal(raBadge({ storeId: nunca, storeName: 'X' }), '');
});
console.log(`consistencia-d3-ra-nao-consultada: ${n} verificações ok`);
