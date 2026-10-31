// tools/reparo-dados.mjs: reparo (só dry-run) de lowest/hist contaminados por casamento errado. Fixtures sintéticas,
// matchers falsos (título → produto), diretórios temporários. Nada de rede, nada do ramo data real.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hunter-reparo-'));
process.env.HUNTER_DATA_DIR = path.join(tmp, 'hd'); // histSummary (paridade) lê daqui
const R = await import('../tools/reparo-dados.mjs');
const { histSummary } = await import('../src/history.js');

// Matchers falsos: base = o que gravou os dados; candidato = a correção.
const fake = (nome, mapa) => ({ nome, commit: null, matchSha256: null, match: (o) => (o.title in mapa ? { productId: mapa[o.title], why: mapa[o.title] ? [] : ['rejeitado'] } : { productId: null, why: ['?'] }) });
const T = (d, h = '12') => `2026-10-${d}T${h}:00:00.000Z`;
const row = (t, offerId, productId, storeId, total, stock = 'IN_STOCK') => ({ t, offerId, productId, storeId, total, stock });
const offer = (id, productId, storeId, title, total, stock = 'IN_STOCK') => ({ id, productId, storeId, storeName: storeId, title, url: `https://${storeId}.example/p/${id}`, total, price: total, stock, firstSeen: T(20), source_timestamp: T(23) });

let n = 0;
function cenario({ offers, history, hist, lowest, products, distrust = null }) {
  const dir = path.join(tmp, 'dados' + (++n));
  fs.mkdirSync(path.join(dir, 'hist'), { recursive: true });
  const prods = products || Object.fromEntries([...new Set(offers.map((o) => o.productId))].map((id) => [id, { id, name: 'Produto ' + id }]));
  fs.writeFileSync(path.join(dir, 'state.json'), JSON.stringify({ generatedAt: T(23), offers, products: Object.values(prods).map((p) => ({ ...p, lowestHistorical: lowest[p.id] || null, hist: null })), distrust }));
  fs.writeFileSync(path.join(dir, 'offers.json'), JSON.stringify(Object.fromEntries(offers.map((o) => [o.id, o]))));
  fs.writeFileSync(path.join(dir, 'history.jsonl'), history.map((r) => JSON.stringify(r)).join('\n') + '\n');
  for (const h of hist) fs.writeFileSync(path.join(dir, 'hist', h.productId + '.json'), JSON.stringify(h));
  fs.writeFileSync(path.join(dir, 'lowest.json'), JSON.stringify({ ...lowest, __fromHist: true }));
  fs.writeFileSync(path.join(dir, 'products.json'), JSON.stringify(prods));
  return dir;
}

