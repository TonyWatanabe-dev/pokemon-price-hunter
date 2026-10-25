// Relatório de qualidade dos dados publicados (auditoria de 25/10/2026). SOMENTE LEITURA: sem rede, sem banco e sem
// gravar nada além do --out pedido. Mede o que o site mostra a partir do ramo data:
//   cobertura (ofertas vivas/stale, produtos, lojas, frete conhecido) · lojas por plataforma (falha, 403/429, sem
//   oferta viva) · oferta visível sem preço/link/horário verificável · frescor das vivas · preço muito longe da
//   referência Copag · ofertas repetidas pela mesma página com parâmetro de rastreio (srsltid, utm_…) · produtos com o
//   mesmo nome · fonte vigiada bloqueada (episódios em ops.runs) · remoções por página de erro (#897: url-cache
//   `removidas`, `pagesGone` nas fontes).
// Uso: node tools/qualidade-dados.mjs [pasta-data] [--json] [--out relatorio.json]
//   Lê <pasta>/state.json (obrigatório) e, se existirem, sources.json, meta.json e url-cache.json.
// "Viva" = a mesma regra do site (api/_lib/home.mjs): em estoque, não stale, não anômala e total > 0.
import fs from 'node:fs';
import path from 'node:path';
import { canonicalizeUrl } from '../src/core/offer-key.js';
import { RULES } from '../src/ops-watch.js';

