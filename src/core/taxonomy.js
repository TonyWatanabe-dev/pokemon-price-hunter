// Ponte entre os tipos atuais do robô (match.js) e a taxonomia do banco (db/migrations/002_seed.sql).
// Regra determinística: nada de IA aqui.
const TYPE_TO_CATEGORY = {
  booster_pack: 'sealed.booster',
  combo: 'sealed.booster_bundle',
  booster_box: 'sealed.booster_box',
  etb: 'sealed.etb',
  colecao: 'sealed.collection_box',
  colecao_ex: 'sealed.collection_box',
  colecao_fichario: 'sealed.collection_box',
  colecao_ilustracao: 'sealed.collection_box',
  colecao_poster: 'sealed.collection_box',
  colecao_miniatura: 'sealed.collection_box',
  colecao_premium: 'sealed.premium_collection',
  blister_1: 'sealed.blister',
  blister_2: 'sealed.blister',
  blister_3: 'sealed.blister',
  blister_4: 'sealed.blister',
  lata: 'sealed.tin',
  minilata: 'sealed.mini_tin',
  deck: 'sealed.deck',
  desafio: 'sealed.deck',
};
export function categoryOf(type) {
  const c = TYPE_TO_CATEGORY[type];
  if (!c) throw new Error(`tipo sem categoria: ${type}`);
  return c;
}
export const KNOWN_TYPES = Object.keys(TYPE_TO_CATEGORY);
