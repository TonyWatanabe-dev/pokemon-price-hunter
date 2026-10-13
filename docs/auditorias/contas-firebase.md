# Auditoria de lacunas: contas, favoritos e regras do Firestore

Escopo: leitura da `main` (`3cd982b`). Complementa `seguranca.md` e `alertas-usuario.md` (este trata do modelo SQL `favorite`/`price_alert`, não do Firestore) sem repeti-los. `account.js` (1 linha, bundle minificado gerado de `tools/account.src.js`) foi só lido. Nada aqui foi executado contra o Firebase real.

## 1. Mapa

| Arquivo | Trecho | Papel |
|---|---|---|
| `tools/account.src.js:10` | `import { getFirestore, doc, getDoc, setDoc, deleteDoc } from 'firebase/firestore/lite'` | único acesso ao Firestore |
| `tools/account.src.js:67-74` | `load()` = `getDoc`; `save(patch)` = `setDoc(..., { merge: true })` + `updatedAt` | leitura/gravação de `users/{uid}` |
| `tools/account.src.js:76-92` | `remove()` e `wipe()`: `deleteDoc` + `deleteUser`, com reautenticação | exclusão da conta |
| `index.html:2560-2575` | `saveField(...)`, `setFav()`: limite 200 favoritos, rollback em erro | favoritos no cliente |
| `firebase/firestore.rules` | `users/{uid}`: `hasOnly([...6 campos])`, `favorites.size() <= 200`, `alerts.size() <= 50`; `/{document=**}` negado | regras versionadas |
| `firebase/firebase.json` | emulador Firestore em `127.0.0.1:8080` | config local |
| `docs/firestore-regras.md`, `docs/firebase-chave.md` | publicação/rollback; restrição da chave | operação |
| `vercel.json:27` | CSP `connect-src` com hosts Google | superfície do cliente |

## 2. O que já está coberto

- Regras: texto das 3 regras `allow`, limites 200/50, negação geral, `firebase/` fora da raiz e do deploy: `test/workflow-security-tests.js` (teste 5, ~linhas 91-120).
- Lista de campos das regras = campos gravados pela página (`base`, `saveField("...")`, `name`, `updatedAt`), e limites da página = regra: mesmo teste.
- Só a coleção `users` usada pelo código: mesmo teste (`doc(db, 'users'...)`, sem `collection(`).
- Chave de API única, só em `account.src.js`/`account.js`, igual nos dois, CSP: `test/firebase-key-tests.js`.
- Comportamento da página: criação de perfil, nome, remover favorito, falha/rede/sessão expirada com rollback, clique repetido, troca de conta sem vazar dados, falha de carga sem sobrescrever: `test/account-page-tests.js` (testes das linhas 45-170).

## 3. Lacunas priorizadas

1. **As regras nunca são executadas.** O teste 5 só faz `match` de texto; docs/firestore-regras.md manda testar "no emulador" manualmente. Uma regra com sintaxe inválida ou semântica errada passa em `npm test`. Evidência: nenhum teste importa `@firebase/rules-unit-testing`; `firebase.json` só configura o emulador.
2. **Sem validação de tipo/tamanho dos valores.** `hasOnly` limita as chaves e `.size()` exige que `favorites`/`alerts` tenham `size()` (lista ou string/map), mas não há `is list`, nem tipo para `name`, `termsAt`, `createdAt`; `name` e os itens de `alerts` não têm limite de tamanho (`firestore.rules`, bloco `create, update`). Dono da conta pode gravar um documento grande (até 1 MiB do Firestore).
3. **`favorites` e `alerts` aceitam qualquer coisa dentro da lista**; o cliente grava ids de produto (`setFav`), mas a regra não valida elementos. Dado inválido quebra a página do próprio usuário (impacto limitado a ele).
4. **Estado publicado vs. versionado depende de pessoa.** `firestore.rules:2` diz "PUBLICADAS no console em 11/10/2026" e nenhum workflow ou teste detecta divergência (docs/firestore-regras.md: "precisa ficar igual ao console").
5. **Regra de exclusão da conta sem teste.** `wipe()` apaga o documento antes de `deleteUser`; `remove()` refaz `deleteDoc` após reautenticar. `test/account-page-tests.js` não cobre `remove`/`wipe` (nenhum teste com esses nomes nas linhas listadas), nem a ordem documento → conta.
6. **Sem e-mail verificado nas regras** (decisão registrada em docs/firestore-regras.md: quebraria a página). Risco aceito, mas sem critério de reavaliação.
7. **Erros de gravação genéricos**: `permission-denied` cai em "Não consegui salvar" (`saveErr`, `index.html:2567`), sem log/telemetria para detectar regra faltando.

## 4. Tarefas pequenas e independentes

| # | Tarefa | Arquivos | Risco | Aceite |
|---|---|---|---|---|
| 1 | Teste de `remove`/`wipe` com SDK simulado: `wipe` chama `deleteDoc` antes de `deleteUser`; `requires-recent-login` reautentica, apaga e remove | `test/account-delete-tests.js` | R0 | `npm test` verde; inverter a ordem no código faz o teste falhar |
| 2 | Teste que valida a sintaxe de `firestore.rules`: chaves/parênteses balanceados, exatamente um `service cloud.firestore`, e `match` sem repetição | `test/firestore-rules-shape-tests.js` | R0 | falha ao remover uma `}` das regras; sem rede nem emulador |
| 3 | Propor (sem publicar) endurecimento das regras: `favorites is list`, `name is string && name.size() <= 80`, `termsAt/createdAt/updatedAt is string`, e atualizar o teste 5 | `firebase/firestore.rules`, `test/workflow-security-tests.js`, `docs/firestore-regras.md` | R2 (dono publica; mudança de regra de produção) | teste confere os novos trechos; docs mantém o passo de comparar com o console |
| 4 | Teste de contrato `saveErr`: `permission-denied` e códigos desconhecidos geram mensagem genérica; auth/rede geram as específicas | `test/account-save-errors-tests.js` | R0 | `npm test` verde; só leitura de `index.html` |
| 5 | Checklist de divergência console × repositório no runbook, com registro de data da última conferência | `docs/firestore-regras.md` | R0 | seção nova com comando `diff` e campo de data; nenhum outro arquivo alterado |

Fora de escopo: `index.html`, `package.json`, workflows, `config/`, `data/`, secrets e produção.
