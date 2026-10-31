// Reparo de dados contaminados por casamento errado (anúncio de um produto gravado em outro). SÓ DRY-RUN.
//
// Por que existe: lowest.json só desce (src/run.js: um preço menor substitui, nunca o contrário) e data/hist/<id>.json
// guarda o menor preço de cada LOJA por dia. Quando o matcher junta caixas diferentes (Zacian Implacáveis no Zacian do
// Lupo, carta avulsa "065/165" na caixa Alakazam, ME06 em ME01...), corrigir o matcher tira o anúncio do produto errado
// na rodada seguinte, mas o menor preço e os pontos do histórico gravados com o anúncio errado continuam publicados.
//
// O que faz: compara o matcher BASE (o que gravou os dados; padrão: este checkout) com um matcher CANDIDATO (a correção)
// em todo anúncio conhecido (offers.json). Anúncio cujo produto muda é "reassociado": as linhas dele no history.jsonl
// gravadas no produto antigo são a evidência do que foi contaminado. Com isso:
//   - classifica cada ponto do hist das lojas afetadas (mantém / remove / revisão humana);
//   - recalcula o menor preço salvo só dos produtos contaminados, a partir do hist reparado (como o __fromHist do run.js);
//   - lista produtos que só existem por causa de anúncios reassociados (remoção SÓ como proposta, nunca aplicada);
//   - separa preço atual (ofertas de agora) × menor preço salvo (lowest.json) × histórico (hist/).
// Funciona antes e depois de integrar o matcher corrigido: a reassociação vem de base(título) × candidato(título), não
// do productId gravado (que só serve de evidência adicional).
//
// Saída (sempre num diretório informado, nunca no ramo data):
//   <saida>/relatorio.json, <saida>/relatorio.md            inventário, evidência, classificação, contagens antes/depois
//   <saida>/proposto/data/lowest.json                       lowest proposto (só correções automáticas e seguras)
//   <saida>/proposto/data/hist/<id>.json                    só os arquivos de hist alterados
//   <saida>/proposto/data/state.json                        espelho: lowestHistorical e hist dos produtos afetados
//   <saida>/proposto/remocoes-propostas.json                produtos falsos (decisão humana)
//   <saida>/proposto/MANIFEST.json                          sha256 antes/depois de cada arquivo proposto
//
// Uso:
//   node tools/reparo-dados.mjs --dados <pasta> --candidato <checkout> --saida <pasta> [--base <checkout>] [--agora ISO]
//                               [--anterior <relatorio.json de um dry-run anterior à integração do matcher>]
//   Depois da integração: --base = checkout da main ANTIGA (o matcher que gravou os dados; o padrão é este checkout)
//   e --anterior = relatório pré-integração (evidência das ofertas que sumiram do offers.json e da remoção de produtos).
//   <pasta> de dados: contém state.json, lowest.json, products.json, offers.json, history.jsonl e hist/ (ou data/ com eles).
//   <checkout>: pasta com src/match.js, src/gate.js e config/catalog.json (ex.: `git archive <sha> src config | tar -x`).
// Não há modo de aplicação: --aplicar é recusado. Aplicar é um passo humano documentado em docs/reparo-dados.md.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { cleanPoints, MIN_HIST_DAYS } from '../src/history.js';
import { trustedPoint } from '../src/distrust.js';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MARCA = '.reparo-dados';
const EPS = 0.005;
export const SALTO_MAX = 1.5; // novo menor preço acima de 1,5× o antigo vai para revisão humana
const igual = (a, b) => a != null && b != null && Math.abs(a - b) < EPS;
const dia = (iso) => String(iso).slice(0, 10);
const safeId = (id) => String(id).replace(/[^a-z0-9_.-]/gi, '_'); // igual a src/history.js
const lerJson = (f, d) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch { return d; } };
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
const ord = (o) => JSON.stringify(o);

// ---------------------------------------------------------------- entrada
export function lerDados(dir) {
  const d = fs.existsSync(path.join(dir, 'data', 'state.json')) ? path.join(dir, 'data') : dir;
  const state = lerJson(path.join(d, 'state.json'), null);
  if (!state || !Array.isArray(state.offers)) throw new Error(`state.json ausente ou inválido em ${d}`);
  const offers = lerJson(path.join(d, 'offers.json'), null) || Object.fromEntries(state.offers.map((o) => [o.id, o]));
  const history = [];
  try { for (const l of fs.readFileSync(path.join(d, 'history.jsonl'), 'utf8').split('\n')) if (l) { try { history.push(JSON.parse(l)); } catch { /* linha quebrada */ } } } catch { /* sem log */ }
  const hist = {};
  try { for (const f of fs.readdirSync(path.join(d, 'hist'))) if (f.endsWith('.json')) { const h = lerJson(path.join(d, 'hist', f), null); if (h?.productId) hist[h.productId] = h; } } catch { /* sem hist */ }
  return { dir: d, state, offers, history, hist, lowest: lerJson(path.join(d, 'lowest.json'), {}), products: lerJson(path.join(d, 'products.json'), {}) };
}

