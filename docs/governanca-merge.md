# Governança de merge na `main` — proposta (NÃO aplicada)

Estado: **proposta**, 25/10/2026. Nada aqui foi aplicado: nenhuma proteção, ruleset, workflow, secret ou código da
Bridge mudou. Cada item abaixo exige decisão do dono. Complementa `docs/protecao-main.md` (ruleset de deleção/force
push) e `docs/release-governor.md` (política R0–R3).

## 1. Estado lido (25/10, 09h40 UTC, via `gh api`)

| Item | Valor | Consequência |
|---|---|---|
| Dono do repo | conta pessoal (`owner.type=User`), público | **merge queue não disponível** (só repo de organização) |
| `required_status_checks` | `strict=true`; `test`, `regression`, `golden`, `qa-review` (app 15368) | bom, mas ver a linha de baixo |
| `enforce_admins` | **false** | admin ignora checks e `strict`: integra com check rodando ou com a branch atrás da main. Causa dos merges #870, #903, #904, #905 sem checks concluídos |
| Aprovações exigidas | **0** | nenhum humano precisa olhar antes do merge, nem em caminho crítico |
| Rulesets | 0 | — |
| CI em push na `main` | não existe (`ci.yml`/`revisor.yml` só `pull_request`) | a árvore integrada nunca é revalidada |
| Lock de merge na Release Executor Bridge | chave `(ação, repo, PR, sha)` (`src/agents/release-executor-bridge.js`, `idempotencyKey`) | duas PRs diferentes podem integrar ao mesmo tempo |

## 2. O que a ferramenta `tools/pode-integrar.mjs` cobre e o que não cobre

Cobre (só leitura, fail-closed): PR aberta/não draft/base main; head inalterado entre leituras; os 4 checks no head
atual (rodada mais recente, `filter=all`, app certo); branch não atrás da main; `mergeable_state` clean; main
inalterada durante a leitura; caminhos críticos; marcadores ("bloqueado até", "não fazer merge", labels); dependências
declaradas ("depende de #N"). Estados: PODE (0), NÃO PODE (1), EVIDÊNCIA INSUFICIENTE (3), REVISÃO HUMANA
NECESSÁRIA (4); 2 = uso inválido. Não imprime comando de merge, exceto com `--mostrar-comando`, no estado PODE, com
`sha=` fixado e o aviso de que não é autorização.

Não cobre — por isso as propostas abaixo continuam necessárias:
- **Instante**: o resultado vale só no momento da leitura. Outra PR integrada um segundo depois muda a main.
- **Dependência funcional não declarada**: duas PRs verdes isoladamente podem quebrar juntas (ex.: mesma função,
  contratos diferentes). Só CI na árvore integrada (fila ou push na main) pega isso.
- **Admin**: com `enforce_admins=false` o GitHub aceita o merge mesmo quando a ferramenta diz NÃO PODE.
- **Autorização**: PODE é um fato técnico, não uma permissão. Um agente não pode tratar a saída como autorização.
- **Exclusividade**: a ferramenta só lê; não trava nada. Duas sessões (inclusive na mesma conta) podem obter PODE ao
  mesmo tempo para PRs diferentes e integrar em sequência sem que a segunda seja reavaliada contra a main nova. Só o lock
  global (3.5) ou a fila de merge resolvem isso. **Continua sem solução em uso**: a seção 7 compara as alternativas e
  `tools/merge-lock.mjs` é só uma implementação proposta, desligada (`EM_USO = false`), que ninguém chama.

## 3. Propostas (ordem de prioridade)

### 3.1 Ligar `enforce_admins` — 1 toggle, dono
Settings → Branches → regra `main` → "Do not allow bypassing the above settings", ou
`gh api -X POST repos/TonyWatanabe-dev/pokemon-price-hunter/branches/main/protection/enforce_admins` (pelo dono).
- Efeito: nem o dono integra com check pendente/falho ou com branch atrás (`strict`). "Update branch" seguido de merge
  imediato passa a ser recusado até a nova rodada concluir.
- Robô: nenhum efeito (o `GITHUB_TOKEN` não é admin). Ver `docs/protecao-main.md` sobre o push de `config/`.
- Rollback: `gh api -X DELETE .../protection/enforce_admins`. Emergência: o dono desliga, integra, religa e registra
  no roadmap.

