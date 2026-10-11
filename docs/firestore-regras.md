# Regras do Firestore

As regras recomendadas estão em `firebase/firestore.rules`, junto com `firebase/firebase.json`. A pasta fica de propósito **fora da raiz**: nada é publicado automaticamente, nenhum workflow publica regras e o `firebase/` está no `.vercelignore`.

## O que o site usa

Só o documento `users/{uid}`, em `tools/account.src.js` (página da conta):

| Operação | Quando |
|---|---|
| `getDoc(users/{uid})` | carregar as preferências |
| `setDoc(users/{uid}, ..., { merge: true })` | salvar as preferências |
| `deleteDoc(users/{uid})` | excluir a conta |

O `uid` é sempre o do próprio usuário logado (`auth.currentUser.uid`). `test/workflow-security-tests.js` falha se o site passar a usar outra coleção sem as regras mudarem junto.

## Regra proposta

- `users/{uid}`: leitura e escrita só quando `request.auth.uid == uid`.
- Todo o resto: negado, inclusive subcoleções de `users/{uid}` e qualquer coleção nova.

Ficou de fora, de propósito (o lote é mínimo):

- **Validação de campos e tamanho** do documento. Pode entrar depois, com a lista de campos que a página grava.
- **Exigir e-mail verificado.** Hoje a página grava preferências antes da verificação, então isso a quebraria.

## Antes de publicar (obrigatório)

**Publicar regras substitui POR INTEIRO o que está no console.** As regras atuais não estão versionadas. Se existir no console alguma regra que este arquivo não conhece, ela some.

1. **Copie as regras atuais**: Firebase Console → projeto `tcg-price-hunter` → **Firestore Database** → **Rules**. Copie o texto inteiro para um arquivo local, por exemplo `regras-console-AAAA-MM-DD.rules`. Guarde essa cópia: ela é o *rollback*.
2. **Compare** com a proposta:
   ```bash
   diff -u regras-console-AAAA-MM-DD.rules firebase/firestore.rules
   ```
   - Qualquer `match` que exista no console e não em `firebase/firestore.rules` precisa de uma decisão: incluir no arquivo ou confirmar que não é usado.
   - Se o console estiver em **modo de teste** (`allow read, write: if request.time < timestamp.date(...)`), qualquer pessoa pode ler e gravar tudo até essa data. Publicar a proposta fecha essa brecha.
3. **Veja o uso real**: Console → **Firestore Database** → **Data**. Confirme que só existe a coleção `users`.

## Testar no emulador (local, sem tocar em produção)

Pré-requisitos: Node 22, Java 21 ou mais novo, e a Firebase CLI (`npm i -g firebase-tools`).

```bash
cd firebase
firebase emulators:start --only firestore --project demo-tcgph
```

O prefixo `demo-` garante que nada fala com um projeto real. Com o emulador no ar, abra o **Rules Playground** do console, ou use o SDK apontado para `127.0.0.1:8080` e confira:

| Caso | Esperado |
|---|---|
| sem login, `get users/abc` | negado |
| logado como `abc`, `get`/`set`/`delete users/abc` | permitido |
| logado como `abc`, `get users/xyz` | negado |
| logado como `abc`, `set users/abc/qualquer/1` (subcoleção) | negado |
| logado, `get outra/1` | negado |

Teste de ponta a ponta com o site, ainda local:

1. Rode `node tools/local-server.mjs`.
2. Aponte o SDK para o emulador (`connectFirestoreEmulator(db, '127.0.0.1', 8080)` num build local; não versionar).
3. Faça login, salve preferências, recarregue e exclua a conta.

## Publicar (só o dono)

Depois dos passos acima:

```bash
cd firebase
firebase login
firebase deploy --only firestore:rules --project tcg-price-hunter
```

Ou cole o conteúdo de `firebase/firestore.rules` em Console → **Firestore Database** → **Rules** → **Publish**.

Conferir logo depois, no site em produção:

1. Faça login.
2. Salve uma preferência.
3. Recarregue a página e veja que a preferência voltou.
4. Exclua uma conta de teste.

Erros `permission-denied` no console do navegador indicam regra faltando.

## Reverter

Console → **Firestore Database** → **Rules**:

- cole a cópia do passo 1 e clique em **Publish**; ou
- use o histórico de versões da própria tela de regras e restaure a anterior.
