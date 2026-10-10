# Runbook do motor: falhas, sinais e recuperação

Guia para quem opera o motor (robô, ramo `data`, banco, coletores, vigia e site). Primeiro diferencie **onde** está o problema, depois use só verificações de leitura; recuperação que escreve ou dispara algo em produção precisa de autorização explícita (ver `CLAUDE.md`).

Este documento não contém credenciais. Nomes de secrets aparecem só como referência; nunca cole valores em issues, PRs ou logs.

## Mapa do motor

| Peça | Onde | Observação |
|---|---|---|
| Robô | `.github/workflows/hunter.yml` → `npm run hunt` (`src/run.js`) | Gatilho principal: cron-job.org (`workflow_dispatch`); `schedule` do GitHub é reserva e atrasa. Intervalo mínimo entre rodadas: `HUNTER_MIN_GAP_MIN` (padrão 8 min); rodada com menos que isso é pulada. Prazo interno: `HUNTER_BUDGET_MIN` (padrão 7 min); job com `timeout-minutes: 12`. |
| Dados publicados | ramo `data` (commit único, reescrito por `tools/push-data.sh`) | `data/state.json`, `data/meta.json` (`ops`), `data/history.jsonl`. É a fonte do site se o banco falhar. |
| Banco | Postgres (Supabase), passo "Sincronizar com o banco" | `continue-on-error`: falha não derruba o robô nem o site. Sequência: `db-migrate` → `db-grants` → `db-sync` → `db-import-references` → `db-stats` → `db-opportunity`. |
| Agentes | passo "Agentes (fila de revisão)" (`docs/agentes.md`) | Só propõem revisões; sempre sai com 0. |
| Vigia | `watchdog.yml` → `tools/watchdog.mjs` (`docs/vigia.md`) | Avisa por Telegram/ntfy só nas transições. |
| Site/API | Vercel (`api/`, `vercel.json`) | Lê o banco com `API_DATABASE_URL` (usuário só-leitura) e cai para `state.json` sem ela. |
| Executor | `docs/executor.md` | Mudanças de código: worktree, `npm test`, PR, CI. Merge na `main` publica em produção. |

Concorrência: `hunter.yml`, `ml-auth.yml` e `db-validate.yml` compartilham o grupo `hunter` (nunca rodam juntos, sem cancelar o que está em andamento).

## Passo 0: onde está o problema?

Todas as verificações abaixo são de leitura.

1. **O vigia avisou?** O texto da mensagem diz o estado (`parado`, `degradado`) e o motivo. Regras em `docs/vigia.md`.
2. **Idade dos dados publicados** (ramo `data`):
   ```bash
   git fetch --depth 1 origin data
   git show FETCH_HEAD:data/meta.json
   git log -1 --format=%cI FETCH_HEAD
   ```
   Olhe `ops.last` (resultado, `dbSync`, `reader`, lojas) e a data do commit. Não precisa de secret.
3. **Últimas rodadas do robô:**
   ```bash
   gh run list --workflow hunter.yml --limit 10
   gh run view <id> --log-failed
   ```
   `--log-failed` mostra só os passos que falharam. Não copie trechos de log para issues públicas sem revisar (o repositório é público).
4. **Decida pela tabela:**

