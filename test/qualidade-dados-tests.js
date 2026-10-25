// Relatório de qualidade dos dados (tools/qualidade-dados.mjs, auditoria de 25/10/2026): cobertura com a regra de
// "viva" do site, lojas por plataforma, oferta visível sem verificação, frescor, preço fora da referência Copag,
// página repetida por parâmetro de rastreio (srsltid), produtos com o mesmo nome, episódios da fonte vigiada e
// contadores de remoção (#897). Fixtures SINTÉTICAS; nada é gravado fora da pasta temporária.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { relatorioQualidade, ofertasRepetidas, episodiosVigiados, markdown, main, viva } from '../tools/qualidade-dados.mjs';

let n = 0; const t = (name, fn) => { try { fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } };
const NOW = '2026-10-25T00:15:00.000Z';
const h = (x) => new Date(Date.parse(NOW) - x * 36e5).toISOString();
const of = (id, over = {}) => ({ id, productId: 'me05-etb', storeId: 'loja', url: `https://loja.test/p/${id}`, price: 400, total: 400, stock: 'IN_STOCK', stale: false, anomalous: false, confirmed: true, source_timestamp: h(0.5), ...over });
const state = (offers, products = [{ id: 'me05-etb', name: 'Escuridão Absoluta - ETB', msrp: 399.99 }]) => ({ generatedAt: NOW, offers, products });

t('viva segue a regra do site', () => {
  assert.equal(viva(of('a')), true);
  for (const o of [of('b', { stale: true }), of('c', { stock: 'OUT_OF_STOCK' }), of('d', { anomalous: true }), of('e', { total: 0 }), of('f', { stock: 'UNKNOWN' })]) assert.equal(viva(o), false, o.id);
});

t('cobertura, frescor, visíveis sem verificação e preço fora da referência', () => {
  const r = relatorioQualidade({ state: state([
    of('a'), of('b', { stale: true, stock: 'UNKNOWN' }), of('c', { stock: 'OUT_OF_STOCK' }), of('d', { storeId: 'outra', source_timestamp: h(8) }),
    of('e', { price: null, storeId: 'outra' }), of('f', { price: 1200, total: 1200, storeId: 'cara' }), of('g', { stock: 'UNKNOWN', storeId: 'semEstoque' }),
    of('h', { confirmed: false, storeId: 'nova', shippingKnown: true }),
  ]) });
  const c = r.cobertura;
  assert.equal(c.ofertas, 8); assert.equal(c.vivas, 5); assert.equal(c.stale, 1); assert.equal(c.lojasComViva, 4); assert.equal(c.freteConhecidoVivas, 1);
  assert.deepEqual(c.staleporLoja, { loja: 1 });
  assert.equal(r.visiveis.semPrecoLinkOuHorario, 1, 'viva sem preço válido aparece'); assert.deepEqual(r.visiveis.exemplos, ['e']);
  assert.equal(r.visiveis.naoConfirmadas, 1); assert.deepEqual(r.visiveis.estoqueNaoConfirmadoComPreco, { semEstoque: 1 });
  assert.equal(r.frescor.vivasVelhas, 1); assert.equal(r.frescor.idadeVivas['6-24h'], 1);
  assert.deepEqual(r.precoForaDaReferencia.map((x) => [x.storeId, x.razao]), [['cara', 3]]);
  assert.equal(r.vivasComReferencia, 5);
});

t('página repetida só por parâmetro de rastreio conta; query que muda produto e vendedor diferente não', () => {
  const r = ofertasRepetidas([
    of('a', { url: 'https://loja.test/etb' }), of('b', { url: 'https://loja.test/etb?srsltid=AAA' }), of('c', { url: 'https://www.loja.test/etb/?srsltid=BBB', stock: 'OUT_OF_STOCK' }),
    of('d', { url: 'https://loja.test/x?variant=1' }), of('e', { url: 'https://loja.test/x?variant=2' }),
    of('f', { url: 'https://mkt.test/p/1', sellerId: 1 }), of('g', { url: 'https://mkt.test/p/1?utm_source=z', sellerId: 2 }),
  ]);
  assert.equal(r.grupos, 1); assert.equal(r.extras, 2); assert.equal(r.extrasVivas, 1); assert.equal(r.comRastreio, 3);
  assert.deepEqual(r.porLoja, { loja: 2 });
});

