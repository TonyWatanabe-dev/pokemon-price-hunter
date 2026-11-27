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
