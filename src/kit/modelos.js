// "Monte seu kit" (docs/monte-seu-kit.md, K2): modelos de combo. Dados puros, sem lógica; a lógica está em recomendar.js.
// Cada papel lista os tipos do catálogo (TYPE_LABEL de src/match.js) em ordem de preferência. Acessórios ainda não têm
// produto no catálogo (o casamento os recusa): o modelo só declara quais seriam sugeridos, para o aviso honesto.
export const MODELOS = Object.freeze({
  primeira_colecao: { nome: 'Minha primeira coleção', papeis: [{ papel: 'abrir', tipos: ['blister_3', 'blister_4', 'blister_2', 'blister_1', 'booster_pack'], porque: 'para abrir pacotes e começar a coleção', repetir: 3 }], acessorios: ['sleeve', 'fichario'] },
  colecionador: { nome: 'Colecionador organizado', papeis: [{ papel: 'colecao', tipos: ['etb', 'colecao_fichario', 'colecao', 'colecao_poster', 'lata'], porque: 'produto de coleção com boosters e itens para organizar' }], acessorios: ['fichario', 'sleeve'] },
  jogar: { nome: 'Quero aprender a jogar', papeis: [{ papel: 'deck', tipos: ['deck', 'kit_treinador', 'desafio'], porque: 'baralho pronto para começar a jogar' }], acessorios: ['sleeve', 'deck_box', 'playmat'] },
  especiais: { nome: 'Quero cartas especiais', papeis: [{ papel: 'especial', tipos: ['colecao_ex', 'colecao_ilustracao', 'colecao_premium', 'colecao_especial'], porque: 'coleção com carta promocional no nome do produto' }], acessorios: ['sleeve'] },
});
// Objetivo do questionário → modelo.
export const OBJETIVO_MODELO = Object.freeze({ colecionar: 'primeira_colecao', abrir: 'primeira_colecao', presentear: 'colecionador', jogar: 'jogar', especiais: 'especiais', proteger: null });
export const ACESSORIO_NOME = Object.freeze({ sleeve: 'sleeves (protetores)', fichario: 'fichário', deck_box: 'deck box', playmat: 'playmat', toploader: 'toploader' });
export const ORCAMENTOS = Object.freeze([50, 100, 200, 400]);
