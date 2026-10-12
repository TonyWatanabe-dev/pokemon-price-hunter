# Mapa de agentes — Pokémon TCG Price Hunter

> **Atualizado em:** 11/10/2026 às 11:56 (America/Sao_Paulo, UTC−03:00)  
> **Escopo:** inventário de agentes existentes, capacidades previstas e critérios de ativação.  
> **Plano de entrega:** [docs/PLANO-ENTREGA-TURBO.md](./PLANO-ENTREGA-TURBO.md) descreve as fases até lançamento, operação 24/7, Dispatcher e ordem de ativação dos especialistas.  
> **Regra de leitura:** “implementado no código” não significa “comprovadamente ativo em produção”. Só afirmar operação real com logs/execuções verificáveis.

## 1. Arquitetura e princípios

Os agentes ficam na **Agent Layer**, acima dos serviços de domínio e do Automation Core. Crawlers/adaptadores são código determinístico de coleta; não são agentes de decisão. O produto deve continuar funcionando sem IA.

Fluxo de alto nível:

1. **Automation Core** agenda jobs, serializa rodadas, aplica timeout/retry/lease e registra estado.
2. **Hunter Orchestrator** seleciona e executa handlers registrados, com idempotência e auditoria.
3. **Agentes especialistas** leem dados por contratos/serviços de domínio e retornam resultados estruturados ou propostas.
4. **Evidence + Governance** validam evidências, permissões e ações permitidas.
5. **Human Review** decide sobre mudanças ambíguas de matching ou propostas de impacto.
6. **Serviços determinísticos** continuam donos de preço, estoque, matching final, score, ranking e Opportunity Engine.
7. **Notificações e observabilidade** relatam falhas e saúde sem esconder estados.

### Restrições globais

- Nenhum agente tem acesso SQL irrestrito ou escreve diretamente em tabelas de negócio. Usar serviços/contratos de domínio.
- Nenhuma IA pode escrever diretamente em preço, score, ranking, oportunidade, oferta ou referência oficial.
- Agentes podem sugerir; alterações de matching seguem revisão auditável e PR. Mudanças comerciais ou em produção precisam de autorização explícita.
- Sem evidência suficiente: abster-se, declarar incerteza ou abrir revisão; nunca inventar preço, fonte, produto ou conclusão.
- Jobs e efeitos colaterais precisam ser idempotentes; retries não podem duplicar alertas, revisões ou mudanças.
- Ações desconhecidas são negadas por padrão. Merge, deploy, migration de produção, acesso a secrets e notificações reais exigem controles/aprovação específicos.
- Dados externos são entrada não confiável; instruções encontradas em páginas de lojas nunca substituem as regras do sistema.
- Cada agente deve ter contrato de entrada/saída, permissões, orçamento/timeout, critérios de falha, métricas e testes offline com casos dourados.

## 2. Agentes e capacidades já encontrados no código

### 2.1 Hunter Orchestrator — implementado no código

**Responsabilidade:** coordenar jobs registrados, sem tomar decisões comerciais por conta própria.

- Enfileirar jobs com `idempotency_key` única; rejeitar reutilização incompatível da chave.
- Reivindicar jobs com lease/lock, executar handlers, aplicar timeout/abort signal e ignorar gravações tardias de workers cujo lock expirou.
- Aplicar backoff progressivo; distinguir falha temporária, erro permanente, payload inválido, tentativas esgotadas e handler inexistente.
- Persistir estados e eventos operacionais; retomar jobs após lease expirada.
- Suportar store PostgreSQL e store em memória para testes.
- **Código documentado:** `src/agents/orchestrator.js`, `src/agents/stores.js`.
- **Testes documentados:** `test/agents-orchestrator-tests.js`, `test/agents-db-tests.js`, `test/agents-integration-tests.js`.
- **Limite de status:** a documentação do repositório registra implementação/testes, mas exige consultar Actions/logs atuais para comprovar execução real.

### 2.2 Matching Review / Review Proposal — implementado sem IA