// Cenário principal: produto P (caixa do Lupo) contaminado pela caixa Implacáveis (vai para Q); F é produto falso (carta).
const TL = 'Box Zacian ex do Lupo'; const TI = 'Box Lendas Implacáveis Zacian'; const TC = 'Carta Golem ex (076/165)';
// M: produto com loja mista (item em revisão) → inteiro fora da parte automática (tudo ou nada por produto).
const TML = 'Box M certo'; const TMI = 'Box M errado';
const base = fake('base', { [TL]: 'P', [TI]: 'P', [TC]: 'F', 'Box Outro': 'O', [TML]: 'M', [TMI]: 'M' });
const cand = fake('cand', { [TL]: 'P', [TI]: 'Q', [TC]: null, 'Box Outro': 'O', [TML]: 'M', [TMI]: 'Q2' });
function principal() {
  return cenario({
    offers: [
      offer('a1', 'P', 'lojaA', TL, 150),           // legítima
      offer('b1', 'P', 'lojaB', TI, 110),           // contaminada: loja B só tem Implacáveis em P
      offer('c1', 'M', 'lojaC', TML, 160),          // M/C: mista
      offer('c2', 'M', 'lojaC', TMI, 160),
      offer('d1', 'M', 'lojaD', TMI, 100),          // M/D: só reassociada (seria removida, mas M está bloqueado)
      offer('f1', 'F', 'lojaF', TC, 47.41, 'OUT_OF_STOCK'), // carta avulsa criou o produto F
      offer('o1', 'O', 'lojaA', 'Box Outro', 99),   // produto sem relação
    ],
    history: [
      row(T(20), 'a1', 'P', 'lojaA', 150), row(T(21), 'b1', 'P', 'lojaB', 110),
      row(T(20), 'c1', 'M', 'lojaC', 160), row(T(21), 'c2', 'M', 'lojaC', 155), row(T(22), 'c2', 'M', 'lojaC', 160), row(T(21), 'd1', 'M', 'lojaD', 100),
      row(T(20), 'f1', 'F', 'lojaF', 47.41), row(T(21, '13'), 'f1', 'F', 'lojaF', 47.41, 'OUT_OF_STOCK'),
      row(T(20), 'o1', 'O', 'lojaA', 99),
    ],
    hist: [
      { productId: 'P', stores: { lojaA: { name: 'A', pts: [['2026-10-20', 150], ['2026-10-21', 150], ['2026-10-22', 150], ['2026-10-23', 150]] },
        lojaB: { name: 'B', pts: [['2026-10-21', 110], ['2026-10-22', 110], ['2026-10-23', 110]] } } },
      { productId: 'M', stores: { lojaC: { name: 'C', pts: [['2026-10-20', 160], ['2026-10-21', 155], ['2026-10-22', 160], ['2026-10-23', 160]] },
        lojaD: { name: 'D', pts: [['2026-10-21', 100], ['2026-10-22', 100]] } } },
      { productId: 'F', stores: { lojaF: { name: 'F', pts: [['2026-10-20', 47.41], ['2026-10-21', 47.41]] } } },
      { productId: 'O', stores: { lojaA: { name: 'A', pts: [['2026-10-20', 99]] } } },
    ],
    lowest: { P: { total: 110, at: T(21), storeId: 'lojaB', offerId: 'b1' }, F: { total: 47.41, at: T(20), storeId: 'lojaF', offerId: 'f1' }, O: { total: 99, at: T(20), storeId: 'lojaA', offerId: 'o1' }, M: { total: 100, at: T(21), storeId: 'lojaD', offerId: 'd1' } },
  });
}

// 1) Recalcula o lowest sem as ofertas contaminadas; preserva o hist legítimo.
const dir1 = principal();
const d1 = R.lerDados(dir1);
const r1 = R.analisar({ dados: d1, base, candidato: cand, agora: T(23) });
{
  const re = r1.relatorio.reassociacoes;
  assert.deepEqual(re.map((x) => x.offerId).sort(), ['b1', 'c2', 'd1', 'f1'], 'só as ofertas cujo produto muda');
  assert.ok(re.filter((x) => x.produtoAntigo !== 'M').every((x) => x.classe === 'auto'));
  const b1 = re.find((x) => x.offerId === 'b1');
  assert.equal(b1.produtoAntigo, 'P'); assert.equal(b1.produtoNovo, 'Q'); assert.equal(b1.titulo, TI); assert.equal(b1.loja, 'lojaB'); assert.equal(b1.preco, 110);
  assert.deepEqual(b1.historico.emEstoqueNoAntigo, [[T(21), 110]], 'evidência: linhas do history.jsonl no produto antigo');
  assert.equal(re.find((x) => x.offerId === 'f1').produtoNovo, null);

  const L = r1.proposto.lowest;
  assert.deepEqual(L.P, { total: 150, at: '2026-10-20T12:00:00.000Z', storeId: 'lojaA', offerId: null }, 'menor legítimo restante (como o __fromHist do run.js)');
  assert.deepEqual(L.O, d1.lowest.O, 'produto sem contaminação: lowest intocado');
  assert.equal(L.__fromHist, true, '__fromHist preservado (o run.js não refaz tudo)');
  const mP = r1.relatorio.menores.find((m) => m.produto === 'P');
  assert.equal(mP.classe, 'auto'); assert.equal(mP.antes.total, 110);

  const hP = r1.proposto.hist.P;
  assert.equal(hP.stores.lojaB, undefined, 'loja só com anúncios reassociados sai do hist do produto');
  assert.deepEqual(hP.stores.lojaA.pts, d1.hist.P.stores.lojaA.pts, 'loja sem contaminação: série idêntica');
  assert.equal(r1.proposto.hist.O, undefined, 'hist de produto sem relação não é proposto');

  // preço atual × menor salvo × histórico separados
  const pp = r1.relatorio.porProduto.find((p) => p.produto === 'P');
  assert.equal(pp.precoAtual.menorEmEstoque, 110); assert.equal(pp.precoAtual.menorEmEstoqueSemReassociadas, 150); assert.equal(pp.precoAtual.reassociadasEmEstoque, 1);
  assert.equal(pp.menorSalvo.antes.total, 110); assert.equal(pp.menorSalvo.depois.total, 150);
  assert.equal(pp.historico.pontosRemovidos, 3); assert.equal(pp.historico.pontosRevisao, 0);
  const sp = r1.proposto.state.products.find((p) => p.id === 'P');
  assert.equal(sp.lowestHistorical.total, 150, 'state espelha o lowest proposto');
  assert.equal(r1.proposto.state.products.find((p) => p.id === 'O').lowestHistorical.total, 99);
}