### 3.2 Ruleset sem bypass (só `main`)
Ruleset "main-governanca", alvo `refs/heads/main`, **bypass list vazia**:
- Restrict deletions; Block force pushes.
- Require a pull request: **≥1 aprovação** com "Require review from Code Owners" (ver 3.3); "Dismiss stale approvals
  when new commits are pushed"; "Require approval of the most recent reviewable push".
- Require status checks: `test`, `regression`, `golden`, `qa-review` (app GitHub Actions, id 15368),
  "Require branches to be up to date".
- Não ligar "Require linear history" sem rever `docs/protecao-main.md`.

Atenção: num repo pessoal com um único humano, o autor não aprova a própria PR. Como as PRs são abertas por agentes
com a conta do dono, a aprovação do dono só é possível se os agentes passarem a usar outra identidade (GitHub App ou
conta de máquina, 3.6). Até lá, a regra de aprovação deve ficar restrita a caminhos críticos via CODEOWNERS — e mesmo
assim exige identidade separada para não travar.

### 3.3 Aprovação humana obrigatória para caminhos críticos (CODEOWNERS)
Arquivo proposto `.github/CODEOWNERS` (o próprio CODEOWNERS é caminho crítico):
```
# Revisão humana obrigatória (com "Require review from Code Owners" ligado no ruleset)
/src/run.js                 @TonyWatanabe-dev
/src/adapters/              @TonyWatanabe-dev
/src/match.js               @TonyWatanabe-dev
/src/discovery/             @TonyWatanabe-dev
/src/ops-incident.js        @TonyWatanabe-dev
/src/agents/release-*       @TonyWatanabe-dev
/.github/                   @TonyWatanabe-dev
/vercel.json                @TonyWatanabe-dev
/config/                    @TonyWatanabe-dev
/firebase/                  @TonyWatanabe-dev
/account.js                 @TonyWatanabe-dev
/tools/account.src.js       @TonyWatanabe-dev
/api/                       @TonyWatanabe-dev
/tools/pode-integrar.mjs    @TonyWatanabe-dev
/tools/merge-lock.mjs       @TonyWatanabe-dev
/tools/burnin.mjs           @TonyWatanabe-dev
/package.json               @TonyWatanabe-dev
/test/run-all.mjs           @TonyWatanabe-dev
```
Também casar Vigia/watchdog/dispatcher pelos nomes reais dos arquivos (conferir com `git ls-files | grep -Ei
'vigia|watchdog|dispatcher|burnin'` antes de criar). A lista é a mesma de `CAMINHOS_CRITICOS` em
`tools/pode-integrar.mjs`; manter as duas em sincronia (a ferramenta dá REVISÃO HUMANA mesmo sem CODEOWNERS).
Alternativa sem CODEOWNERS: o Release Governor já devolve `human_required` por caminho (`docs/release-governor.md`);
a Bridge continua obedecendo isso.

### 3.4 CI em push na `main`
Diff proposto em `.github/workflows/ci.yml` (não aplicado; R3):
```diff
 on:
   pull_request:
     branches: [main]
+  push:
+    branches: [main]
 concurrency:
-  group: ci-${{ github.event.pull_request.number }}
-  cancel-in-progress: true
+  group: ci-${{ github.event_name == 'pull_request' && github.event.pull_request.number || github.sha }}
+  cancel-in-progress: ${{ github.event_name == 'pull_request' }}
```
Não bloqueia (o commit já entrou), mas valida a árvore realmente integrada e pega a quebra entre duas PRs verdes.
Falha → aviso e revert via PR (seção 4). `tools/burnin.mjs` lê só os runs de `hunter`, `watchdog`, `dispatcher` e
`tarefas`: runs de `ci.yml` em push não entram no burn-in.

### 3.5 Lock global de merge na Release Executor Bridge
Hoje `runMerge` usa `lock(idempotencyKey(action, repo, PR, sha))`: só impede o mesmo PR/sha em paralelo. Proposta:
- envolver o trecho do PUT num lock global `merge:<repo>:main` (o `pgAdvisoryLock` já existente serve), mantendo a
  chave de idempotência por PR/sha para a auditoria;
