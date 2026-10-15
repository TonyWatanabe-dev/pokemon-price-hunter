// Social MVP — runbook de operação e incidentes (issue #660): o docs/social-runbook.md só pode descrever o que existe.
// Confere caminhos e funções citados, as afirmações sobre SOCIAL_ENABLED / SOCIAL_PAUSA / aprovação / dedupe e roda o
// script de prévia do próprio runbook contra um state.json de teste (sem rede, banco, secrets nem process.env real).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import * as elegiveis from '../src/agents/social/elegiveis.js';
import * as rascunho from '../src/agents/social/rascunho.js';
import * as fila from '../src/agents/social/fila.js';
import * as aprovacao from '../src/agents/social/aprovacao.js';
import * as afiliados from '../src/agents/social/afiliados.js';
import * as moderacao from '../src/agents/social/moderacao.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const doc = fs.readFileSync(path.join(root, 'docs/social-runbook.md'), 'utf8');
let n = 0;
function t(name, fn) { try { fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } }
const NOW = '2026-10-14T12:00:00.000Z';
const ON = { SOCIAL_ENABLED: '1' };

t('caminhos citados existem no repositório', () => {
  const citados = [...doc.matchAll(/`((?:src|api|config|docs|test|tools)\/[^`*\s]+)`/g)].map((m) => m[1]);
  assert.ok(citados.length >= 10);
  for (const c of citados) assert.ok(fs.existsSync(path.join(root, c)), `caminho inexistente no runbook: ${c}`);
});

t('funções citadas são exportadas pelos módulos', () => {
  const mods = {
    elegiveis: [elegiveis, ['selecionarElegiveis', 'ofertaElegivel', 'chaveDedupe', 'exigeDisclosure', 'socialHabilitado', 'MOTIVOS']],
    rascunho: [rascunho, ['gerarRascunho', 'socialEnabled', 'DISCLOSURE']],
    fila: [fila, ['enfileirar', 'aprovar', 'rejeitar', 'agendar', 'pausado', 'habilitado', 'paraJson', 'deJson', 'TRANSICOES', 'PADROES']],
    aprovacao: [aprovacao, ['decidir', 'aprovacaoValida', 'verificarTrilha', 'ultimoHash']],
    afiliados: [afiliados, ['linkParaPost', 'loadConfig', 'validarLink']],
    moderacao: [moderacao, ['classificarMensagem', 'hostsDeLojas', 'socialHabilitado', 'HOSTS_CONHECIDOS_PADRAO']],
  };
  for (const [nome, [mod, fns]] of Object.entries(mods)) {
    for (const f of fns) {
      assert.ok(f in mod, `${nome}.js não exporta ${f}`);
      assert.ok(doc.includes('`' + f) || doc.includes(f + '('), `runbook não cita ${f}`);
    }
  }
});

t('SOCIAL_ENABLED: ausente desliga tudo, "1" liga tudo, "true" não liga elegiveis/rascunho', () => {
  const flags = [elegiveis.socialHabilitado, rascunho.socialEnabled, fila.habilitado, aprovacao.socialEnabled, afiliados.socialEnabled, moderacao.socialHabilitado];
  for (const f of flags) { assert.equal(f({}), false); assert.equal(f(ON), true); }
  assert.equal(elegiveis.socialHabilitado({ SOCIAL_ENABLED: 'true' }), false);
  assert.equal(rascunho.socialEnabled({ SOCIAL_ENABLED: 'true' }), false);
  for (const f of [fila.habilitado, aprovacao.socialEnabled, afiliados.socialEnabled, moderacao.socialHabilitado]) assert.equal(f({ SOCIAL_ENABLED: 'true' }), true);
  assert.match(doc, /SOCIAL_ENABLED=1/);
  assert.match(doc, /aceitam \*\*só\*\* `1`/);
});

t('SOCIAL_PAUSA: lista, separadores, "todos", caixa; agendar pausado mantém agendadoPara', () => {
  assert.equal(fila.pausado('telegram', { SOCIAL_PAUSA: 'instagram;Telegram' }), true);
  assert.equal(fila.pausado('telegram', { SOCIAL_PAUSA: 'instagram, x' }), false);
  assert.equal(fila.pausado('telegram', { SOCIAL_PAUSA: 'TODOS' }), true);
  let f = fila.enfileirar(null, { canal: 'telegram', chaveDedupe: 'a', texto: 'x' }, { now: NOW });
  f = fila.aprovar(f.fila, f.item.id, { now: NOW }).fila;
  const ag = fila.agendar(f, { canal: 'telegram', now: NOW, env: ON });
  assert.equal(ag.status, 'ok');
  const p = fila.agendar(ag.fila, { canal: 'telegram', now: NOW, env: { ...ON, SOCIAL_PAUSA: 'telegram' } });
  assert.equal(p.status, 'pausado');
  assert.ok(p.fila.itens[0].agendadoPara, 'a pausa não remove horário já gravado (o runbook diz isso)');
  assert.equal(fila.agendar(f, { canal: 'telegram', now: NOW, env: {} }).status, 'desligado');
});

