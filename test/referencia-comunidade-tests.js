// Referência da comunidade (decisão do proprietário, 15/10/2026): preço que NÃO é o oficial confirmado da Copag aparece como
// "Ref. da comunidade" (curto) / "Referência da comunidade" (longo), com a nota "preço divulgado fora do site da Copag; não
// confirmado". "Copag" como nome de referência fica só para o preço oficial confirmado. Nenhum rótulo "internet" sobra.
// Roda trechos reais de index.html num sandbox, o SSR de api/pagina.mjs num processo filho e os rótulos da API.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { KINDS, LABEL, contextReferenceView } from '../api/_lib/references.mjs';
import { calculateOpportunity } from '../src/core/opportunity-engine.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8').replace(/\r\n/g, '\n');
const html = read('index.html');
let n = 0; const t = async (name, fn) => { try { await fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } };
const text = (h) => h.replace(/<[^>]+>/g, ' ').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const money = (v) => (typeof v !== 'number' ? '-' : 'R$ ' + v.toFixed(2).replace('.', ','));
const line = (prefix) => { const l = html.split('\n').find((x) => x.startsWith(prefix)); assert.ok(l, `linha ${prefix}`); return l; };
const cutFn = (a) => { const i = html.indexOf(a); assert.ok(i > 0, `função ${a}`); const j = html.indexOf('\n}\n', i); assert.ok(j > i, `fim de ${a}`); return html.slice(i, j + 3); };
const run = (code, ctx, expose) => { vm.createContext(ctx); vm.runInContext(code + `\n;globalThis.__t={${expose}};`, ctx); return ctx.__t; };

await t('1. nenhum rótulo "internet" para referência de preço (site, SSR e API de exibição)', () => {
  const OLD = /ref\.?\s*internet|\(internet\)|na internet|sugerido \(internet\)/i;
  for (const f of ['index.html', 'api/pagina.mjs', 'api/_seo.mjs', 'api/v1.mjs', 'api/_lib/references.mjs', 'src/core/opportunity-engine.js']) assert.doesNotMatch(read(f), OLD, f);
  // no index.html, "internet" só sobra nas mensagens de falta de conexão (login/salvar), nunca perto de preço/referência
  const left = html.split('\n').filter((l) => /internet/i.test(l));
  for (const l of left) for (const m of l.matchAll(/[^"]{0,60}internet[^"]{0,40}/gi)) assert.match(m[0], /conex[aã]o/i, `"internet" fora de mensagem de conexão: ${m[0]}`);
  for (const f of ['api/pagina.mjs', 'api/_seo.mjs', 'api/v1.mjs']) assert.doesNotMatch(read(f), /internet/i, f);
});

await t('2. rótulos curto/longo e a nota de explicação no site', () => {
  assert.ok((html.match(/>Ref\. da comunidade</g) || []).length >= 2, 'chip/rótulo curto no cartão e em /precos');
  assert.match(html, /<span>Referência da comunidade<\/span>/, 'rótulo longo na comparação da página do produto');
  const { REFNOTE } = run(line('const REFNOTE='), {}, 'REFNOTE');
  assert.match(REFNOTE, /^Referência da comunidade: /); assert.match(REFNOTE, /preço divulgado fora do site da Copag/); assert.match(REFNOTE, /não confirmado/);
  assert.match(REFNOTE, /não entra no Opportunity Score nem nos alertas/, 'a nota continua dizendo que não entra no cálculo');
  // os pontos que mostram a referência usam a nota (tooltip ou linha de explicação)
  assert.match(html, /<span class="refnet" title="\$\{esc\(REFNOTE\)\}">Ref\. da comunidade<\/span>/);
  assert.match(html, /<span class="chip warn" title="\$\{esc\(REFNOTE\)\}">Ref\. da comunidade<\/span>/);
  assert.match(html, /<p class="refline">\$\{ic\("info"\)\}<span>\$\{REFNOTE\}/);
  assert.match(html, /\$\{d\.refNet\?`<p class="hnote">\$\{REFNOTE\}<\/p>`:""\}/);
});