- antes do PUT, reler a main e exigir os mesmos critérios de `tools/pode-integrar.mjs` (`avaliar()` é pura e
  exportada): `filter=all` nos check-runs, `behind_by == 0`, `mergeable_state ∈ {clean, has_hooks}` (hoje
  `conflictFree` aceita `behind`/`blocked`/`unstable`), dependências declaradas integradas;
- depois do merge, segurar o lock até a main nova ser lida, para a próxima PR ser avaliada contra ela.

Sessões fora da Bridge (mesma conta): lock pelo próprio GitHub —
`gh api -X POST repos/R/git/refs -f ref=refs/tags/merge-lock -f sha=<main>` cria ou falha 422 se já existe; quem
criou integra (com `sha=`) e apaga a ref; lock com mais de 30 min só é removido por humano. Regra: nunca
update-branch e merge na mesma ação. Detalhes, comparação e ferramenta proposta: seção 7.

### 3.6 Identidade por executor
Um GitHub App (ou conta de máquina) por executor de merge, token do dono fora das sessões. Benefícios: `merged_by`
identifica o agente; permite que o dono aprove PRs de agentes (3.2/3.3); com `enforce_admins` ligado, nenhuma
identidade contorna a proteção.

## 4. Procedimento de recuperação (merge ruim na `main`)
1. Confirmar: `node tools/merge-audit.mjs --prs <n>` e (se existir) o CI em push na main.
2. Revert via PR: botão "Revert" da PR no GitHub, ou
   `git switch -c revert/pr-<n> origin/main && git revert --no-edit <sha-do-squash> && git push -u origin revert/pr-<n>`
   e abrir PR.
3. A PR de revert passa pelos mesmos checks e por `node tools/pode-integrar.mjs <revert>`. Nada de push direto,
   force-push ou bypass.
4. Se o merge afetou deploy (`vercel.json`, `api/`), rollback na Vercel só com autorização humana explícita.
5. Registrar no roadmap: PR, SHA do merge, SHA do revert, horário UTC, se o burn-in foi afetado.

## 5. Limitações
- **Repo de conta pessoal: sem merge queue.** A fila (que testaria a árvore combinada antes de integrar) exige
  transferir o repo para uma organização: muda URL, exige reconectar a integração Vercel e conferir runner, secrets e
  variáveis. Decisão do dono, **só depois do burn-in**.
- Sem audit log de organização: não dá para saber retroativamente quem integrou com bypass, além de `merged_by`.
- Job pulado conta como satisfeito na proteção (`qa-review` pula em Dependabot/fork/draft); a ferramenta exige
  `success` e é mais rígida que o GitHub.
- Repo com um só humano: aprovação obrigatória só funciona com identidade separada para os agentes (3.6).
- A ferramenta e a Bridge leem o mesmo estado em momentos diferentes; só o lock global (3.5) ou a fila tornam a
  decisão e o merge atômicos.

## 6. Impacto no burn-in
Nenhum: este documento e a ferramenta são só leitura. As propostas 3.1–3.3 e 3.6 são configuração do GitHub e não
mudam o robô. 3.4 gera runs só em `ci.yml` (não contados pelo burn-in). 3.5 muda código da Bridge (R3, testar antes).
Transferência para organização: esperar o fim do burn-in.

## 7. Serializar a integração — comparação das alternativas (25/10, rodada 2)

**Estado: nada disto está em uso.** Hoje duas sessões podem obter PODE ao mesmo tempo e integrar em sequência; a
segunda não é reavaliada contra a main nova (seção 2). Pré-requisito de TODAS as opções: **`enforce_admins` ligado
(3.1)**. Sem ele, qualquer sessão com o token do dono (admin) ignora lock, checks e `strict` — o lock vira convenção
que só segura quem o respeita.

### 7.1 Quadro comparativo

