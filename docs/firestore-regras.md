# Regras do Firestore

**Publicadas no console em 11/10/2026.** `firebase/firestore.rules` é a cópia versionada e precisa ficar igual ao console. As regras estão em `firebase/firestore.rules`, junto com `firebase/firebase.json`. A pasta fica de propósito **fora da raiz**: nada é publicado automaticamente, nenhum workflow publica regras e o `firebase/` está no `.vercelignore`.

## O que o site usa

Só o documento `users/{uid}`, em `tools/account.src.js` (página da conta):

| Operação | Quando |
|---|---|
| `getDoc(users/{uid})` | carregar as preferências |
| `setDoc(users/{uid}, ..., { merge: true })` | salvar as preferências |
| `deleteDoc(users/{uid})` | excluir a conta |

O `uid` é sempre o do próprio usuário logado (`auth.currentUser.uid`).

Campos de alertas no Telegram (`docs/alertas-telegram-usuario.md`): a página grava `telegramPedido` (`{ hash, criadoEm }`, hash SHA-256 em hex e `criadoEm` a até 2 min da hora do servidor) e pode gravar `telegram: null` (desligar). O conteúdo de `telegram` (chat ligado e registro de envios) só é gravado pelo robô, com conta de serviço; a conta não consegue escrever um chat_id. Casos no emulador: grupo `telegram` de `firebase/test/casos.mjs`. `test/workflow-security-tests.js` falha se o site passar a usar outra coleção sem as regras mudarem junto.

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

## Checklist de divergência (console × repositório)

Use sempre que alguém mexer nas regras pelo console ou antes de publicar. Sem rede: a conferência é manual.

1. Console → **Firestore Database** → **Rules** → copie o texto inteiro para `regras-console-AAAA-MM-DD.rules`.
2. Compare com a versão do repositório:
   ```bash
   diff -u regras-console-AAAA-MM-DD.rules firebase/firestore.rules
   ```
3. Sem saída = iguais. Qualquer diferença: decida se o repositório ou o console está certo e alinhe os dois (o repositório é a fonte; publicar substitui o console por inteiro).
4. Atualize a data abaixo.

**Última conferência console × repositório:** AAAA-MM-DD (preencher; nenhuma conferência registrada por este checklist ainda)

## Teste automático no emulador (CI)

`.github/workflows/firestore-regras.yml` roda em PR/push que altere `firebase/**` (ou o próprio teste) e por `workflow_dispatch`: instala Java 21, `firebase-tools`, `@firebase/rules-unit-testing` e `firebase` em versões fixas num diretório temporário (`--no-save`, nada no `package.json`), sobe só o emulador do Firestore no projeto `demo-tcgph` e roda `firebase/test/regras-emulador.mjs` com os casos de `firebase/test/casos.mjs` (dono lê/grava/apaga `users/{uid}`; outro usuário e anônimo negados; campos fora da lista e limites de 200 favoritos/50 alertas; subcoleções e outras coleções negadas). O resumo sai como anotação `::notice::` do job. Sem secrets, só leitura, não publica nada. `test/firestore-regras-emulador-tests.js` (no `npm test`, sem Java) confere o workflow e a cobertura dos casos.

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