// Matcher a partir de um checkout (src/match.js + src/gate.js + config/), com o catálogo montado como loadCatalog().
export async function matcherDe(dir, productIds, nome) {
  const matchFile = path.join(dir, 'src', 'match.js');
  const M = await import(pathToFileURL(matchFile).href);
  let gate = null; try { gate = await import(pathToFileURL(path.join(dir, 'src', 'gate.js')).href); } catch { /* sem trava */ }
  const cat = lerJson(path.join(dir, 'config', 'catalog.json'), null);
  if (!cat) throw new Error(`config/catalog.json ausente em ${dir}`);
  cat.products ||= []; cat.copag ||= {};
  cat.refs = lerJson(path.join(dir, 'config', 'refs-copag.json'), {})?.refs || {};
  cat.variantes = M.variantesDe(productIds);
  let commit = null;
  const g = spawnSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' });
  if (g.status === 0) commit = g.stdout.trim();
  return {
    nome: nome || dir, commit, matchSha256: sha(fs.readFileSync(matchFile)),
    match(l) {
      const m = M.matchProduct({ title: l.title, url: l.url, ean: l.ean }, cat);
      if (!m.productId) return { productId: null, why: m.why || [] };
      if (gate?.linkAgrees) { const g2 = gate.linkAgrees(l, m, cat); if (!g2.ok) return { productId: null, why: [g2.why] }; }
      return { productId: m.productId, why: [], via: m.via || null };
    },
  };
}

// Espelho de histSummary (src/history.js) sobre um objeto em memória (paridade coberta em teste).
export function resumoHist(h, distrust = null) {
  if (!h) return null;
  const byDay = {};
  for (const [sid, s] of Object.entries(h.stores || {})) for (const [d, v] of cleanPoints(s.pts).pts) if (trustedPoint(distrust, sid, d) && (!byDay[d] || v < byDay[d])) byDay[d] = v;
  const days = Object.keys(byDay).sort(); if (!days.length) return null;
  const today = days[days.length - 1]; const cur = byDay[today];
  const cut = dia(new Date(Date.parse(today) - 7 * 864e5).toISOString());
  const prev = days.filter((d) => d < today && d >= cut).map((d) => byDay[d]);
  const ref = prev.length ? Math.max(...prev) : null;
  const enough = days.length >= MIN_HIST_DAYS;
  return { days: days.length, from: days[0], enough, drop7d: enough && ref && cur < ref ? +(1 - cur / ref).toFixed(4) : 0 };
}