await t('3. "Copag" só nomeia a referência quando o preço oficial está confirmado (cartão, desconto, produto)', () => {
  const { refOf } = run(line('const refOf='), {}, 'refOf');
  assert.equal(refOf({ copagConfirmed: true, msrp: 400 }).net, false, 'oficial confirmado');
  assert.equal(refOf({ copagConfirmed: false, copagReference: 380, msrp: 380 }).net, true, 'não confirmado = comunidade');
  assert.equal(refOf({ copagConfirmed: false }), null);
  // cada rótulo com "Copag" está no ramo do confirmado; o ramo da referência usa o rótulo da comunidade
  assert.ok(html.includes('p.copagConfirmed?`Copag <s>${money(p.msrp)}</s>'), 'cartão: "Copag" só com copagConfirmed');
  assert.ok(html.includes('${r.net?"vs ref. da comunidade":"vs Copag"}'), 'selo de desconto');
  assert.ok(html.includes('acima da ${r.net?"ref. da comunidade":"Copag"}'), 'selo de acima');
  assert.ok(html.includes('${p.copagConfirmed?`<div class="cmp4"><div><span>Preço sugerido Copag</span>'), 'página do produto');
  const commBranch = html.slice(html.indexOf('(p.copagReference?(()=>{const rv=p.copagReference'), html.indexOf('<p class="refline">', html.indexOf('(p.copagReference?(()=>{const rv=p.copagReference')));
  assert.ok(commBranch.length > 0 && commBranch.includes('Referência da comunidade'), 'ramo da referência no produto');
  assert.doesNotMatch(commBranch, /Copag/, 'ramo da referência não diz "Copag"');
});

await t('4. /precos no site: linha da comunidade com "Ref. da comunidade" e nota; "Copag" só na linha oficial', () => {
  const { REFNOTE } = run(line('const REFNOTE='), {}, 'REFNOTE');
  const col = { id: 'c1', name: 'Alfa' };
  const prod = (id, x) => ({ id, collection: 'c1', collectionName: 'Alfa', type: 'etb', typeLabel: 'ETB ' + id, ...x });
  const OF = prod('of', { copagConfirmed: true, msrp: 400, copag: { msrp: 400, source_url: 'https://www.copagloja.com.br/x/p', source_timestamp: '2026-10-08T10:00:00Z' } });
  const CM = prod('cm', { copagConfirmed: false, copagReference: 380, copagReferenceUrl: 'https://www.instagram.com/p/tabela/' });
  const slot = { innerHTML: '' };
  run(cutFn('function renderCopag'), { S: { products: [OF, CM], collections: [col] }, esc, money, ic: (k) => `<i:${k}>`, safeUrl: (u) => u, REFNOTE,
    label: (p) => p.typeLabel, Date, $: () => slot }, 'renderCopag').renderCopag();
  const rows = slot.innerHTML.split('<tr class="click"').slice(1);
  const rOf = rows.find((r) => r.includes('data-p="of"')), rCm = rows.find((r) => r.includes('data-p="cm"'));
  assert.ok(rOf && rCm);
  assert.match(slot.innerHTML, /<caption class="tcap">Fonte: <a [^>]*>Loja oficial Copag<\/a><\/caption>/, 'fonte oficial Copag (no caption, uma vez por coleção)');
  assert.match(text('<x' + rOf), /R\$ 400,00 Conferido em/, 'linha oficial com preço e data');
  assert.match(rCm, /<span class="chip warn" title="Referência da comunidade: preço divulgado fora do site da Copag[^"]*não confirmado[^"]*">Ref\. da comunidade<\/span>/);
  assert.doesNotMatch(text('<x' + rCm), /Copag|internet/i, 'texto visível da linha da comunidade sem "Copag"');
  assert.match(text(slot.innerHTML), /1 oficiais 1 só ref\. da comunidade 0 sem preço/);
});