// 1a) R2, tudo ou nada por produto: M tem um ponto misto em revisão, então nada de M é aplicado (nem a loja D, que
// sozinha seria removida automaticamente, nem o lowest, nem as reassociações).
{
  // C: 20 só legítimo mantém; 21 a contaminada (155) ficou abaixo da legítima (160, em estoque por carry-forward); 22-23 empate mantém
  const pc = r1.relatorio.pontos.filter((p) => p.produto === 'M' && p.loja === 'lojaC');
  assert.equal(pc.length, 1); assert.equal(pc[0].dia, '2026-10-21'); assert.equal(pc[0].acao, 'revisao', 'mista: substituição é decisão humana');
  assert.equal(pc[0].proposta, 160);
  const pd = r1.relatorio.pontos.filter((p) => p.produto === 'M' && p.loja === 'lojaD');
  assert.equal(pd.length, 2); assert.ok(pd.every((p) => p.acao === 'revisao' && p.bloqueado && /bloqueado/.test(p.motivo)));
  assert.equal(r1.proposto.hist.M, undefined, 'nenhum arquivo de hist de M no proposto');
  assert.deepEqual(r1.proposto.lowest.M, d1.lowest.M, 'lowest de M intocado');
  const mM = r1.relatorio.menores.find((m) => m.produto === 'M');
  assert.equal(mM.classe, 'revisao'); assert.equal(mM.bloqueado, true); assert.equal(mM.depois.total, 160, 'proposta registrada');
  assert.ok(r1.relatorio.reassociacoes.filter((x) => x.produtoAntigo === 'M').every((x) => x.classe === 'revisao' && x.bloqueado));
  assert.deepEqual(r1.relatorio.contagens.produtosBloqueados, ['M']);
  assert.equal(r1.proposto.state.products.find((p) => p.id === 'M').lowestHistorical.total, 100);
  assert.ok(r1.proposto.hist.P, 'P (sem revisão) continua automático');
}

// 1b) Ponto em revisão abaixo do menor proposto: o lowest também vai para revisão (proposta trata o ponto como contaminado).
{
  const dirB = cenario({
    offers: [offer('a1', 'P', 'lojaA', TL, 150), offer('c1', 'P', 'lojaC', TL, 160), offer('c2', 'P', 'lojaC', TI, 120)],
    history: [row(T(20), 'a1', 'P', 'lojaA', 150), row(T(20), 'c1', 'P', 'lojaC', 160), row(T(21), 'c2', 'P', 'lojaC', 120)],
    hist: [{ productId: 'P', stores: { lojaA: { name: 'A', pts: [['2026-10-20', 150]] }, lojaC: { name: 'C', pts: [['2026-10-20', 160], ['2026-10-21', 120]] } } }],
    lowest: { P: { total: 120, at: T(21), storeId: 'lojaC', offerId: 'c2' } },
  });
  const rB = R.analisar({ dados: R.lerDados(dirB), base, candidato: cand, agora: T(23) });
  assert.equal(rB.relatorio.menores[0].classe, 'revisao');
  assert.equal(rB.relatorio.menores[0].depois.total, 150);
  assert.equal(rB.proposto.lowest.P.total, 120, 'nada aplicado sem decisão humana');
}