// ---------------------------------------------------------------- análise (pura: não escreve nada)
export function analisar({ dados, base, candidato, agora = new Date().toISOString(), anterior = null }) {
  const { state, offers, history, hist, lowest, products } = dados;
  const distrust = state.distrust && Array.isArray(state.distrust.stores) ? state.distrust : null;
  const rowsPorOferta = new Map();
  for (const r of history) { if (!r?.offerId) continue; (rowsPorOferta.get(r.offerId) || rowsPorOferta.set(r.offerId, []).get(r.offerId)).push(r); }
  for (const rs of rowsPorOferta.values()) rs.sort((a, b) => String(a.t).localeCompare(String(b.t)));

  // 1) Reassociações: base(título) ≠ candidato(título).
  const reassoc = new Map(); // offerId → registro
  for (const o of Object.values(offers)) {
    if (!o?.id || !o.title) continue;
    const b = base.match(o); const c = candidato.match(o);
    if (b.productId === c.productId || !b.productId) continue; // candidato só pode TIRAR de um produto que a base gravou
    const rows = rowsPorOferta.get(o.id) || [];
    const pids = [...new Set(rows.map((r) => r.productId).filter(Boolean))];
    const motivos = [];
    if (o.productId !== b.productId && o.productId !== c.productId) motivos.push(`produto gravado (${o.productId}) não é o da base nem o do candidato`);
    const estranhos = pids.filter((p) => p !== b.productId && p !== c.productId);
    if (estranhos.length) motivos.push(`history.jsonl tem a oferta em outro produto (${estranhos.join(', ')}): título pode ter mudado`);
    const noAntigo = rows.filter((r) => r.productId === b.productId);
    reassoc.set(o.id, {
      offerId: o.id, titulo: o.title, loja: o.storeId, lojaNome: o.storeName || o.storeId, url: o.url || null,
      preco: o.total ?? o.price ?? null, estoque: o.stock || null, vistoEm: o.source_timestamp || o.firstSeen || null, primeiraVez: o.firstSeen || null,
      produtoAntigo: b.productId, produtoNovo: c.productId, produtoGravado: o.productId || null, motivoCandidato: c.productId ? (c.via || 'casamento') : (c.why || []).join('; '),
      historico: { linhasNoAntigo: noAntigo.length, primeira: noAntigo[0]?.t || null, ultima: noAntigo.at(-1)?.t || null,
        emEstoqueNoAntigo: noAntigo.filter((r) => r.stock === 'IN_STOCK' && r.total > 0).map((r) => [r.t, r.total]) },
      classe: motivos.length ? 'revisao' : 'auto', motivos, origem: 'titulo',
    });
  }
  // 1b) Depois da integração do matcher, a oferta que foi para "sem produto" sai do offers.json e leva o título junto:
  // a comparação base × candidato não a enxerga mais, e as linhas dela no history.jsonl virariam "desconhecidas"
  // (protegendo o ponto contaminado). Com --anterior (relatório de um dry-run feito ANTES da integração), a reassociação
  // registrada lá vale como evidência para essas ofertas ausentes. Oferta ainda presente usa a comparação pelo título.
  for (const ra of anterior?.reassociacoes || []) {
    if (!ra?.offerId || !ra.produtoAntigo || reassoc.has(ra.offerId) || offers[ra.offerId]) continue;
    const rows = rowsPorOferta.get(ra.offerId) || [];
    const estranhos = [...new Set(rows.map((r) => r.productId).filter((p) => p && p !== ra.produtoAntigo && p !== ra.produtoNovo))];
    const motivos = [];
    if (ra.classe !== 'auto' && !ra.bloqueado) motivos.push('reassociação estava em revisão no relatório anterior');
    if (estranhos.length) motivos.push(`history.jsonl tem a oferta em outro produto (${estranhos.join(', ')}): título pode ter mudado`);
    const noAntigo = rows.filter((r) => r.productId === ra.produtoAntigo);
    reassoc.set(ra.offerId, { ...ra, origem: 'anterior', produtoGravado: null,
      historico: { linhasNoAntigo: noAntigo.length, primeira: noAntigo[0]?.t || null, ultima: noAntigo.at(-1)?.t || null,
        emEstoqueNoAntigo: noAntigo.filter((r) => r.stock === 'IN_STOCK' && r.total > 0).map((r) => [r.t, r.total]) },
      classe: motivos.length ? 'revisao' : 'auto', motivos, bloqueado: undefined });
  }
  const afetadosPorProduto = new Map(); // produto antigo → Set(offerId)
  for (const r of reassoc.values()) (afetadosPorProduto.get(r.produtoAntigo) || afetadosPorProduto.set(r.produtoAntigo, new Set()).get(r.produtoAntigo)).add(r.offerId);
  const produtosAfetados = new Set(afetadosPorProduto.keys());

  // 2) Reconstrução diária por (produto, loja, dia) a partir do history.jsonl, só nos produtos afetados.
  const cat = (oid, pid) => {
    const r = reassoc.get(oid);
    if (r) return pid === r.produtoAntigo ? 'cont' : (pid === r.produtoNovo ? 'legit' : 'desconhecida');
    return offers[oid]?.title ? 'legit' : 'desconhecida';
  };
  let ultimoDia = dia(agora);
  for (const h of Object.values(hist)) for (const s of Object.values(h.stores || {})) for (const [d] of s.pts || []) if (d > ultimoDia) ultimoDia = d;
  const agg = new Map(); // pid|sid|dia → { cont, legit, desconhecida, contIds:Set }
  const catsSerie = new Map(); // pid|sid → Set(categorias)
  const contIdsSerie = new Map(); // pid|sid → Set(offerId)
  const add = (pid, sid, d, c, v, oid) => {
    const k = `${pid}|${sid}|${d}`; const a = agg.get(k) || agg.set(k, { cont: null, legit: null, desconhecida: null, contIds: new Set() }).get(k);
    if (a[c] == null || v < a[c]) a[c] = v; if (c === 'cont') a.contIds.add(oid);
  };
  const proxDia = (d) => new Date(Date.parse(d + 'T00:00:00Z') + 864e5).toISOString().slice(0, 10);
  for (const [oid, rows] of rowsPorOferta) {
    if (!rows.some((r) => produtosAfetados.has(r.productId))) continue;
    for (const r of rows) if (produtosAfetados.has(r.productId)) {
      const ks = `${r.productId}|${r.storeId}`;
      (catsSerie.get(ks) || catsSerie.set(ks, new Set()).get(ks)).add(cat(oid, r.productId));
      if (cat(oid, r.productId) === 'cont') (contIdsSerie.get(ks) || contIdsSerie.set(ks, new Set()).get(ks)).add(oid);
    }
    let cur = null; let i = 0;
    for (let d = dia(rows[0].t); d <= ultimoDia; d = proxDia(d)) {
      if (cur && cur.stock === 'IN_STOCK' && cur.total > 0 && produtosAfetados.has(cur.productId)) add(cur.productId, cur.storeId, d, cat(oid, cur.productId), cur.total, oid);
      while (i < rows.length && dia(rows[i].t) === d) {
        const r = rows[i++]; cur = { productId: r.productId, storeId: r.storeId, stock: r.event === 'removed' ? 'UNAVAILABLE' : r.stock, total: r.total };
        if (cur.stock === 'IN_STOCK' && cur.total > 0 && produtosAfetados.has(cur.productId)) add(cur.productId, cur.storeId, d, cat(oid, cur.productId), cur.total, oid);
      }
      if (i >= rows.length && (!cur || cur.stock !== 'IN_STOCK')) break;
    }
  }

  // 3) Pontos do hist dos produtos afetados.
  const pontos = []; // { produto, loja, dia, valor, acao: manter|remover|revisao, classe, motivo, proposta, ofertas }
  const histProposto = {};
  for (const pid of produtosAfetados) {
    const h = hist[pid]; if (!h) continue;
    const novo = JSON.parse(JSON.stringify(h)); let mudou = false;
    for (const [sid, s] of Object.entries(h.stores || {})) {
      const ks = `${pid}|${sid}`; const cats = catsSerie.get(ks);
      if (!cats || !cats.has('cont')) continue; // loja sem anúncio reassociado neste produto: intocada
      const soCont = cats.size === 1;
      const idsSerie = [...(contIdsSerie.get(ks) || [])];
      const serieAuto = idsSerie.every((id) => reassoc.get(id)?.classe === 'auto');
      const manter = [];
      for (const [d, v] of s.pts || []) {
        const a = agg.get(`${pid}|${sid}|${d}`);
        let acao = 'manter'; let motivo = ''; let proposta = null; let ids = a ? [...a.contIds] : idsSerie;
        // Sem linha no history.jsonl para o dia não há evidência, nem quando a série da loja é toda reassociada (o log tem
        // 45 dias e o hist 180: ponto antigo pode ser de anúncio legítimo que já saiu do log).
        if (!a) { acao = 'revisao'; motivo = soCont ? 'série da loja só com anúncios reassociados, mas sem linha no history.jsonl para o dia (sem evidência)' : 'sem linha no history.jsonl para o dia (não dá para atribuir o ponto)'; }
        else if (soCont) { acao = 'remover'; motivo = 'a loja só teve anúncios reassociados neste produto'; }
        else if (!igual(a.cont, v)) { motivo = 'valor não vem de anúncio reassociado'; }
        else if (igual(a.legit, v) || igual(a.desconhecida, v)) { motivo = 'mesmo valor também em anúncio legítimo'; }
        else if (a.legit == null && a.desconhecida == null) { acao = 'remover'; motivo = 'no dia, só anúncios reassociados em estoque nesta loja'; }
        else { acao = 'revisao'; proposta = Math.min(...[a.legit, a.desconhecida].filter((x) => x != null)); motivo = `ponto veio de anúncio reassociado; o legítimo do dia era ${proposta} (substituição aproximada: o history.jsonl não guarda stale/confirmado)`; }
        const autoOk = (acao === 'remover') && (ids.length ? ids.every((id) => reassoc.get(id)?.classe === 'auto') : serieAuto);
        if (acao === 'remover' && !autoOk) { acao = 'revisao'; motivo += '; anúncio(s) com reassociação em revisão'; }
        if (acao !== 'manter') pontos.push({ produto: pid, loja: sid, dia: d, valor: v, acao, classe: acao === 'remover' ? 'auto' : 'revisao', motivo, proposta, ofertas: ids });
        if (acao === 'remover') mudou = true; else manter.push([d, v]);
      }
      if (manter.length !== (s.pts || []).length) { if (manter.length) novo.stores[sid].pts = manter; else delete novo.stores[sid]; }
    }
    if (mudou) histProposto[pid] = novo;
  }

  // 4) Menor preço salvo (lowest.json) dos produtos contaminados.
  const removidos = new Set(pontos.filter((p) => p.acao === 'remover').map((p) => `${p.produto}|${p.loja}|${p.dia}`));
  const emRevisao = pontos.filter((p) => p.acao === 'revisao');
  const lowestProposto = { ...lowest };
  const menores = [];
  for (const [pid, L] of Object.entries(lowest)) {
    if (pid.startsWith('__') || !L || typeof L !== 'object') continue;
    const r = L.offerId ? reassoc.get(L.offerId) : null;
    const porOferta = r && r.produtoAntigo === pid;
    const k = `${pid}|${L.storeId}|${dia(L.at)}`;
    const porPonto = removidos.has(k) || emRevisao.some((p) => p.produto === pid && p.loja === L.storeId && p.dia === dia(L.at) && igual(p.valor, L.total));
    if (!porOferta && !porPonto) continue;
    const h = histProposto[pid] || hist[pid] || { stores: {} };
    // Proposta conservadora: pontos em revisão contam como contaminados. Se um deles for <= à proposta, a decisão é humana.
    const rev = new Set(emRevisao.filter((p) => p.produto === pid).map((p) => `${p.loja}|${p.dia}`));
    let melhor = null;
    for (const [sid, s] of Object.entries(h.stores || {})) for (const [d, v] of cleanPoints(s.pts).pts) if (!rev.has(`${sid}|${d}`) && trustedPoint(distrust, sid, d) && (!melhor || v < melhor.total || (v === melhor.total && d < dia(melhor.at)))) melhor = { total: v, at: d + 'T12:00:00.000Z', storeId: sid, offerId: null };
    const pend = emRevisao.filter((p) => p.produto === pid && (!melhor || p.valor <= melhor.total || (p.proposta != null && p.proposta <= melhor.total)));
    const ofertaRevisao = porOferta && r.classe !== 'auto';
    const salto = melhor && L.total > 0 && melhor.total > L.total * SALTO_MAX;
    const classe = pend.length || ofertaRevisao || salto ? 'revisao' : 'auto';
    const motivo = [porOferta ? `veio do anúncio reassociado ${L.offerId} (${r.titulo})` : `ponto ${L.storeId} ${dia(L.at)} R$ ${L.total} é contaminado`,
      pend.length ? `${pend.length} ponto(s) em revisão podem mudar o valor (proposta os trata como contaminados)` : null, ofertaRevisao ? 'reassociação do anúncio em revisão' : null,
      salto ? `o novo menor preço é mais de ${SALTO_MAX}× o antigo: conferir se a série legítima restante é representativa` : null].filter(Boolean).join('; ');
    menores.push({ produto: pid, antes: L, depois: melhor, acao: melhor ? 'recalcular' : 'remover', classe, motivo });
    if (classe === 'auto') { if (melhor) lowestProposto[pid] = melhor; else delete lowestProposto[pid]; }
  }

  // 4b) Tudo ou nada por produto: produto com QUALQUER item em revisão (ponto, menor preço ou reassociação) fica inteiro
  // fora do estado proposto até a decisão humana. Aplicar só parte (ex.: hist sem o lowest) deixa o produto incoerente.
  const bloqueados = new Set([
    ...pontos.filter((p) => p.acao === 'revisao').map((p) => p.produto),
    ...menores.filter((m) => m.classe === 'revisao').map((m) => m.produto),
    ...[...reassoc.values()].filter((r) => r.classe === 'revisao').map((r) => r.produtoAntigo),
  ]);
  const NOTA = 'produto bloqueado: há item em revisão neste produto e nada dele é aplicado parcialmente';
  for (const pid of bloqueados) {
    delete histProposto[pid];
    if (lowest[pid]) lowestProposto[pid] = lowest[pid]; else delete lowestProposto[pid];
    for (const p of pontos) if (p.produto === pid && p.acao === 'remover') { p.acao = 'revisao'; p.classe = 'revisao'; p.bloqueado = true; p.motivo += '; ' + NOTA; }
    for (const m of menores) if (m.produto === pid) { m.bloqueado = true; if (m.classe === 'auto') { m.classe = 'revisao'; m.motivo += '; ' + NOTA; } }
    for (const r of reassoc.values()) if (r.produtoAntigo === pid) { r.bloqueado = true; if (r.classe === 'auto') { r.classe = 'revisao'; r.motivos.push(NOTA); } }
  }
  for (const p of pontos) if (p.acao === 'revisao' && !p.bloqueado && bloqueados.has(p.produto)) p.bloqueado = true;

  // 5) Produtos que só existem por anúncios reassociados → proposta de remoção (nunca aplicada). Só é proposta quando
  // NENHUMA oferta de offers.json aponta para o id (ou seja, depois que o matcher corrigido rodou e tirou as ofertas
  // de lá). Antes disso fica "adiada". Depois da integração, a oferta que foi para "sem produto" some do offers.json
  // (sem título): a evidência de que ela era reassociada vem do relatório anterior (--anterior), gerado antes.
  const reassocAnterior = new Map();
  for (const r of anterior?.reassociacoes || []) if (r?.offerId && r.produtoAntigo) reassocAnterior.set(r.offerId, r.produtoAntigo);
  const candidatosRemocao = new Set([...produtosAfetados, ...reassocAnterior.values()]);
  const remocoes = []; const remocoesAdiadas = [];
  for (const pid of [...candidatosRemocao].sort()) {
    const ids = new Set();
    for (const o of Object.values(offers)) if (o.productId === pid) ids.add(o.id);
    for (const [oid, rows] of rowsPorOferta) if (rows.some((x) => x.productId === pid)) ids.add(oid);
    if (!ids.size) continue;
    const reassocDe = (id) => reassoc.get(id)?.produtoAntigo === pid || reassocAnterior.get(id) === pid;
    if (![...ids].every(reassocDe)) continue;
    const apontando = Object.values(offers).filter((o) => o.productId === pid);
    const item = { produto: pid, nome: products[pid]?.name || null, ofertas: [...ids], classe: 'revisao', registro: products[pid] ? 'products.json' : 'ausente do products.json' };
    if (apontando.length) {
      remocoesAdiadas.push({ ...item, acao: 'adiada', ofertasApontando: apontando.map((o) => o.id), emEstoque: apontando.filter((o) => o.stock === 'IN_STOCK').length,
        motivo: `${apontando.length} oferta(s) do offers.json ainda apontam para o produto; rodar de novo depois que o matcher corrigido tirar as ofertas de lá (com --anterior)` });
    } else {
      remocoes.push({ ...item, acao: 'remover-do-registro (proposta)', motivo: 'nenhuma oferta do offers.json aponta para o produto e todas as já vistas nele foram reassociadas; nenhuma legítima' });
    }
  }

  // 6) Preço atual × menor salvo × histórico por produto afetado.
  const porProduto = [];
  for (const pid of [...produtosAfetados].sort()) {
    const lista = Object.values(offers).filter((o) => o.productId === pid);
    const live = (o) => o.stock === 'IN_STOCK' && !o.stale && !o.anomalous && o.total > 0;
    const minDe = (arr) => arr.length ? Math.min(...arr.map((o) => o.total)) : null;
    const reas = afetadosPorProduto.get(pid);
    const m = menores.find((x) => x.produto === pid);
    const sp = (state.products || []).find((p) => p.id === pid);
    porProduto.push({
      produto: pid, nome: products[pid]?.name || sp?.name || null,
      ofertasReassociadas: reas.size,
      precoAtual: { menorEmEstoque: minDe(lista.filter(live)), menorEmEstoqueSemReassociadas: minDe(lista.filter((o) => live(o) && !reas.has(o.id))), reassociadasEmEstoque: lista.filter((o) => live(o) && reas.has(o.id)).length },
      menorSalvo: { antes: lowest[pid] || null, depois: m ? (m.classe === 'auto' ? (lowestProposto[pid] || null) : lowest[pid] || null) : lowest[pid] || null, proposto: m ? m.depois : undefined, classe: m?.classe || 'intocado' },
      historico: { antes: resumoHist(hist[pid], distrust), depois: resumoHist(histProposto[pid] || hist[pid], distrust),
        pontosRemovidos: pontos.filter((p) => p.produto === pid && p.acao === 'remover').length, pontosRevisao: pontos.filter((p) => p.produto === pid && p.acao === 'revisao').length },
      remocaoProposta: remocoes.some((r) => r.produto === pid),
    });
  }

  // 7) state.json espelhado (lowestHistorical e hist dos produtos alterados).
  const stateProposto = { ...state, products: (state.products || []).map((p) => {
    const mudouL = ord(lowestProposto[p.id] || null) !== ord(lowest[p.id] || null);
    if (!mudouL && !histProposto[p.id]) return p;
    return { ...p, lowestHistorical: lowestProposto[p.id] || null, hist: histProposto[p.id] ? resumoHist(histProposto[p.id], distrust) : p.hist };
  }) };

  const lista = [...reassoc.values()];
  const contagens = {
    ofertasAnalisadas: Object.values(offers).filter((o) => o?.title).length,
    reassociacoes: { total: lista.length, viaAnterior: lista.filter((r) => r.origem === 'anterior').length, auto: lista.filter((r) => r.classe === 'auto').length, revisao: lista.filter((r) => r.classe === 'revisao').length,
      emEstoque: lista.filter((r) => r.estoque === 'IN_STOCK').length, paraSemProduto: lista.filter((r) => !r.produtoNovo).length,
      paraIdNovo: lista.filter((r) => r.produtoNovo && !products[r.produtoNovo]).length },
    produtosAfetados: produtosAfetados.size,
    hist: { arquivosAlterados: Object.keys(histProposto).length, pontosRemovidosAuto: pontos.filter((p) => p.acao === 'remover').length, pontosRevisao: pontos.filter((p) => p.acao === 'revisao').length,
      pontosAntes: Object.values(hist).reduce((n, h) => n + Object.values(h.stores || {}).reduce((m, s) => m + (s.pts || []).length, 0), 0) },
    lowest: { entradasAntes: Object.keys(lowest).filter((k) => !k.startsWith('__')).length, entradasDepois: Object.keys(lowestProposto).filter((k) => !k.startsWith('__')).length,
      contaminados: menores.length, recalculadosAuto: menores.filter((m) => m.classe === 'auto' && m.acao === 'recalcular').length,
      removidosAuto: menores.filter((m) => m.classe === 'auto' && m.acao === 'remover').length, revisao: menores.filter((m) => m.classe === 'revisao').length },
    remocoesPropostas: remocoes.length,
    remocoesAdiadas: remocoesAdiadas.length,
    produtosBloqueados: [...bloqueados].sort(),
  };
  contagens.hist.pontosDepois = contagens.hist.pontosAntes - contagens.hist.pontosRemovidosAuto;
  return {
    relatorio: { geradoEm: agora, modo: 'dry-run',
      matchers: { base: { nome: base.nome, commit: base.commit || null, matchSha256: base.matchSha256 || null }, candidato: { nome: candidato.nome, commit: candidato.commit || null, matchSha256: candidato.matchSha256 || null } },
      dados: { generatedAt: state.generatedAt || null, linhasHistory: history.length, arquivosHist: Object.keys(hist).length, ofertas: Object.keys(offers).length },
      anterior: anterior ? { geradoEm: anterior.geradoEm || null, reassociacoes: reassocAnterior.size } : null,
      contagens, porProduto, reassociacoes: lista, pontos, menores, remocoes, remocoesAdiadas },
    proposto: { lowest: lowestProposto, hist: histProposto, state: stateProposto, remocoes },
  };
}

