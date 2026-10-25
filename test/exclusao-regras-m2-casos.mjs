// Casos da regra M2 (exclusão de conta: "criar só com perfil completo") no MESMO formato de firebase/test/casos.mjs,
// prontos para colar em CASOS quando a PR da regra existir (o workflow firestore-regras.yml copia só regras-emulador.mjs
// e casos.mjs para a pasta temporária: os casos precisam estar DENTRO de casos.mjs, não importados daqui).
// Diff proposto (regra + casos + test/workflow-security-tests.js): scratchpad frentes/T5-B.md. Conferência estática no
// `npm test`: test/exclusao-regras-m2-tests.js. M2 NÃO validada: sem emulador do Firestore nesta máquina (jar bloqueado).
// Todos os casos usam o PRÓPRIO uid ('novo', sem documento na SEMENTE; ou usuarioA, que existe): o controle negativo do
// workflow (sed tira a checagem de dono) não muda nenhum deles, então só os casos outro-usuario continuam divergindo.

const A = 'usuarioA';
// Perfil completo como a página cria (onUser: save(base, true) = setDoc merge; continuar(): set na transação).
const perfil = { name: 'Novo', favorites: [], alerts: [], termsAt: 2, createdAt: 2, updatedAt: 2 };
const semCampo = (k) => Object.fromEntries(Object.entries(perfil).filter(([c]) => c !== k));

/** grupo 'criacao': create de users/{uid} exige createdAt e termsAt; update de documento existente segue como hoje. */
export const CASOS_M2 = Object.freeze([
  // Gravação parcial de cliente antigo (setDoc merge de favorito/alerta) NÃO recria documento apagado (lacuna M2 hoje).
  { id: 'm2-cria-parcial-favorito', grupo: 'criacao', quem: 'novo', op: 'merge', caminho: 'users/novo', dados: { favorites: ['sv1-1'], updatedAt: 3 }, esperado: 'negado' },
  { id: 'm2-cria-parcial-alerta', grupo: 'criacao', quem: 'novo', op: 'merge', caminho: 'users/novo', dados: { alerts: [{ p: 'sv1-1', alvo: 10 }], updatedAt: 3 }, esperado: 'negado' },
  { id: 'm2-cria-sem-termsAt', grupo: 'criacao', quem: 'novo', op: 'set', caminho: 'users/novo', dados: semCampo('termsAt'), esperado: 'negado' },
  { id: 'm2-cria-sem-createdAt', grupo: 'criacao', quem: 'novo', op: 'merge', caminho: 'users/novo', dados: semCampo('createdAt'), esperado: 'negado' },
  { id: 'm2-cria-vazio', grupo: 'criacao', quem: 'novo', op: 'set', caminho: 'users/novo', dados: {}, esperado: 'negado' },
  { id: 'm2-cria-completo-campo-extra', grupo: 'criacao', quem: 'novo', op: 'set', caminho: 'users/novo', dados: { ...perfil, admin: true }, esperado: 'negado' },
  { id: 'm2-cria-completo-201', grupo: 'criacao', quem: 'novo', op: 'merge', caminho: 'users/novo', dados: { ...perfil, favorites: Array.from({ length: 201 }, (_, i) => `id-${i}`) }, esperado: 'negado' },
  // Cadastro e "Criar perfil"/"Continuar usando" seguem funcionando.
  { id: 'm2-cria-completo-merge', grupo: 'criacao', quem: 'novo', op: 'merge', caminho: 'users/novo', dados: perfil, esperado: 'permitido' },
  { id: 'm2-cria-completo-set', grupo: 'criacao', quem: 'novo', op: 'set', caminho: 'users/novo', dados: perfil, esperado: 'permitido' },
  // Documento existente: gravação parcial (merge/update) continua permitida, com os mesmos campos e limites.
  { id: 'm2-existente-merge-parcial', grupo: 'criacao', quem: A, op: 'merge', caminho: `users/${A}`, dados: { favorites: ['sv1-9'], updatedAt: 4 }, esperado: 'permitido' },
  { id: 'm2-existente-update-parcial', grupo: 'criacao', quem: A, op: 'update', caminho: `users/${A}`, dados: { alerts: [], updatedAt: 4 }, esperado: 'permitido' },
  { id: 'm2-existente-campo-extra', grupo: 'criacao', quem: A, op: 'merge', caminho: `users/${A}`, dados: { admin: true }, esperado: 'negado' },
]);

/** Ids que divergem com as regras ATUAIS (create aceita gravação parcial): a lacuna que a M2 fecha. */
export const LACUNA_HOJE = Object.freeze(['m2-cria-parcial-favorito', 'm2-cria-parcial-alerta', 'm2-cria-sem-termsAt', 'm2-cria-sem-createdAt', 'm2-cria-vazio']);
