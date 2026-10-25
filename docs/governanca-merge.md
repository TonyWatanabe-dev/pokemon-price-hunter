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
  global (3.5) ou a fila de merge resolvem isso.

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
update-branch e merge na mesma ação.

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