// ---------------------------------------------------------------- saída
// Recusa: dentro da pasta de dados lida (ou contendo-a), dentro de um checkout do ramo data, ou pasta não vazia alheia.
export function verificarSaida(saida, dadosDir = null) {
  const abs = path.resolve(saida);
  const dentro = (a, b) => { const r = path.relative(b, a); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); };
  if (dadosDir) { const d = path.resolve(dadosDir); if (dentro(abs, d) || dentro(d, abs)) throw new Error(`recusado: a saída (${abs}) não pode ficar dentro da pasta de dados lida (${d}) nem contê-la`); }
  let anc = abs; while (!fs.existsSync(anc)) anc = path.dirname(anc);
  const git = (...a) => { const r = spawnSync('git', ['-C', anc, ...a], { encoding: 'utf8' }); return r.status === 0 ? r.stdout.trim() : null; };
  if (git('rev-parse', '--is-inside-work-tree') === 'true') {
    const ramo = git('rev-parse', '--abbrev-ref', 'HEAD');
    const up = git('rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}');
    const assunto = git('log', '-1', '--format=%s') || '';
    const head = git('rev-parse', 'HEAD'); const dataRef = git('rev-parse', '--verify', '-q', 'refs/remotes/origin/data');
    if (ramo === 'data' || /(^|\/)data$/.test(up || '') || /^dados \d{4}-\d{2}-\d{2}/.test(assunto) || (head && dataRef && head === dataRef)) {
      throw new Error(`recusado: ${anc} é um checkout do ramo data (ramo=${ramo}, upstream=${up || '-'}, commit="${assunto}"). O reparo só escreve fora dele.`);
    }
  }
  if (fs.existsSync(abs) && fs.readdirSync(abs).length && !fs.existsSync(path.join(abs, MARCA))) throw new Error(`recusado: ${abs} não está vazia e não é uma saída anterior do reparo`);
  return abs;
}