| | (a) Merge queue do GitHub | (b) Lock por ref no GitHub | (c) `pgAdvisoryLock` da Bridge | (d) Workflow único de merge com `concurrency` | (e) Validação com `sha=` + reavaliação após cada merge |
|---|---|---|---|---|---|
| Disponível hoje | **não** (repo de conta pessoal; exige transferir para organização) | sim (API REST `git/refs`) | sim no código (`src/agents/release-executor-bridge.js`, `pgAdvisoryLock`), mas a chave é por PR/sha | não (workflow = R3; só proposta) | sim (parcial: `pode-integrar --sha` + `-f sha=`) |
| Atomicidade | GitHub serializa e testa a árvore combinada | `POST git/refs` cria ou responde 422 (servidor) | `pg_try_advisory_lock` (servidor Postgres) | `concurrency` serializa runs do mesmo grupo | nenhuma: só detecta mudança do head (`sha=`), não da main |
| Testa a árvore combinada | **sim** | não (só serializa; CI em push na main, 3.4, cobre depois) | não | pode, se o workflow rodar a suíte antes do PUT | não |
| Quem fica coberto | todos (é a proteção) | só quem usa a ferramenta (com `enforce_admins`, nada mais integra fora do fluxo de PR, mas o lock em si continua voluntário) | só merges pela Bridge | só merges por esse workflow | quem segue o procedimento |
| Lock órfão | não existe | possível (sessão morre antes de liberar) → expiração 30 min + liberação forçada manual | **não**: lock de sessão do Postgres cai quando a conexão fecha | não (o run termina ou é cancelado) | não há lock |
| Sessão morre no meio | fila continua | lock fica até expirar; humano confere se a PR foi integrada antes de forçar | lock solto na hora; `outcomes` registra `started`/`unknown` e a Bridge confere no GitHub antes de repetir | run falha/cancela; próximo run reavalia | nada a recuperar; próxima sessão relê |
| Main anda durante | impossível fora da fila | só se alguém integrar fora do lock (detectado: `pode-integrar` → REVISÃO HUMANA) | idem, fora da Bridge | idem, fora do workflow | `strict`+`enforce_admins` recusam o PUT se a branch ficou atrás |
| Custo/risco | transferência: URL, integração Vercel, runner, secrets; só depois do burn-in | 2 escritas por aquisição + 1 por liberação; tag dispara evento `push` (ver riscos) | precisa de `DATABASE_URL` na sessão (secret) — sessões fora da Bridge não têm | permissões de escrita num workflow; R3 | zero infraestrutura, mas não serializa |
| Depende do dono | transferir repo + ligar fila + diffs `merge_group` (C4 §4.2) | autorizar uso (`EM_USO`), `enforce_admins`, regra "sem lock, sem merge" | mudar a chave do lock da Bridge (R3, `src/agents`) | aprovar workflow + token de merge | `enforce_admins` |

### 7.2 Leitura

- **(a)** é a única que resolve o problema de fundo (duas PRs verdes que quebram juntas) e não deixa lock órfão. Está
  bloqueada pela conta pessoal. Decisão do dono, depois do burn-in.
- **(e)** já existe em parte e deve continuar em qualquer cenário: `pode-integrar --sha <head>` imediatamente antes,
  `-f sha=<head>` no PUT (o GitHub recusa se o head mudou), e, depois de cada merge, toda PR pendente é reavaliada
  contra a main nova. Sozinha não serializa: entre a leitura e o PUT outra sessão pode integrar; com `enforce_admins`
  ligado o `strict` faz o GitHub recusar o segundo PUT (branch atrás), o que fecha a janela **só se** o toggle estiver
  ligado.
- **(c)** é o melhor lock para a Bridge (sem órfão, já testado), mas só cobre a Bridge e exige o secret do banco.
  Proposta: lock global `merge:<repo>:main` (3.5).
- **(b)** cobre sessões fora da Bridge com a mesma conta e não exige secret. Custo: lock órfão possível (mitigado por
  expiração + liberação manual) e o lock é voluntário.
- **(d)** concentra o merge num lugar só, mas cria um caminho de escrita automatizado novo (R3) — só proposta.

Recomendação (decisão do dono): `enforce_admins` → (e) sempre → (c) na Bridge e (b) para sessões fora dela, com a
regra "sem lock próprio, sem merge" (`pode-integrar --exigir-lock`) → (a) se o repo for para uma organização.

### 7.3 Ferramenta proposta para (b): `tools/merge-lock.mjs` (desligada)

