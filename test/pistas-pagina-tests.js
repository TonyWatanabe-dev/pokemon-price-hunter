// Página /pistas enxuta: lista padrão só com pistas identificadas, agrupadas por produto (cabeçalho com foto, nome e
// Copag; pistas por desconto), selo "virou oferta" na pista que a API do ML confirmou, não identificadas atrás de
// "Mostrar N não identificadas", post sem preço fora da página; contador do menu só com as identificadas.
// Usa o código real do index.html (fonte da interface) e api/_lib/site.mjs + home.mjs. Sem rede e sem banco.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { siteTips } from '../api/_lib/site.mjs';
import { slimHome } from '../api/_lib/home.mjs';

const now = Date.now(); const T = (h) => new Date(now - h * 3600e3).toISOString();
const st = () => ({
  generatedAt: T(0), dataAt: T(0), coverage: { stores: 1 }, totals: { offers: 1 },
  collections: [{ id: 'me05', name: 'Escuridão Absoluta', series: 'Megaevolução', aliases: [] }],
  types: [{ id: 'etb', label: 'Treinador Avançado (ETB)', group: 'ETB' }, { id: 'blister_3', label: 'Blister Triplo', group: 'Blisters' }],
  products: [
    { id: 'me05-etb', collection: 'me05', collectionName: 'Escuridão Absoluta', type: 'etb', typeLabel: 'Treinador Avançado (ETB)', group: 'ETB', boosters: 9, image: 'https://img/etb.png', copagConfirmed: true, msrp: 400, offerCount: 1 },
    { id: 'me05-b3', collection: 'me05', collectionName: 'Escuridão Absoluta', type: 'blister_3', typeLabel: 'Blister Triplo', group: 'Blisters', boosters: 3, image: 'https://img/b3.png', copagConfirmed: false, msrp: null, copagReference: 70, offerCount: 0 },
  ],
  offers: [{ id: 'ofml', productId: 'me05-etb', storeId: 'mercadolivre', storeName: 'Mercado Livre', url: 'https://produto.mercadolivre.com.br/MLB-1', price: 330, total: 330, stock: 'IN_STOCK', source_timestamp: T(1), sourceType: 'pista_verificada', discount: 0.175 }],
  activity: [], sources: [{ id: 'mercadolivre', name: 'Mercado Livre', url: 'https://api.mercadolibre.com', status: 'ACTIVE' }], reputation: null, distrust: null,
  tips: [
    { key: 'tg:1', id: 'ml', source: 'Telegram x', title: 'ETB', text: 'bruto', productId: 'me05-etb', collectionName: 'Escuridão Absoluta', label: 'ETB', store: 'Mercado Livre', price: 330, discount: 0.175, postedAt: T(3), firstSeen: T(3), url: 'https://meli.la/1', virouOferta: 'ofml', verificada: { at: T(1), ok: true, motivo: null, mlb: 'MLB1', ofertaId: 'ofml' } },
    { key: 'tg:2', id: 'etb2', source: 'Telegram x', title: 'ETB cara', text: 'bruto', productId: 'me05-etb', collectionName: 'Escuridão Absoluta', label: 'ETB', store: 'Shopee', price: 380, discount: 0.05, postedAt: T(2), firstSeen: T(2), url: 'https://s.shopee.com.br/1' },
    { key: 'tg:3', id: 'b3', source: 'Telegram y', title: 'Blister', text: 'bruto', productId: 'me05-b3', collectionName: 'Escuridão Absoluta', label: 'Blister Triplo', store: 'Amazon', price: 50, discount: 0.28, postedAt: T(5), url: 'https://amzn.to/1' },
    { key: 'tg:4', id: 'semp', source: 'Telegram x', title: 'Coisa qualquer', text: 'bruto', price: 10, postedAt: T(6), url: 'https://x.com/1' },                 // não identificada
    { key: 'tg:5', id: 'cupom', source: 'Telegram x', title: 'NOVOS CUPONS SHOPEE', text: 'bruto', price: null, postedAt: T(6), url: 'https://x.com/2' },        // sem preço: fora
    { key: 'tg:6', id: 'enc', source: 'Telegram x', title: 'ETB encerrada', productId: 'me05-etb', collectionName: 'Escuridão Absoluta', label: 'ETB', price: 300, postedAt: T(9), url: 'https://x.com/3', expired: true },
  ],
});
const t = async (name, fn) => { try { await fn(); } catch (e) { e.message = `${name}: ${e.message}`; throw e; } };

await t('siteTips: post sem preço fica fora; virouOferta vai para a página; texto bruto não', () => {
  const r = siteTips(st());
  assert.deepEqual(r.tips.map((x) => x.id), ['ml', 'etb2', 'b3', 'semp', 'enc']);
  assert.equal(r.tips[0].virouOferta, 'ofml'); assert.equal('verificada' in r.tips[0], false, 'detalhe interno não sai'); assert.equal('text' in r.tips[0], false);
  assert.deepEqual(r.products.map((p) => p.id), ['me05-etb', 'me05-b3']);
});

await t('contador do menu (slim): só as identificadas, vivas e com preço', () => {
  assert.equal(slimHome(st(), { source: 'state', now }).counts.tips, 3);
});