const fmt = (v) => (v == null ? '—' : 'R$ ' + Number(v).toFixed(2).replace('.', ','));
export function markdown(rel) {
  const c = rel.contagens; const L = [];
  L.push('# Reparo de dados — relatório (dry-run)', '');
  L.push(`Gerado em ${rel.geradoEm}. Dados de ${rel.dados.generatedAt || '?'} (${rel.dados.ofertas} ofertas, ${rel.dados.linhasHistory} linhas no history.jsonl, ${rel.dados.arquivosHist} arquivos em hist/).`);
  L.push(`Base: ${rel.matchers.base.nome}${rel.matchers.base.commit ? ' @ ' + rel.matchers.base.commit.slice(0, 8) : ''}. Candidato: ${rel.matchers.candidato.nome}${rel.matchers.candidato.commit ? ' @ ' + rel.matchers.candidato.commit.slice(0, 8) : ''} (match.js sha256 ${String(rel.matchers.candidato.matchSha256).slice(0, 12)}).`, '');
  L.push('## Contagens', '', '| item | antes | depois / total | automático | revisão humana |', '|---|---|---|---|---|');
  L.push(`| ofertas reassociadas | — | ${c.reassociacoes.total} (${c.reassociacoes.emEstoque} em estoque; ${c.reassociacoes.paraSemProduto} ficam sem produto; ${c.reassociacoes.paraIdNovo} vão para id novo) | ${c.reassociacoes.auto} | ${c.reassociacoes.revisao} |`);
  L.push(`| produtos afetados | — | ${c.produtosAfetados} | — | — |`);
  L.push(`| pontos de hist (todos os arquivos) | ${c.hist.pontosAntes} | ${c.hist.pontosDepois} | ${c.hist.pontosRemovidosAuto} removidos | ${c.hist.pontosRevisao} |`);
  L.push(`| arquivos de hist alterados | — | ${c.hist.arquivosAlterados} | — | — |`);
  L.push(`| entradas no lowest.json | ${c.lowest.entradasAntes} | ${c.lowest.entradasDepois} | ${c.lowest.recalculadosAuto} recalculados, ${c.lowest.removidosAuto} removidos | ${c.lowest.revisao} |`);
  L.push(`| produtos bloqueados (item em revisão: nada aplicado) | — | ${c.produtosBloqueados.length} | — | ${c.produtosBloqueados.join(', ') || '—'} |`);
  L.push(`| produtos com remoção proposta | — | ${c.remocoesPropostas} | 0 (nunca automático) | ${c.remocoesPropostas} |`);
  L.push(`| remoções adiadas (ofertas ainda apontam) | — | ${c.remocoesAdiadas} | — | — |`, '');
  L.push('## Por produto: preço atual × menor salvo × histórico', '', '| produto | reassoc. | menor em estoque agora (sem reassoc.) | menor salvo antes → depois | classe | hist: dias/drop7d antes → depois | pontos rem./rev. |', '|---|---|---|---|---|---|---|');
  for (const p of rel.porProduto) {
    const h = (x) => (x ? `${x.days}d/${(x.drop7d * 100).toFixed(1)}%` : '—');
    const prop = p.menorSalvo.classe === 'revisao' ? ` (proposto ${p.menorSalvo.proposto ? fmt(p.menorSalvo.proposto.total) : 'remover'})` : '';
    L.push(`| ${p.produto}${p.remocaoProposta ? ' ⚠ remoção proposta' : ''} | ${p.ofertasReassociadas} | ${fmt(p.precoAtual.menorEmEstoque)} (${fmt(p.precoAtual.menorEmEstoqueSemReassociadas)}) | ${fmt(p.menorSalvo.antes?.total)} → ${fmt(p.menorSalvo.depois?.total)}${prop} | ${p.menorSalvo.classe} | ${h(p.historico.antes)} → ${h(p.historico.depois)} | ${p.historico.pontosRemovidos}/${p.historico.pontosRevisao} |`);
  }
  L.push('', '## Menor preço salvo contaminado', '');
  for (const m of rel.menores) L.push(`- **${m.produto}** [${m.classe}]: ${fmt(m.antes.total)} (${m.antes.storeId}, ${dia(m.antes.at)}) → ${m.depois ? `${fmt(m.depois.total)} (${m.depois.storeId}, ${dia(m.depois.at)})` : 'sem menor preço'}. ${m.motivo}`);
  L.push('', '## Reassociações (evidência)', '', '| classe | loja | preço | visto em | antigo → novo | título |', '|---|---|---|---|---|---|');
  for (const r of rel.reassociacoes) L.push(`| ${r.classe}${r.motivos.length ? ' (' + r.motivos.join('; ').replace(/\|/g, '/') + ')' : ''} | ${r.loja} | ${fmt(r.preco)} ${r.estoque === 'IN_STOCK' ? '' : '(sem estoque)'} | ${dia(r.vistoEm)} | ${r.produtoAntigo} → ${r.produtoNovo || 'sem produto: ' + r.motivoCandidato} | ${String(r.titulo).replace(/\|/g, '/')} |`);
  if (rel.remocoesAdiadas?.length) { L.push('', '## Remoção adiada (ofertas ainda apontam para o produto)', ''); for (const r of rel.remocoesAdiadas) L.push(`- ${r.produto} (${r.nome || 'sem nome'}): ${r.ofertasApontando.length} oferta(s) apontando (${r.emEstoque} em estoque). ${r.motivo}.`); }
  if (rel.remocoes.length) { L.push('', '## Remoção proposta (decisão humana)', ''); for (const r of rel.remocoes) L.push(`- ${r.produto} (${r.nome || 'sem nome'}): ${r.ofertas.length} oferta(s), todas reassociadas. ${r.registro}.`); }
  const rev = rel.pontos.filter((p) => p.acao === 'revisao');
  if (rev.length) { L.push('', '## Pontos de histórico em revisão humana', ''); for (const p of rev.slice(0, 80)) L.push(`- ${p.produto} / ${p.loja} / ${p.dia}: ${fmt(p.valor)} — ${p.motivo}`); if (rev.length > 80) L.push(`- … mais ${rev.length - 80} (ver relatorio.json)`); }
  L.push('');
  return L.join('\n');
}