- Comandos `status | adquirir | liberar`. **Nunca faz merge.** Nada no repositório a chama (teste garante); o
  `pode-integrar` importa só as funções de leitura. `adquirir`/`liberar` recusam no modo real (`EM_USO = false`,
  código 5, nenhuma chamada à API). Só rodou contra API simulada (`test/merge-lock-tests.js`); **nenhuma ref de lock
  foi criada no GitHub real.**
- Formato: tag **anotada** `refs/tags/merge-lock`. O objeto tag aponta para o SHA da main na aquisição; a mensagem traz
  JSON `{versao, sessao, pr, sha (head validado), main, adquiridoEm, expiraEm, ttlMin}`. O objeto é criado antes da
  ref, então toda ref de lock nasce com dono legível; objeto órfão (corrida perdida, sessão morta entre os dois POSTs)
  não é referenciado e é inofensivo. Rejeitados: ref leve + metadados em outra ref (duas escritas não atômicas → lock
  sem dono); `refs/heads/merge-lock` (branch novo dispara deploy de preview na Vercel e eventos de push/create).
- Dono = (sessão, PR, SHA). Mesmo dono readquire sem escrever; resposta perdida no POST é resolvida relendo. Ocupado →
  código 1 com dono, idade e expiração. Expiração padrão 30 min (5–120). Lock expirado **não** é tomado
  automaticamente (apagar+criar não é atômico entre sessões); só `liberar --forcar --tag <sha do objeto> --motivo
  "..."`, e só depois de expirar — ou já, se os metadados forem ilegíveis/fora de faixa ou o relógio de quem adquiriu
  estiver adiantado (§8.2). Não-dono não libera.
- `pode-integrar`: lock de outro dono vigente → **NÃO PODE** (fato técnico transitório, como check rodando: a main vai
  andar; esperar resolve). Lock de outro dono expirado ou sem metadados → **REVISÃO HUMANA** (a sessão pode ter morrido
  no meio do merge; alguém precisa conferir se a PR foi integrada antes de forçar). Seu lock expirado → NÃO PODE. Main
  andou desde a aquisição do seu lock → REVISÃO HUMANA (alguém integrou fora do lock). Sem lock → aviso; com
  `--exigir-lock` → NÃO PODE. Lock ilegível (erro de leitura) → EVIDÊNCIA INSUFICIENTE. Dono reconhecido só com
  `--sessao <id>`.
- Riscos conhecidos: (1) o GitHub não tem DELETE condicional: `liberar` relê imediatamente antes de apagar, o que
  estreita a janela mas não a elimina (só importa se um lock expirado for forçado e readquirido nesse intervalo);
  (2) **hipótese não verificada**: criar a tag com token de usuário gera evento `push` de tag, e
  `firestore-regras.yml` escuta `push` só com `paths` (sem `branches`); segundo a documentação do GitHub, filtros de
  caminho não são avaliados em push de tag, então o workflow pode rodar a cada aquisição. Proposta (R3, não aplicada):
  `push: { branches: ['**'], paths: [...] }` nesse workflow antes de pôr o lock em uso; (3) o lock é voluntário: só
  serve combinado com `enforce_admins` e com a regra de exigir lock; (4) relógio: idade e expiração usam o relógio de
  quem lê (UTC); diferença grande entre máquinas antecipa ou atrasa a expiração.

### 7.4 Procedimento proposto (EXIGE autorização do dono para entrar em uso)

Pré-requisitos: `enforce_admins` ligado; dono autoriza por escrito e uma PR revisada muda `EM_USO` para `true`;
mitigação do risco (2) decidida. Até lá, **não usar**.

1. **Adquirir**: `node tools/merge-lock.mjs adquirir --sessao <id> --pr <n> --sha <head>` (código 0). Ocupado (1):
   esperar; não forçar.
2. **Conferir**: `node tools/pode-integrar.mjs <n> --sha <head> --sessao <id> --exigir-lock` → precisa dar PODE (0).
   Qualquer outro estado: liberar (passo 5) e parar.
3. **Merge**, só por quem tem autorização explícita para aquela PR: `gh api -X PUT repos/R/pulls/<n>/merge -f
   sha=<head> -f merge_method=squash`. Nunca update-branch e merge na mesma ação.