t('aprovado não volta atrás, publicado é recusado e rascunho da mesma oferta é duplicado por 24 h', () => {
  assert.deepEqual([...fila.TRANSICOES.aprovado], []);
  const r = fila.enfileirar(null, { canal: 'telegram', chaveDedupe: 'p|l|100', texto: 'x' }, { now: NOW });
  assert.throws(() => fila.transicionar(r.fila, r.item.id, 'publicado', { now: NOW }), /publicação fora do escopo/);
  const rej = fila.rejeitar(r.fila, r.item.id, { now: NOW, motivo: 'errado' }).fila;
  const mais23h = new Date(Date.parse(NOW) + 23 * 3600e3).toISOString();
  assert.equal(fila.enfileirar(rej, { canal: 'telegram', chaveDedupe: 'p|l|100', texto: 'corrigido' }, { now: mais23h }).status, 'duplicado');
  assert.equal(fila.enfileirar(rej, { canal: 'telegram', chaveDedupe: 'p|l|90', texto: 'preço novo' }, { now: mais23h }).status, 'enfileirado');
});

t('decidir exige SOCIAL_ENABLED, operador e motivo; editar o texto invalida a aprovação', () => {
  const item = { id: 'telegram:x', texto: 'Rascunho' };
  const base = { operador: 'dono', operadores: ['dono'], now: NOW };
  assert.equal(aprovacao.decidir(item, { ...base, decisao: 'aprovar', env: {} }).ok, false);
  assert.equal(aprovacao.decidir(item, { ...base, decisao: 'rejeitar', env: ON }).erro, 'rejeição exige motivo');
  assert.equal(aprovacao.decidir(item, { ...base, operador: 'outro', decisao: 'aprovar', env: ON }).ok, false);
  const ok = aprovacao.decidir(item, { ...base, decisao: 'aprovar', env: ON });
  assert.equal(ok.ok, true);
  const trilha = [ok.evento];
  assert.equal(aprovacao.aprovacaoValida(ok.item, { trilha }), true);
  assert.equal(aprovacao.aprovacaoValida({ ...ok.item, texto: 'Rascunho editado' }, { trilha }), false);
  assert.equal(aprovacao.decidir(ok.item, { ...base, decisao: 'rejeitar', motivo: 'x', env: ON, trilha }).erro, 'item já decidido');
  assert.equal(aprovacao.verificarTrilha(trilha, { ultimoHash: aprovacao.HASH_INICIAL }).ok, false, 'âncora detecta remoção no fim');
});

t('pendência link.amazon do checklist continua citada enquanto o classificador marcar o host', () => {
  const cfg = afiliados.loadConfig();
  const amazon = cfg.links.amazon?.url ?? '';
  if (amazon.startsWith('https://link.amazon/') && moderacao.classificarMensagem(amazon).nivel !== 'ok') assert.match(doc, /`link\.amazon`/);
});

t('o runbook não manda publicar nem ler secrets', () => {
  assert.doesNotMatch(doc, /\b(sendMessage|api\.telegram\.org|graph\.facebook\.com)\b/);
  assert.match(doc, /nenhum agente lê ou copia/);
});

t('script de prévia do runbook roda e gera rascunho só de oferta atual', () => {
  const m = doc.match(/<!-- previa:inicio -->\s*```js\n([\s\S]*?)```\s*<!-- previa:fim -->/);
  assert.ok(m, 'bloco de prévia ausente');
  const script = m[1];
  assert.doesNotMatch(script, /\bfetch\(|https?\.request|child_process/);
  const lida = new Date(Date.parse(NOW) - 10 * 60e3).toISOString();
  const velha = new Date(Date.parse(NOW) - 3 * 3600e3).toISOString();
  const oferta = (id, productId, storeId, price, extra = {}) => ({
    id, productId, storeId, storeName: `Loja ${storeId}`, url: `https://${storeId}.com.br/p/${id}`, price, total: price + 20,
    shippingKnown: true, stock: 'IN_STOCK', stale: false, anomalous: false, source_timestamp: lida, ...extra,
  });
  const state = {
    products: [
      { id: 'me02-blister4', collectionName: 'Fogo Fantasmagórico', typeLabel: 'Blister Quádruplo', type: 'blister_4', name: 'Fogo Fantasmagórico - Blister Quádruplo', offerCount: 2 },
      { id: 'sv7-booster', collectionName: 'Coroa Estelar', typeLabel: 'Booster unitário', type: 'booster', name: 'Coroa Estelar - Booster unitário', offerCount: 1 },
    ],
    offers: [
      oferta('o1', 'me02-blister4', 'lojaa', 50.35),
      oferta('o2', 'sv7-booster', 'lojab', 11.9, { shippingKnown: false, total: 11.9 }),
      oferta('o3', 'me02-blister4', 'lojac', 45, { source_timestamp: velha }),
    ],
  };
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'social-runbook-'));
  const arq = path.join(dir, 'state.json');
  fs.writeFileSync(arq, JSON.stringify(state));
  try {
    const r = spawnSync(process.execPath, ['--input-type=module', '-', arq], {
      cwd: root, input: script, encoding: 'utf8', env: { PATH: process.env.PATH, PREVIA_NOW: NOW },
    });
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, /^recusadas: 1 frescor não atual/m);
    assert.match(r.stdout, /--- me02-blister4\|lojaa\|5035/);
    assert.match(r.stdout, /total com frete R\$\s70,35/);
    assert.match(r.stdout, /https:\/\/tcgpricehunter\.com\.br\/produto\/fogo-fantasmagorico-blister-quadruplo/);
    assert.match(r.stdout, /R\$\s11,90 em Loja lojab \(frete a calcular\)/);
    assert.match(r.stdout, /avisos: frete desconhecido/);
    assert.doesNotMatch(r.stdout, /lojac/);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

console.log(`social-runbook-tests: ${n} ok`);