export function escreverSaida(saida, resultado, { dados }) {
  const abs = verificarSaida(saida, dados.dir);
  const P = path.join(abs, 'proposto'); const PD = path.join(P, 'data');
  fs.rmSync(P, { recursive: true, force: true });
  fs.mkdirSync(path.join(PD, 'hist'), { recursive: true });
  fs.writeFileSync(path.join(abs, MARCA), 'saída de tools/reparo-dados.mjs (dry-run)\n');
  const manifest = [];
  const grava = (rel, obj, antes) => { const s = JSON.stringify(obj, null, rel.startsWith('data/hist/') ? 0 : 2); fs.writeFileSync(path.join(P, rel), s); manifest.push({ arquivo: rel, sha256Antes: antes == null ? null : sha(antes), sha256Depois: sha(s) }); };
  const orig = (f) => { try { return fs.readFileSync(path.join(dados.dir, f)); } catch { return null; } };
  grava('data/lowest.json', resultado.proposto.lowest, orig('lowest.json'));
  for (const [pid, h] of Object.entries(resultado.proposto.hist)) grava(`data/hist/${safeId(pid)}.json`, h, orig(`hist/${safeId(pid)}.json`));
  grava('data/state.json', resultado.proposto.state, orig('state.json'));
  fs.writeFileSync(path.join(P, 'remocoes-propostas.json'), JSON.stringify(resultado.proposto.remocoes, null, 2));
  fs.writeFileSync(path.join(P, 'MANIFEST.json'), JSON.stringify({ geradoEm: resultado.relatorio.geradoEm, origem: dados.dir, arquivos: manifest }, null, 2));
  fs.writeFileSync(path.join(abs, 'relatorio.json'), JSON.stringify(resultado.relatorio, null, 2));
  fs.writeFileSync(path.join(abs, 'relatorio.md'), markdown(resultado.relatorio));
  return abs;
}

