// Social Media MVP — gerador de hashtags por coleção/tipo do catálogo (issue #655; escopo da #631/#560). Desativado por padrão.
// Módulo puro e determinístico: sem IA, sem rede, sem banco, sem secrets, sem leitura de arquivo. NÃO publica.
// Entrada = produto do catálogo (data/products.json: collection, collectionName, series, type); a mesma entrada gera
// sempre as mesmas hashtags, na mesma ordem. Texto livre de loja não vira hashtag. Tom e regras: docs/social-tom-de-voz.md.
// Marca de terceiro que sugira afiliação/patrocínio (Copag, Nintendo, lojas, "oficial") é descartada com motivo.
import { CANAIS, LIMITES, limpar, socialEnabled, SOCIAL_ENABLED_DEFAULT } from './rascunho.js';

export { socialEnabled, SOCIAL_ENABLED_DEFAULT };

/** Máximo de hashtags por canal: poucas e relevantes (Telegram não indexa hashtag como o Instagram). */
export const LIMITES_HASHTAGS = Object.freeze({ telegram: 3, instagram: 8 });
export const HASHTAG_MAX = 30;   // caracteres depois do "#"; hashtag maior é descartada, nunca cortada
/** Hashtags gerais do nicho. "PokemonTCG" só identifica o jogo do produto (uso descritivo), não afiliação. */
export const GERAIS = Object.freeze(['PokemonTCG', 'TCGBrasil', 'CartasPokemon']);

// Tipo do catálogo (TYPE_LABEL em src/match.js) → hashtag em pt-BR. Tipo fora da lista não gera hashtag de tipo.
export const TIPOS = Object.freeze({
  booster_box: 'BoosterBox', combo: 'ComboDeBooster', etb: 'ETB', booster_pack: 'Booster',
  blister_1: 'Blister', blister_2: 'Blister', blister_3: 'Blister', blister_4: 'Blister',
  minilata: 'Minilata', lata: 'LataPokemon', deck: 'BaralhoDeBatalha', desafio: 'DesafioEstrategico', kit_treinador: 'KitTreinador',
  colecao: 'BoxColecao', colecao_premium: 'ColecaoPremium', colecao_especial: 'ColecaoEspecial', colecao_ex: 'BoxPokemonEx',
  colecao_poster: 'BoxColecao', colecao_fichario: 'BoxColecao', colecao_miniatura: 'BoxColecao',
  colecao_porta_retrato: 'ColecaoPremium', colecao_ilustracao: 'BoxColecao',
});

// Termos de marca de terceiro que não podem aparecer em hashtag (comparação sem acento, minúscula, só letras/dígitos).
// Fabricante/distribuidora/detentoras de direitos (sugeririam afiliação oficial) e lojas/marketplaces (propaganda de
// terceiro). Lojas de config/stores.json entram por opts.marcas; este módulo não lê arquivo.
export const MARCAS_BLOQUEADAS = Object.freeze([
  'oficial', 'official', 'copag', 'nintendo', 'pokemoncompany', 'gamefreak', 'creaturesinc',
  'amazon', 'mercadolivre', 'mercadolibre', 'shopee', 'magalu', 'magazineluiza', 'americanas', 'submarino',
  'casasbahia', 'carrefour', 'aliexpress', 'rihappy', 'kabum', 'ligapokemon', 'mypcards',
]);
// Hashtag não promete nada nem pressiona (mesma lista de chamadas proibidas do guia de tom de voz).
export const TERMOS_PROIBIDOS = Object.freeze([
  'imperdivel', 'ultimachance', 'ultimasunidades', 'sohoje', 'garantaja', 'vaiacabar', 'vaiesgotar',
  'vaibaixar', 'vaisubir', 'vaivoltar', 'promocao', 'menorprecodobrasil', 'precobaixo', 'barato', 'queima',
]);

export const MOTIVOS = Object.freeze({
  MARCA: 'marca de terceiro',
  PROIBIDO: 'termo proibido pelo guia de tom de voz',
  LONGA: 'hashtag longa demais',
  SEM_LETRA: 'hashtag sem letras',
  DUPLICADA: 'hashtag duplicada',
  LIMITE: 'acima do limite do canal',
});

const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const erro = (m) => Object.assign(new Error(`hashtags social: ${m}`), { code: 'HASHTAGS_INVALIDAS' });
/** Comparação: sem acento, minúscula, só [a-z0-9]. */
export const chave = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Texto do catálogo → corpo de hashtag em CamelCase sem acento ("Equilíbrio Perfeito" → "EquilibrioPerfeito").
 *  Passa antes por limpar (rascunho.js): HTML, URL e @menção não viram parte da hashtag. */
