// Casos de comportamento das regras do Firestore (firebase/firestore.rules), rodados no emulador por
// firebase/test/regras-emulador.mjs (workflow .github/workflows/firestore-regras.yml). Só dados: sem dependências,
// para test/firestore-regras-emulador-tests.js conferir a cobertura dentro do `npm test` (que não tem Java).
// Antes de CADA caso o banco é zerado e recebe SEMENTE (gravada com as regras desligadas).
// quem: A | B | outro uid (logado com esse uid) | 'anon' (sem login). op: get | list | set | merge | update | delete.

export const A = 'usuarioA';
export const B = 'usuarioB';

/** Documentos existentes antes de cada caso (perfil como a página grava). */
export const SEMENTE = Object.freeze({
  [`users/${A}`]: { name: 'A', favorites: ['sv1-1'], alerts: [], termsAt: 1, createdAt: 1, updatedAt: 1 },
  [`users/${B}`]: { name: 'B', favorites: ['sv1-2'], alerts: [], termsAt: 1, createdAt: 1, updatedAt: 1 },
  [`users/${A}/privado/1`]: { x: 1 },
  'outra/1': { x: 1 },
});

const lista = (n) => Array.from({ length: n }, (_, i) => `id-${i}`);
const perfil = { name: 'Novo', favorites: [], alerts: [], termsAt: 2, createdAt: 2, updatedAt: 2 };

/** grupo: dono | outro-usuario | anonimo | campos | outros-caminhos. */
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
  // Qualquer outro caminho: negado, mesmo para o dono (subcoleção) e para usuário logado.
  { id: 'subcolecao-le', grupo: 'outros-caminhos', quem: A, op: 'get', caminho: `users/${A}/privado/1`, esperado: 'negado' },
  { id: 'subcolecao-grava', grupo: 'outros-caminhos', quem: A, op: 'set', caminho: `users/${A}/privado/2`, dados: { x: 1 }, esperado: 'negado' },
  { id: 'outra-le', grupo: 'outros-caminhos', quem: A, op: 'get', caminho: 'outra/1', esperado: 'negado' },
  { id: 'outra-lista', grupo: 'outros-caminhos', quem: A, op: 'list', caminho: 'outra', esperado: 'negado' },
  { id: 'outra-grava', grupo: 'outros-caminhos', quem: A, op: 'set', caminho: 'outra/2', dados: { x: 1 }, esperado: 'negado' },
  { id: 'outra-apaga', grupo: 'outros-caminhos', quem: A, op: 'delete', caminho: 'outra/1', esperado: 'negado' },
  { id: 'colecao-nova-grava', grupo: 'outros-caminhos', quem: A, op: 'set', caminho: `qualquer/${A}`, dados: { x: 1 }, esperado: 'negado' },
]);
