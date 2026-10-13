# Plano de entrega Turbo — Pokémon TCG Price Hunter

> **Atualizado em:** 12/10/2026
> **Base consultada:** \`main\` em \`a53d73abb17e88170b7a94930a2d2a161eeb171e\`.  
> **Objetivo:** levar o produto existente até uma operação comercial útil, confiável e sustentável, com coleta, agentes de engenharia e monitoramento trabalhando 24/7, sem depender de alguém distribuindo cada tarefa manualmente.

Este documento é o plano de execução de ponta a ponta. Use \`docs/ROADMAP-OPERACIONAL.md\` para evidências e estado operacional detalhado, \`docs/MAPA-DE-AGENTES.md\` para contratos dos agentes e \`docs/agentes.md\` para governança de merge/deploy.


> **Atualização de execução — 13/10/2026:** o fluxo Vigia → Dispatcher → worker → PR de agente → revisão independente foi documentado como comprovado em runtime no [roadmap operacional](./ROADMAP-OPERACIONAL.md). Isso não comprova sete dias verdes de burn-in nem autoriza ativar agentes de publicação. As PRs #597–#600 de SEO foram integradas; a CI posterior revelou uma regressão no contrato antigo de `robots.txt`, em correção na #601. A #602 adiciona smoke público diário/manual, ainda aguardando CI e primeira execução real. Use os checks, runs e o burn-in atuais como fonte de verdade; não reutilize estados antigos deste plano como evidência atual.

## 1. Resultado final esperado

O projeto só será considerado entregue quando cumprir todos estes critérios:

1. **Descoberta e comparação confiáveis:** usuário encontra Pokémon TCG selado, reconhece exatamente a variante/idioma/quantidade, vê ofertas comparáveis por loja, preço, estoque, data da observação e reputação somente quando houver evidência.
2. **Preço de referência íntegro:** preço sugerido Copag vem de fonte oficial confirmada e vigente. Marketplace ou inferência nunca substituem a fonte oficial; sem referência confiável não há desconto, score ou selo que induza a compra.
3. **Custo total honesto:** preço e frete são apresentados separadamente e totalizados só quando o frete foi cotado para o CEP e método de envio reais. Frete desconhecido continua desconhecido. Métodos não suportados não são simulados.
4. **Fluxo de compra completo:** busca → resultado → detalhe/comparação → abertura do destino certo da loja; experiência mobile, acessível e com estados de carregamento, vazio, erro e dados desatualizados bem explicados.
5. **Retenção controlada pelo usuário:** favoritos/watchlist e notificações com opt-in, preferências, deduplicação, cooldown, cancelamento e evidência do motivo do alerta.
6. **Monetização transparente:** links afiliados Meli/Amazon corretamente configurados e auditáveis; disclosure visível, destino permitido, nenhuma distorção do ranking por comissão.
7. **Operação remota contínua:** coleta, sincronização, agentes de manutenção, testes, fila de PRs, monitoramento e recuperação operam 24/7 com locks, retries, limites, logs seguros e alertas. O sistema tolera falhas de lojas, API, banco e scheduler sem fabricar dados ou derrubar o site.
8. **Entrega de software governada:** mudanças chegam por branches e PRs, passam CI, regressões e casos dourados; release agent registra a decisão, deploy faz smoke test e falha é recuperada quando o rollback é seguro.
9. **Pronto para operação pública:** segurança, privacidade, SEO técnico, acessibilidade, desempenho, backup/restore, runbooks e painel de saúde verificados com evidência real.
10. **Medição de negócio:** dashboard de qualidade operacional e KPIs do produto (frescor, cobertura, falsos positivos, busca sem resultado, clique de oferta, alertas entregues e conversão afiliada quando o provedor disponibilizar dados).

Não é necessário implementar tudo numa única PR. A aceleração vem de dividir o trabalho em fatias independentes, executar em paralelo e integrar pela ordem de dependência.

## 2. Estado real de partida — não confundir capacidade com operação completa

| Componente | Situação verificada | Lacuna para o objetivo 24/7 |
|---|---|---|
| Price Hunter | \`.github/workflows/hunter.yml\` agendado a cada 15 min; intervalo mínimo configurável de 8 min; descoberta e checagem Copag diárias | Verificar séries de execuções e frescor sustentado; scheduler do GitHub é melhor-esforço |
| Vigia operacional | \`watchdog.yml\`, leitura do estado publicado, últimas rodadas e alertas com ledger; fallback GitHub a cada 30 min | Confirmar job externo cron-job.org a cada 15 min, canais de aviso e recuperação contínua |
| Dados/banco | Publica o ramo \`data\`; sincroniza PostgreSQL quando \`DATABASE_URL\` está configurada; integração do banco não pode derrubar a publicação | Provar sync saudável, backup/restore e alarmes com execuções reais |
| Orchestrator / revisão | Fila \`automation_job\`, retries/leases, evidência, governance, fila de revisão de matching e revisão humana já estão documentados no código | Confirmar métricas e execução de handlers em produção; IA de domínio continua futura |
| Executor Claude por issue | Smoke #225 passou, PR #228 criada com sucesso, testes reportados verdes e CI verde | Hoje dispara por issue + label; ainda falta um dispatcher autônomo que retire tarefas de uma fila aprovada sem alguém aplicar cada label |
| Paralelismo | Workflow permite 1–10 sessões; valor padrão no YAML é 3 | Configurar/verificar \`TAREFAS_MAX=10\` nas Actions Variables; a conexão atual não expõe o valor real da variável |
| Release Governor / ponte | Ciclo R0 de merge documental foi provado; PR #221 da ponte de release permanece aberta na última consulta | A #221 exige autorização humana pela política R3; credencial/escope Vercel e deploy + smoke real ainda não comprovados |
| PRs de produto bloqueadas | #195 (frete), #186 (referência Copag) e #20 (migration) continuam abertas/draft na última consulta | Revalidar status/diffs/checks antes de retomar. #186 exige decisão comercial; #20 não integrar sem autorização específica; #195 não ativa frete por si só |
| Agentes futuros | Mapa já diferencia implementado vs. futuro | Ativar cada especialidade só após dados, contratos, métricas e governança cumprirem seus pré-requisitos |

**Conclusão honesta:** a coleta recorrente e o executor de tarefa por issue já existem, mas isso ainda não equivale a uma fábrica de software totalmente autônoma. O próximo salto estrutural é o **Planner + Dispatcher + verificador independente de PRs**, mantendo o Release Governor como gate separado.

## 3. Arquitetura 24/7 alvo

### 3.1 Dois ciclos autônomos, uma única governança

**Ciclo A — operação do produto**
1. Scheduler inicia a rodada (cron externo primário + cron do GitHub como fallback).
2. Hunter coleta por loja com timeout, concorrência limitada, rate limit e backoff.
3. Validadores verificam formato, origem, preço, variante, estoque e frescor; matching ambíguo é rejeitado ou encaminhado a revisão.
4. Dados observados são gravados com timestamps e histórico; publicação do \`data/state.json\` não depende de IA.
5. Banco/opportunity engine sincronizam com transação e heartbeat; falha opcional do banco não inventa estado nem substitui o último dataset válido.
6. Orchestrator executa jobs curtos de revisão; notificações operacionais e watchdog detectam falhas/recuperação.
7. O site mostra o estado realmente observado e deixa claro quando dado está stale, indisponível ou desconhecido.

**Ciclo B — manutenção e evolução do software**
1. Planner lê este plano, o roadmap operacional, as issues abertas e os PRs atuais.
2. Dispatcher escolhe apenas tarefas pré-aprovadas e desbloqueadas, respeita dependências e arquivos em disputa e despacha tarefas de modo idempotente.
3. Até 10 workers Claude Code trabalham em branches isoladas, cada um com uma issue, orçamento e limite de tempo.
4. Testes locais são executados; um QA/Reviewer independente compara diff, escopo, testes, segurança, duplicações e critérios de aceitação.
5. PR abre/atualiza; CI roda suíte completa, regressões e golden tests. Falha é encaminhada ao worker para correção automática limitada; falhas repetidas vão para quarentena.
6. Release Governor avalia o nível de risco e a evidência, registra decisão auditável e só libera as operações permitidas pela política.
7. O deploy bridge publica apenas um commit elegível. Smoke pós-deploy confirma site/API/dados; se falhar, interrompe rollout e faz rollback apenas se for seguro.
8. Watchdog confirma saúde, backlog e recuperação, e fecha o ciclo atualizando métricas e o roadmap.

### 3.2 Como tornar o Dispatcher realmente autônomo

O workflow \`tarefas.yml\` atual é **event-driven por label**, não um planejador contínuo. Construir uma camada separada, por etapas:

- Criar uma fila explícita de **tarefas elegíveis**. Reusar issues já existentes; usar um label de elegibilidade distinto do \`executor:ready\` do executor local. O label representa escopo aprovado, não autorização irrestrita de produção.
- Agendar o Planner/Dispatcher de forma recorrente. Ele lê somente issues criadas por operadores autorizados, confere escopo, dependências, tarefas já em curso, PR duplicada e arquivos conflitantes.
- Acrescentar uma entrada autenticada do dispatcher ao workflow executor (por exemplo, \`workflow_dispatch\` com número da issue validado), em vez de simplesmente relaxar a proteção que hoje exige que o evento venha de um operador.
- Idempotência por issue + tentativa; leases e limite global; nunca iniciar duas tarefas concorrentes que alterem o mesmo subsistema crítico sem dependência explícita.
- O Dispatcher pode decompor tarefas de backlog que já tiveram escopo aprovado; não pode inventar work items para R3 ou decidir mudanças comerciais sensíveis.
- Limitar inicialmente a 3 workers, provar fila/retomada/falha/duplicidade e então aumentar para 10 depois de configurar \`TAREFAS_MAX=10\` e realizar período de observação.
- Falhas recorrentes entram em quarentena, com log sanitizado, comentário/diagnóstico e sem repetir indefinidamente a mesma tarefa.
- O Planner não implementa código nem autoriza release: ele ordena backlog. O worker implementa. O QA revisa. O Governor decide sobre release.

### 3.3 Requisitos reais de 24/7

- **Scheduler redundante:** validar cron-job.org para o Hunter e o Vigia a cada 15 minutos. O schedule interno do GitHub fica como fallback; uma execução agendada do GitHub não deve ser tratada como garantia de horário exato.
- **Sem sobreposição:** locks, concurrency groups, lease, idempotência de upsert, e publicação por snapshot; retries não podem gerar ofertas, eventos ou notificações duplicadas.
- **Tolerância a falhas:** timeout e backoff por loja, circuit breaker em fonte repetidamente indisponível, quarentena por adaptação quebrada e continuidade parcial da rodada.
- **Observabilidade:** última rodada, última rodada saudável, idade dos dados, sucesso por loja, falhas por classe, tempo de execução, estado do banco, heartbeat do Opportunity Engine, fila de agentes, idade das PRs, taxa de CI falha e saúde do deploy.
- **Alertas:** imediatos para transição relevante, lembretes limitados e confirmação de recuperação; sanitizar token, cookie, query string e dados pessoais dos logs.
- **Recuperação:** instruções de rerun, retomada de lease, rollback seguro, backup/restore e procedimento para fonte bloqueada; nunca contornar robots.txt, CAPTCHA ou proteção de loja.
- **Continuidade:** não depender do computador do usuário como único host. O executor local permanece complementar até ter runtime e heartbeat comprovados. Priorizar Actions/infra remota para operação contínua.
- **Carga/custo:** 10 tarefas de Claude consomem cota muito mais rápido. O Dispatcher deve medir duração, tentativas, taxa de falha e consumo quando disponível; o objetivo não é manter 10 sessões ocupadas sem necessidade, e sim esvaziar a fila segura com eficiência.

### 3.4 Esforço adaptativo, roteamento de modelos e orçamento sustentável

O objetivo é maximizar trabalho útil aprovado por unidade de consumo, sem esgotar a capacidade nem reduzir qualidade. **Esforço de raciocínio, modelo escolhido, tokens totais e concorrência são controles diferentes** e devem ser geridos separadamente.

**Antes de cada tarefa:**
- O Planner/Dispatcher determina classe, risco, tamanho aproximado, dependências, arquivos prováveis, histórico de falhas e critérios de aceite usando metadados e regras determinísticas. Não chamar um segundo modelo caro apenas para classificar tarefas simples.
- O executor inspeciona a integração/modelo realmente utilizado e configura o esforço por sessão/tarefa através de parâmetros oficialmente suportados por essa versão. Não assumir que uma variável global altera uma sessão existente, nem registrar um nível como disponível sem validar o modelo/runtime.
- Iniciar no menor nível que seja razoável para o escopo. Como padrão orientativo: **Low** para documentação/formatação/testes mecânicos isolados; **Medium** para correções comuns e funcionalidades delimitadas; **High** para bugs difíceis, integrações e mudanças arquiteturais; **XHigh/Max**, se suportado, só para casos excepcionalmente complexos com justificativa.
- Para segurança, credenciais, permissões, migrations críticas, risco financeiro/dados, ranking/preços em massa e decisões R3, não reduzir esforço abaixo do necessário para análise segura. Nenhum nível de esforço substitui gate humano, revisão independente ou testes.

**Escalada e economia:**
- Escalar o esforço quando houver falhas de raciocínio/teste recorrentes, contexto contraditório, dependências inesperadas ou risco maior que o inicialmente estimado. Se a tarefa continuar falhando, parar retries cegos, registrar evidência e encaminhar para diagnóstico/revisão.
- Desescalar tarefas que se mostrem simples, sem reiniciar trabalho desnecessariamente. Preferir chamadas/tool use mínimas, contexto focado, leitura seletiva de arquivos e logs resumidos; não repetir auditorias/documentos já lidos sem mudança de estado.
- Avaliar roteamento para modelos mais econômicos em tarefas mecânicas/triagem somente quando o executor e as políticas atuais suportarem isso. Usar modelos mais capazes para tarefas complexas ou revisão de risco; o revisor deve ser independente o suficiente para não repetir cegamente conclusões do worker.
- Gerenciar orçamento global e capacidade: concorrência adaptativa, limite por tarefa e ciclo, timeouts, retries limitados, backoff para rate limit/cota, fila persistente, leases/idempotência e checkpoints recuperáveis. Em esgotamento/indisponibilidade, preservar trabalho e fila, reduzir a carga e retomar quando houver capacidade. **Não prometer operação ilimitada nem contornar cota, rate limits ou políticas do provedor.**
- Não aumentar automaticamente a concorrência só porque existem slots: custo, quota, conflito entre arquivos e taxa de falha devem determinar o paralelismo. Fazer aumento gradual e manter tasks que competem pelos mesmos arquivos serializadas.

**Medição e prova:**
- Registrar, quando as interfaces do provedor permitirem, modelo, esforço, tokens de entrada/saída/cache, duração, tentativas, custo calculável, resultado dos testes, motivo de escalada e resultado da PR. Nunca inventar métricas que não estejam disponíveis.
- Medir custo/uso por tarefa concluída e por PR aprovada, taxa de sucesso na primeira tentativa, retrabalho, latência, concorrência máxima e falhas por cota/rate limit. Proteger logs contra secrets e dados pessoais.
- Fazer comparação controlada em tarefas representativas para demonstrar economia sem piorar CI, regressões, golden tests, defeitos reabertos ou taxa de rejeição de PRs. Não comparar somente tokens; comparar trabalho útil aceito e qualidade.
- Antes de ativar roteamento adaptativo em produção, testar configuração, fallback e recuperação em CI/sandbox. Se não existir suporte confiável para ajuste por sessão, documentar a limitação e implementar primeiro os controles que o executor suporta, sem simular adaptatividade.

## 4. Ciclo de vida de cada tarefa

| Etapa | Dono | Entrada | Saída obrigatória |
|---|---|---|---|
| 1. Priorizar | Planner / Product Ops | Plano, issues, bloqueios, impacto, esforço, dependências | Issue pequena, critérios de aceite, risco preliminar |
| 2. Despachar | Dispatcher determinístico | Issue elegível e desbloqueada | Job idempotente, worker e branch isolados |
| 3. Implementar | Claude Code worker / agente especialista | Issue + \`CLAUDE.md\` + plano + contratos | Diff focado, testes e relatório |
| 4. Verificar | QA/PR Reviewer independente | Diff, arquivos, testes, threat model | Aprovação técnica ou pedidos objetivos de correção |
| 5. Validar | CI | Commit/PR | \`npm test\`, regressão, golden e checks exigidos verdes |
| 6. Autorizar release | Release Governor | Evidência e classificação de risco | Decisão auditável: autorizar, bloquear ou escalar |
| 7. Integrar/Publicar | Release Executor Bridge | SHA aprovado + locks + config de ambiente | Merge/deploy idempotente com identificadores |
| 8. Comprovar | Smoke + SRE/Vigia | URL e commit publicados | Verificação pós-release, métricas, rollback ou recuperação |
| 9. Aprender | Planner + roadmap | Resultado final, incidentes e métricas | Próxima tarefa priorizada, sem duplicar trabalho |

Toda tarefa precisa ter: objetivo, fora de escopo, arquivos/área provável, dependências, critérios testáveis, risco, rollback quando aplicável e evidência final. “PR aberta” não equivale a “entregue”; para concluir, requer CI e gates aplicáveis e, após deploy, smoke/saúde.

## 5. Fases até a entrega

As fases avançam por **critérios de saída**, não por calendário artificial. Onde há issues existentes, reutilizá-las e atualizá-las; não abrir clones das mesmas tarefas.

### Fase 0 — fábrica de desenvolvimento e governança 24/7
**Prioridade imediata.**

> **Estado dos critérios de saída em 12/10/2026, 09:45 UTC** (evidências em `docs/ROADMAP-OPERACIONAL.md`, seção "Validação em runtime"):
> - **Tarefa elegível despachada sem label manual:** comprovado (#257 → worker → PR #258).
> - **Despacho não autorizado ignorado:** coberto por testes. Em runtime, o worker recusou fechado uma tentativa inválida.
> - **Reexecução não duplica:** a chave idempotente foi comprovada.
> - **Backoff:** comprovado.
> - **Retomada depois de quarentena:** depende da #256.
> - **Esforço adaptativo:** etapa 1 na `main` (#246); a ligação ao worker está na #248, aberta.
> - **Gate R0–R3 com revisão independente:** o revisor de PRs do worker foi comprovado (#261, PR #258). A exigência de `qa-review` pelo Governor está na #260, aberta.
> - **Fase 0 continua aberta.**

Trabalho:
- Confirmar \`TAREFAS_MAX=10\` nas variáveis do repo e conferir \`TAREFAS_OPERADORES\`; começar/validar com 3 e aumentar depois do teste de concorrência.
- Implementar classificação determinística de tarefas e esforço adaptativo por sessão, roteamento econômico quando suportado, escalada com base em falhas e gestão de orçamento/quota. Medir tokens/custo apenas quando houver telemetria real.
- Adicionar retries limitados, backoff, fila persistente, checkpoints e retomada; diante de rate limit ou quota esgotada, preservar progresso e reduzir a carga em vez de repetir tentativas caras.
- Confirmar cron-job.org ativo para Hunter e Vigia, verificar os últimos runs \`workflow_dispatch\` e provar uma notificação de teste nos canais operacionais configurados.
- Implementar Planner + Dispatcher com fila aprovada, dependências, idempotência, limite de concorrência, quarentena e logs sanitizados.
- Implementar QA/PR Reviewer independente, sem permissão de merge/deploy, com inspeção de diff, testes, risco, arquivos críticos e critérios da issue.
- Revalidar a Release Executor Bridge (#221), política de Release Governor e acesso Vercel no ambiente correto; nunca enviar tokens pelo chat nem registrá-los em arquivos.
- Configurar o monitor de decisão do ChatGPT (automation existente) para examinar o roadmap completo, PRs, CI, saúde da operação e somente notificar quando houver decisão/bloqueio acionável ou marco relevante.

Critérios de saída:
- Uma tarefa elegível é selecionada sem alguém aplicar manualmente seu label individual; dispatcher não começa tarefa não autorizada.
- Reexecuções não geram duas branches/PRs para a mesma tarefa.
- Simulação/teste com jobs concorrentes prova limite, fila, retry, cancelamento e retomada após falha.
- Diferentes classes de tarefa recebem configurações de esforço coerentes; escalada/desescalada e orçamento são demonstrados por testes ou telemetria real.
- Há métricas auditáveis de consumo disponíveis (ou uma limitação documentada) e o fallback por quota/rate limit preserva a fila sem tentativas ilimitadas.
- Testes comparativos mostram que a economia não enfraquece CI, golden tests, revisão ou critérios de segurança.
- Há evidência de scheduler primário e fallback, watchdog, alerta e recuperação.
- Gate R0/R1/R2/R3 documentado e testado; a permissão do worker de tarefas continua sem merge/deploy.

### Fase 1 — integridade dos dados e do catálogo
**Prioridade de produto mais alta; IA só propõe quando dados determinísticos já são confiáveis.**

Trabalho (reusar issues existentes):
- Contrato comum dos coletores e fixtures para sucesso, vazio legítimo, timeout, 429, 5xx, bloqueio, parse quebrado e payload gigante (issues #47, #103, #106, #93).
- Matching de produto selado: coleção, tipo, boosters, idioma, EAN/SKU, variante e loja; falsos positivos vão a revisão. Não casar kits/acessórios ou idiomas diferentes (issues #42, #109, #110).
- Normalizar preço/moeda com centavos inteiros ou decimal seguro; validação de zero, negativo, NaN e formato brasileiro (issue #79).
- Proveniência por oferta: URL, fonte, observado em, last seen, confiança, estoque e preço. Separar indisponível, vazio, desconhecido e stale; impedir respostas atrasadas de sobrescrever as novas (issues #104, #46, #112, #113).
- Deduplicação/canonicalização de URL e oferta mantendo parâmetros que identificam produto/variante (issue #78).
- Referência Copag oficial, validade, histórico e confiança; nunca substituir oficial por marketplace (issue #41 e docs de referência).
- Reputação da loja só com evidência e metadados explícitos; corrigir domínio pendente ou deixar integração desativada.
- Data Quality/Catalog Agent em modo proposta: encontra duplicatas/campos incompletos, mostra evidência e abre review item; não altera catálogo/pricing diretamente.

Critérios de saída:
- Golden tests cobrem falsos positivos e variantes relevantes; nenhuma regressão conhecida na suíte.
- Uma oferta inválida/stale não recebe selo, desconto, score ou alerta como se fosse atual.
- Erros de uma loja não encerram a rodada das demais.
- Revisões deduplicadas, auditáveis e rejeitáveis.

### Fase 2 — fluxo principal do site e confiança
Trabalho:
- Validar o caminho busca → lista → detalhe → comparação → clique para loja (issue #43).
- Garantir paginação/ordenação estável, busca sem acento e filtros que não descartem variantes (issue #111 e issues de busca existentes).
- Corrigir estados loading/vazio/erro, dados parciais e retry seguro, sem submissão duplicada (issue #83).
- Melhorar acessibilidade dinâmica, teclado, foco, contraste, labels e leitor de tela (issues #82 e #98).
- Exibir timestamp e estado do dado; explicar preço, referência Copag, estoque e taxa de entrega; link de loja seguro (issues #55, #100, #115, #116).
- Garantir navegação mobile e performance em rede lenta, sem cache que apresente preço vencido como novo.
- Adicionar testes E2E de fluxos públicos principais, conta, API e erro/recovery.

Critérios de saída:
- Caminhos de compra funcionam em desktop/mobile com loading/vazio/erro cobertos.
- Cada oferta permite saber loja, URL correta, preço observado e idade/estado do dado.
- Auditoria a11y não deixa problemas críticos abertos; links externos não permitem SSRF/open redirect.

### Fase 3 — frete e custo total de compra
Trabalho:
- Resolver a PR #195 (issue #84) em branch atualizada: conflito/diff, CI e validação de segurança; manter \`SHIPPING_CALC_ENABLED\` desligada até teste real.
- Primeira entrega fica restrita à cotação VTEX suportada pela implementação; verificar CEP, seller, SKU/variante, carrinho e contrato de resposta.
- Em etapas separadas, integrar métodos que cada loja de fato oferece e para os quais exista API/contrato verificável. Não assumir que frete VTEX serve para Shopify ou loja própria.
- Modelo de cotação: transportadora/método, prazo, custo, moeda, CEP de origem/destino quando aplicável, momento da consulta, validade, erro e fonte.
- Comparar custo total apenas entre cotações compatíveis; se não houver método/cotação disponível, mostrar “não calculado” e permitir abrir a loja.
- Criar testes de contrato, timeouts, falhas, cache por CEP/SKU/loja com TTL correto, rate limit e invalidação.

Critérios de saída:
- Cotações reais reproduzíveis para as lojas/métodos anunciados.
- Nenhum frete ausente é tratado como zero; nem resultado sintético aparece como real.
- Flag só é habilitada depois de smoke real, rollout controlado e autorização prevista na governança.

### Fase 4 — contas, favoritos, watchlist e alertas
Trabalho:
- Manter navegação pública sem exigir login; autenticação só para salvar/gerenciar dados do usuário (issue #49).
- Testar isolamento entre contas e regras Firebase/Firestore; usuário A não pode ler/modificar dados do usuário B (issue #86).
- Garantir favoritos/watchlist com CRUD, estados consistentes, recuperação e limites.
- Melhorar alerta de queda/restock para exigir mudança real, referência vigente, oferta atual e base de frete comparável (issue #45).
- Preferências e notificações idempotentes com opt-in/out, canal, cooldown, deduplicação e tratamento de entrega/retry (issue #85).
- Alert Agent em modo proposta inicialmente; envio continua determinístico e só respeita preferências/políticas explícitas.

Critérios de saída:
- Testes demonstram isolamento por usuário, opt-in/out, cooldown, retry sem duplicação e “queda” não dispara por falha de coleta.
- Cada alerta explica produto, loja, mudança, timestamp e motivo de comparabilidade.

### Fase 5 — Opportunity Engine e inteligência de mercado
Trabalho:
- Validar score e ranking explicáveis e determinísticos; separar preço nominal, preço parcelado/Pix, frete, confiança de matching e frescor (issue #44).
- Melhorar cobertura/qualidade do histórico e explicação de referência oficial (issue #46).
- Price Intelligence Agent sumariza variações observadas e aponta anomalias para revisão, sem ser autoridade de preço/score/ranking.
- Resolver decisão de produto da PR #186 sobre 11 referências Copag vindas do Instagram somente com decisão humana explícita.
- PR #20 permanece **não integrar** enquanto sua migration/impacto de produção não tiver autorização específica, diff revisado e plano de rollback.
- Reconciliar banco e arquivos publicados; fazer verificações de integridade read-only e preparar correções auditáveis para órfãos/duplicatas (issue #113).

Critérios de saída:
- Score reproduzível para a mesma entrada e explicável por campos.
- Fonte não oficial não aparece como Copag confirmada.
- Migrations e mudanças em lote não são executadas por um agente sem os gates obrigatórios.

### Fase 6 — cobertura de lojas, afiliados e monetização
Trabalho:
- Melhorar catálogo de lojas e URLs conhecidas; lojas sem domínio confiável ou que bloqueiam robôs continuam explicitamente pendentes/desativadas.
- Auditar links Meli/Amazon, allowlist, preservação de destino, parâmetros de tracking, divulgação de afiliado e comportamento em falha.
- Affiliate Agent valida links, disclosure, redirecionamento e cobertura de campanhas em PRs/propostas.
- Só adicionar cupom/cashback quando houver fonte verificável, termos, validade e atribuição clara. Não prometer API que a loja não disponibiliza.
- Não favorecer oferta afiliada por comissão; o ranking representa valor para o usuário e os interesses comerciais são divulgados.

Critérios de saída:
- Link abre o destino correto e os parâmetros aprovados são auditáveis.
- Disclosure aparece no lugar apropriado, sem ocultar publicidade.
- Relatórios de receita/conversão dependem de dados legítimos dos provedores; métricas inexistentes não são inventadas.

### Fase 7 — ativação progressiva de agentes especialistas
Ativar em ordem de dependência, não todos de uma vez:

1. **Planner / Backlog Steward (novo):** transforma metas do plano em fatias pequenas, associa issues existentes, detecta dependências e ordena por valor × risco × bloqueios. Não codifica, não aprova release.
2. **Dispatcher (novo, principalmente determinístico):** despacha somente issues pré-aprovadas; controla idempotência, worker, slot, rate limit, concorrência, fila, quarentena e reentrada.
3. **QA / PR Reviewer (novo):** lê diff e requisitos independentemente do implementador; confere testes, segurança, migrações, acessibilidade e risco. Pode bloquear/comentar; não pode alterar o próprio gate nem fazer merge.
4. **Release Governor + Release Executor Bridge (em evolução):** classifica R0–R3, verifica checks e SHA, registra autorização e aciona merge/deploy apenas com permissões e credenciais próprias, smoke e rollback compatíveis.
5. **SRE / Operations Agent (evolução do Vigia existente):** detecta scheduler parado, atraso, banco sem sync, falhas por loja, fila travada e deploy degradado; executa apenas recuperação read-only/idempotente permitida, abre issue com diagnóstico e avisa pelos canais definidos.
6. **Catalog Agent:** propõe normalização/duplicatas, evidência estruturada e revisão; pré-requisito: matching e golden tests estáveis.
7. **Marketplace Health Agent:** agrupa falhas por loja/plataforma, frescor e cobertura; propõe ajustes sem contornar bloqueios/robots; pré-requisito: contratos e rate limits estáveis.
8. **Price Intelligence Agent:** explica mudanças históricas e oportunidades com incerteza; não define preço oficial nem escreve score; pré-requisito: histórico e comparabilidade confiáveis.
9. **Shipping Verification Agent (novo, se necessário):** valida qualidade das cotações, método compatível, CEP, validade, timeout e comparação do total; não inventa cotações.
10. **Alert Agent:** valida elegibilidade, opt-in, dedupe e motivo; o emissor determinístico mantém o envio final.
11. **Affiliate Agent:** audita links e disclosures, reporta tracking e erros; não muda ranking por comissão.
12. **UX Research Agent:** analisa feedback autorizado e métricas de tarefas, separa observação de hipótese e entrega pesquisa/prioridades.
13. **UI & Design System Agent:** mantém tokens/componentes, consistência, acessibilidade, responsividade e testes visuais; entrega diffs/PRs.
14. **SEO & Content Agent:** auditoria técnica, metadados, canonical, sitemap, conteúdo útil e freshness das páginas; não cria reviews/dados fictícios.
15. **Social Media Agent:** prepara calendário e rascunhos, links e disclosure; publicação externa continua controlada por política e autorização.
16. **Growth & CRO Agent:** propõe experimentos com hipótese, métrica primária, guardrails, amostra e janela; não declara causalidade sem evidência.
17. **Brand & Creative Agent:** guarda voz/identidade, produz briefs e criativos como propostas; checa direitos e claims.

Os agentes 12–17 já constam como futuros em \`docs/MAPA-DE-AGENTES.md\` e **não devem iniciar agora**. Entram somente após produto lançado, analytics confiável/consentido, volume suficiente, guide de marca/direitos, e pré-requisitos específicos. Não construir agentes apenas para aumentar quantidade: cada um precisa reduzir defeitos, tempo de ciclo ou custo com métrica comprovada.

### Fase 8 — hardening e lançamento estável
Trabalho:
- Segurança de dependências e workflows, SSRF, XSS, validação de entradas, proteção de logs e retenção mínima (issues #94, #105, #117).
- API com limites, timeout, paginação, erros seguros e performance/caches medidos (issues #80, #81, #114).
- Modelo/migrations com verificação de compatibilidade, backup/restore testado e runbook de rollback/forward-fix (issues #87, #108, #118).
- Painel interno read-only de operação: estado do robô, última/última saudável, idade por loja, erros, sync banco, engine heartbeat, fila, PRs antigas, CI e deploy (issue #92).
- SEO técnico e indexação correta sem indexar produto vazio/stale (issue #96).
- E2E, acessibilidade, performance, smoke público e teste de recuperação sob falha.
- Definir fonte canônica de produção: GitHub Pages e Vercel aparecem no repositório/histórico; documentar qual ambiente/URL é canônico para cada superfície, e testar o pipeline certo antes de automatizar mais deploys.

Critérios de saída:
- Todos os checks CI/regression/golden aprovados; zero vulnerabilidade crítica sem mitigação.
- Backup restaurado num ambiente de teste; runbook seguido por outro worker sem improviso.
- Smoke pós-deploy confirma busca, detalhe, API/dados, conta/alerta quando aplicável e links.
- Rodada de estabilidade 24/7 por pelo menos 7 dias: scheduler primário/fallback, coleta, freshness, sync, alertas, fila do dispatcher, PR/CI e recuperação observados; incidentes críticos resolvidos e registrados.
- Não há deploy automático baseado só no fato de que o merge ocorreu.

### Fase 9 — manutenção contínua pós-lançamento
- Monitorar freshness e cobertura, novos produtos/coleções, qualidade de matching, API/lojas, custos e saúde de conta.
- Planner mantém backlog ordenado por impacto e risco e separa bugs de novas funcionalidades.
- Agentes especialistas seguem métricas de precisão, abstenção, retrabalho, custo e latência; especialidade com qualidade insuficiente é desativada sem afetar o núcleo determinístico.
- Executar atualização/segurança, backups, smoke e revisão da fila em ciclo recorrente.
- Replanejar versões com base em dados reais de uso, cliques/receita consentidos e suporte; não adicionar funcionalidades sem hipótese mensurável.

## 6. Matriz de trabalho em modo Turbo

| Lote | Frentes paralelas | Regra de isolamento |
|---|---|---|
| A — controle operacional | Dispatcher; configuração concorrência; scheduler/Vigia; QA reviewer; documentação/runbook | Um PR por workflow; não alterar scheduler e permissões no mesmo lote sem necessidade |
| B — dados | contratos de coletores; matching/golden; frescor/histórico; normalização de preço/moeda; lojas/domínios | Worker diferente por módulo/teste; mudanças de catálogo/matching compartilham owners de domínio |
| C — site | busca/ordenação; estados UX; acessibilidade; links/diretório de lojas; API/paginação | Separar API de interface; PR E2E transversal depois dos blocos |
| D — compra/retensão | frete VTEX; modelos de método/cotação; favoritos/isolamento; alertas/opt-in | Frete atrás de flag; nunca abrir várias PRs alterando mesma rota/schema |
| E — inteligência/monetização | referência Copag; score explicado; histórico; Meli/Amazon/disclosure | Referência/score e migrations são de risco alto; política Copag precisa de decisão de negócio |
| F — qualidade de lançamento | SEO/performance/a11y; segurança; backup/restore; painel ops; smoke E2E | Não executar migrations/produção paralelamente a deploys; um release owner por janela |

**Concorrência:** começar com o máximo real configurado no GitHub (padrão 3) e só operar com 10 workers depois de definir \`TAREFAS_MAX=10\` nas Actions Variables, confirmar que o dispatcher respeita slots e demonstrar ausência de tarefas duplicadas. Não gerar dez PRs ao mesmo tempo para o mesmo arquivo.

**Ordem de integração:** dependências determinísticas → validação/testes → revisão independente → CI → Release Governor → merge/deploy elegível → smoke/monitoramento. PRs sem dependências podem desenvolver em paralelo, porém toda branch deve ser rebased/atualizada e retestada antes de integrar.

## 7. Autonomia, riscos e quando notificar

A meta é operar sem perguntas repetidas para ações rotineiras. Aplicar a política existente em \`docs/agentes.md\`:

- **R0 — docs/testes/refatoração reversível:** execução autônoma após testes, diff claro e gates verdes.
- **R1 — correção funcional localizada:** autonomia após revisão independente, CI e smoke aplicáveis.
- **R2 — comportamento de produto controlado:** autonomia somente com feature flag segura, rollout/canário, métricas, rollback e validação; flag não ativa por acidente.
- **R3 — crítico:** segredos/permissões, auth, migration destrutiva, alteração em massa de dados/preços/ranking, risco de segurança/privacidade, pagamentos ou incidente grave. Bloquear a ação crítica e criar registro claro da decisão necessária.
- **R-STOP:** evidência, CI, origem dos dados ou rollback insuficientes. Bloquear, tentar diagnóstico seguro automaticamente e escalar se persistir.

### Canal de decisão humano

- **Decisões e bloqueios de produto/R3:** registrar no GitHub com motivo, evidências, alternativas e recomendação. Não enviar uma pergunta repetida dentro de cada issue nem usar o agente implementador como autorizador.
- **Aviso ao usuário:** usar o monitor de projeto já registrado no ChatGPT para notificar quando houver uma decisão realmente necessária, um risco crítico ou um marco material; manter notificação acionável com links, escolha recomendada e consequência. O monitor atual é horário, portanto não prometer aviso instantâneo.
- **Alertas de operação:** os canais Telegram/ntfy já configurados continuam para incidentes técnicos/recuperação do robô. Eles não substituem a notificação do ChatGPT para decisões de produto/risco.
- **Sem decisão pendente:** os workers continuam em tarefas R0–R2 pré-aprovadas; não parar o projeto à espera do usuário para trabalho independente seguro.
- Nunca expor segredos em comentário, log ou notificação. Não elevar um pedido de autonomia a permissão para contornar a política R3.

## 8. Critérios de saúde do sistema

Dashboard e verificação contínua devem mostrar, pelo menos:

- idade de \`data/state.json\`, última rodada e última rodada saudável;
- sucesso/falha/timeout/adiamento por loja, cobertura de anúncios e classe de erro;
- freshness e origem do preço/estoque/frete e quantidade de matches ambíguos;
- sync de banco e heartbeat do Opportunity Engine;
- jobs pending/running/failed, idade da fila, retries, tarefas em quarentena;
- PRs abertas/antigas, CI verde/vermelha, tempo entre issue → PR → merge → deploy;
- saúde após deploy, smoke, incidentes/recovery;
- custos/sessões Claude quando medição estiver disponível;
- KPIs públicos de busca, resultado vazio, clique de oferta e alertas; métricas comerciais só quando instrumentadas legitimamente.

O watchdog atual usa limites operacionais já presentes no código. Metas futuras devem ser medidas, registradas e ajustadas em PR — não substituir as regras de runtime por números arbitrários no dashboard.

## 9. Primeiras ações executáveis — nessa ordem

1. **Ativar e validar a fábrica:** confirmar \`TAREFAS_MAX\`, \`TAREFAS_OPERADORES\`, app/secret Claude e runner firewall. Fazer um teste de duas/tarefas independentes, depois subir gradualmente até dez; medir falha/conflito/cota.
2. **Fechar o circuito do watchdog:** conferir o job externo cron-job.org para Hunter e Vigia; executar teste de aviso e validar que a recuperação é anunciada após checagens saudáveis.
3. **Implementar Dispatcher/Planner e Reviewer independente:** tornar a fila autônoma sem relaxar a proteção do executor; manter o release fora dos workers.
4. **Tratar release bridge (#221):** revalidar diff/checks, concluir o passo R3 necessário pela política, configurar token Vercel no ambiente seguro correto e provar deploy + smoke de um PR elegível. Não afirmar release automatizado até essa prova.
5. **Destravar a base por dependência:** auditar PRs #195/#186/#20 e issues existentes; avançar #195 em staging/flag desligada; deixar #186 aguardar decisão comercial e #20 bloqueada sem autorização de migration.
6. **Despachar Lote B — integridade dos dados:** contratos, matching, freshness, histórico, preços e golden tests com issues existentes. É o pré-requisito do resto do site e dos agentes de IA.
7. **Despachar Lote C — fluxos do site:** busca/detalhe/comparação, estados UX, acessibilidade, diretório de lojas, segurança de links e testes E2E.
8. **Despachar Lote D — compra/retensão:** cotação de frete real, conta/watchlist, notificações e confiabilidade de alertas.
9. **Despachar Lote E — inteligência/monetização:** referência Copag, score explicável, links de afiliado e tracking transparente.
10. **Ativar agentes por dependência** nas fases 7 e 8 do documento; agentes de experiência/crescimento entram depois que a base técnica e métricas estiverem maduras.
11. **Rodar hardening e burn-in de sete dias** antes de declarar concluído o projeto. Depois, manter a operação e o backlog evoluindo em ciclos autônomos.

## Autonomia de execução e comunicação por fase

**Instrução de produto:** Claude Code é responsável pela execução ponta a ponta. Não deve interromper o fluxo para pedir autorização rotineira de commit, criação/atualização de PR, correção de CI, merge governado, deploy elegível ou continuidade de tarefas. Executa essas ações automaticamente sempre que existirem permissões técnicas e a decisão do Release Governor for positiva. O workflow worker `tarefas.yml` continua sendo apenas branch + PR; o merge/deploy passa pela ponte dedicada.

A autonomia vale para mudanças que a política `docs/agentes.md` permite aprovar automaticamente (R0/R1 e R2 quando todos os controles estiverem satisfeitos). R3 e R-STOP continuam bloqueados: o ChatGPT deve chamar o proprietário apenas quando houver decisão humana real, não para repetir pedidos rotineiros. Ausência de token ou permissão não deve ser contornada; registrar o bloqueio, continuar o trabalho independente e seguir quando a configuração oficial estiver disponível.

### Relatório de conclusão de cada fase

Ao terminar uma fase, Claude Code deve comprovar todos os critérios de saída, atualizar `docs/ROADMAP-OPERACIONAL.md` e incluir:
- objetivo da fase e estado final de cada critério de saída;
- entregas e decisões técnicas, links de PRs/commits e CI;
- merges/deploys efetivamente feitos, URL/SHA e resultado dos smoke tests, quando aplicável;
- testes, métricas de qualidade/uso disponíveis e estabilidade observada;
- riscos/pendências remanescentes, bloqueios humanos (se existirem) e próxima fase autorizada.

Esse registro versionado é a fonte que o monitor do ChatGPT usa para apresentar o relatório ao proprietário ao fim de cada fase. Não enviar ao usuário relatórios a cada pequena PR nem chamar uma coleção de PRs abertas de “fase concluída”. O monitor de ChatGPT opera em verificação horária, portanto o aviso pode ocorrer na próxima verificação, não necessariamente instantaneamente.

## 10. Regra permanente para agentes

Claude Code tem autonomia para concluir operações rotineiras elegíveis — commits, branches, PRs, correções de CI, merge pelo Release Governor, deploy aprovado e smoke — sem solicitar confirmação passo a passo. Somente escalonar ações que a política classifique como R3/R-STOP ou que dependam de uma decisão comercial/humana não predefinida.

Antes de pegar uma nova tarefa: ler este plano e \`docs/ROADMAP-OPERACIONAL.md\`; consultar \`docs/MAPA-DE-AGENTES.md\` e \`docs/agentes.md\`; verificar na \`main\` as issues/PRs atuais; escolher a próxima tarefa elegível ainda não duplicada; criar branch própria; implementar/testar; abrir PR; avaliar CI/evidência; atualizar status/roadmap. Não alterar a própria política, permissões, secrets ou gates de release para concluir uma tarefa mais rápido.

**Modo Turbo significa paralelismo com controle, não ausência de controle.** O objetivo é manter os agentes trabalhando continuamente na próxima tarefa segura, enquanto operações críticas ficam bloqueadas até a autorização exigida e são comunicadas pelo canal do ChatGPT.


## Atualização posterior — estado real após validação de runtime (12/10/2026)

Esta atualização é mais recente que o texto de estado de partida e os critérios provisórios da Fase 0 acima. Não apaga o histórico: atualiza a leitura operacional atual.

- **Ciclo ponta a ponta de desenvolvimento comprovado:** Vigia → Dispatcher → worker → PR do agente → qa-review independente → Release Governor. O canário #257 produziu a PR #258; a revisão independente aprovou a mesma SHA, o Governor classificou como R0 e a PR foi integrada. Correções reportadas como integradas: #250, #252, #256, #260 e #261; #243/#244/#246 compõem o Dispatcher/revisor/classificador.
- **O que isso prova:** uma tarefa elegível pode percorrer a cadeia sem alguém aplicar manualmente cada etapa da execução, com backoff/idempotência e gates técnicos. **Não prova ainda operação 24/7 sustentada, dez workers ativos ou deploy autônomo em produção.**
- **Próxima tarefa técnica:** implementar telemetria real por execução no worker/executor — modelo e esforço efetivos, tokens de entrada/saída/cache e custo apenas se o runtime fornecer esses dados; duração, retries, falhas, escaladas, CI e resultado por PR. Não inventar estimativas quando a fonte não fornecer tokens/custos. Usar logs sanitizados e testes.
- **Rotina horária:** ainda precisa ser criada/ativada pelo mecanismo de agendamento disponível e validada com execuções reais consecutivas. rotina-horaria-prompt.md é o roteiro, não prova de que o agendamento esteja ativo.
- **Release ainda é uma fronteira separada:** a #221 permanece R3/bloqueada até a revisão humana e a decisão do sink de auditoria; VERCEL_TOKEN precisa ser configurado diretamente no ambiente seguro correto. Só declarar a ponte operacional depois de um deploy real por SHA elegível e smoke pós-deploy comprovado.
- **Concorrência:** confirmar TAREFAS_MAX nas variáveis do GitHub Actions. O padrão no workflow é 3 e o limite suportado é 10; não anunciar dez workers ativos sem evidência de configuração e teste gradual.
- **Proteção e qualidade:** verificar checks obrigatórios nos Settings, manter qa-review na mesma SHA e os checks test, regression, golden. A revisão automatizada não substitui aprovação humana quando a política exigir.
- **Decisões humanas consolidadas na issue #231:** sink de auditoria (recomendação técnica: comentários append-only no GitHub, opção C, ainda não aprovada), credencial Vercel, regras de proteção/checks e rotina horária.
- **Critério final da fábrica 24/7:** ciclo autônomo de desenvolvimento comprovado + scheduler recorrente ativo + telemetria observável + release bridge validada + sete dias de estabilidade real (coleta, freshness, sync, fila, CI, smoke e recuperação). Até lá, classificar como “cadeia funcional comprovada; operação contínua e release autônomo ainda em validação”.

Os bloqueios de produto permanecem inalterados: #195 frete só após cotação real e autorização; #186 depende da decisão comercial Copag; #20 continua **NÃO INTEGRAR** sem autorização específica. Não usar a autonomia dos agentes para contornar R3/R-STOP, branch protection ou configuração de segredos.

## Backlog futuro — auditoria de UX, UI e SEO do site (12/10/2026)

> **Estado: registrado para execução futura; não implementar automaticamente agora.** Esta seção preserva a auditoria de código e renderização mobile/desktop. Prioridades e dependências devem ser revalidadas contra a `main` e os dados atuais antes de cada lote.

### Ordem planejada

#### Lote A — rápidos de UI/UX (prioridade alta, estimativa P)
- Remover o rótulo de raridade visual que se confunde com a nota de qualidade; manter apenas a nota explicável (ex.: “88 · Boa”) e nomenclatura em português.
- Unificar o CTA principal “Ver oferta” como botão preenchido e tornar “Comparar” ação secundária consistente.
- Identificar explicitamente “Reclame Aqui” antes de métricas como “Sem cadastro” e “2,5”.
- Melhorar legibilidade em mobile: evitar texto abaixo de 12–13 px nos elementos relevantes e aumentar alvos de toque para pelo menos 44 × 44 px quando aplicável.
- Corrigir contraste de cores de alerta, estrelas e chips; validar WCAG.
- Corrigir hierarquia de headings: H1 em `/busca` e `/precos`, sem salto H1→H3 em `/oportunidades`.
- Deduplicar destaques do Hunter e exibir variação percentual em “Maiores quedas”.
- Corrigir eixo/rotulagem do gráfico e a apresentação da tabela de preços em mobile.
- Aceite: testes automatizados, checagem de acessibilidade e screenshots em viewport mobile e desktop.

#### Lote C — SEO técnico rápido (prioridade seguinte, estimativa P)
- Implementar fallback útil em `/oportunidades` quando DB/dados estiverem indisponíveis.
- Em `/precos`, exibir os preços sugeridos Copag confirmados com fonte e data verificáveis.
- Corrigir canonical e resolução de rotas, incluindo trailing slash e páginas `/termos` e `/privacidade`; aplicar `noindex` às páginas de busca/pistas ou rotas privadas quando apropriado.
- Limitar meta descriptions a aproximadamente 160 caracteres, sem cortar informação essencial.
- Declarar `width`/`height` e textos alternativos adequados nas imagens de cards; avaliar `lastmod` por produto.
- Aceite: inspeção de HTML SSR, canonicals, sitemap, robots e dados estruturados.

#### Lote B — listas e busca (estimativa M)
- Tornar os cards de `/oportunidades` mais compactos no mobile, visando aproximadamente dois cards por viewport sem sacrificar legibilidade.
- Em `/busca`, implementar “Carregar mais” em lotes (inicialmente 24), ordenação e filtros por tipo de produto.
- Priorizar correspondência de tipo exato antes de resultados relacionados (ex.: busca “booster” não deve colocar blister em primeiro sem justificativa).
- Aceite: testes de relevância, paginação/carregamento progressivo e regressão de comparação/favoritos.

#### Lote D — consistência de preço e dados estruturados (condicionado)
- Resolver divergência entre título/JSON-LD (“a partir de R$ 66,57”) e oferta visível de R$ 41,80.
- **Dependência obrigatória:** revalidar a regra de frete comparável da issue/PR #84. Não publicar `lowPrice` nem título baseado no menor valor bruto se isso contradisser a regra de comparabilidade, frete ou as ofertas efetivamente apresentadas.
- Escolher uma única regra consistente entre preço destacado, lista de ofertas e Product/AggregateOffer JSON-LD; documentar a regra e testar cenários de frete conhecido/desconhecido.
- Aceite: preço e JSON-LD coerentes com a política aprovada e com conteúdo visível.

#### Lote E — conteúdo SEO (fase separada, exige autorização explícita)
- Renderizar o conteúdo completo do guia `/como-funciona` no SSR e avaliar FAQPage somente para perguntas/respostas realmente visíveis e elegíveis.
- Avaliar páginas agregadas por tipo, começando por `/tipo/blister`, e glossário de termos de Pokémon TCG.
- **Gate:** o `CLAUDE.md` restringe SEO & Content até autorização explícita. Este registro não concede essa autorização; não iniciar implementação sem ela.

#### Lote F — performance e estratégia de build (fase separada, estimativa G)
- Reduzir HTML inline por rota (auditoria mediu cerca de 465 KB), CSS/JS/fontes/logo embutidos e dependência de carregar `state.json` de aproximadamente 1,8 MB para exibir conteúdo.
- Avaliar externalização de CSS, JS, fontes e logo com cache apropriado e payload JSON específico/leve por rota.
- Antes de implementar, definir estratégia de geração e validar o estado de `page.template.html`, apontado na auditoria como defasado.
- Medir Core Web Vitals/LCP/CLS e peso transferido antes/depois; não assumir melhoria sem medição.

### Evidências e critérios transversais
- A auditoria reportou SSR com títulos, canonical, OG e JSON-LD em rotas analisadas; sitemap coerente com o estoque; rótulos de Pix e referência Copag; explicabilidade “Por que esta nota?”; respeito a `prefers-reduced-motion`; sem erros de console ou imagens sem alt na execução reportada.
- A auditoria foi executada com Playwright em mobile e desktop usando o `index.html` da `main`, rewrites do Vercel e dados do ramo `data`, porque o host de produção estava bloqueado pelo proxy da sessão. Revalidar no host real quando acessível; screenshots originais foram reportadas em `/tmp/claude-0/ux/shots/` e não devem ser presumidas disponíveis no repositório.
- Ordem sugerida: **A → C → B → D (após revalidar a regra #84) → E (após autorização explícita) → F (após decisão de build)**.
- Cada lote deve ser entregue em PRs pequenas, com critérios de aceite, testes, evidência visual e revisão independente. Este backlog não autoriza por si só merge, deploy ou mudança de política comercial.

