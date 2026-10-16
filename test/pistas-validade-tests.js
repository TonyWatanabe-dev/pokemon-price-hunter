// Pista com data do post ilegível ou no futuro: vale a 1ª leitura (firstSeen); sem data válida, vence já.
// Na página de ofertas, a mesma promoção vinda de duas fontes aparece uma vez só.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { tipVencida } from '../src/tips.js';

const now = Date.parse('2026-10-16T12:00:00Z'); const H = 3600e3; const max = 72 * H;
const iso = (h) => new Date(now - h * H).toISOString();
assert.equal(tipVencida({ postedAt: iso(1), firstSeen: iso(1) }, now, max), false);
assert.equal(tipVencida({ postedAt: iso(80), firstSeen: iso(1) }, now, max), true, 'post antigo vence');
let t = { postedAt: 'ontem à noite', firstSeen: iso(2) };
assert.equal(tipVencida(t, now, max), false); assert.equal('postedAt' in t, false, 'data ilegível sai');
t = { postedAt: 'lixo', firstSeen: iso(90) }; assert.equal(tipVencida(t, now, max), true, 'ilegível usa firstSeen e vence');
t = { postedAt: iso(-48), firstSeen: iso(80) }; assert.equal(tipVencida(t, now, max), true, 'data no futuro não segura a pista');
assert.equal(tipVencida({ postedAt: 'x', firstSeen: 'y' }, now, max), true, 'sem data válida vence');
assert.equal(tipVencida({}, now, max), true);
assert.match(fs.readFileSync(new URL('../src/run.js', import.meta.url), 'utf8'), /if \(tipVencida\(t, now\.getTime\(\), maxAge\)\) delete tipStore\[id\];/);

// dedupe entre fontes na página de ofertas (código real do index.html)
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const i = html.indexOf('/* Pistas misturadas nas oportunidades'); const j = html.indexOf('function pistaCard', i);
const ctx = { P: {}, OF: { faixa: '', conf: '', ref: '', loja: '', cat: '', col: '', max: '', abaixo: '', sort: 'score' }, catMatch: () => true, String, Number, Map, Array, Object };
vm.createContext(ctx);
vm.runInContext(html.slice(i, j) + '\n;OPP_TIPS.st="ok";globalThis.f=(l)=>{OPP_TIPS.l=l;return oppTips().map((x)=>x.id).join()};', ctx);
const tip = (id, x) => ({ id, productId: 'p1', price: 100, store: 'Amazon', url: 'https://amzn.to/' + id, discount: 0.2, ...x });
assert.equal(ctx.f([tip('tg', { postedAt: iso(2) }), tip('pel', { postedAt: iso(5), source: 'Pelando' })]), 'pel', 'mesma promoção: fica a 1ª postada');
assert.equal(ctx.f([tip('a', { postedAt: iso(2) }), tip('b', { postedAt: iso(5), price: 90 })]).split(',').sort().join(), 'a,b', 'preço diferente: as duas');
assert.equal(ctx.f([tip('a', {}), tip('b', { store: 'Shopee' })]).split(',').sort().join(), 'a,b', 'loja diferente: as duas');
console.log('pistas-validade-tests: ok');