// 2) Produto falso sem ofertas legítimas: remoção só como proposta, e só quando nenhuma oferta do offers.json aponta
// para ele. Antes da integração do matcher, f1 ainda aponta para F → adiada.
{
  assert.deepEqual(r1.relatorio.remocoes, [], 'f1 ainda aponta para F: nada de remoção proposta');
  const ad = r1.relatorio.remocoesAdiadas;
  assert.deepEqual(ad.map((x) => x.produto), ['F']);
  assert.deepEqual(ad[0].ofertasApontando, ['f1']); assert.equal(ad[0].emEstoque, 0); assert.equal(ad[0].classe, 'revisao');
  assert.equal(r1.relatorio.contagens.remocoesPropostas, 0); assert.equal(r1.relatorio.contagens.remocoesAdiadas, 1);
  assert.equal(r1.proposto.lowest.F, undefined, 'lowest do falso sai (único ponto era a carta)');
  assert.deepEqual(r1.proposto.hist.F.stores, {});
  assert.ok(r1.proposto.state.products.some((p) => p.id === 'F'), 'o produto continua no state: remover é decisão humana');

  // Oferta em estoque apontando também adia (e é contada).
  const dirE = principal();
  const offE = JSON.parse(fs.readFileSync(path.join(dirE, 'offers.json'), 'utf8')); offE.f1.stock = 'IN_STOCK';
  fs.writeFileSync(path.join(dirE, 'offers.json'), JSON.stringify(offE));
  const rE = R.analisar({ dados: R.lerDados(dirE), base, candidato: cand, agora: T(23) });
  assert.equal(rE.relatorio.remocoes.length, 0); assert.equal(rE.relatorio.remocoesAdiadas[0].emEstoque, 1);

  // Depois da integração: f1 foi para "sem produto" e sumiu do offers.json. Sem o relatório anterior não há evidência
  // (oferta sem título); com --anterior, a remoção é proposta.
  const dirP = principal();
  const offP = JSON.parse(fs.readFileSync(path.join(dirP, 'offers.json'), 'utf8')); delete offP.f1;
  fs.writeFileSync(path.join(dirP, 'offers.json'), JSON.stringify(offP));
  const semAnt = R.analisar({ dados: R.lerDados(dirP), base, candidato: cand, agora: T(23) });
  assert.equal(semAnt.relatorio.remocoes.length + semAnt.relatorio.remocoesAdiadas.length, 0, 'sem evidência, nada proposto');
  const comAnt = R.analisar({ dados: R.lerDados(dirP), base, candidato: cand, agora: T(23), anterior: r1.relatorio });
  assert.deepEqual(comAnt.relatorio.remocoes.map((x) => x.produto), ['F']);
  assert.match(comAnt.relatorio.remocoes[0].acao, /proposta/); assert.equal(comAnt.relatorio.remocoes[0].classe, 'revisao');
  assert.equal(comAnt.relatorio.anterior.reassociacoes, 4);
  // P tem oferta legítima: nunca proposto, nem com --anterior.
  assert.ok(!comAnt.relatorio.remocoes.some((x) => x.produto === 'P'));
}

// 3) Escrita: só na saída; products.json nunca é proposto; relatório JSON + MD com contagens.
const out1 = path.join(tmp, 'saida1');
{
  const antes = fs.readFileSync(path.join(dir1, 'lowest.json'), 'utf8');
  R.escreverSaida(out1, r1, { dados: d1 });
  assert.equal(fs.readFileSync(path.join(dir1, 'lowest.json'), 'utf8'), antes, 'entrada não é tocada');
  for (const f of ['relatorio.json', 'relatorio.md', 'proposto/data/lowest.json', 'proposto/data/state.json', 'proposto/data/hist/P.json', 'proposto/remocoes-propostas.json', 'proposto/MANIFEST.json']) assert.ok(fs.existsSync(path.join(out1, f)), f);
  assert.ok(!fs.existsSync(path.join(out1, 'proposto/data/products.json')), 'registro de produtos não é reescrito');
  assert.ok(!fs.existsSync(path.join(out1, 'proposto/data/hist/O.json')));
  const md = fs.readFileSync(path.join(out1, 'relatorio.md'), 'utf8');
  assert.match(md, /ofertas reassociadas \| — \| 4 /); assert.match(md, /produtos bloqueados .* \| M \|/); assert.match(md, /Remoção adiada/);
  const man = JSON.parse(fs.readFileSync(path.join(out1, 'proposto/MANIFEST.json'), 'utf8'));
  assert.ok(man.arquivos.every((a) => /^[0-9a-f]{64}$/.test(a.sha256Depois)));
  R.escreverSaida(out1, r1, { dados: d1 }); // reexecução na mesma saída é permitida (marca .reparo-dados)
}

