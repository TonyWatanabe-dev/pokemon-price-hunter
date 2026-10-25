// Casos de comportamento das regras do Firestore (firebase/firestore.rules), rodados no emulador por
// firebase/test/regras-emulador.mjs (workflow .github/workflows/firestore-regras.yml). Só dados: sem dependências,
// para test/firestore-regras-emulador-tests.js conferir a cobertura dentro do `npm test` (que não tem Java).
// Antes de CADA caso o banco é zerado e recebe SEMENTE (gravada com as regras desligadas).
// quem: A | B | outro uid (logado com esse uid) | 'anon' (sem login). op: get | list | set | merge | update | delete.

export const A = 'usuarioA';
export const B = 'usuarioB';

// Alertas no Telegram (docs/alertas-telegram-usuario.md): A já está ligado (telegram gravado pelo robô); B tem um pedido
// de vínculo antigo. criadoEm do pedido precisa estar a até 2 min da hora do servidor: AGORA é lido ao carregar os casos,
// na mesma máquina do emulador.
export const AGORA = Date.now();
const H = (c) => c.repeat(64);
export const TELEGRAM_A = Object.freeze({ chatId: 111, ligadoEm: '2026-10-15T12:00:00.000Z', hash: H('a'), envios: {}, dia: '', nDia: 0 });

/** Documentos existentes antes de cada caso (perfil como a página grava, mais os campos do Telegram). */
export const SEMENTE = Object.freeze({
  [`users/${A}`]: { name: 'A', favorites: ['sv1-1'], alerts: [], termsAt: 1, createdAt: 1, updatedAt: 1, telegramPedido: null, telegram: TELEGRAM_A },
  [`users/${B}`]: { name: 'B', favorites: ['sv1-2'], alerts: [], termsAt: 1, createdAt: 1, updatedAt: 1, telegramPedido: { hash: H('b'), criadoEm: 1 }, telegram: null },
  [`users/${A}/privado/1`]: { x: 1 },
  'outra/1': { x: 1 },
});

const lista = (n) => Array.from({ length: n }, (_, i) => `id-${i}`);
const perfil = { name: 'Novo', favorites: [], alerts: [], termsAt: 2, createdAt: 2, updatedAt: 2 };
const semCampo = (k) => Object.fromEntries(Object.entries(perfil).filter(([c]) => c !== k));
const SEMENTE_A = () => ({ ...SEMENTE[`users/${A}`] });

