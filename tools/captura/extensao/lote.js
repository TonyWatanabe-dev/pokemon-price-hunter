// Lote do dia da extensão (funções puras, sem chrome.*): acumula por loja com dedupe por id (o último vence), monta o arquivo no
// formato do favorito e decide quando gravar (no máximo 1 gravação por loja a cada 30 s). Usado pelo service worker e pelos testes.
const LOJAS = ['mercadolivre', 'shopee', 'amazon'];
const NOMES = { mercadolivre: 'Mercado Livre', shopee: 'Shopee', amazon: 'Amazon' };
const INTERVALO_GRAVACAO_MS = 30000;

function dia(d) {
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}
function loteVazio(diaAtual) {
  return { dia: diaAtual, lojas: {} };
}
function itemValido(i) {
  return !!(i && typeof i.id === 'string' && i.id && typeof i.titulo === 'string' && i.titulo && Number(i.preco) > 0);
}
// Devolve o lote novo (não altera o recebido). Lote de outro dia recomeça vazio.
function acumular(lote, loja, itens, diaAtual) {
  if (!LOJAS.includes(loja)) return lote;
  const base = lote && lote.dia === diaAtual ? lote : loteVazio(diaAtual);
  const atual = base.lojas[loja] || { itens: {}, sujo: false, gravadoEm: null };
  const mapa = { ...atual.itens };
  let mudou = false;
  for (const i of itens || []) {
    if (!itemValido(i)) continue;
    if (JSON.stringify(mapa[i.id]) !== JSON.stringify(i)) mudou = true;
    mapa[i.id] = i;
  }
  return { dia: base.dia, lojas: { ...base.lojas, [loja]: { itens: mapa, sujo: atual.sujo || mudou, gravadoEm: atual.gravadoEm } } };
}
function total(lote, loja) {
  return lote && lote.lojas && lote.lojas[loja] ? Object.keys(lote.lojas[loja].itens).length : 0;
}
function montarArquivo(lote, loja) {
  return { versao: 1, loja, origem: 'extensao', itens: Object.values(lote.lojas[loja].itens) };
}
function nomeArquivo(loja, diaAtual) {
  return 'tph-capturas/captura-' + loja + '-' + diaAtual + '.json';
}
// Pronto para gravar agora? (tem mudança pendente e passaram 30 s da última gravação da loja)
function aGravar(lote, loja, agoraMs) {
  const l = lote && lote.lojas && lote.lojas[loja];
  if (!l || !l.sujo) return false;
  return l.gravadoEm == null || agoraMs - l.gravadoEm >= INTERVALO_GRAVACAO_MS;
}
// Quanto falta (ms) para poder gravar; 0 se já pode ou se não há nada pendente.
function esperaGravacao(lote, loja, agoraMs) {
  const l = lote && lote.lojas && lote.lojas[loja];
  if (!l || !l.sujo || l.gravadoEm == null) return 0;
  return Math.max(0, INTERVALO_GRAVACAO_MS - (agoraMs - l.gravadoEm));
}
function marcarGravado(lote, loja, agoraMs) {
  const l = lote.lojas[loja];
  return { dia: lote.dia, lojas: { ...lote.lojas, [loja]: { ...l, sujo: false, gravadoEm: agoraMs } } };
}
function urlDados(arquivo) {
  return 'data:application/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(arquivo, null, 1));
}

// ---------------------------------------------------------------- buscas feitas (popup: ✓ / pendente)
const VALIDADE_BUSCA_MS = 48 * 3600 * 1000; // mesma validade das leituras manuais no site
/** Chave estável de uma busca: ML pelo caminho, Shopee pelo keyword, Amazon pelo k (minúsculo, sem acento de codificação). */
function chaveBusca(url) {
  let u;
  try { u = new URL(url); } catch { return null; }
  const q = (n) => (u.searchParams.get(n) || '').trim().toLowerCase().replace(/\s+/g, ' ');
  if (/(^|\.)mercadolivre\.com\.br$/.test(u.hostname)) return 'mercadolivre:' + decodeURIComponent(u.pathname).replace(/\/+$/, '').toLowerCase();
  if (/(^|\.)shopee\.com\.br$/.test(u.hostname)) return q('keyword') ? 'shopee:' + q('keyword') : null;
  if (/(^|\.)amazon\.com\.br$/.test(u.hostname)) return q('k') ? 'amazon:' + q('k') + (q('page') && q('page') !== '1' ? '#p' + q('page') : '') : null;
  return null;
}
/** Registra a leitura de uma busca; guarda o maior número de ofertas lido na página. */
function marcarBusca(buscas, url, naPagina, agoraMs) {
  const k = chaveBusca(url);
  if (!k || !(naPagina > 0)) return buscas || {};
  const ant = (buscas || {})[k];
  const recente = ant && agoraMs - ant.em < VALIDADE_BUSCA_MS;
  return { ...(buscas || {}), [k]: { em: agoraMs, n: recente ? Math.max(ant.n, naPagina) : naPagina } };
}
/** Estado de uma busca para o popup: { feita, em, n }. */
function estadoBusca(buscas, url, agoraMs) {
  const b = (buscas || {})[chaveBusca(url)];
  return b && agoraMs - b.em < VALIDADE_BUSCA_MS ? { feita: true, em: b.em, n: b.n } : { feita: false, em: b ? b.em : null, n: 0 };
}