// 4) Idempotência: aplicar o proposto e rodar de novo não muda mais nada.
{
  const dir2 = path.join(tmp, 'aplicado');
  fs.cpSync(dir1, dir2, { recursive: true });
  fs.cpSync(path.join(out1, 'proposto', 'data'), dir2, { recursive: true });
  const d2 = R.lerDados(dir2);
  const r2 = R.analisar({ dados: d2, base, candidato: cand, agora: T(23) });
  assert.equal(r2.relatorio.contagens.hist.pontosRemovidosAuto, 0);
  assert.deepEqual(r2.relatorio.menores.map((m) => [m.produto, m.classe]), [['M', 'revisao']], 'só o bloqueado continua pendente');
  assert.equal(r2.relatorio.contagens.lowest.recalculadosAuto + r2.relatorio.contagens.lowest.removidosAuto, 0);
  assert.deepEqual(r2.proposto.lowest, d2.lowest);
  assert.deepEqual(Object.keys(r2.proposto.hist), []);
  assert.equal(r2.relatorio.contagens.hist.pontosRevisao, 3, 'os itens de M continuam apontados até decisão humana');
  assert.deepEqual(r2.relatorio.contagens.produtosBloqueados, ['M']);
  // Rodar duas vezes sobre a mesma entrada dá o mesmo resultado.
  const r1b = R.analisar({ dados: R.lerDados(dir1), base, candidato: cand, agora: T(23) });
  assert.deepEqual(r1b.proposto, r1.proposto);
  assert.deepEqual(r1b.relatorio, r1.relatorio);
}

// 5) Depois de integrar o matcher: offers.json já tem o produto novo; a evidência vem do history.jsonl.
{
  const dir3 = principal();
  const offs = JSON.parse(fs.readFileSync(path.join(dir3, 'offers.json'), 'utf8'));
  offs.b1.productId = 'Q'; offs.c2.productId = 'Q2'; offs.d1.productId = 'Q2';
  fs.writeFileSync(path.join(dir3, 'offers.json'), JSON.stringify(offs));
  const r3 = R.analisar({ dados: R.lerDados(dir3), base, candidato: cand, agora: T(23) });
  assert.equal(r3.proposto.lowest.P.total, 150);
  assert.equal(r3.relatorio.reassociacoes.find((x) => x.offerId === 'b1').produtoGravado, 'Q');
  assert.ok(r3.relatorio.reassociacoes.filter((x) => x.produtoAntigo === 'P').every((x) => x.classe === 'auto'));
}