// ---------------------------------------------------------------- CLI
function args(argv) {
  const o = {};
  for (let i = 0; i < argv.length; i++) { const a = argv[i]; if (!a.startsWith('--')) continue; const k = a.slice(2); const v = argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[++i] : true; o[k] = v; }
  return o;
}
export async function main(argv = process.argv.slice(2), log = console.log) {
  const a = args(argv);
  if (Object.keys(a).some((k) => /^(aplicar|apply)(=|$)/.test(k))) throw new Error('modo de aplicação não implementado: o reparo é só dry-run (ver docs/reparo-dados.md)');
  if (!a.dados || !a.saida || !a.candidato) throw new Error('uso: node tools/reparo-dados.mjs --dados <pasta> --candidato <checkout> --saida <pasta> [--base <checkout>] [--agora ISO] [--anterior <relatorio.json>]');
  const dados = lerDados(a.dados);
  verificarSaida(a.saida, dados.dir); // antes de qualquer trabalho
  const ids = Object.keys(dados.products);
  const base = await matcherDe(a.base || RAIZ, ids, a['nome-base'] || a.base || 'checkout atual');
  const candidato = await matcherDe(a.candidato, ids, a['nome-candidato'] || a.candidato);
  let anterior = null;
  if (a.anterior) { anterior = lerJson(a.anterior, null); if (!anterior || !Array.isArray(anterior.reassociacoes)) throw new Error(`--anterior: relatorio.json inválido (${a.anterior})`); }
  const r = analisar({ dados, base, candidato, agora: a.agora || new Date().toISOString(), anterior });
  const out = escreverSaida(a.saida, r, { dados });
  const c = r.relatorio.contagens;
  log(`reparo-dados (dry-run): ${c.reassociacoes.total} reassociações (${c.reassociacoes.auto} auto, ${c.reassociacoes.revisao} revisão), ${c.produtosAfetados} produtos; hist −${c.hist.pontosRemovidosAuto} pontos (${c.hist.pontosRevisao} em revisão); lowest ${c.lowest.recalculadosAuto} recalculados, ${c.lowest.removidosAuto} removidos, ${c.lowest.revisao} em revisão; ${c.remocoesPropostas} remoções propostas, ${c.remocoesAdiadas} adiadas. Saída: ${out}`);
  return r;
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((e) => { console.error(e.message); process.exit(1); });
}
