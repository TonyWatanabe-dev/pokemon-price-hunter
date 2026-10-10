// Feed de oportunidades (#53): o que mudou na oferta — queda de preço, novo anúncio ou restock — com as regras de
// dados ausentes: estoque desconhecido não vira disponível, total com frete desconhecido nunca é comparado,
// oferta stale/anômala/não confirmada não gera mudança, leitura repetida e preço que vai e volta não são queda.
// Função pura (src/core/offer-change.js), sem banco. Registrado via import no fim de test/price-engine-tests.js.
import assert from 'node:assert/strict';
import { classifyOfferChange, CHANGE, CHANGE_LABEL } from '../src/core/offer-change.js';

const NOW = Date.parse('2026-10-10T12:00:00Z');
const H = (h) => new Date(NOW - h * 3600e3).toISOString();
const offer = (x = {}) => ({ status: 'active', stock_status: 'in_stock', first_seen_at: H(24 * 10), anomalous: false, confirmed: true, ...x });
// leitura de price_history: total só com frete conhecido (como grava src/core/mappers.js)
const pt = (h, price, total = null, stock = 'in_stock') => ({ observed_at: H(h), price, total_price: total, stock_status: stock });
const C = (o, history = [], stockEvents = []) => classifyOfferChange({ offer: offer(o), history, stockEvents, now: NOW });

let n = 0;
const t = (name, fn) => { fn(); n++; };

t('mudança real: queda com frete conhecido compara total com total', () => {
  const r = C({}, [pt(30, 380, 400), pt(5, 350, 370)]);
  assert.equal(r.kind, CHANGE.DROP); assert.equal(r.label, CHANGE_LABEL[CHANGE.DROP]);
  assert.equal(r.from, 400); assert.equal(r.to, 370); assert.equal(r.basis, 'total'); assert.equal(r.at, H(5));
});

t('frete desconhecido: compara preço com preço, nunca total', () => {
  const r = C({}, [pt(30, 400), pt(5, 360)]);
  assert.equal(r.kind, CHANGE.DROP); assert.equal(r.basis, 'price'); assert.equal(r.from, 400); assert.equal(r.to, 360);
  assert.match(r.reason, /frete desconhecido/);
});

t('frete que deixou de ser conhecido (ou passou a ser) não é queda', () => {
  // total 420 (com frete) → preço 380 sem frete: o "valor" caiu só porque o frete sumiu
  const a = C({}, [pt(30, 380, 420), pt(5, 380)]);
  assert.equal(a.kind, null); assert.match(a.reason, /frete mudou/);
  const b = C({}, [pt(30, 400), pt(5, 380, 395)]);
  assert.equal(b.kind, null); assert.match(b.reason, /frete mudou/);
});

t('shipping_status unknown descarta total gravado (não usa total com frete desconhecido)', () => {
  const r = C({}, [{ ...pt(30, 400, 300), shipping_status: 'unknown' }, { ...pt(5, 390, 290), shipping_status: 'unknown' }]);
  assert.equal(r.kind, CHANGE.DROP); assert.equal(r.basis, 'price'); assert.equal(r.from, 400); assert.equal(r.to, 390);
});

t('leituras repetidas do mesmo valor (duplicatas) não criam queda nova', () => {
  const r = C({}, [pt(60, 380, 400), pt(40, 350, 370), pt(20, 350, 370), pt(2, 350, 370)]);
  assert.equal(r.kind, CHANGE.DROP); assert.equal(r.at, H(40), 'a mudança é a primeira leitura no valor novo, não a última repetida');
  const flat = C({}, [pt(30, 350, 370), pt(10, 350, 370), pt(1, 350, 370)]);
  assert.equal(flat.kind, null); assert.match(flat.reason, /sem mudança/);
});

t('preço que vai e volta em 48 h não é queda', () => {
  const r = C({}, [pt(30, 340, 360), pt(20, 380, 400), pt(5, 350, 370)]);
  assert.equal(r.kind, null); assert.match(r.reason, /48 h/);
});

t('subida de preço não é queda; queda implausível (outro produto/kit) também não', () => {
  assert.equal(C({}, [pt(30, 350, 370), pt(5, 380, 400)]).kind, null);
  const r = C({}, [pt(30, 400, 420), pt(5, 100, 120)]);
  assert.equal(r.kind, null); assert.match(r.reason, /implausível/);
});

t('queda antiga (fora da janela) não aparece como mudança recente', () => {
  const r = C({}, [pt(24 * 5, 400, 420), pt(24 * 4, 350, 370), pt(2, 350, 370)]);
  assert.equal(r.kind, null); assert.match(r.reason, /fora da janela/);
});

t('restock: último estoque conhecido era esgotado', () => {
  const r = C({}, [pt(30, 380, 400, 'out_of_stock'), pt(3, 380, 400)], [{ from_status: 'out_of_stock', to_status: 'in_stock', observed_at: H(3) }]);
  assert.equal(r.kind, CHANGE.RESTOCK); assert.equal(r.label, 'Voltou ao estoque'); assert.equal(r.at, H(3));
});