await t('5. SSR (api/pagina.mjs): /precos e listas com "Referência da comunidade"; "Copag" só no confirmado', () => {
  const T = '2026-10-09T17:55:00.000Z';
  const prod = (id, x) => ({ id, collection: 'c1', collectionName: 'Alfa', type: 'etb', typeLabel: 'ETB ' + id, group: 'ETB', boosters: null, offerCount: 1, ...x });
  const P = [prod('of', { copagConfirmed: true, msrp: 400, copag: { msrp: 400, source_url: 'https://www.copagloja.com.br/x/p', source_timestamp: T, msrp_updated_at: T } }),
    prod('cm', { copagConfirmed: false, msrp: 380, copagReference: 380, copagReferenceUrl: 'https://www.instagram.com/p/tabela/', lastSeen: T })];
  const off = (id, productId, price) => ({ id, productId, storeId: 's-' + id, storeName: 'Loja ' + id, title: 'x', url: 'https://x.com.br/' + id, price, priceKind: 'base', shipping: 0,
    shippingKnown: true, total: price, stock: 'IN_STOCK', confirmed: true, anomalous: false, stale: false, discount: null, matchConfidence: 0.95, firstSeen: T, source_timestamp: T });
  const O = [off('a', 'of', 350), off('b', 'cm', 330)];
  const state = { generatedAt: T, coverage: { found: 2 }, totals: { offers: 2 }, products: P, offers: O, collections: [{ id: 'c1', name: 'Alfa', series: 'S', aliases: [], products: 2 }],
    types: [{ id: 'etb', label: 'ETB', group: 'ETB', products: 2 }], sources: [], activity: [], tips: [], bestDeals: [] };
  const script = `import { setFreshnessClock } from ${JSON.stringify(pathToFileURL(path.join(root, 'api/_lib/freshness.mjs')).href)};
    setFreshnessClock(() => ${Date.parse('2026-10-09T18:00:00.000Z')}); const st = JSON.parse(process.argv[1]);
    globalThis.fetch = async () => new Response(JSON.stringify(st), { status: 200 });
    const { default: h } = await import(${JSON.stringify(pathToFileURL(path.join(root, 'api/pagina.mjs')).href)});
    const out = {};
    for (const q of ['t=precos', 't=colecao&slug=alfa']) { const res = { headers: {}, setHeader(k, v) { this.headers[k] = v; }, end(b) { this.body = b; } };
      await h({ url: '/api/pagina?' + q, headers: { host: 'x' } }, res); out[q] = res.body; }
    console.log(JSON.stringify(out));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script, JSON.stringify(state)], { cwd: root, encoding: 'utf8', maxBuffer: 64 << 20, env: { ...process.env, API_DATABASE_URL: '' } });
  assert.equal(r.status, 0, r.stderr);
  const out = JSON.parse(r.stdout.trim().split('\n').pop());
  const ssr = (b) => (b.match(/<div class="ssr">([\s\S]*?)<\/div><\/div>/) || [])[1] || '';
  const precos = ssr(out['t=precos']);
  const tr = precos.split('<tr>').slice(1); const tOf = tr.find((x) => x.includes('ETB of')), tCm = tr.find((x) => x.includes('ETB cm'));
  assert.ok(tOf && tCm, '/precos lista as duas linhas');
  assert.match(text('<x>' + tOf), /Preço sugerido Copag \(oficial\)/);
  assert.match(tCm, /<span title="Preço divulgado fora do site da Copag; não confirmado">Referência da comunidade \(não confirmada\)<\/span>/);
  assert.doesNotMatch(text('<x>' + tCm), /Copag|internet/i, 'texto visível da linha da comunidade sem "Copag"');
  const lis = ssr(out['t=colecao&slug=alfa']).split('<li>').slice(1);
  assert.match(text('<x>' + lis.find((x) => x.includes('ETB of'))), /Copag R\$ ?400,00/, 'lista: Copag com o confirmado');
  assert.doesNotMatch(text('<x>' + lis.find((x) => x.includes('ETB cm'))), /Copag/, 'lista: sem "Copag" para a referência da comunidade');
});

await t('6. API: rótulo da referência comunitária e aviso do motor dizem "referência da comunidade", sem nomear Copag', () => {
  assert.equal(LABEL.COMMUNITY_REFERENCE, 'Referência da comunidade');
  for (const k of KINDS) if (/Copag/.test(LABEL[k])) assert.ok(k.startsWith('COPAG_OFFICIAL'), `${k}: ${LABEL[k]}`);
  assert.match(LABEL.COPAG_OFFICIAL_CURRENT, /Copag/, 'oficial confirmado continua "Copag"');
  const v = contextReferenceView({ reference_kind: 'COMMUNITY_REFERENCE', value: 399.99, confidence: 95, source_url: 'https://www.instagram.com/voltztcg/' });
  assert.equal(v.label, 'Referência da comunidade'); assert.notEqual(v.source, 'Copag');
  const src = read('src/core/opportunity-engine.js');
  assert.match(src, /`Existe uma referência da comunidade de \$\{brl\(c\.price\)\}/); assert.doesNotMatch(src, /Existe uma referência comunitária/);
  assert.equal(typeof calculateOpportunity, 'function');
});

console.log(`✓ Referência da comunidade (rótulos): ${n} grupos de testes passaram`);