// ---- renderTips com o código real do index.html
const html = fs.readFileSync(new URL('../index.html', import.meta.url), 'utf8').replace(/\r\n/g, '\n');
const cut = (a, b) => { const i = html.indexOf(a); const j = html.indexOf(b, i + a.length); assert.ok(i > 0 && j > i, `trecho ${a}`); return html.slice(i, j); };
const cutFn = (a) => { const i = html.indexOf(a); assert.ok(i > 0, a); const j = html.indexOf('\n}\n', i); return html.slice(i, j + 3); };
const line = (p) => { const l = html.split('\n').find((x) => x.startsWith(p)); assert.ok(l, p); return l; };
const code = [
  ...['const esc=', 'const money=', 'const pct=', 'const ago=', 'const ic=', 'const safeUrl=', 'const norm=', 'const label=', 'const refOf=', 'const MK=', 'const mkDomain=', 'const mkName=', 'const chan=', 'const slugify=', 'function buildSlugs'].map(line),
  cutFn('function tipCard'), cut('const tipVs=', '/* Por que esta nota? Explicação'),
].join('\n');
function render(state) {
  const view0 = { innerHTML: '' };
  const ctx = { console, Date, Math, JSON, Number, String, Object, Array, Set, Map, URL, encodeURIComponent, Intl, S: state, P: {}, OFF: [], SLUG: {}, BYSLUG: {}, PG: {}, tipDest: (t) => t.url, $: (s) => (s === '#view' ? view0 : null),
    photo: (p, o, cls) => `<i class="${cls}" data-src="${p?.image || ''}"></i>` };
  vm.createContext(ctx);
  vm.runInContext(code + '\n;P=Object.fromEntries(S.products.map((p)=>[p.id,p]));buildSlugs();renderTips();', ctx);
  return view0.innerHTML;
}

await t('renderTips: grupos por produto (maior desconto primeiro), cabeçalho com foto, nome, Copag e link do produto', () => {
  const out = render(st());
  const groups = [...out.matchAll(/data-tipgroup="([^"]+)"/g)].map((m) => m[1]);
  assert.deepEqual(groups, ['me05-b3', 'me05-etb'], 'blister (28%) antes da ETB (17,5%)');
  assert.match(out, /<a class="ai-p" href="\/produto\/escuridao-absoluta-blister-triplo"[^>]*><i class="photo dl-ph" data-src="https:\/\/img\/b3\.png"><\/i><span>Escuridão Absoluta · Blister Triplo<\/span><\/a><small>Copag R\$\s70,00 \(ref\.\) · 1 pista<\/small>/);
  assert.match(out, /href="\/produto\/escuridao-absoluta-treinador-avancado-etb"[\s\S]*?<small>Copag R\$\s400,00 · 2 pistas · 1 virou oferta<\/small>/);
  const etb = out.slice(out.indexOf('data-tipgroup="me05-etb"'));
  assert.ok(etb.indexOf('data-tip="ml"') < etb.indexOf('data-tip="etb2"'), 'dentro do grupo, maior desconto primeiro');
});

await t('renderTips: selo "✓ virou oferta" só na pista confirmada; as outras seguem "não verificado"', () => {
  const out = render(st());
  const card = (id) => { const i = out.indexOf(`data-tip="${id}"`); return out.slice(i, out.indexOf('</a>', i)); };
  assert.match(card('ml'), /<span class="chip ok">✓ virou oferta<\/span>/); assert.match(card('ml'), /anúncio conferido na API do Mercado Livre/); assert.doesNotMatch(card('ml'), /não verificado/);
  assert.doesNotMatch(card('etb2'), /virou oferta/); assert.match(card('etb2'), /não verificado/);
  assert.doesNotMatch(card('b3'), /virou oferta/);
});

await t('renderTips: não identificadas e encerradas atrás de "Mostrar N…" (toggle, sem recarregar); post sem preço fora', () => {
  const out = render(st());
  assert.match(out, /<details class="more"><summary>[\s\S]*?Mostrar 2 não identificadas ou encerradas<\/summary>/);
  assert.ok(out.indexOf('Coisa qualquer') > out.indexOf('<details class="more">'), 'não identificada só dentro do toggle');
  assert.ok(out.indexOf('https://x.com/3') > out.indexOf('<details class="more">'), 'encerrada só dentro do toggle');
  assert.doesNotMatch(out, /NOVOS CUPONS SHOPEE/, 'post sem preço não aparece');
  assert.doesNotMatch(out, /data-tipgroup="undefined"|data-tipgroup="null"/);
  const s2 = st(); s2.tips = s2.tips.filter((x) => x.productId && !x.expired);
  assert.doesNotMatch(render(s2), /<details class="more">/, 'sem não identificadas, sem botão');
  const s3 = st(); s3.tips = [s2.tips[0] && { ...st().tips[3] }].filter(Boolean);
  assert.match(render(s3), /Mostrar 1 não identificada<\/summary>/); assert.match(render(s3), /Nenhuma pista com produto identificado agora/);
});

await t('contador c-tip do menu (estado completo): mesma regra da lista padrão', () => {
  const m = html.match(/const tp=S\.slim\?S\.counts\.tips:\(S\.tips\|\|\[\]\)\.filter\(\(x\)=>(.*?)\)\.length;/);
  assert.ok(m, 'expressão do contador');
  assert.equal(m[1], 'x.productId&&!x.expired&&x.price>0');
  assert.doesNotMatch(m[1], /discount/, 'não filtra mais por desconto');
});

console.log('pistas-pagina-tests: ok');