t('restock pula leitura unknown no meio (esgotado → desconhecido → em estoque)', () => {
  const r = C({}, [], [{ from_status: 'in_stock', to_status: 'out_of_stock', observed_at: H(30) },
    { from_status: 'out_of_stock', to_status: 'unknown', observed_at: H(10) }, { from_status: 'unknown', to_status: 'in_stock', observed_at: H(3) }]);
  assert.equal(r.kind, CHANGE.RESTOCK);
});

t('em estoque → desconhecido → em estoque não é restock; pré-venda que abre estoque não é restock', () => {
  const a = C({}, [], [{ from_status: 'in_stock', to_status: 'unknown', observed_at: H(10) }, { from_status: 'unknown', to_status: 'in_stock', observed_at: H(3) }]);
  assert.equal(a.kind, null);
  const b = C({}, [], [{ from_status: 'preorder', to_status: 'in_stock', observed_at: H(3) }]);
  assert.equal(b.kind, null);
});

t('estoque desconhecido agora: nenhuma mudança (não vira disponível nem indisponível)', () => {
  const r = C({ stock_status: 'unknown' }, [pt(30, 400, 420), pt(5, 350, 370, 'unknown')],
    [{ from_status: 'out_of_stock', to_status: 'unknown', observed_at: H(5) }]);
  assert.equal(r.kind, null); assert.match(r.reason, /estoque desconhecido/);
  assert.equal(C({ stock_status: 'out_of_stock' }, [pt(30, 400, 420), pt(5, 350, 370)]).kind, null);
  assert.equal(C({ stock_status: 'preorder' }, [pt(30, 400, 420), pt(5, 350, 370)]).kind, null);
});

t('leitura com estoque desconhecido no histórico não serve de base para queda', () => {
  // única leitura anterior foi unknown: sem base com estoque confirmado
  const r = C({}, [pt(30, 400, 420, 'unknown'), pt(5, 350, 370)]);
  assert.equal(r.kind, null); assert.match(r.reason, /sem leitura anterior/);
});

t('oferta stale, anômala, não confirmada ou fora do ar não gera mudança', () => {
  const h = [pt(30, 400, 420), pt(5, 350, 370)];
  assert.match(C({ stale: true }, h).reason, /stale/);
  assert.match(C({ anomalous: true }, h).reason, /anômalo/);
  assert.match(C({ confirmed: false }, h).reason, /não confirmada/);
  assert.equal(C({ status: 'removed' }, h).kind, null);
  for (const o of [{ stale: true }, { anomalous: true }, { confirmed: false }]) assert.equal(C(o, h).kind, null);
});

t('novo anúncio: primeira aparição na janela; não vira queda nem restock', () => {
  const r = C({ first_seen_at: H(6) }, [pt(6, 350, 370)], [{ from_status: null, to_status: 'in_stock', observed_at: H(6) }]);
  assert.equal(r.kind, CHANGE.NEW); assert.equal(r.label, 'Novo anúncio'); assert.equal(r.at, H(6)); assert.equal(r.to, 370); assert.equal(r.basis, 'total');
  const u = C({ first_seen_at: H(6) }, [pt(6, 350)]);
  assert.equal(u.kind, CHANGE.NEW); assert.equal(u.to, 350); assert.equal(u.basis, 'price', 'frete desconhecido: valor é o preço, não total');
  assert.equal(C({ first_seen_at: H(24 * 3) }, [pt(24 * 3, 350, 370)]).kind, null, 'vista há 3 dias não é novidade');
});

t('restock e queda na janela: vale a mudança mais recente', () => {
  const ev = [{ from_status: 'out_of_stock', to_status: 'in_stock', observed_at: H(20) }];
  const r = C({}, [pt(30, 400, 420), pt(20, 400, 420), pt(2, 360, 380)], ev);
  assert.equal(r.kind, CHANGE.DROP); assert.equal(r.from, 420); assert.equal(r.to, 380);
  const s = C({}, [pt(30, 400, 420), pt(20, 360, 380)], [{ from_status: 'out_of_stock', to_status: 'in_stock', observed_at: H(2) }]);
  assert.equal(s.kind, CHANGE.RESTOCK);
});

t('determinística: ordem das leituras não muda o resultado; não mexe nos dados recebidos', () => {
  const h = [pt(30, 380, 400), pt(20, 380, 400), pt(5, 350, 370)];
  const copy = JSON.parse(JSON.stringify(h));
  assert.deepEqual(C({}, [...h].reverse()), C({}, h));
  assert.deepEqual(h, copy);
});

t('sem oferta ou sem histórico: sem mudança, com motivo', () => {
  assert.equal(classifyOfferChange({}).kind, null);
  const r = C({}, []); assert.equal(r.kind, null); assert.ok(r.reason);
});

console.log(`✓ Mudança da oferta (queda × novo anúncio × restock, #53): ${n} grupos passaram`);

await import('./opportunity-change-api-tests.js');