export const LIMITES = { REF_BAIXO: 0.5, REF_ALTO: 2.5, VIVA_VELHA_H: 6 };
export const viva = (o) => !!o && o.stock === 'IN_STOCK' && !o.stale && !o.anomalous && o.total > 0;
const contar = (xs, f) => xs.reduce((m, x) => { const k = f(x); m[k] = (m[k] || 0) + 1; return m; }, {});
const norm = (s) => String(s ?? '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]/g, '');
const horas = (now, iso) => { const t = Date.parse(iso ?? ''); return Number.isFinite(t) ? (now - t) / 36e5 : null; };

/** Mesma página com parâmetro de rastreio diferente (srsltid, utm_…): grupos loja + produto + URL sem rastreio. */
export function ofertasRepetidas(offers) {
  const g = new Map();
  for (const o of offers) {
    const c = canonicalizeUrl(o.url);
    if (!c.valid) continue;
    const k = `${o.storeId}|${o.productId}|${c.canonical}|${o.sellerId ?? o.seller ?? ''}`;
    (g.get(k) || g.set(k, { storeId: o.storeId, productId: o.productId, canonical: c.canonical, ofertas: [] }).get(k)).ofertas.push(o);
  }
  const grupos = [...g.values()].filter((x) => x.ofertas.length > 1 && x.ofertas.some((o) => canonicalizeUrl(o.url).removed.length));
  return {
    grupos: grupos.length,
    extras: grupos.reduce((a, x) => a + x.ofertas.length - 1, 0),
    extrasVivas: grupos.reduce((a, x) => a + Math.max(0, x.ofertas.filter(viva).length - 1), 0),
    comRastreio: offers.filter((o) => canonicalizeUrl(o.url).removed.length).length,
    porLoja: contar(grupos.flatMap((x) => x.ofertas.slice(1)), (o) => o.storeId),
    exemplos: grupos.slice(0, 5).map((x) => ({ storeId: x.storeId, productId: x.productId, canonical: x.canonical, n: x.ofertas.length })),
  };
}

/** Episódios de bloqueio/erro de cada fonte vigiada (ops.runs[].watched), na ordem das rodadas. */
export function episodiosVigiados(runs, consec = RULES.CONSEC) {
  const down = (x) => !!x && (['BLOCKED', 'ERROR'].includes(x.status) || (x.status === 'ACTIVE' && x.listings === 0));
  const out = {};
  const rs = (Array.isArray(runs) ? runs : []).filter((r) => r && r.generatedAt).sort((a, b) => Date.parse(a.generatedAt) - Date.parse(b.generatedAt));
  const ids = [...new Set(rs.flatMap((r) => Object.keys(r.watched || {})))];
  for (const id of ids) {
    const eps = []; let cur = null;
    for (const r of rs) {
      const x = r.watched?.[id];
      if (down(x)) { if (!cur) eps.push(cur = { inicio: r.generatedAt, fim: r.generatedAt, rodadas: 0, status: x.status }); cur.fim = r.generatedAt; cur.rodadas++; }
      else cur = null;
    }
    out[id] = { rodadas: rs.filter((r) => r.watched?.[id]).length, rodadasFora: eps.reduce((a, e) => a + e.rodadas, 0), episodios: eps,
      episodiosQueAvisam: eps.filter((e) => e.rodadas >= consec).length };
  }
  return out;
}

export function relatorioQualidade({ state, sources = null, meta = null, urlCache = null, now = null } = {}) {
  if (!state || !Array.isArray(state.offers)) throw new Error('state.json sem offers');
  const N = Date.parse(now || state.generatedAt || '') || Date.now();
  const offers = state.offers; const vivas = offers.filter(viva);
  const products = Array.isArray(state.products) ? state.products : [];
  const P = new Map(products.map((p) => [p.id, p]));
  const porLoja = new Map(); for (const o of offers) { const x = porLoja.get(o.storeId) || porLoja.set(o.storeId, { todas: 0, vivas: 0, stale: 0 }).get(o.storeId); x.todas++; if (viva(o)) x.vivas++; if (o.stale) x.stale++; }
  const cobertura = {
    dadosEm: state.generatedAt || null, ofertas: offers.length, vivas: vivas.length, stale: offers.filter((o) => o.stale).length,
    estoque: contar(offers, (o) => (o.stale ? 'stale' : o.stock || '?')),
    produtos: products.length, produtosComViva: new Set(vivas.map((o) => o.productId)).size, produtosSemOferta: products.filter((p) => !offers.some((o) => o.productId === p.id)).length,
    lojasComOferta: porLoja.size, lojasComViva: [...porLoja.values()].filter((x) => x.vivas).length,
    freteConhecidoVivas: vivas.filter((o) => o.shippingKnown).length,
    staleporLoja: Object.fromEntries([...porLoja].filter(([, x]) => x.stale).sort((a, b) => b[1].stale - a[1].stale).map(([id, x]) => [id, x.stale])),
  };
  const plataformas = {};
  for (const [id, s] of Object.entries(sources || {})) {
    const k = s?.platform || s?.platformHint || 'desconhecida';
    const x = plataformas[k] ||= { lojas: 0, status: {}, comViva: 0, ativasSemViva: 0, http403: 0, http429: 0, leiturasOk: 0, leituras: 0 };
    x.lojas++; x.status[s?.status || '?'] = (x.status[s?.status || '?'] || 0) + 1;
    if (porLoja.get(id)?.vivas) x.comViva++; else if (s?.status === 'ACTIVE') x.ativasSemViva++;
    const st = s?.lastFailure?.status ?? s?.httpStatus; if (st === 403) x.http403++; if (st === 429) x.http429++;
    x.leiturasOk += Number(s?.ok) || 0; x.leituras += Number(s?.checks) || 0;
  }
  const semVerificacao = vivas.filter((o) => !(Number.isFinite(o.price) && o.price > 0) || !o.url || horas(N, o.source_timestamp) == null);
  const idade = { '<1h': 0, '1-3h': 0, '3-6h': 0, '6-24h': 0, '>24h': 0 };
  for (const o of vivas) { const h = horas(N, o.source_timestamp); if (h == null) continue; idade[h < 1 ? '<1h' : h < 3 ? '1-3h' : h < 6 ? '3-6h' : h < 24 ? '6-24h' : '>24h']++; }
  const precoForaDaReferencia = vivas.map((o) => { const ref = P.get(o.productId)?.msrp; return ref > 0 && Number.isFinite(o.price) && o.price > 0 ? { o, ref, r: o.price / ref } : null; })
    .filter((x) => x && (x.r < LIMITES.REF_BAIXO || x.r > LIMITES.REF_ALTO))
    .map(({ o, ref, r }) => ({ productId: o.productId, storeId: o.storeId, price: o.price, ref, razao: +r.toFixed(2) }));
  const nomes = new Map(); for (const p of products) { const k = norm(p.name); if (k) (nomes.get(k) || nomes.set(k, []).get(k)).push(p.id); }
  const vigiados = episodiosVigiados(meta?.ops?.runs);
  for (const id of Object.keys(vigiados)) {
    const os = offers.filter((o) => o.storeId === id);
    const soDela = new Set(os.filter((o) => o.stale && o.lastValid?.stock === 'IN_STOCK').map((o) => o.productId));
    for (const o of vivas) if (o.storeId !== id) soDela.delete(o.productId);
    Object.assign(vigiados[id], { ofertas: os.length, ofertasStale: os.filter((o) => o.stale).length, produtosSemVivaPorElaAgora: soDela.size });
  }
  const removidas = [];
  for (const [id, c] of Object.entries(urlCache || {})) for (const [url, a] of Object.entries(c?.removidas || {})) removidas.push({ storeId: id, url, n: a?.n ?? null, motivo: a?.motivo ?? null, desde: a?.desde ?? null });
  const paginasRemovidas = Object.entries(sources || {}).filter(([, s]) => s?.pagesGone || s?.pagesGoneConfirmed).map(([id, s]) => ({ storeId: id, pagesGone: s.pagesGone || 0, pagesGoneConfirmed: s.pagesGoneConfirmed || 0, lastCheck: s.lastCheck || null }));
  return {
    cobertura, plataformas,
    visiveis: { semPrecoLinkOuHorario: semVerificacao.length, exemplos: semVerificacao.slice(0, 5).map((o) => o.id),
      naoConfirmadas: vivas.filter((o) => o.confirmed === false).length,
      estoqueNaoConfirmadoComPreco: contar(offers.filter((o) => !o.stale && o.stock === 'UNKNOWN' && o.price > 0), (o) => o.storeId) },
    frescor: { idadeVivas: idade, vivasVelhas: vivas.filter((o) => horas(N, o.source_timestamp) > LIMITES.VIVA_VELHA_H).length },
    precoForaDaReferencia, vivasComReferencia: vivas.filter((o) => P.get(o.productId)?.msrp > 0).length,
    repetidas: ofertasRepetidas(offers),
    produtosMesmoNome: [...nomes.values()].filter((v) => v.length > 1),
    vigiados, remocoes: { removidas, paginasRemovidas },
  };
}

const tab = (head, rows) => [`| ${head.join(' | ')} |`, `|${head.map(() => '---').join('|')}|`, ...rows.map((r) => `| ${r.join(' | ')} |`)];
const hhmm = (iso) => String(iso || '?').slice(5, 16).replace('T', ' ');
export function markdown(r) {
  const c = r.cobertura; const out = [`# Qualidade dos dados publicados (${c.dadosEm || '?'})`, '', 'Somente leitura. "Viva" = em estoque, não stale, não anômala, total > 0 (regra do site).', '',
    '## Cobertura', '', `Ofertas ${c.ofertas}: vivas ${c.vivas}, stale ${c.stale}. Produtos ${c.produtos}: com oferta viva ${c.produtosComViva}, sem nenhuma oferta ${c.produtosSemOferta}. Lojas com oferta ${c.lojasComOferta}, com oferta viva ${c.lojasComViva}. Frete conhecido em ${c.freteConhecidoVivas} de ${c.vivas} vivas.`, '',
    `Estoque: ${Object.entries(c.estoque).map(([k, v]) => `${k} ${v}`).join(', ')}. Stale por loja: ${Object.entries(c.staleporLoja).map(([k, v]) => `${k} ${v}`).join(', ') || '—'}.`, '',
    '## Lojas por plataforma', '', ...tab(['plataforma', 'lojas', 'status', 'com oferta viva', 'ativas sem viva', '403', '429', 'leituras ok'],
      Object.entries(r.plataformas).sort((a, b) => b[1].lojas - a[1].lojas).map(([k, x]) => [k, x.lojas, Object.entries(x.status).map(([s, n]) => `${s} ${n}`).join(', '), x.comViva, x.ativasSemViva, x.http403, x.http429, x.leituras ? `${(100 * x.leiturasOk / x.leituras).toFixed(1)}%` : '—'])), '',
    '## Visíveis e frescor', '', `Vivas sem preço, link ou horário: ${r.visiveis.semPrecoLinkOuHorario}. Vivas com leitura não confirmada: ${r.visiveis.naoConfirmadas}. Estoque não confirmado (UNKNOWN) com preço: ${Object.entries(r.visiveis.estoqueNaoConfirmadoComPreco).map(([k, v]) => `${k} ${v}`).join(', ') || '—'}.`,
    `Idade das vivas: ${Object.entries(r.frescor.idadeVivas).map(([k, v]) => `${k} ${v}`).join(', ')}; acima de ${LIMITES.VIVA_VELHA_H} h: ${r.frescor.vivasVelhas}.`, '',
    `## Preço fora da referência Copag (< ${LIMITES.REF_BAIXO}× ou > ${LIMITES.REF_ALTO}×; ${r.vivasComReferencia} vivas têm referência)`, '',
    ...(r.precoForaDaReferencia.length ? tab(['produto', 'loja', 'preço', 'referência', 'razão'], r.precoForaDaReferencia.map((x) => [x.productId, x.storeId, x.price, x.ref, x.razao])) : ['Nenhuma.']), '',
    '## Mesma página repetida por parâmetro de rastreio', '', `${r.repetidas.comRastreio} oferta(s) com rastreio na URL; ${r.repetidas.grupos} página(s) repetida(s), ${r.repetidas.extras} oferta(s) a mais (${r.repetidas.extrasVivas} viva(s)). Por loja: ${Object.entries(r.repetidas.porLoja).map(([k, v]) => `${k} ${v}`).join(', ') || '—'}.`, '',
    '## Produtos com o mesmo nome', '', r.produtosMesmoNome.length ? r.produtosMesmoNome.map((v) => `- ${v.join(' = ')}`).join('\n') : 'Nenhum.', '',
    `## Fontes vigiadas (ops.runs; o Vigia avisa com ${RULES.CONSEC}+ rodadas seguidas fora)`, '',
    ...Object.entries(r.vigiados).flatMap(([id, v]) => [`- **${id}**: fora em ${v.rodadasFora}/${v.rodadas} rodadas, ${v.episodios.length} episódio(s), ${v.episodiosQueAvisam} com aviso. Agora: ${v.ofertasStale}/${v.ofertas} ofertas stale; ${v.produtosSemVivaPorElaAgora} produto(s) sem nenhuma oferta viva por causa dela.`,
      ...v.episodios.map((e) => `  - ${hhmm(e.inicio)} → ${hhmm(e.fim)} UTC (${e.rodadas} rodada(s), ${e.status})`)]), '',
    '## Remoção por página de erro (#897)', '', `url-cache \`removidas\`: ${r.remocoes.removidas.length}${r.remocoes.removidas.map((x) => `\n- ${x.storeId} n=${x.n} desde ${x.desde}: ${x.motivo} — ${x.url}`).join('')}`,
    `Fontes com pagesGone: ${r.remocoes.paginasRemovidas.map((x) => `${x.storeId} ${x.pagesGone} (confirmadas ${x.pagesGoneConfirmed}, ${x.lastCheck})`).join('; ') || 'nenhuma'}.`, ''];
  return out.join('\n');
}

const lerJson = (f, obrigatorio = false) => { try { return JSON.parse(fs.readFileSync(f, 'utf8')); } catch (e) { if (obrigatorio) throw e; return null; } };
export function main(argv = process.argv.slice(2), { log = (s) => process.stdout.write(s) } = {}) {
  const i = argv.indexOf('--out'); const outFile = i >= 0 ? argv[i + 1] : null;
  const dir = argv.filter((a, k) => !a.startsWith('--') && argv[k - 1] !== '--out')[0] || 'data';
  const rep = relatorioQualidade({ state: lerJson(path.join(dir, 'state.json'), true), sources: lerJson(path.join(dir, 'sources.json')),
    meta: lerJson(path.join(dir, 'meta.json')), urlCache: lerJson(path.join(dir, 'url-cache.json')) });
  if (outFile) fs.writeFileSync(outFile, JSON.stringify(rep, null, 2) + '\n');
  log(argv.includes('--json') ? JSON.stringify(rep, null, 2) + '\n' : markdown(rep));
  return rep;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  try { main(); } catch (e) { console.error(`Relatório não gerado: ${String(e?.message || e).slice(0, 200)}`); process.exitCode = 1; }
}