t('episódios da fonte vigiada: 2+ rodadas seguidas fora avisam; ACTIVE com zero anúncios conta como fora', () => {
  const run = (at, status, listings = 10) => ({ generatedAt: at, watched: { ml: { status, listings } } });
  const e = episodiosVigiados([run('2026-10-24T11:15:00Z', 'BLOCKED'), run('2026-10-24T11:00:00Z', 'BLOCKED'), run('2026-10-24T11:30:00Z', 'ACTIVE'),
    run('2026-10-24T12:00:00Z', 'ERROR'), run('2026-10-24T12:15:00Z', 'ACTIVE'), run('2026-10-24T13:00:00Z', 'ACTIVE', 0), run('2026-10-24T13:15:00Z', 'BLOCKED')]);
  assert.equal(e.ml.rodadas, 7); assert.equal(e.ml.rodadasFora, 5); assert.equal(e.ml.episodios.length, 3); assert.equal(e.ml.episodiosQueAvisam, 2);
  assert.equal(e.ml.episodios[0].inicio, '2026-10-24T11:00:00Z', 'ordem por horário, não pela do arquivo');
  assert.deepEqual(episodiosVigiados(null), {});
});

t('fonte vigiada fora: produtos que ficam sem oferta viva por causa dela; remoções #897; plataformas', () => {
  const offers = [of('m1', { storeId: 'ml', stale: true, stock: 'UNKNOWN', productId: 'p1', lastValid: { stock: 'IN_STOCK' } }),
    of('m2', { storeId: 'ml', stale: true, stock: 'UNKNOWN', productId: 'p2', lastValid: { stock: 'IN_STOCK' } }), of('x', { productId: 'p2' })];
  const meta = { ops: { runs: [{ generatedAt: NOW, watched: { ml: { status: 'BLOCKED', listings: 2 } } }] } };
  const sources = { ml: { platform: 'mercadolivre', status: 'BLOCKED', httpStatus: 429, checks: 10, ok: 8 }, loja: { platform: 'jsonld', status: 'ACTIVE', checks: 5, ok: 5 },
    vazia: { platformHint: 'jsonld', status: 'ACTIVE', pagesGone: 1, pagesGoneConfirmed: 0, lastCheck: NOW }, cf: { status: 'BLOCKED', lastFailure: { status: 403 } } };
  const urlCache = { vazia: { removidas: { 'https://v.test/p/1': { n: 1, motivo: 'página de erro com HTTP 200', desde: NOW } } }, loja: {} };
  const r = relatorioQualidade({ state: state(offers, [{ id: 'p1', name: 'P1' }, { id: 'p2', name: 'P2' }]), sources, meta, urlCache });
  assert.equal(r.vigiados.ml.ofertasStale, 2); assert.equal(r.vigiados.ml.produtosSemVivaPorElaAgora, 1, 'p2 ainda tem viva em outra loja');
  assert.deepEqual(r.remocoes.removidas.map((x) => [x.storeId, x.n]), [['vazia', 1]]);
  assert.deepEqual(r.remocoes.paginasRemovidas, [{ storeId: 'vazia', pagesGone: 1, pagesGoneConfirmed: 0, lastCheck: NOW }]);
  assert.equal(r.plataformas.mercadolivre.http429, 1); assert.equal(r.plataformas.desconhecida.http403, 1);
  assert.equal(r.plataformas.jsonld.lojas, 2); assert.equal(r.plataformas.jsonld.comViva, 1); assert.equal(r.plataformas.jsonld.ativasSemViva, 1);
  const md = markdown(r);
  for (const s of ['## Cobertura', 'mercadolivre', '**ml**: fora em 1/1', 'url-cache `removidas`: 1', 'vazia 1 (confirmadas 0']) assert.ok(md.includes(s), s);
});

t('produtos com o mesmo nome (ex.: ev09-* e sv9-*)', () => {
  const r = relatorioQualidade({ state: state([], [{ id: 'ev09-etb', name: 'Amigos de Jornada - Treinador Avançado (ETB)' }, { id: 'sv9-etb', name: 'Amigos de Jornada – Treinador Avançado (ETB)' }, { id: 'x', name: 'Outro' }]) });
  assert.deepEqual(r.produtosMesmoNome, [['ev09-etb', 'sv9-etb']]);
});

t('CLI: lê a pasta, sem state falha fechado, --out grava só onde pedido', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'qualidade-'));
  assert.throws(() => main([dir], { log: () => {} }));
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify(state([of('a')])));
  let out = ''; const rep = main([dir, '--json', '--out', path.join(dir, 'r.json')], { log: (s) => { out += s; } });
  assert.equal(JSON.parse(out).cobertura.vivas, 1); assert.equal(rep.cobertura.vivas, 1);
  assert.deepEqual(fs.readdirSync(dir).sort(), ['r.json', 'state.json']);
  assert.throws(() => relatorioQualidade({ state: {} }), /sem offers/);
  fs.rmSync(dir, { recursive: true, force: true });
});

console.log(`qualidade-dados-tests: ${n} ok`);