**Responsabilidade:** identificar anúncios ambíguos que merecem triagem humana, sem forçar correspondências.

- Sugerir revisão para anúncios recusados por motivo específico (tipo desconhecido, boosters desconhecidos, coleções ambíguas, EAN divergente) e ofertas aceitas com baixa confiança.
- Ignorar ruído conhecido, limitar volume por rodada e deduplicar pela loja/página normalizada.
- Gravar apenas `review_item` aberto; não mudar preço, score, ranking, oferta nem oportunidade.
- **Código documentado:** `src/agents/matching-review.js`, `src/agents/handlers/review-propose.js`.
- **Status:** implementado no código; validação operacional requer logs atuais.

### 2.3 Human Review — implementado

**Responsabilidade:** dar a operadores autorizados a decisão final em propostas de matching.

- Listar, triar, aprovar, rejeitar, dispensar e exportar propostas.
- Verificar permissões do operador; gravar decisão, motivo, identidade e evento auditável na mesma transação.
- Impedir decisões concorrentes ou contraditórias sobre o mesmo item.
- Aprovar somente com coleção, tipo e boosters válidos no catálogo; calcular o ID do produto, nunca aceitar um ID arbitrário.
- Exportar overrides em branch/PR, nunca diretamente na `main`; os overrides continuam desativados por padrão.
- **Código documentado:** `src/core/review.js`, `tools/review.mjs`, `.github/workflows/review.yml`.
- **Limite conhecido:** não há tela dedicada; uso por Actions/CLI. Rejeitar revisão não remove automaticamente uma oferta previamente aceita.

### 2.4 Agent Evidence — implementado como contrato/validador

**Responsabilidade:** impedir propostas sem proveniência suficiente.

- Exigir evidência estruturada com fonte, URL HTTP(S), motivo, base (`observado` ou `inferido`) e status coerente.
- Rejeitar payload inválido antes de criar revisão; campos livres como `title` ou `why` não substituem o contrato.
- Diferenciar observação direta de inferência e manter rastreabilidade.
- **Código documentado:** `src/agents/evidence.js`.
- **Status:** contrato documentado; manter testes de esquema e regressões para entradas malformadas.

### 2.5 Agent Governance — implementado como política/guard

**Responsabilidade:** descrever e bloquear operações não autorizadas; não concede acesso por si só.

- Negar por padrão ações desconhecidas ou sem grant.
- Separar leitura, alteração em branch/PR, ações que exigem aprovação humana e ações proibidas.
- Registrar ferramenta, objetivo, resultado e erro com redação de segredos.
- Não permitir que aprovação para uma ação se estenda a outra ação.
- **Código documentado:** `src/agents/governance.js`, `test/agents-governance-tests.js`.
- **Status:** guard/política existe; ligação integral com telemetria de todos os agentes deve ser comprovada, não presumida.

### 2.6 Agent Notifications — implementado no código

**Responsabilidade:** agregar avisos de falha/bloqueio dos jobs sem gerar spam.

- Notificar eventos novos `AGENT_JOB_FAILED` e `AGENT_JOB_BLOCKED` pelo canal operacional configurado.
- Avançar cursor de leitura somente depois de entrega confirmada.
- Não notificar repetidamente `ai_disabled`.
- **Código documentado:** `src/agents/notify.js`.
- **Status:** implementação descrita; confirmar entrega real por logs antes de considerar operacional.

### 2.7 Agent Cycle / integração com a rodada — implementado no código

**Responsabilidade:** conectar a fila ao workflow do Hunter sem tornar o agente um ponto único de falha.

- Executar a etapa de agentes depois da sincronização dos dados/oportunidades.
- Limitar tempo, serializar rodadas e permitir que a rodada principal prossiga se a etapa de agentes falhar.
- **Código documentado:** `src/agents/cycle.js`, `tools/agents-run.mjs`, workflow `hunter.yml`.
- **Status:** integração declarada no código; verificar runs atuais do Actions e logs para provar uso real.