4. **Reler a main**: `gh api repos/R/git/ref/heads/main` e `node tools/merge-audit.mjs --prs <n>`; conferir que o SHA
   do squash é a nova main.
5. **Liberar**: `node tools/merge-lock.mjs liberar --sessao <id> --pr <n> --sha <head>`. Toda PR pendente passa a
   ser reavaliada contra a main nova (o PODE anterior não vale mais).

Recuperação:
- **Sessão morreu com o lock**: esperar expirar; humano roda `merge-lock status`, confere `gh api repos/R/pulls/<pr>
  --jq .merged` e a main; registra no roadmap; então `merge-lock liberar --forcar --tag <sha> --motivo "<o que foi
  conferido>"`. Antes de expirar, só o dono do repo apaga a ref manualmente (`gh api -X DELETE
  repos/R/git/refs/tags/merge-lock`), registrando o motivo.
- **Main andou entre adquirir e integrar**: alguém integrou fora do lock. Não integrar; liberar; investigar com
  `merge-audit`; recomeçar do passo 1 depois de a PR ser atualizada e os checks rodarem de novo.
- **Merge feito, liberação falhou**: o lock expira; quem vier depois verá REVISÃO HUMANA e confere que a PR está
  `merged` antes de forçar.

Impacto no burn-in: nenhum (ferramenta e doc; nada em uso; nenhuma ref criada).

## 8. Análise técnica final da trava e escolha (25/10, rodada T5-A)

> **A trava NÃO é enforcement.** Está desligada (`EM_USO = false`) e, mesmo ligada, só vale para quem usa a
> ferramenta. Nada impede merge pela UI, pela API (`PUT pulls/N/merge`), pelo `gh pr merge` ou pela Bridge sem
> passar por ela. Quem garante algo para todos é a proteção da `main` no GitHub.

### 8.1 Estado verificado (só leitura, `gh api`, 25/10)
- Dono do repositório: `owner.type = User` (conta pessoal), público.
- Proteção da `main`: `strict = true`, checks `test, regression, golden, qa-review`, **`enforce_admins = false`**,
  0 aprovações. `refs/tags/merge-lock` → 404 (nenhuma trava existe).

### 8.2 `tools/merge-lock.mjs` — propriedade por propriedade
| propriedade | conclusão | base |
|---|---|---|
| Exclusão mútua | `POST git/refs` só cria se a ref não existe; a decisão é sempre tomada **relendo** a ref, não pelo código de erro. N aquisições simultâneas → exatamente 1 vence. | Docs REST `git/refs`: create lista 201/409/422 (422 = "Validation failed"); get: "If the `:ref` doesn't match an existing ref, a `404` is returned". Atomicidade da criação condicional **não é declarada** na documentação (é a semântica de ref do git; hipótese forte). Teste: `Promise.all` de 12, 5 sementes de intercalação. |
| Duplicada do mesmo dono | todas as cópias recebem OK; uma ref; com concorrentes misturados, ou todas as cópias do dono vencem juntas ou nenhuma. | teste local |
| Falha no meio | morte entre criar o objeto tag e a ref → sem trava (objeto órfão inofensivo); morte depois da ref → **trava órfã**. Resposta perdida no POST ou no DELETE → relê e confirma. Erro não reconhecido → código 3 (fail-closed). | teste local |
| Expiração/TTL | 5–120 min, padrão 30. **Corrigido**: metadados com `expiraEm` incoerente com `ttlMin`, acima do máximo ou anterior à aquisição eram aceitos — uma `expiraEm` adulterada (ex.: 2099) travava para sempre, porque a forçada só vale depois de expirar. Agora é "ilegível". | teste que falhava antes |
| Recuperação de órfã | ninguém toma sozinho; forçada manual com `--tag` exato + `--motivo`, após expirar, ou já se ilegível / relógio suspeito. | teste local (CLI) |
| Liberação só pelo dono | outra sessão, mesma sessão com outra PR, mesma sessão com outro head → recusado sem escrita. Sem DELETE condicional no GitHub (docs: delete sem parâmetro de SHA esperado): relê antes de apagar; janela estreita, não zero. | docs REST + teste |
| Relógio | idade/expiração = relógio de quem lê × UTC gravado por quem adquiriu. **Corrigido**: relógio de quem adquiriu adiantado (aquisição > agora + 5 min) prolongava a trava sem aviso; agora `relogioSuspeito` libera a forçada manual e o `pode-integrar` dá REVISÃO HUMANA. Relógio de quem lê adiantado só antecipa a expiração → REVISÃO HUMANA (nunca toma sozinho). | teste que falhava antes |
| `EM_USO = false` | CLI recusa `adquirir`/`liberar` no modo real com código 5 e **zero chamadas**; `status` só lê. O `pode-integrar` só lê. **Corrigido**: `--exigir-lock` mandava "adquira antes", impossível com a ferramenta desligada; agora diz que a aquisição está desligada. | teste local |