export function paraHashtag(s) {
  return limpar(s).normalize('NFD').replace(/[̀-ͯ]/g, '')
    .split(/[^A-Za-z0-9]+/).filter(Boolean)
    .map((p) => (/^[a-z]/.test(p) ? p[0].toUpperCase() + p.slice(1) : p)).join('');
}

/** Candidatas em ordem de prioridade: coleção, tipo, jogo, série, demais gerais. */
function candidatas(produto) {
  const p = isObj(produto) ? produto : {};
  const txt = (v) => (typeof v === 'string' ? v.trim() : '');
  return [
    { origem: 'colecao', corpo: paraHashtag(txt(p.collectionName)) },
    { origem: 'tipo', corpo: Object.hasOwn(TIPOS, p.type) ? TIPOS[p.type] : '' },
    { origem: 'geral', corpo: GERAIS[0] },
    { origem: 'serie', corpo: paraHashtag(txt(p.series)) },
    ...GERAIS.slice(1).map((corpo) => ({ origem: 'geral', corpo })),
  ].filter((c) => c.corpo);
}

/** produto = { collectionName, series, type } (data/products.json). opts = { canal, marcas: [nomes extras a bloquear] }.
 *  Devolve { canal, hashtags: ['#…'], texto: '#A #B', descartadas: [{ hashtag, origem, motivo }] }. */
export function gerarHashtags(produto, { canal, marcas = [] } = {}) {
  if (!CANAIS.includes(canal)) throw erro(`canal desconhecido: ${String(canal)}`);
  if (!Array.isArray(marcas)) throw erro('marcas deve ser lista');
  const bloqueadas = [...MARCAS_BLOQUEADAS, ...marcas.map(chave)].filter((m) => m.length >= 3);
  const hashtags = []; const descartadas = []; const vistas = new Set();
  for (const { origem, corpo } of candidatas(produto)) {
    const k = chave(corpo); const hashtag = `#${corpo}`;
    const fora = (motivo) => descartadas.push({ hashtag, origem, motivo });
    if (!/[a-z]/.test(k)) fora(MOTIVOS.SEM_LETRA);
    else if (corpo.length > HASHTAG_MAX) fora(MOTIVOS.LONGA);
    else if (bloqueadas.some((m) => k.includes(m))) fora(MOTIVOS.MARCA);
    else if (TERMOS_PROIBIDOS.some((m) => k.includes(m))) fora(MOTIVOS.PROIBIDO);
    else if (vistas.has(k)) fora(MOTIVOS.DUPLICADA);
    else if (hashtags.length >= LIMITES_HASHTAGS[canal]) { vistas.add(k); fora(MOTIVOS.LIMITE); }
    else { vistas.add(k); hashtags.push(hashtag); }
  }
  return { canal, hashtags, texto: hashtags.join(' '), descartadas };
}

/** Acrescenta a linha de hashtags ao rascunho (saída de gerarRascunho) sem passar do limite do canal: se não couber,
 *  tira hashtags do fim (as menos prioritárias); o texto do rascunho nunca é cortado. Devolve o rascunho com
 *  { texto, hashtags, avisos } atualizados. */
export function anexarHashtags(rascunho, hashtags) {
  if (!isObj(rascunho) || !CANAIS.includes(rascunho.canal) || typeof rascunho.texto !== 'string') throw erro('rascunho inválido');
  if (!Array.isArray(hashtags) || hashtags.some((h) => typeof h !== 'string' || !/^#[A-Za-z0-9]+$/.test(h))) throw erro('hashtags inválidas');
  const usadas = hashtags.slice(0, LIMITES_HASHTAGS[rascunho.canal]);
  const avisos = [...(Array.isArray(rascunho.avisos) ? rascunho.avisos : [])];
  const cabe = (hs) => rascunho.texto.length + 1 + hs.join(' ').length <= LIMITES[rascunho.canal];
  while (usadas.length && !cabe(usadas)) usadas.pop();
  if (usadas.length < Math.min(hashtags.length, LIMITES_HASHTAGS[rascunho.canal])) avisos.push('hashtags reduzidas para caber no limite do canal');
  return { ...rascunho, texto: usadas.length ? `${rascunho.texto}\n${usadas.join(' ')}` : rascunho.texto, hashtags: usadas, avisos };
}