| Sinal | Provável causa | Seção |
|---|---|---|
| Nenhuma rodada nova em `gh run list`; dados com mais de 45 min | Gatilho (cron-job.org/GitHub) | [Gatilho parado](#gatilho-parado) |
| Rodadas falhando; passo vermelho no job | Local/GitHub executor | [Rodada falha](#rodada-falha) |
| Rodadas `success` mas muitas "Pulando" no passo de intervalo | Intervalo mínimo | [Rodada pulada](#rodada-pulada) |
| `ops.last.dbSync.status` = `atrasado`/`indisponivel` | Banco | [Banco](#banco) |
| `reader.status` = `unavailable`, ou zero notas válidas | Leitor da nota oficial (banco) | [Banco](#banco) |
| Muitas lojas `bloqueadas`/`com erro`/`sem resultado` | Coletores | [Coletores](#coletores) |
| Dados frescos no ramo `data`, mas site antigo ou com erro | Deploy/Vercel | [Site e deploy](#site-e-deploy) |
| Alerta ou vigia mudo | Canais de aviso | [Avisos](#avisos) |

## Rodada falha

**Sinais:** e-mail/Telegram "a rodada falhou" (passo "Avisar falha no Telegram"), vigia `degradado` (2 últimas rodadas concluídas falharam).

**Verificar (leitura):** `gh run view <id> --log-failed`; o passo que falhou diz a fase. `Salvar dados (ramo data)` falhando costuma ser permissão (`contents: write`) ou corrida de push; `Caçar preços` falhando é código ou coletor.

**Recuperar:**
- Falha única, sem causa de código: aguarde a próxima rodada. Uma rodada falha não corrompe `data`, porque o ramo só é reescrito por `push-data.sh` depois da caça.
- Falha repetida por código: abra issue/PR com a correção pelo fluxo do executor (`docs/executor.md`). **Não** edite o ramo `data` na mão.
- Reexecutar o robô (`gh workflow run hunter.yml` ou "Run workflow") publica dados e dispara alertas: é ação de produção, só com autorização.

**Passo "Salvar configuração":** tenta 3 vezes `git pull --rebase -X theirs` na `main`; se esgotar, o passo falha. Isso mexe só em `config/`. Em caso de conflito real, analise as duas versões e preserve as duas intenções; não use `--theirs/--ours` em massa.

## Rodada pulada

**Sinal:** o log do passo "Intervalo entre rodadas" diz "Pulando". É esperado quando o gatilho chama mais de uma vez dentro de `HUNTER_MIN_GAP_MIN`. Só é problema se **todas** as rodadas forem puladas: confira se a data do commit do ramo `data` está avançando. A rodada diária das 09:17 UTC (`17 9 * * *`) ignora o intervalo e também roda `discover` e `copag-check`.

## Gatilho parado

**Sinais:** `gh run list --workflow hunter.yml` sem execuções `workflow_dispatch` recentes; `parado` no vigia (dados com mais de 45 min).

**Verificar:** o painel do cron-job.org (conta do dono) mostra falhas HTTP do job. Causas comuns: token do GitHub expirado ou sem "Actions: read and write", URL/corpo alterados. O `schedule` do GitHub é só reserva e pode atrasar ou pular.

**Recuperar:** o dono da conta renova o token no cron-job.org (configuração em `docs/vigia.md`). Esta etapa é fora do repositório; o repositório nunca guarda esse token.

## Banco

**Sinais:** `dbSync.status` = `atrasado` (banco não recebeu a rodada anterior), `indisponivel` (leitura falhou) ou `desligado` (robô sem `DATABASE_URL`); `reader.status` = `unavailable`; vigia `degradado` com isso nas 2 últimas rodadas; no site, idade do banco acima de 30 min (atrasado até 90, desatualizado acima disso; `api/_lib/freshness.mjs`).

**Efeito:** o site e os dados publicados continuam (o ramo `data` é a fonte de reserva). Alertas saem sem a linha da nota oficial quando o leitor não está disponível.

**Verificar (leitura):**
- Log do passo "Sincronizar com o banco" (`gh run view <id> --log`): mostra em qual etapa parou.
- `ops.last.dbSync` e `ops.last.reader` em `data/meta.json` (passo 0).
- Erros de conexão: `tools/db-diagnose.mjs` descreve o formato da URL sem revelá-la e testa a conexão (é o passo "Conexão e versão do Postgres" do `db-validate.yml`). Ele usa o secret `DATABASE_URL`, então rode-o só com autorização e nunca publique a saída bruta. O workflow `diag.yml` é outra coisa: faz dump de páginas de lojas (coletores), não do banco. Após trocar senha, o pooler do Supabase pode recusar algumas conexões; o script tenta até 5 vezes.

**Recuperar:**
- Causas de configuração (secret `DATABASE_URL` vencido ou errado, projeto Supabase pausado) são resolvidas pelo dono do projeto no Supabase/GitHub Settings. Nunca cole o valor em chat, issue ou commit.
- As etapas de sincronização são idempotentes (`db-migrate` aplica cada migration uma vez; `db-import-references` é idempotente). Depois que a causa for corrigida, a **próxima rodada normal** ressincroniza sozinha. Não é necessário reaplicar nada na mão.
- Validação completa (`db-validate.yml`, "Banco: validar Marketplace Core") roda migrations e sincronizações no banco de produção e publica um relatório de contagens no ramo `db-validation`. **É ação de produção:** só com autorização.
- `tools/db-sync.mjs`, `db-stats.mjs`, `db-opportunity.mjs`, `db-migrate.mjs`, `db-grants.mjs` e `db-import-references.mjs` **escrevem** no banco. Nunca aponte para produção sem autorização; para testar, use um Postgres descartável (`TEST_DATABASE_URL`, como no `ci.yml`).
- Migrations só vão adiante: não há rollback automático. Mudança de esquema passa por PR e CI.

## Coletores

**Sinais:** em `ops.last.stores`: lojas `bloqueadas`, `com erro`, `sem resultado` ou `adiadas`. Resultado `parcial` significa que o prazo (`HUNTER_BUDGET_MIN`) adiou lojas: elas entram na rodada seguinte, não são perdidas.

**Verificar (leitura):**
- `ops.last` e `data/state.json` no ramo `data`.
- Log do passo "Caçar preços".
- Mercado Livre exige token OAuth; sem ele a busca fica sem integração. Passo "Renovar acesso ao Mercado Livre" falhar não derruba a caça (`ml-token.mjs refresh` sai com 0 na rodada normal).
- Loja nova sem domínio, plataforma própria ou que bloqueia robôs: ver "Limites reais" no `README.md`. O agente respeita `robots.txt` e **não contorna bloqueio**.

**Recuperar:**
- Bloqueio, mudança de HTML ou de plataforma: correção de adaptador ou de `config/stores.json` por PR, com teste (`test/collectors-tests.js`, `test/ml-tests.js`). Nunca desative ou enfraqueça teste para passar.
- Uma loja que falha não deve derrubar as demais; se derrubar, é bug a corrigir.
- Frete VTEX e catálogo do Mercado Livre: falha da simulação/busca preserva o último valor, com data e motivo, em vez de virar queda de preço. Se o valor parecer velho, cheque a data registrada antes de concluir que a loja mudou.
- Token do Mercado Livre inválido (o refresh é de uso único): o dono autoriza de novo pelo workflow "Mercado Livre: autorizar" (`ml-auth.yml`), colando o código `TG-…` que aparece na página `/ml/callback`. O código é mascarado no log. Isso escreve (criptografado) no ramo `data`; só com o dono envolvido.

## Site e deploy

**Sinais:** `data/state.json` fresco no ramo `data`, mas o site mostra dados velhos, página 5xx, ou rotas `/api` falhando.

**Verificar (leitura):**
- Painel da Vercel (deployments e logs da função), pelo dono.
- `test/deploy-safety-tests.js` (parte do `npm test`) garante que todo import da função em `api/` existe e não está no `.vercelignore`. Falha de "módulo não encontrado" em produção quase sempre é isso: um arquivo de `src/`, `tools/` ou `db/` importado por `api/` mas excluído do bundle.
- Sem `API_DATABASE_URL`, a API usa `state.json`; com banco indisponível, o limite de consulta é 5 s (`api/_lib/db.mjs`).

**Recuperar:**
- Merge na `main` publica em produção e exige aprovação explícita do usuário, válida só para aquele PR (`docs/executor.md`).
- Deploy ruim: **corrija com um novo PR** (reverter o commit com `git revert` num branch de tarefa é uma opção). Não use `git push --force` nem `git reset --hard` na `main`.
- Rollback pelo painel da Vercel é decisão do dono. O executor nunca faz deploy nem altera o ambiente de produção.

## Avisos

**Sinais:** vigia sem mensagem mesmo com problema, ou mensagens repetidas.

**Verificar:**
- Actions → "Vigia do robô": o resumo mostra estado e idade dos dados. Rode manualmente com `teste = true` (não avalia e não muda o livro) para conferir Telegram e ntfy. Isso envia uma mensagem real, então avise o dono.
- O livro (`wd/ledger.json`) fica no cache do Actions e só avança se pelo menos um canal entregou. Se todos falharem, o aviso é tentado de novo.
- Estado `desconhecido` nunca avisa (sem dados legíveis ou sem `ops` ainda).
- Localmente, sem enviar nada: `node tools/watchdog.mjs --state … --meta … --runs … --ledger … --dry-run`.

**Recuperar:** secrets de canal (`TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID`, `NTFY_TOPIC`) são trocados pelo dono em Settings → Secrets. Não leia nem copie esses valores.

## Fila de revisão

`node tools/review.mjs list | triage | export` lê/gera a fila de revisão humana (`docs/agentes.md`). Ela usa `DATABASE_URL`: contra produção, só com autorização, e decisões (`approve`, `reject`, `dismiss`) exigem operador autorizado (`REVIEW_OPERATORS`). Job de agente `failed`/`blocked` gera aviso pelo vigia; `ai_disabled` é esperado quando `AI_AGENTS_ENABLED` não está ligado.

## O que nunca fazer

- Commitar, imprimir ou colar secrets, URLs de banco ou tokens.
- Editar ou reescrever o ramo `data` à mão; ele é gerado pelo robô.
- `git push --force`, `git reset --hard`, `git clean` ou `checkout --theirs/--ours` em massa na `main` ou em trabalho alheio.
- Rodar escritas no banco de produção, reexecutar workflows de produção ou fazer deploy sem autorização explícita para aquela ação.
- Contornar bloqueio de loja ou ignorar `robots.txt`.
- Pular, desativar ou enfraquecer testes.

## Ao terminar uma recuperação

1. Confirme em `data/meta.json` (`ops.last`): `health = saudavel`, `dbSync.status = ok`, `reader.status = ok` com N > 0.
2. Aguarde o aviso de recuperação do vigia (2 checagens saudáveis seguidas).
3. Registre a causa e a correção no PR ou issue, sem logs brutos nem segredos.