`pode-integrar` (corrigido): lock **próprio** com tag inconsistente (objeto aponta para SHA diferente do gravado)
dava **PODE**; agora REVISÃO HUMANA. Lock próprio com relógio suspeito: REVISÃO HUMANA. Lock de outro dono vigente
continua NÃO PODE; expirado/sem dono legível, REVISÃO HUMANA; falha de leitura, EVIDÊNCIA INSUFICIENTE.

### 8.3 Comparação das quatro abordagens
| | trava por ref (`merge-lock`) | workflow único + `concurrency` | proteções nativas (`strict`, merge queue) | `enforce_admins` |
|---|---|---|---|---|
| É enforcement? | **não** (voluntária) | **não** (só serializa quem passa pelo workflow) | **sim**, para quem não tem bypass | **sim**: retira o bypass de admin |
| Disponível | código pronto, desligado | proposta (workflow = R3) | `strict` já ligado; **merge queue indisponível**: a documentação limita a "any public repository owned by an organization" e privados de organizações no Enterprise Cloud; este repo é de conta pessoal | 1 toggle do dono |
| O que resolve | coordena sessões que usam a ferramenta | serializa runs: por padrão "only one run can be pending… any additional pending runs cancel the previous one"; a documentação cita fila opt-in que executa em ordem | `strict` faz o GitHub recusar merge de branch atrás da main → cada PR integrada foi testada contra a main atual; merge queue testaria a árvore combinada | sem ele, admin (o token das sessões) ignora `strict` e checks |
| Órfão / falha | órfã possível (expiração + forçada) | não (run termina/cancela) | não | não |
| Custo | 2 escritas/aquisição; possível evento `push` de tag (hipótese §7.3) | token de escrita num workflow; caminho de merge automatizado novo | atualizações de branch e CI repetida quando a main anda | admin também passa a esperar checks |

### 8.4 Escolha
**Solução preferida: proteção nativa — `enforce_admins = true` sobre o `strict` que já existe — com `-f sha=<head>`
no PUT e `pode-integrar --sha` imediatamente antes.** Com `strict` valendo para todos, a segunda de duas sessões com
PODE simultâneo é recusada pelo próprio GitHub (a branch ficou atrás), e o `sha=` recusa head trocado. Isso fecha a
corrida para qualquer caminho (UI, API, Bridge, ferramenta), coisa que nenhuma trava faz. A trava por ref fica
**desligada** como cortesia opcional de coordenação (evita CI desperdiçada), nunca como garantia. Workflow com
`concurrency` só se o dono quiser um caminho único de merge (R3). Merge queue só se o repo for para uma organização,
depois do burn-in.

**Exige autorização do dono (nada disto foi feito):**
1. Ligar `enforce_admins` (mudança de proteção).
2. Pôr a trava em uso: PR mudando `EM_USO` para `true` + regra `--exigir-lock` + mitigação do `firestore-regras.yml`
   (workflow, R3).
3. Qualquer workflow de merge com `concurrency` (workflow + token de escrita, R3).
4. Transferir o repositório para organização (merge queue) — depois do burn-in.

Fontes (25/10): docs.github.com — REST `git/refs`; Actions, conceito de `concurrency`; "Merging a pull request with a
merge queue" (disponibilidade). Não lidas nesta rodada (acesso bloqueado ao buscador): "Managing a merge queue" e
"About protected branches" (comportamento de `enforce_admins`/bypass de admin vem da leitura anterior da proteção e do
campo da API, não de releitura da documentação).