// 5b) Pós-integração com ofertas que SUMIRAM do offers.json (foram para "sem produto"): sem título, a comparação
// base × candidato não as vê. Com --anterior (dry-run pré-integração), a reassociação registrada lá vale como evidência.
{
  const dirS = principal();
  const offS = JSON.parse(fs.readFileSync(path.join(dirS, 'offers.json'), 'utf8')); delete offS.b1; delete offS.f1;
  fs.writeFileSync(path.join(dirS, 'offers.json'), JSON.stringify(offS));
  const sem = R.analisar({ dados: R.lerDados(dirS), base, candidato: cand, agora: T(23) });
  assert.ok(!sem.relatorio.reassociacoes.some((r) => r.offerId === 'b1'), 'sem --anterior, b1 (sem título) é invisível');
  assert.equal(sem.proposto.lowest.P.total, 110, 'e a contaminação de P passaria despercebida');
  const com = R.analisar({ dados: R.lerDados(dirS), base, candidato: cand, agora: T(23), anterior: r1.relatorio });
  const b1 = com.relatorio.reassociacoes.find((r) => r.offerId === 'b1');
  assert.equal(b1.origem, 'anterior'); assert.equal(b1.classe, 'auto'); assert.equal(b1.produtoGravado, null);
  assert.deepEqual(b1.historico.emEstoqueNoAntigo, [[T(21), 110]], 'evidência recalculada no history.jsonl atual');
  assert.deepEqual(com.proposto.lowest.P, r1.proposto.lowest.P, 'mesmo resultado do dry-run pré-integração');
  assert.deepEqual(com.proposto.hist.P, r1.proposto.hist.P);
  assert.equal(com.relatorio.contagens.reassociacoes.viaAnterior, 2);
  assert.ok(com.relatorio.reassociacoes.filter((r) => r.offerId !== 'b1' && r.offerId !== 'f1').every((r) => r.origem === 'titulo'));
  // Oferta da anterior que voltou a aparecer em outro produto (título pode ter mudado) vai para revisão.
  const hs = fs.readFileSync(path.join(dirS, 'history.jsonl'), 'utf8') + JSON.stringify(row(T(23), 'b1', 'Z', 'lojaB', 90)) + '\n';
  fs.writeFileSync(path.join(dirS, 'history.jsonl'), hs);
  const z = R.analisar({ dados: R.lerDados(dirS), base, candidato: cand, agora: T(23), anterior: r1.relatorio });
  assert.equal(z.relatorio.reassociacoes.find((r) => r.offerId === 'b1').classe, 'revisao');
}

// 6) Revisão humana: oferta com histórico em outro produto (título pode ter mudado) e salto grande no menor preço.
{
  const dir4 = cenario({
    offers: [offer('x1', 'P', 'lojaX', TI, 100), offer('y1', 'P', 'lojaY', TL, 400)],
    history: [row(T(18), 'x1', 'Z', 'lojaX', 90), row(T(20), 'x1', 'P', 'lojaX', 100), row(T(20), 'y1', 'P', 'lojaY', 400)],
    hist: [{ productId: 'P', stores: { lojaX: { name: 'X', pts: [['2026-10-20', 100]] }, lojaY: { name: 'Y', pts: [['2026-10-20', 400]] } } }],
    lowest: { P: { total: 100, at: T(20), storeId: 'lojaX', offerId: 'x1' } },
  });
  const r4 = R.analisar({ dados: R.lerDados(dir4), base, candidato: cand, agora: T(23) });
  const x1 = r4.relatorio.reassociacoes[0];
  assert.equal(x1.classe, 'revisao'); assert.match(x1.motivos.join(), /outro produto \(Z\)/);
  assert.equal(r4.relatorio.pontos[0].acao, 'revisao', 'ponto de anúncio em revisão não é removido automaticamente');
  assert.equal(r4.relatorio.menores[0].classe, 'revisao');
  assert.deepEqual(r4.proposto.lowest.P, { total: 100, at: T(20), storeId: 'lojaX', offerId: 'x1' }, 'em revisão: lowest proposto = atual');
  assert.equal(r4.relatorio.menores[0].depois.total, 400, 'mas a proposta fica registrada no relatório');

  const dir5 = cenario({
    offers: [offer('x1', 'P', 'lojaX', TI, 100), offer('y1', 'P', 'lojaY', TL, 400)],
    history: [row(T(20), 'x1', 'P', 'lojaX', 100), row(T(20), 'y1', 'P', 'lojaY', 400)],
    hist: [{ productId: 'P', stores: { lojaX: { name: 'X', pts: [['2026-10-20', 100]] }, lojaY: { name: 'Y', pts: [['2026-10-20', 400]] } } }],
    lowest: { P: { total: 100, at: T(20), storeId: 'lojaX', offerId: 'x1' } },
  });
  const r5 = R.analisar({ dados: R.lerDados(dir5), base, candidato: cand, agora: T(23) });
  assert.equal(r5.relatorio.menores[0].classe, 'revisao', `400 > ${R.SALTO_MAX}× 100: decisão humana`);
  assert.equal(r5.proposto.lowest.P.total, 100);
  assert.ok(r5.relatorio.pontos[0].acao === 'revisao' && r5.relatorio.pontos[0].bloqueado, 'lowest em revisão bloqueia também a remoção do ponto');
  assert.equal(r5.proposto.hist.P, undefined);

  // R6: série da loja só com anúncios reassociados, mas ponto anterior à 1ª linha do history.jsonl (log de 45 dias ×
  // hist de 180): sem evidência, vai para revisão e nada da loja/produto é apagado.
  const dir6 = cenario({
    offers: [offer('x1', 'P', 'lojaX', TI, 95), offer('y1', 'P', 'lojaY', TL, 120)],
    history: [row(T(22), 'x1', 'P', 'lojaX', 95), row(T(10), 'y1', 'P', 'lojaY', 120)],
    hist: [{ productId: 'P', stores: { lojaX: { name: 'X', pts: [['2026-09-15', 90], ['2026-10-22', 95]] }, lojaY: { name: 'Y', pts: [['2026-10-10', 120]] } } }],
    lowest: { P: { total: 90, at: '2026-09-15T12:00:00.000Z', storeId: 'lojaX', offerId: null } },
  });
  const r6 = R.analisar({ dados: R.lerDados(dir6), base, candidato: cand, agora: T(23) });
  const antigo = r6.relatorio.pontos.find((p) => p.dia === '2026-09-15');
  assert.equal(antigo.acao, 'revisao'); assert.match(antigo.motivo, /sem evidência/);
  assert.equal(r6.relatorio.pontos.find((p) => p.dia === '2026-10-22').acao, 'revisao', 'produto bloqueado: o ponto com evidência também espera');
  assert.equal(r6.proposto.hist.P, undefined, 'nenhum ponto sem evidência apagado');
  assert.deepEqual(r6.proposto.lowest.P, R.lerDados(dir6).lowest.P);
}