### 2.8 Dispatcher — implementado; despacho real comprovado em 12/10/2026
- **Código:** `src/agents/dispatcher.js`, `tools/dispatcher.mjs` e `.github/workflows/dispatcher.yml`.
- **Disparo:** `workflow_run` depois de "Vigia do robô", cron como reserva, ou manual.
- **Responsabilidade:** escolher issues `tarefa:aprovada` por operador e despachar para o worker. Respeita dependências, vagas, áreas críticas, lease, backoff, quarentena e idempotência (marcador `dispatch:N:T`).
- **Limites:** não implementa, não revisa, não faz merge nem deploy. O despacho real só acontece com `DISPATCHER_ATIVO=true`.
- **Status:** despacho real comprovado (#247 tentativas 1 e 2; #257 até a PR #258). Defeito de lease e quarentena corrigido na #256, que aguarda merge.

### 2.9 Worker de tarefas (Claude Code Action) — implementado; caminho do despacho comprovado
- **Código:** `.github/workflows/tarefas.yml`, com dois caminhos: label `executor:github` e `workflow_dispatch` do Dispatcher.
- **Revalidação:** `tools/validar-despacho.mjs` revalida cada despacho antes de qualquer efeito.
- **Entrega:** só branch e PR, com commits assinados pelo app.
- **Status:** a execução pelo caminho do despacho e a PR #258 foram comprovadas (worker `38229495517`). O perfil de esforço ainda não está ligado (#248 aberta).

### 2.10 QA/PR Reviewer (`qa-review`) — implementado; revisão de PR do worker comprovada
- **Código:** `.github/workflows/revisor.yml`.
- **Funcionamento:** sessão separada do Claude, só leitura e comentário, veredito estruturado fail-closed. Não aprova pela API de review e não faz merge.
- **Status:** revisões reais aprovadas nas PRs #244, #250, #252, #254, #256 e #259. Na #258, recusou o ator `claude`; depois da #261 (integrada), revisou a #258 e aprovou sem bloqueantes.

### 2.11 Release Governor — política implementada; Ponte de execução ainda não integrada
- **Código:** `src/agents/release-governor.js` e `release-governor-audit.js`.
- **Status:** a exigência de `qa-review` está na #260, aberta. A Ponte (#221), o sink de auditoria e o `VERCEL_TOKEN` estão pendentes, então não há merge nem deploy autônomos.

## 3. Agentes de domínio mapeados — futuros, por dependência

Os nomes abaixo são capacidades de produto previstas, não declaração de que handlers já existam. Construir somente quando o pré-requisito estiver satisfeito; o núcleo determinístico deve continuar funcionando sem IA.

### 3.1 Catalog Agent — futuro; primeira especialização de IA

**Missão:** preparar propostas de enriquecimento/normalização do catálogo.

Funções:
- Detectar possíveis produtos duplicados, nomes alternativos, coleção/idioma/tipo/quantidade de boosters ausentes.
- Sugerir campos normalizados e links de evidência verificáveis.
- Comparar proposta com catálogo existente e casos dourados; declarar confiança e abster-se em ambiguidade.
- Criar `review_item` com evidências, sem editar `config/catalog.json` ou banco diretamente.

**Não pode:** criar automaticamente produto oficial, resolver EAN divergente por palpite, aceitar marketplace como referência Copag ou alterar preço/score.

**Pré-requisitos:** contrato de evidências estável, fila de revisão operacional, casos dourados de catálogo/matching, dedupe, métricas de falso positivo e autorização explícita para habilitar IA.

### 3.2 Marketplace Agent — futuro

**Status (12/10/2026):** o agente em si continua futuro. A parte determinística de descoberta de fontes existe como **Discovery Intelligence Engine v0** (`src/discovery/`, `docs/discovery-engine.md`): conectores de busca intercambiáveis (Brave real; Bing/Serper atrás de chave, indisponíveis sem ela), consultas geradas do catálogo, ledger com seleção heurística (sem IA) e hand-off de lojas/URLs ao coletor. Ligado no passo diário do `hunter.yml` (desliga com `HUNTER_DISCOVERY=0`). Sem validação ao vivo neste repositório: só testes offline.

**Missão:** diagnosticar cobertura e qualidade dos coletores, não substituir crawlers.

Funções:
- Resumir saúde por loja/plataforma, falhas recorrentes, idade dos dados e campos faltantes.
- Recomendar reexecução limitada, pausa de uma fonte ou revisão de configuração em proposta auditável.
- Identificar divergências de contrato entre adaptadores e catálogo.
- Priorizar manutenção com base em impacto e evidência.

**Não pode:** contornar robots.txt, CAPTCHA, login, limites de API ou controles anti-bot; habilitar lojas bloqueadas automaticamente; alterar segredos ou publicar configuração sem aprovação.

**Pré-requisitos:** contratos de adaptadores e freshness/health estáveis, telemetria por loja, política de rate limit e testes de falha transitória.

### 3.3 Price Intelligence Agent — futuro

**Missão:** explicar mudanças e levantar hipóteses sobre preço, estoque e frete a partir de dados históricos.

Funções:
- Resumir mudanças reais e persistentes; separar alteração observada de anomalia.
- Comparar preços somente entre produtos/variantes equivalentes e mesma base de frete.
- Apontar amostra insuficiente, possível preço promocional, Pix versus parcelado e histórico defasado.
- Produzir explicação e evidências para revisão; o score oficial continua determinístico.

**Não pode:** criar preço de referência, substituir preço Copag, escrever oportunidade/score ou disparar alertas de compra com dados incompletos.

**Pré-requisitos:** histórico suficiente e confiável, matching de alta precisão, preço/frete com timestamp e origem, política de comparabilidade e golden tests temporais.

### 3.4 Affiliate Agent — futuro

**Missão:** sugerir e auditar monetização de links sem degradar confiança ou segurança.

Funções:
- Verificar presença de disclosure, parâmetros de afiliado autorizados e destino final permitido.
- Detectar links quebrados, tracking duplicado, redirecionamentos inesperados e inconsistências de campanha.
- Sugerir testes A/B e relatório de receita/conversão agregada, se houver dados consentidos.

**Não pode:** inventar URLs afiliadas, trocar destinos para domínios não aprovados, ocultar publicidade, acessar tokens/secrets, manipular ranking em função da comissão sem política explícita.

**Pré-requisitos:** política comercial definida, allowlist de domínios, tracking auditável, analytics com privacidade e disclosure validado.

### 3.5 Alert Agent — futuro como especialista; envio atual é determinístico

**Missão:** melhorar qualidade das propostas de alerta, mantendo o envio sob regras determinísticas.

Funções:
- Agrupar alertas duplicados, explicar por que uma queda é ou não comparável e sugerir resumo legível.
- Verificar opt-in, canal preferido, cooldown, idempotência e limites antes de propor envio.
- Preparar rascunhos para revisão quando evidência for fraca.

**Não pode:** enviar mensagens reais autonomamente enquanto `notify.real` não estiver explicitamente autorizada; ignorar opt-in, anti-spam ou limites; transformar frete desconhecido em zero.

**Pré-requisitos:** preferências/canais persistidos, dedupe comprovado, observabilidade de entrega, políticas de consentimento e aprovação para notificações reais.

### 3.6 Hunter Orchestrator — evolução futura, não um segundo orquestrador

**Missão futura:** planejar workflows multiagente, ordenar dependências e consolidar resultados.

- Resolver qual especialista pode ser chamado e em que ordem.
- Aplicar orçamento, limite de chamadas, deadline, retry, cancelamento e circuit breaker.
- Consolidar propostas conflitantes sem esconder discordâncias.
- Exigir evidências e registrar qual agente/versão produziu cada resultado.

**Regra:** reutilizar o Orchestrator de jobs existente; não criar um segundo motor paralelo. A camada de planejamento só vem depois de contratos e métricas dos handlers estarem estáveis.

## 4. Capacidades futuras de Produto, Experiência, Crescimento e Aquisição

**Planejadas — não iniciar agora.** Só ativar quando houver maturidade de produto, instrumentação confiável, pré-requisitos listados e aprovação explícita.

### 4.1 UX Research Agent — futuro

- Analisar feedback, dúvidas e tarefas de usuários em dados autorizados e minimizados.
- Formular hipóteses de usabilidade, agrupar temas e recomendar pesquisas/testes.
- Separar observação, inferência e recomendação; não alegar entrevistas ou evidências que não existiram.
- Entregar relatório com evidências e grau de confiança; não alterar interface sozinho.

**Pré-requisitos:** analytics/feedback com consentimento e minimização, baseline de métricas, protocolo de pesquisa e revisão humana.

### 4.2 UI & Design System Agent — futuro

- Auditar componentes, tokens, acessibilidade, responsividade e consistência visual.
- Propor tokens/componentes e diffs em branch/PR com screenshots/testes quando disponíveis.
- Validar contraste, foco, teclado, semântica e estados de loading/erro/vazio.

**Não pode:** publicar diretamente, introduzir dependências/telemetria sem revisão ou substituir critérios de acessibilidade por julgamento visual.

**Pré-requisitos:** biblioteca de componentes/tokens estável, critérios de design aprovados, testes visuais/a11y e ambiente de preview confiável.

### 4.3 Social Media Agent — futuro

- Gerar calendário e rascunhos editoriais sobre coleções/produtos com fatos verificáveis.
- Adaptar formato/canal e manter disclosure de afiliado quando aplicável.
- Criar fila de aprovação, rastrear campanha e reportar resultados agregados.

**Não pode:** publicar autonomamente, inventar preço/disponibilidade, usar imagens/marcas sem direito ou fazer alegações promocionais não verificadas.

**Pré-requisitos:** política editorial, direitos/licenças, canais conectados, calendário, aprovação humana e tracking com privacidade.

### 4.4 SEO & Content Agent — futuro

- Auditar indexabilidade, canonical, sitemap, metadados, conteúdo duplicado e links quebrados.
- Propor páginas/briefings baseados em demanda observada e conteúdo útil.
- Validar que preço/estoque exibidos tenham fonte e data; impedir páginas finas ou dados fabricados.
- Abrir PRs com testes para metadados, structured data e rotas.

**Não pode:** publicar conteúdo em massa sem valor, criar reviews fictícias, fabricar estatísticas nem alterar SEO de produção sem revisão.

**Pré-requisitos:** base técnica estável, Search Console/analytics autorizados, política de conteúdo e testes de renderização/indexabilidade.

### 4.5 Growth & CRO Agent — futuro

- Formular hipóteses de conversão, priorizar por impacto/confiança/esforço e propor experimentos.
- Avaliar funis, busca, clique de oferta, watchlist e retorno sem coletar dados excessivos.
- Definir métrica primária, guardrails e janela antes do teste; relatar resultado e incerteza.

**Não pode:** declarar causalidade sem desenho adequado, alterar ranking para favorecer comissão, fazer dark patterns ou lançar experimento sem aprovação.

**Pré-requisitos:** volume mínimo de tráfego/eventos, instrumentação validada, baseline, consentimento e guardrails de performance/privacidade.

### 4.6 Brand & Creative Agent — futuro

- Manter voz, mensagens, identidade visual e consistência entre site, campanhas e conteúdo.
- Criar briefs, conceitos, textos e direções visuais como propostas revisáveis.
- Checar uso correto de marcas, direitos, claims e disclosure.

**Não pode:** sugerir afiliação oficial com Pokémon/Copag sem autorização, usar assets sem licença, alterar marca publicada automaticamente ou apresentar conceito gerado como material aprovado.

**Pré-requisitos:** brand guide, biblioteca de assets licenciados, política de claims e fluxo de aprovação criativa.

## 5. Dependências e ordem de ativação

| Ordem | Capacidade | Estado | Pré-requisito principal |
|---|---|---|---|
| 0 | Automation Core + Orchestrator | Código implementado; runtime/execução devem ser verificados | Jobs, locks, retries, logs e testes |
| 1 | Evidence, Governance, Human Review | Código/contratos existentes; integração operacional deve ser comprovada | Permissões, audit trail, dedupe e casos dourados |
| 2 | Catalog Agent | Futuro próximo, ainda não habilitar | Fila estável + evidências + golden tests de matching |
| 3 | Marketplace Agent | Futuro | Health/freshness e contratos dos coletores |
| 4 | Price Intelligence Agent | Futuro | Histórico confiável + matching preciso + comparabilidade |
| 5 | Alert Agent especializado | Futuro; envio atual continua determinístico | Preferências, dedupe, consentimento e entrega observável |
| 6 | Affiliate Agent | Futuro | Política de afiliados, allowlist e tracking confiável |
| 7 | Hunter Orchestrator multiagente | Evolução futura | Especialistas avaliados, métricas e orçamento |
| 8 | UX Research + UI/Design System | Futuro, não iniciar agora | Produto/telemetria estáveis + aprovação |
| 9 | SEO & Content + Social Media | Futuro, não iniciar agora | Conteúdo/brand policy, direitos e analytics |
| 10 | Growth & CRO + Brand & Creative | Futuro, não iniciar agora | Tráfego suficiente, guardrails e aprovação explícita |

Esta ordem é de dependência, não uma autorização para começar todas as etapas automaticamente.

## 6. Contrato obrigatório para cada novo agente

Antes de registrar um handler, adicionar um documento/PR que especifique:

1. Nome, missão e casos de uso incluídos/excluídos.
2. Dono humano e serviço de domínio que fornece os dados.
3. Payload de entrada e schema estrito de saída.
4. Fontes/evidências exigidas e como diferenciar observado de inferido.
5. Permissões/grants, ferramentas permitidas e ações proibidas.
6. Chave de idempotência e estratégia para efeitos colaterais/retries.
7. Timeout, orçamento de execução, rate limits e comportamento em cancelamento.
8. Critérios de abstinência, bloqueio, retry e falha permanente.
9. Métricas: precisão/recall quando aplicável, taxa de abstenção, duplicidade, custo, latência e falhas.
10. Golden tests offline, regressões adversariais e teste de integração.
11. Plano de rollout desativado por padrão, rollback e evidência de operação.
12. Critérios de aceitação verificáveis no PR/CI; nenhum “done” apenas por label.

## 7. O que falta comprovar

- Execução real da etapa `Agentes` nos runs atuais de Actions e logs; o código sozinho não prova produção.
- Ligação de ponta a ponta de auditoria/governance para todas as ferramentas que os handlers utilizam.
- Métricas de qualidade em dados reais autorizados; os golden tests existentes são sintéticos e medem regressões, não desempenho real.
- UI própria para fila de revisão e comportamento ao rejeitar um caso já aceito.
- Catalog Agent com IA: ainda planejado; nenhum handler de IA está registrado no inventário atual.
- Nenhuma das seis capacidades de Produto/Experiência/Crescimento/Aquisição futuras deve começar até que os pré-requisitos e a aprovação estejam presentes.

## 8. Referências no repositório

- Implementação e regras atuais: [docs/agentes.md](./agentes.md)
- Arquitetura e matriz de testes: [docs/arquitetura-e-testes.md](./arquitetura-e-testes.md)
- Roadmap operacional: [ROADMAP-OPERACIONAL.md](./ROADMAP-OPERACIONAL.md)
- Governança: issue [#89](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/issues/89)
- Agentes de produto e evidências: issue [#36](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/issues/36)
- UX de confiança: issue [#37](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/issues/37)
- Golden evaluation: issue [#90](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/issues/90)

---
*Manter este documento sincronizado com o código e o CI. Atualizar estado só após verificar diffs/testes/logs; nunca transformar capacidade planejada em “implementada” por intenção ou nome de issue.*