/** grupo: dono | outro-usuario | anonimo | campos | telegram | outros-caminhos | criacao. */
export const CASOS = Object.freeze([
  // Dono: lê, cria, grava (merge, como a página), atualiza e apaga o próprio documento.
  { id: 'dono-le', grupo: 'dono', quem: A, op: 'get', caminho: `users/${A}`, esperado: 'permitido' },
  { id: 'dono-merge', grupo: 'dono', quem: A, op: 'merge', caminho: `users/${A}`, dados: { favorites: ['sv1-1', 'sv1-3'], updatedAt: 3 }, esperado: 'permitido' },
  { id: 'dono-update', grupo: 'dono', quem: A, op: 'update', caminho: `users/${A}`, dados: { name: 'A2' }, esperado: 'permitido' },
  { id: 'dono-apaga', grupo: 'dono', quem: A, op: 'delete', caminho: `users/${A}`, esperado: 'permitido' },
  { id: 'dono-cria-novo', grupo: 'dono', quem: 'novo', op: 'set', caminho: 'users/novo', dados: perfil, esperado: 'permitido' },
  // Outro usuário: A não lê, não grava e não apaga users/B (nem cria documento com o uid de outro).
  { id: 'outro-le', grupo: 'outro-usuario', quem: A, op: 'get', caminho: `users/${B}`, esperado: 'negado' },
  { id: 'outro-merge', grupo: 'outro-usuario', quem: A, op: 'merge', caminho: `users/${B}`, dados: { name: 'invadido' }, esperado: 'negado' },
  { id: 'outro-set', grupo: 'outro-usuario', quem: A, op: 'set', caminho: `users/${B}`, dados: perfil, esperado: 'negado' },
  { id: 'outro-update', grupo: 'outro-usuario', quem: A, op: 'update', caminho: `users/${B}`, dados: { name: 'invadido' }, esperado: 'negado' },
  { id: 'outro-apaga', grupo: 'outro-usuario', quem: A, op: 'delete', caminho: `users/${B}`, esperado: 'negado' },
  { id: 'outro-cria', grupo: 'outro-usuario', quem: A, op: 'set', caminho: 'users/inexistente', dados: perfil, esperado: 'negado' },
  { id: 'logado-lista-users', grupo: 'outro-usuario', quem: A, op: 'list', caminho: 'users', esperado: 'negado' },
  // Anônimo: nada.
  { id: 'anon-le', grupo: 'anonimo', quem: 'anon', op: 'get', caminho: `users/${A}`, esperado: 'negado' },
  { id: 'anon-lista-users', grupo: 'anonimo', quem: 'anon', op: 'list', caminho: 'users', esperado: 'negado' },
  { id: 'anon-set', grupo: 'anonimo', quem: 'anon', op: 'set', caminho: `users/${A}`, dados: perfil, esperado: 'negado' },
  { id: 'anon-apaga', grupo: 'anonimo', quem: 'anon', op: 'delete', caminho: `users/${A}`, esperado: 'negado' },
  { id: 'anon-le-outra', grupo: 'anonimo', quem: 'anon', op: 'get', caminho: 'outra/1', esperado: 'negado' },
  // Campos e limites gravados pela página (hasOnly, favorites <= 200, alerts <= 50).
  { id: 'campo-desconhecido', grupo: 'campos', quem: A, op: 'merge', caminho: `users/${A}`, dados: { admin: true }, esperado: 'negado' },
  { id: 'favoritos-200', grupo: 'campos', quem: A, op: 'merge', caminho: `users/${A}`, dados: { favorites: lista(200) }, esperado: 'permitido' },
  { id: 'favoritos-201', grupo: 'campos', quem: A, op: 'merge', caminho: `users/${A}`, dados: { favorites: lista(201) }, esperado: 'negado' },
  { id: 'alertas-50', grupo: 'campos', quem: A, op: 'merge', caminho: `users/${A}`, dados: { alerts: lista(50) }, esperado: 'permitido' },
  { id: 'alertas-51', grupo: 'campos', quem: A, op: 'merge', caminho: `users/${A}`, dados: { alerts: lista(51) }, esperado: 'negado' },
  // Telegram: a conta pede vínculo (hash + criadoEm atual) e pode desligar (null); chat_id e registro de envios só o robô grava.
  { id: 'tg-pedido-valido', grupo: 'telegram', quem: A, op: 'merge', caminho: `users/${A}`, dados: { telegramPedido: { hash: H('c'), criadoEm: AGORA } }, esperado: 'permitido' },
  { id: 'tg-pedido-apaga', grupo: 'telegram', quem: B, op: 'merge', caminho: `users/${B}`, dados: { telegramPedido: null }, esperado: 'permitido' },
  { id: 'tg-pedido-antigo-mantido', grupo: 'telegram', quem: B, op: 'merge', caminho: `users/${B}`, dados: { favorites: ['sv1-9'], updatedAt: 3 }, esperado: 'permitido' },
  { id: 'tg-desliga', grupo: 'telegram', quem: A, op: 'merge', caminho: `users/${A}`, dados: { telegram: null }, esperado: 'permitido' },
  { id: 'tg-pedido-velho', grupo: 'telegram', quem: A, op: 'merge', caminho: `users/${A}`, dados: { telegramPedido: { hash: H('c'), criadoEm: AGORA - 10 * 60e3 } }, esperado: 'negado' },
  { id: 'tg-pedido-futuro', grupo: 'telegram', quem: A, op: 'merge', caminho: `users/${A}`, dados: { telegramPedido: { hash: H('c'), criadoEm: AGORA + 60 * 60e3 } }, esperado: 'negado' },
  { id: 'tg-pedido-hash-ruim', grupo: 'telegram', quem: A, op: 'merge', caminho: `users/${A}`, dados: { telegramPedido: { hash: 'xyz', criadoEm: AGORA } }, esperado: 'negado' },
  { id: 'tg-pedido-campo-extra', grupo: 'telegram', quem: A, op: 'set', caminho: `users/${A}`, dados: { ...SEMENTE_A(), telegramPedido: { hash: H('c'), criadoEm: AGORA, chatId: 5 } }, esperado: 'negado' },
  { id: 'tg-forja-chat', grupo: 'telegram', quem: A, op: 'merge', caminho: `users/${A}`, dados: { telegram: { chatId: 999 } }, esperado: 'negado' },
  { id: 'tg-zera-envios', grupo: 'telegram', quem: A, op: 'set', caminho: `users/${A}`, dados: { ...SEMENTE_A(), telegram: { ...TELEGRAM_A, nDia: 0, envios: { x: 1 } } }, esperado: 'negado' },
  { id: 'tg-liga-sozinho', grupo: 'telegram', quem: B, op: 'merge', caminho: `users/${B}`, dados: { telegram: { chatId: 222, ligadoEm: 'x', hash: H('b'), envios: {}, dia: '', nDia: 0 } }, esperado: 'negado' },
  { id: 'tg-cria-com-chat', grupo: 'telegram', quem: 'novo', op: 'set', caminho: 'users/novo', dados: { ...perfil, telegram: { chatId: 5 } }, esperado: 'negado' },
  // Qualquer outro caminho: negado, mesmo para o dono (subcoleção) e para usuário logado.
  { id: 'subcolecao-le', grupo: 'outros-caminhos', quem: A, op: 'get', caminho: `users/${A}/privado/1`, esperado: 'negado' },
  { id: 'subcolecao-grava', grupo: 'outros-caminhos', quem: A, op: 'set', caminho: `users/${A}/privado/2`, dados: { x: 1 }, esperado: 'negado' },
  { id: 'outra-le', grupo: 'outros-caminhos', quem: A, op: 'get', caminho: 'outra/1', esperado: 'negado' },
  { id: 'outra-lista', grupo: 'outros-caminhos', quem: A, op: 'list', caminho: 'outra', esperado: 'negado' },
  { id: 'outra-grava', grupo: 'outros-caminhos', quem: A, op: 'set', caminho: 'outra/2', dados: { x: 1 }, esperado: 'negado' },
  { id: 'outra-apaga', grupo: 'outros-caminhos', quem: A, op: 'delete', caminho: 'outra/1', esperado: 'negado' },
  { id: 'colecao-nova-grava', grupo: 'outros-caminhos', quem: A, op: 'set', caminho: `qualquer/${A}`, dados: { x: 1 }, esperado: 'negado' },
  // Exclusão de conta (regra M2): criar users/{uid} só com perfil completo (createdAt + termsAt); documento existente segue com gravação parcial.
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