// 7) Recusa de escrita no ramo data, dentro da pasta lida, em pasta alheia; recusa de --aplicar.
{
  const git = (cwd, ...a) => { const r = spawnSync('git', a, { cwd, encoding: 'utf8' }); assert.equal(r.status, 0, r.stderr); return r.stdout; };
  const env = ['-c', 'user.name=t', '-c', 'user.email=t@t'];
  const repo = path.join(tmp, 'checkout-data'); fs.mkdirSync(repo);
  git(repo, 'init', '-q', '-b', 'data'); fs.writeFileSync(path.join(repo, 'x'), '1'); git(repo, 'add', 'x'); git(repo, ...env, 'commit', '-qm', 'qualquer');
  assert.throws(() => R.verificarSaida(path.join(repo, 'saida')), /ramo data/);
  assert.throws(() => R.escreverSaida(path.join(repo, 'saida'), r1, { dados: d1 }), /ramo data/);
  assert.ok(!fs.existsSync(path.join(repo, 'saida')), 'nada escrito');
  const repo2 = path.join(tmp, 'checkout-dados'); fs.mkdirSync(repo2);
  git(repo2, 'init', '-q', '-b', 'outro'); fs.writeFileSync(path.join(repo2, 'x'), '1'); git(repo2, 'add', 'x'); git(repo2, ...env, 'commit', '-qm', 'dados 2026-10-25T11:34Z');
  assert.throws(() => R.verificarSaida(path.join(repo2, 'a', 'b')), /ramo data/, 'commit no formato do push-data.sh');
  const repo3 = path.join(tmp, 'checkout-main'); fs.mkdirSync(repo3);
  git(repo3, 'init', '-q', '-b', 'main'); fs.writeFileSync(path.join(repo3, 'x'), '1'); git(repo3, 'add', 'x'); git(repo3, ...env, 'commit', '-qm', 'feat: x');
  assert.doesNotThrow(() => R.verificarSaida(path.join(repo3, 'saida')));
  assert.throws(() => R.verificarSaida(path.join(dir1, 'saida'), dir1), /pasta de dados/);
  assert.throws(() => R.verificarSaida(tmp, dir1), /pasta de dados/, 'saída que contém os dados');
  const alheia = path.join(tmp, 'alheia'); fs.mkdirSync(alheia); fs.writeFileSync(path.join(alheia, 'nota.txt'), 'x');
  assert.throws(() => R.verificarSaida(alheia), /não está vazia/);
  await assert.rejects(R.main(['--dados', dir1, '--candidato', RAIZ, '--saida', path.join(tmp, 's'), '--aplicar'], () => {}), /não implementado/);
  await assert.rejects(R.main(['--dados', dir1, '--saida', path.join(tmp, 's')], () => {}), /uso:/);
  for (const f of ['--aplicar=sim', '--apply=1', '--apply', '--aplicar=']) await assert.rejects(R.main(['--dados', dir1, '--candidato', RAIZ, '--saida', path.join(tmp, 's'), f], () => {}), /não implementado/, f);
  assert.ok(!fs.existsSync(path.join(tmp, 's')), 'nada escrito');
  fs.writeFileSync(path.join(tmp, 'ant.json'), '{"x":1}');
  await assert.rejects(R.main(['--dados', dir1, '--candidato', RAIZ, '--saida', path.join(tmp, 's'), '--anterior', path.join(tmp, 'ant.json')], () => {}), /--anterior/);
}

// 8) resumoHist = histSummary (src/history.js) e matcherDe carrega um checkout de verdade.
{
  fs.mkdirSync(path.join(tmp, 'hd', 'hist'), { recursive: true });
  const h = { productId: 'H', stores: { a: { name: 'a', pts: [['2026-10-15', 200], ['2026-10-18', 180], ['2026-10-20', 150], ['2026-10-20', 140]] }, b: { name: 'b', pts: [['2026-10-19', 170], ['x', 1]] } } };
  fs.writeFileSync(path.join(tmp, 'hd', 'hist', 'H.json'), JSON.stringify(h));
  assert.deepEqual(R.resumoHist(h), histSummary('H'));
  const dist = { stores: ['a'], until: '2026-10-18' };
  assert.deepEqual(R.resumoHist(h, dist), histSummary('H', dist));
  const m = await R.matcherDe(RAIZ, [], 'main');
  assert.match(m.matchSha256, /^[0-9a-f]{64}$/);
  const x = m.match({ title: 'Carta avulsa qualquer', url: '' });
  assert.ok('productId' in x);
}

// Decisão do dono (docs/reparo-dados.md §0.6): "apagar" tira os pontos em revisão do produto (sem substituto) e apaga o
// menor preço salvo sem recalcular; o produto deixa de ficar bloqueado. Os outros produtos não mudam.
{
  const rd = R.analisar({ dados: d1, base, candidato: cand, agora: T(23), decisoes: { M: 'apagar' } });
  assert.deepEqual(rd.relatorio.contagens.produtosBloqueados, [], 'M deixa de ficar bloqueado');
  const pM = rd.relatorio.pontos.filter((p) => p.produto === 'M');
  assert.ok(pM.length && pM.every((p) => p.acao === 'remover'), 'nenhum ponto de M fica em revisão');
  assert.ok(pM.filter((p) => p.classe === 'decisao').every((p) => p.proposta == null && /decisão do dono: apagar/.test(p.motivo)), 'sem valor substituto');
  assert.ok(pM.some((p) => p.classe === 'decisao'));
  const mM = rd.relatorio.menores.find((m) => m.produto === 'M');
  assert.equal(mM.classe, 'decisao'); assert.equal(mM.depois, null);
  assert.equal(rd.proposto.lowest.M, undefined, 'lowest de M apagado, sem recalcular');
  assert.equal(rd.relatorio.contagens.lowest.removidosDecisao, 1);
  assert.ok(rd.proposto.hist.M, 'hist de M proposto sem os pontos contaminados');
  for (const p of pM) assert.ok(!(rd.proposto.hist.M.stores[p.loja]?.pts || []).some(([d]) => d === p.dia), `ponto ${p.loja} ${p.dia} removido`);
  assert.deepEqual(rd.proposto.lowest.P, r1.proposto.lowest.P, 'P igual ao reparo automático');
  assert.deepEqual(rd.proposto.hist.P, r1.proposto.hist.P);
  assert.throws(() => R.analisar({ dados: d1, base, candidato: cand, agora: T(23), decisoes: { M: 'recalcular' } }), /decisão inválida/);
}

fs.rmSync(tmp, { recursive: true, force: true });
console.log('reparo-dados: ok (9 grupos)');
