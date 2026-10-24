# Atualização estratégica — 24/10/2026 (America/Sao_Paulo)

## Nova prioridade de produto: infraestrutura antes dos combos

A expansão **“Monte seu kit”** foi aprovada como direção de produto, mas não deve competir com a estabilização e a qualidade da plataforma. A sequência obrigatória é: **confiabilidade operacional → qualidade e taxonomia de dados → motor de ofertas/preços/frete → experiência guiada e combos → medição e expansão**.

### Trabalho prioritário de infraestrutura
1. **P0 — Operação confiável:** manter #271 até haver evidência de 7 dias consecutivos encerrados e verdes; validar smoke de produção no SHA publicado. Acompanhar #231 para evidências reais de Governor, auditoria e fluxo operacional. Não declarar concluído por documentação ou CI isolados.
2. **P1 — Qualidade do catálogo e matching:** melhorar identificação de produto, coleção, idioma, EAN, quantidade, categoria e estoque; reduzir falsos positivos, duplicatas e produtos não casados. Distinguir cartas, produtos lacrados, decks, acessórios, brinquedos e mercadorias não equivalentes.
3. **P1 — Frescor e cobertura de ofertas:** medir atualização por loja, idade dos dados, disponibilidade real, falhas e taxa de matching. Priorizar problemas por impacto na experiência, não apenas pelo número bruto de lojas/ofertas.
4. **P1 — Preço e custo total:** preservar ranking independente de comissão; separar preço do produto, frete e total. A cotação real por CEP permanece desligada até existir fonte oficial/autorizada e evidência confiável (#84). Nunca tratar frete desconhecido como zero.
5. **P1 — API, banco e observabilidade:** avaliar latência, consultas, cache, sincronização, recuperação de falhas, alertas e integridade dos snapshots. Corrigir gargalos comprovados antes de aumentar carga.
6. **P2 — Combos:** iniciar a funcionalidade de consumidor depois que os contratos de catálogo/ofertas necessários estiverem confiáveis. Design, taxonomia, protótipo e questionário podem avançar em paralelo sem publicar recomendações falsas nem alterar a produção.

### Nova iniciativa: “Monte seu kit”
- Página separada, rota sugerida `/monte-seu-kit/`, item próprio no menu desktop/mobile e chamada na Home com CTA **“Descobrir meu kit ideal”**.
- Público prioritário: iniciantes que não sabem qual coleção ou produto comprar.
- Questionário curto: objetivo (colecionar, jogar, presentear, abrir boosters ou proteger cartas), orçamento, preferências, idioma e acessórios opcionais.
- Recomendações explicáveis e baseadas somente em catálogo/ofertas reais. Diferenciar boosters, ETBs, decks prontos e acessórios; nunca prometer cartas aleatórias ou raridades.
- Combos virtuais: “Minha primeira coleção”, “Colecionador organizado”, “Quero aprender a jogar” e “Quero cartas especiais”, com itens configuráveis e sem estoque/logística próprios.
- Configurador de cesta: adicionar/remover itens, quantidades, alternativas e comparação entre uma loja e várias lojas, considerando frete apenas quando sustentado por dados reais.
- Usar a mesma fonte de catálogo, Offer Engine, ranking, histórico, disponibilidade e links do site. Não criar catálogo, preços, ranking ou sistema de frete paralelos.
- Instrumentar funil: visita, início/conclusão do questionário, combo visualizado, itens alterados, clique para loja e conversão afiliada quando disponível.
- A monetização afiliada nunca altera a ordem das recomendações. Mostrar limitações e disclosure aplicável.

### Critério para liberar recomendações reais
A experiência pode ser desenhada e testada com fixtures claramente sintéticas, mas só deve recomendar produtos reais quando houver testes comprovando: matching correto; dados atuais/estado de estoque; preço rastreável; orçamento respeitado; cálculo honesto do total; ausência de mistura entre idiomas/variantes/categorias; e links de destino corretos. Se não houver dados suficientes, mostrar a limitação ou oferecer alternativas verificadas.

### Instruções para Claude Code
1. Ler `CLAUDE.md`, este documento, `docs/PLANO-ENTREGA-TURBO.md`, `docs/agentes.md` e o mapa de agentes antes de iniciar.
2. Conferir estado atual da `main`, issues, PRs, diffs, CI, deploy e logs recentes; reconciliar este plano com evidência atual para evitar duplicar tarefas ou tratar snapshots antigos como estado vivo.
3. Trabalhar por branch/worktree e PR; não escrever diretamente na `main`. Não reescrever a arquitetura nem duplicar funcionalidades existentes.
4. Primeiro entregar auditoria técnica e tarefas pequenas com dependências, critérios de aceite, riscos e testes. Paralelizar apenas tarefas independentes; evitar concorrência em arquivos ou subsistemas conflitantes.
5. Priorizar #271, #231, qualidade de dados e custo total conforme estado real. O trabalho visual de “Monte seu kit” pode avançar em paralelo como protótipo, sem habilitar dados ou flags não validados.
6. Para cada tarefa, declarar claramente: **feito no código**, **integrado**, **publicado** e **validado em runtime** são estados diferentes. Anexar SHA, CI, PR, smoke e métricas quando aplicáveis.
7. Executar `npm test` e os testes de domínio relevantes. Adicionar golden/regressão para regras de matching, ranking, preço, frete e combos; não enfraquecer nem pular testes.
8. Preservar gates do Release Governor e revisão independente. R3, R-STOP persistente, riscos de dados/segurança/impacto financeiro e decisões comerciais críticas seguem escalonamento humano. Autonomia rotineira não autoriza contornar proteções.
9. Não habilitar cotação por CEP, recomendação em produção, novas permissões, secrets ou flags por inferência. Frete real exige fonte autorizada; nunca contornar robots.txt, CAPTCHA, WAF ou checkout protegido.
10. Atualizar os dois documentos de roadmap após cada mudança de fase e ao concluir entregas relevantes, citando PRs, SHA, testes, deploy/smoke, métricas, limitações e próxima prioridade. Não marcar fase concluída sem critérios de saída comprovados.
11. Não reintroduzir o teto financeiro de US$ 100/24 h removido pelo proprietário. Manter os controles técnicos, de telemetria, idempotência, concorrência e release já exigidos.

---

## Execução do roadmap — 24/10/2026, tarde (America/Sao_Paulo)

### Auditoria (13h30 UTC)
- **#271:** 22/10 e 23/10 vermelhos só pela sincronização do banco (0,40 e 0,323; causa corrigida na #856). 24/10 parcial verde (sync 1,0; Hunter 0,977). Sequência 0/7; 7/7 possível em 31/10.
- **Smoke de produção:** verde no SHA publicado `7094692` (run 40097327606). Deploy `dpl_FAPKuaKNPFeobgrsUsbah9pPQt2Y`.
- **#231:** Dispatcher roda a cada ~15 min sem falha; worker `tarefas.yml` sem execução desde 14/10 porque não há issue `executor:ready` (fila vazia). Variáveis do Actions não são legíveis por este ambiente (403 no proxy).
- **Dados (13:00 UTC):** 165 fontes (115 ativas, 33 bloqueadas, 10 indisponíveis, 5 erro, 2 pausadas); 3.402 ofertas, 1.159 com estoque, 986 com menos de 1 h; frete conhecido 288/1.159. 29 lojas "ativas" sem nenhuma oferta (maioria JSON-LD sem página de produto no sitemap). Kalunga, Havan e Leitura cadastradas sem leitura (sonda: Havan VTEX 404; logs e artefatos do Actions bloqueados aqui).
- **Duplicidade:** 166 pares loja+produto com mais de uma oferta = vendedores diferentes no mesmo marketplace (ML, Ri Happy/PBKids), não duplicação.

### Entregue
| PR | O quê | Estado |
|---|---|---|
| #867 | Descoberta Fase 0 sem custo: validador v2 (busca da loja, sitemap), reconferir recusados, OpenStreetMap | integrado; 1ª rodada: OSM 49 lojas com site/566 sem, 3 conferidas; reconferir 15 → 4 candidatas |
| #868 | `copag-check` grava em `data/copag-check.json` (push em config/ na main protegida derrubava a rodada de 12:29 UTC) | integrado |
| #869 | Fase 1: 12 redes (ToyMania, Livraria da Vila, Livrarias Curitiba, Le Biscuit, Riachuelo, Casa&Video, Sam's Club, Drogasil, Araujo, Nissei, Fast Shop, Bruno PokeCartas) | integrado; resultado por loja nas próximas rodadas |
| #871 | `docs/monte-seu-kit.md` (K1) | integrado |
| #872 | K2: recomendação pura + golden do critério de liberação (fixtures sintéticas) | integrado |
| #874, #875 | K3: `/monte-seu-kit` oculto (noindex, fora do menu/Home/sitemap) + `GET /api/v1/site/kit`; nome e foto corrigidos após revisão independente | **publicado e validado em runtime** (14:19 UTC, fonte db, dados "atual") |

### Próximo
1. P0: acompanhar #271 até 7/7; smoke a cada deploy relevante.
2. P2 (paralelo, oculto): K4 cesta e comparação uma × várias lojas.
3. P1: nomes com palavra repetida no catálogo ("Baralho de Batalha Batalha ex"); Kalunga/Havan/Leitura; lojas ativas sem oferta.
4. Dono: lista de acessórios oficiais para K5.

---

## Atualização executiva — 24/10/2026 (America/Sao_Paulo)

### Entregue em 24/10

| Área | Entrega | PR |
|---|---|---|
| Banco | Quarentena no sync: lote com SAVEPOINT; linha recusada fica de fora sem parar a rodada (oferta continua viva); tipo sem categoria isolado; erro sistêmico (>10% ou >50) ainda para. Validado em PostgreSQL 16 com o ramo data real | #862 |
| Vigia | `whatsapp_parado`: 4 rodadas concluídas seguidas do envio ao WhatsApp com falha → degradado | #862 |
| Frete | Selo "Frete grátis acima de R$ X na loja" pela regra pública de 5 lojas (config/frete-gratis.json, fonte e data); 51 ofertas sem frete ganham o selo. Total, nota e ordem não mudam | #863 |
| Dono | Search Console verificado e sitemap enviado; convite antigo do WhatsApp redefinido; caixa de 18 boosters = Combo de Booster 18 | #861 |

### Estado por fase (docs/PLANO-ENTREGA-TURBO.md)

| Fase | Estado | O que falta |
|---|---|---|
| 0 — Fábrica e governança | Operando (CI com 4 checks, revisão, merge por PR) | Evidência formal do Governor/auditoria em #231 |
| 1 — Integridade e operação 24/7 | Código pronto; burn-in reiniciado em 22/10 | 7/7 dias verdes (previsão ~30/10). Quarentena (#862) reduz o risco de novo reinício |
| 2 — Fluxo principal e confiança | **Concluída** | — |
| 3 — Frete e custo total | Parcial | Mercado Livre 283/356 com frete; VTEX 429 a IP de nuvem; Nuvemshop/Woo/Shopify sem consulta pública. Selo de frete grátis por loja (#863). Cotação real só com acesso autorizado |
| 4 — Contas e alertas | Fluxo feliz comprovado em 20/10; texto ajustado (#844) | Testar falha de credencial e bloqueio (403) |
| 5 — Opportunity Engine | Concluída no código e em produção | Acompanhar falsos positivos |
| 6 — Lojas e afiliados | 165 fontes: 115 ativas, 33 bloqueadas, 10 indisponíveis, 5 com erro; 3.304 ofertas (1.121 com estoque), 510 produtos | Links de afiliado novos (dono, computador); não casados: 163 de 200 por "coleção não identificada" |
| 7 — Agentes especialistas | Parcial | Social Media em operação (Telegram/WhatsApp); demais agentes dependem de pré-requisitos |
| 8 — Hardening e lançamento | Parcial | Burn-in, smoke público com SHA publicado; backup do Supabase (recomendação: adiar o Pro até haver receita) |
| 9 — Manutenção contínua | Não iniciada (começa após a 8) | — |

### Próxima ordem de execução

1. **P0:** burn-in 7/7 e smoke de produção.
2. **P1, conversão:** medir /entrar antes × depois da #858 (26/10).
3. **P1, robô de busca:** casamento de "coleção não identificada"; revisar as 33 lojas bloqueadas (pausar as que bloqueiam sempre).
4. **P2, após o burn-in:** Supabase como fonte única.

---

## Atualização executiva — 23/10/2026 (America/Sao_Paulo)

### Entregue em 20–23/10

| Área | Entrega | PR |
|---|---|---|
| Alertas | Texto com horário de Brasília e base de comparação (total com frete ou só preço) | #844 |
| Lojas | 26 lojas mortas retiradas do radar; 8 lojas de importados adicionadas | #845, #846 |
| Anúncios | Contagem por origem no plano gratuito (/entrar/<origem>, /ir/<canal>/<origem>) e /entrar no design system | #850, #851 |
| Banco | Sync parado em 22/10 12:15 UTC por `offer_external_uq` (anúncio do ML com novo legacy_id). Corrigido; banco voltou a atualizar às 19:00 UTC de 23/10 | #856 |
| WhatsApp | Teto 20 → 34 mensagens/24 h (1 a cada 30 min, 7h–24h); oferta sem afiliado volta após 6 h. Motivo: pessoas entravam e saíam do grupo por falta de novidade | #857 |
| /entrar | Botão do WhatsApp antes da imagem (sem rolar no celular), Telegram no topo e "Ofertas de hoje" vindas da API | #858 |

### Estado

- **Página por coleção:** já estava no ar (/colecao/<slug>, CollectionPage + BreadcrumbList, sitemap). Sai da lista P2.
- **Painel de métricas:** é o Vercel Web Analytics (ligado). 7 dias até 23/10: 270 visitantes (+52%), 995 visualizações. /entrar/tt-comparativo 106 visitantes, /ir/whatsapp/tt-comparativo 10 (≈9%). TikTok traz mais que Instagram (141 × 47 visitantes nas páginas de entrada). Sai da lista P2; medir o efeito da #858 em 2–3 dias.
- **Burn-in (#271):** reiniciado pelo incidente de 22/10. Primeiro dia verde possível: 24/10; 7/7 por volta de 30/10 se não houver falha.
- **Banco:** 165 oportunidades em 23/10 23:37 UTC; frete "não confirmado" na maioria das ofertas (lojas só mostram frete com CEP; Fase 3 segue com a flag desligada).

### Próxima ordem de execução

1. **P0, #271:** acompanhar até 7/7 verdes.
2. **P0, smoke de produção** com o SHA publicado (rotas, filtro de idioma, /entrar).
3. **P1, conversão:** comparar visitas × cliques do /entrar antes e depois da #858; ajustar texto ou ordem se ficar abaixo de 15%.
4. **P1, WhatsApp:** acompanhar entradas e saídas do grupo com o ritmo novo e sinais de bloqueio do número (automação não oficial).
5. **P1, dados:** resultado das 8 lojas novas; estoque desconhecido da Bravo Jogos; TCG Culture só com moeda confirmada.

### Pendências do proprietário

- **Feito em 23/10:** Search Console verificado (TXT na zona DNS da HostGator; não remover) e sitemap `https://tcgpricehunter.com.br/sitemap.xml` enviado; convite antigo do WhatsApp redefinido; caixa de 18 boosters confirmada como o formato "Combo de Booster 18" já cadastrado.
- **Backup do Supabase:** plano gratuito sem backup do banco. O dado essencial é reconstruível pelas etiquetas diárias `data-backup/*` (docs/backup.md). Recomendação: adiar o Pro (~US$ 25/mês) até haver receita; decisão do dono.
- **Pendente:** links de afiliado novos (ML, Amazon, Shopee) pelo computador.

---

## Atualização executiva — 20/10/2026 (America/Sao_Paulo)

> Leitura mais recente. Issues abertas: #271, #231 e #84. Sem PRs abertas depois do #841.

### Entregue em 18–20/10

| PR | O que mudou |
|---|---|
| [#829](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/829) | 16 coleções Espada e Escudo (PT-BR) no catálogo. Os produtos aparecem quando há oferta numa loja acompanhada (76 na primeira rodada). |
| [#831](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/831) | Importados EN/JA/ZH/KO viram produto próprio (`<id>-<idioma>`) e não herdam preço Copag. A Home e o "abaixo da Copag" contam só PT. Oportunidades ganhou filtro de idioma (padrão Português), e o card ganhou etiqueta do idioma. Entraram nomes em inglês das coleções (`langAliases`), 40 coleções do Japão (`jp*`) e 13 da China (`cn*`). |
| [#832](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/832) | **Incidente:** sync com o banco parado de 19/10 02:00 UTC até a correção (cerca de 10 h), por `tipo sem categoria: colecao_especial` depois da #829. Corrigido na taxonomia, com teste que exige categoria para todo `TYPE_LABEL`. O passo de sync tem `continue-on-error`. O vigia tem a regra `sync_falhando`, mas a entrega do aviso precisa ser confirmada pelo dono. |
| [#835](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/835), [#838](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/838), [#840](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/840) | Bloco "Compare também na Liga Pokémon" publicado (link e depois preço com data) e **retirado** a pedido do dono. Nada da Liga no site (`test/sem-liga-tests.js`). A Liga continua sem leitura automática. |
| [#839](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/839) | Testes de workflow alinhados ao SHA da `claude-code-action` v1.0.252 (#834). A `main` estava vermelha. Merge feito pelo dono. |
| [#841](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/841) | Grupos: importados saem nos mesmos grupos, com bandeira e linha "🌐 Idioma", sem comparação Copag. O avulso importado passa a se chamar "Box Pokémon - …". |

### Estado

- **Fase 4, alertas pessoais no Telegram: teste ponta a ponta feito em 20/10 com usuário real (o dono).** Passos: vínculo pelo site às 08:27 BRT, confirmação "✅ Alertas ligados" às 08:34; `/start` repetido respondeu "já estão ligados" (idempotente); alvo de R$ 35 no Blister Triplo de Caos Ascendente, com o site marcando "Chegou no seu preço" às 08:36; mensagem "PREÇO-ALVO ATINGIDO" no Telegram às 08:55 (rodada das 08:45, botão COMPRAR); `/status` respondeu "ligados, 2 alertas"; `/parar` respondeu "Alertas desligados"; `/parar` repetido respondeu "nenhuma conta ligada". Evidência: prints enviados pelo dono na sessão. Ainda falta testar falha de credencial e bloqueio do bot (HTTP 403). Melhorias de texto pendentes: "Lido em" em UTC, que deve ir para o horário de Brasília, e a linha "Comparação", que está técnica.
- **Fase 1 / #271:** sequência reiniciada para **0/7** (19/10 vermelho por causa do sync). Em 20/10 está parcial e verde até a consulta.
- **Analytics (Vercel), 7 dias até 18/10:** 177 visitantes, 1.042 visualizações, rejeição de 50%. O tráfego depende da divulgação.
- **Histórico de preço na página do produto:** já existe (gráfico de 7D, 30D, 90D e 1A, com atual, menor, maior e média). Sai da lista de funcionalidades novas.

### Próxima ordem de execução

1. **P0, #271:** acompanhar até 7/7 verdes. Confirmar com o dono se o aviso `sync_falhando` chegou em 19/10. Se não chegou, verificar o canal do vigia.
2. **P0, smoke de produção:** passar pelas rotas com o SHA publicado, incluindo o filtro de idioma e os importados.
3. **P1, Fase 4:** fluxo feliz comprovado em 20/10. Falta testar falha de credencial e bloqueio (403) e melhorar o texto do alerta (horário de Brasília e linha "Comparação").
4. **P1, dados:** auditar frescor, estoque e falsos positivos por loja. Cadastrar lojas de importados quando o dono enviar a lista.
5. **P2:** página por coleção (SEO e compartilhamento) e painel de métricas de cliques para o dono.

### Pendências do proprietário

- Search Console. Backup do Supabase. Confirmar a entrega do aviso do vigia. Decidir sobre a caixa de 18 boosters. Desativar o convite antigo do WhatsApp.

---

## Atualização executiva — 17/10/2026 (America/Sao_Paulo) — revisão de pendências

> Esta seção é a leitura operacional mais recente. A documentação e os dados do ramo `data` são snapshots; não equivalem a uma nova inspeção visual de todas as rotas em produção. PRs abertas: nenhuma na consulta de 17/10. Issues abertas: #271, #231 e #84.

### Estado atual por fase

| Fase | Estado | O que falta para fechar |
|---|---|---|
| **1 — Confiabilidade / operação 24/7** | Código integrado; burn-in em andamento | Completar **7 dias consecutivos encerrados e verdes** em #271, com evidência dos runs. Dia vermelho reinicia a contagem. |
| **2 — Fluxo principal do site** | **Concluída** | Nenhum bloqueio de fase registrado. Regressões futuras continuam cobertas por CI e smoke. |
| **3 — Frete por CEP** | Bloqueada; feature flag deve permanecer desligada | #84: obter cotação real por API oficial/autorizada. VTEX responde 429 a IPs de nuvem. Não contornar bloqueios, não raspar checkout protegido, não estimar frete nem exibir desconhecido como R$ 0. |
| **4 — Contas e alertas** | Avançou: alertas Telegram por usuário ligados em 17/10 (#783) | Fazer validação ponta a ponta com usuário real e opt-in/out, isolamento, deduplicação, retries, falha de credencial e evidência do envio; reconciliar critérios antigos da matriz de Fase 4 com o que foi integrado. Não declarar fase fechada só pela configuração. |
| **5 — Opportunity Engine / pistas** | Código integrado e pistas incorporadas às ofertas | Verificar em produção a apresentação, deduplicação e links das pistas após deploy; manter pista não verificada fora do score. |
| **6 — Lojas, coleta e afiliados** | Cobertura expandida; snapshot do ramo `data` em 17/10: 176 lojas nas fontes, 108 ativas, 80 com casamento de produtos, 2.517 ofertas e 352 produtos | Auditar frescor, estoque e falsos positivos por loja; adicionar rótulo visível de afiliado ML se ainda ausente; completar links afiliados por anúncio onde disponíveis; confirmar política de deploy e backup Supabase em #231. Não tratar contagens como métrica de qualidade por si só. |
| **7 — Agentes / fábrica de PRs** | Ciclo autônomo parcialmente comprovado; sem PRs abertas na consulta | #231: comprovar configuração e runtime do Governor/worker, checks obrigatórios, auditoria append-only, scheduler recorrente, concorrência real e fluxo CI → revisão independente → decisão → merge elegível → registro. Não presumir 10 workers ativos sem evidência. |
| **8 — Hardening / lançamento** | Parcial; depende do burn-in e de controles operacionais | Fechar #231: confirmar proteção da main, sink de auditoria, VERCEL_TOKEN no secret store, política de deploy, backup Supabase e monitor horário. Revalidar smoke público no domínio canônico `https://tcgpricehunter.com.br/` com SHA publicado. |

### Próxima ordem de execução

1. **P0 — #271:** registrar diariamente o burn-in e só concluir a Fase 1 com 7/7 dias fechados verdes.
2. **P0 — #231:** reconciliar configurações e evidências de autonomia, release, auditoria e backup. O teto financeiro anterior de **US$ 100/24 h foi removido pelo proprietário**: não reintroduzir como requisito nem como bloqueio. Permanecem controles técnicos, telemetria, limites de concorrência, idempotência, retries e gates de release.
3. **P0 — smoke de produção:** confirmar o SHA publicado e validar canonical/redirect, home, busca, página de produto, APIs/dados, links e estados vazios/erro. O último smoke documentado foi verde em 16/10; isso não prova sozinho que todas as mudanças posteriores foram verificadas visualmente.
4. **P1 — Fase 4:** testar alertas Telegram por usuário de ponta a ponta e atualizar a matriz de critérios com evidência atual.
5. **P1 — dados/UX:** medir frescor por loja, cobertura real de ofertas, correspondência errada e cliques; tratar os 153 casos de “coleção não identificada” da amostra antiga por prioridade e manter caixa de 18 boosters como decisão pendente.
6. **P1 — afiliados:** confirmar o rótulo visível do Mercado Livre e mapear links de afiliado por anúncio sem influenciar ranking. Shopee continua pendente de aprovação/link.
7. **P2 — Social Media:** Telegram tem automação documentada; manter como pendente a prova recente de publicação WhatsApp por via oficial e os publishers automáticos de Instagram/TikTok/YouTube. Gerar rascunhos e ativos pode avançar sem prometer publicação não comprovada.
8. **P2 — descoberta de lojas:** solicitar autorização para a plataforma Liga antes de qualquer leitura automatizada; não contornar robots.txt. Havan segue sem adaptador reconhecido. Pesquisa semanal de lojas abre PRs para confirmação.

### Pendências que dependem do proprietário

- Configurar/verificar Search Console para o domínio novo.
- Confirmar política de deploy e credenciais no ambiente seguro (não compartilhar segredos em chat).
- Confirmar backup automático do banco Supabase, além do backup do ramo `data`.
- Decidir se solicita autorização à plataforma Liga para leitura das lojas.
- Colocar vídeos da semana 2 no Drive e fornecer link de afiliado Shopee quando aprovado.
- Confirmar decisão de produto para caixa de 18 boosters; não inferir formato silenciosamente.

### Regras de conclusão

- **Código integrado ≠ deploy publicado ≠ comportamento real validado.** Cada status precisa de SHA, CI/run e, quando aplicável, smoke ou evidência de envio.
- Não declarar projeto completo enquanto #271 e #231 não cumprirem os critérios operacionais. A Fase 3 pode permanecer explicitamente bloqueada se não existir fonte de frete autorizada.
- Nenhum teto financeiro removido deve ser restaurado por documentação antiga. Não alterar gates, secrets, proteções ou política comercial para acelerar.
- Manter issue #271 aberta até 7 dias verdes consecutivos; manter #84 desligada até haver cotação autorizada e fiel.

---

## Atualização executiva — 17/10/2026 (America/Sao_Paulo)

> Fotografia: main com #779–#800 integradas; produção na Vercel acompanhando cada merge; smoke público verde em 16/10 (run 38982057641). Ramo `data` de 17/10: **176 lojas** nas fontes, **108 ativas**, **80 casando produtos**, **2.517 ofertas** e **352 produtos** no estado.

### Entregue em 16–17/10
| Frente | O que mudou | PRs |
|---|---|---|
| Pistas | Pistas viraram parte da página de ofertas (selo "Pista não verificada", sem nota); data ilegível não segura pista; mesma promoção de duas fontes aparece uma vez; menu sem "Pistas" (/pistas → /oportunidades) | #779, #780 |
| Pistas do ML | Link de catálogo (/p/MLB…) conferido pelo buy box da API; pista sem produto no post identificada pelo título oficial; meli.la de divulgador (/social/) lido pelo produto em destaque | #784, #786 |
| Alertas por usuário (Fase 4) | **Ligado em 17/10**: conta de serviço, regras Firestore publicadas, bot @PokemonTCGHunterBR_bot publicado no site; log explica chave inválida sem expor conteúdo | #783 |
| Coleta | Adaptador WooCommerce (Store API) só quando a API traz anúncios; detecção pelo sitemap quando a home não cita Pokémon; lastmod do sitemap; GET condicional (ETag/Last-Modified); frequência adaptativa (30→120 min sem mudança; 6 h para quem lê e casa 0; ML e Copag sempre) | #787, #789, #791, #792, #793, #796 |
| Casamento | Código de referência Copag (config/refs-copag.json); box/baralho com Pokémon em destaque sem coleção no título (coleção conhecida ou "Box Pokémon"); padrão de varejo "(216 Cartas) (36 Boosters)", "(6 Cartas) (01 Blister)". Na amostra de 200 não casados: 45 passam a casar; golden 31/31, 0 falso positivo | #790, #797 |
| Lojas | +46 (varredura TCG, brinquedos, papelarias, varejo regional), +5 (Maps/comunidade/CNPJ), +4 (conferência no Chrome). Na 1ª leitura das 46: 19 casando ~270 produtos (MP Brinquedos 70, Taverna do Rei 57, Ciatoy 31) | #788, #799, #800 |
| Descoberta | Consultas por código Copag, varejo de brinquedos/papelaria e +6 cidades; tarefa agendada **"Pesquisa semanal de lojas"** (segundas 8h49) abre PR com lojas novas confirmadas | #794 |
| Sondas (só leitura) | Sonda de adaptadores e de feeds no Actions. Resultados: VTEX dedicado proibido por robots nas 5 lojas JSON-LD; Metacards sem /products.json; **0 de 69** lojas JSON-LD com feed público | #782, #795 |
| Infra/SEO | GitHub Pages despublicado; redirect vercel.app → domínio em 308 (painel); bio IG/TikTok com /grupos | — |

### Achados que orientam a próxima etapa
- **Lojas do sistema da Liga** (`?view=ecom`): ~45 lojas físicas de TCG vendem Pokémon lacrado por essa plataforma (conferido no Chrome), mas o robots.txt não abre para o robô (teste no Actions). Ficam fora sem contorno; só entram com autorização da plataforma/lojas.
- Não casados (amostra de 200): 153 "coleção não identificada", 20 tipo, 14 idioma; parte resolvida pelo #797. Caixa de 18 boosters segue sem formato no catálogo (decisão pendente, revisão caso 5).
- Havan segue em "plataforma não reconhecida" (sem Pokémon no sitemap).

### Pendências
- **Proprietário:** Search Console com o domínio novo; política de deploy (#231); backup do banco Supabase (#231); rótulo do afiliado ML no site; vídeos da semana 2 no Drive; decidir se pede liberação de leitura ao sistema da Liga.
- **Burn-in (Fases 1 e 8):** 7 dias verdes seguidos, previsão ~23/10 (#271).
- **Fase 3 (frete por CEP):** bloqueada por 429 das lojas VTEX a IPs de nuvem (#84).
- Issues abertas reduzidas a 3 (#271, #231, #84); #560 e #592 fechadas em 17/10.

---

## Atualização executiva — 16/10/2026 (America/Sao_Paulo)

> **Estado da fotografia consultada:** main em [35b95fd](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/commit/35b95fd31de1ae8d863ef0c53916ddab1214ce6d), última integração identificada em 15/10 à noite. Esta atualização separa código integrado de operação pública comprovada.

### Resumo para decisão
- **PRs:** a consulta atual não encontrou PRs abertas. As PRs #750–#755 foram integradas; tarefas locais mencionadas no registro de 15/10 ainda precisam ser confirmadas como PR/merge antes de considerá-las entregues.
- **Produção:** **não comprovada como atualizada**. A Vercel atingiu o limite de builds/deploys (build-rate-limit). A #754 reduziu deploys redundantes do ramo `data`; é necessário novo deploy do SHA mais recente e smoke público verde. Não assumir que `main` já está refletida em produção.
- **Smoke público:** a execução registrada em 15/10 falhou na validação do canonical. O domínio canônico escolhido continua sendo **https://tcgpricehunter.com.br/**; corrigir/verificar o redirect/canonical e repetir o smoke.
- **Burn-in 24/7:** ainda não concluído. Registro de 15/10 verde (1º dia de 7); 16/10 estava parcial na última verificação. Só contar dias encerrados e verdes consecutivos; não declarar a Fase 1 concluída antes de 7/7.
- **Fases:** Fase 2 está concluída. Fase 1 segue em burn-in; Fases 4, 6 e 8 têm critérios pendentes nas matrizes abaixo; Fase 5 está concluída no código, mas depende da publicação para validação pública; Fase 7 segue em evolução. Fase 3 (frete por CEP) está integrada com feature flag desligada e bloqueada por respostas 429 das lojas de nuvem.
- **Social Media:** Telegram teve envio real e automação conforme os registros das PRs #693–#697. O WhatsApp também aparece como implementado em trabalho recente, mas há divergência entre documentação, estado de integração oficial e capacidade de publicar no grupo existente: não afirmar que publicação automática no grupo está comprovada sem evidência de execução recente. Instagram, TikTok e YouTube ainda não devem ser tratados como publishers implementados.
- **Agente de alertas Telegram por usuário:** trabalho em branch local foi reportado para 16/10; só marcar integrado quando existir PR/merge e CI verificáveis.
- **Orçamento:** o proprietário retirou o teto anterior de US$ 100 por 24 horas; não tratar esse teto removido como bloqueio ativo. Permanecem os limites técnicos de segurança, concorrência, retries e autorização de release.
- **Governança:** até o lançamento, merge humano permanece o gate de publicação conforme decisão registrada na #753. Não fazer bypass nem declarar deploy concluído sem evidência.

### Próximas prioridades
1. Resolver a cota da Vercel, publicar o SHA atual da `main` e executar smoke público completo (canonical, Home, busca/produto, API/dados e links).
2. Continuar registrando o burn-in diário e só fechar Fase 1 com sete dias encerrados consecutivos verdes.
3. Reconciliar e testar o publisher de WhatsApp: documentar API/caminho oficial realmente usado, destino, opt-in e evidência de envio; manter pausa se a integração não for verificável.
4. Confirmar se as branches locais mencionadas em 15/10 viraram PRs; priorizar alertas Telegram por usuário e critérios restantes das Fases 4/6/8.
5. Atualizar o roadmap novamente após o primeiro deploy/smoke verde e após cada gate de fase realmente concluído.

---

# Roadmap operacional — Pokémon TCG Price Hunter

> **Atualizado em:** 16/10/2026, 10:14 (America/Sao_Paulo, UTC−03:00) — produção aguardando deploy/smoke; burn-in em curso.
> **Base consultada para esta atualização:** main em `35b95fd31de1ae8d863ef0c53916ddab1214ce6d` (último commit identificado em 15/10 à noite).
> **Base consultada:** `main` em `5a70b1c1a008890082f21890c8f73c2bda985d19` (PR #335 integrada). Deploy Vercel iniciado após #335; verificar run #38279377618 antes de declarar produção atualizada.  
> **Propósito:** fonte de contexto para Claude Code/agentes e para acompanhamento humano. Este arquivo documenta o estado observado; issue/PR/CI e execução real continuam sendo a fonte de verdade para cada entrega.
> **Plano até a entrega:** [docs/PLANO-ENTREGA-TURBO.md](./PLANO-ENTREGA-TURBO.md) — fases de produto, ciclo 24/7, agentes futuros, critérios de conclusão e política de notificação.

## Canais e destinos do Social Media — atualizado em 14/10/2026

Canais informados/confirmados pelo proprietário. Distinguir perfis públicos, grupo e bot; não tratar o bot como grupo.

| Canal | Endereço | Estado / uso |
|---|---|---|
| Telegram — comunidade/grupo | https://t.me/+LzS_Jp1Wvas2NDhh | Convite público fornecido pelo proprietário. Validar novamente o chat ID antes de qualquer teste novo; há evidência histórica de publicação nas PRs #694–#697. |
| Telegram — bot | https://t.me/PokemonTCGHunterBR_bot | Bot separado da comunidade. O proprietário confirmou que o adicionou como administrador em “TCG Price Hunter \| 01”; o bot foi adicionado ao grupo; o envio real e a automação são documentados nas PRs #694–#697. Revalidar o destino e o último run antes de qualquer diagnóstico de falha. |
| Instagram | https://www.instagram.com/tcgpricehunter151/ (@tcgpricehunter151) | Perfil informado; publicação automatizada depende de elegibilidade e configuração da API oficial. |
| TikTok | https://www.tiktok.com/@tcgpricehunter | Perfil informado; não presumir integração de publicação automatizada implementada. |
| Facebook | https://www.facebook.com/profile.php?id=61595339254811 | Página informada pelo proprietário em 17/10/2026; link no rodapé do site e em /comunidade. |
| YouTube | https://www.youtube.com/channel/UCiePh0ZymWoPwa8k1d2jrDg | Canal informado; não presumir integração de publicação automatizada implementada. |
| WhatsApp | Sem link de convite confirmado nesta atualização | Não alterar o grupo existente nem presumir acesso à API de grupos. Integração somente por caminho oficial confirmado. |
| Shopee Afiliados | Link de afiliado pendente | Não inventar nem substituir link. |

Links de afiliados já informados:
- Mercado Livre: https://meli.la/1BzQ4PU
- Amazon: https://link.amazon/B0bVBmGRD

**Estado operacional:** Telegram tem evidência histórica de publicação e automação nas PRs #694–#697. WhatsApp está em divergência documental e exige confirmação de implementação oficial e de publicação no grupo existente. Instagram, TikTok e YouTube não devem ser considerados publishers automáticos ativos sem PR e evidência. Não guardar tokens, códigos de autenticação ou segredos nestes documentos.

## Social Media — Telegram em operação automática (14/10/2026)

Etapa concluída. Issue [#690](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/issues/690) fechada com evidência.

| Entrega | PR | Evidência |
|---|---|---|
| Prévia manual (só leitura, ramo `data`) | [#693](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/693) | workflow `social-preview.yml` |
| Piloto manual com dupla trava (`confirmar=ENVIAR` + título do chat) | [#694](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/694) | 1º envio real 14/10 08:59 (blister ME04, pbkids) |
| Card ambientado (foto real recortada sobre a mesa) + legenda aprovada (🇧🇷 / De ❌ / Por ✅ / loja / link) + prioridade de afiliado | [#695](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/695) | `tools/social-card.py`, `src/agents/social/legenda.js` |
| Envio automático com as regras do proprietário | [#696](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/696) | run 38570688326: post 14/10 10:18 (Box Display ME05, Mercado Livre) confirmado por print |
| Disparo logo após cada rodada do robô (`workflow_run`), cron de reserva 30 min, madrugada só novidades | [#697](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/697) | 1ª rodada automática 14/10 11:11, sucesso |

**Regras em vigor** (`src/agents/social/auto.js`): oferta nova no radar (≤ 60 min) sai na hora, até 3 por rodada; demais no máximo 1 por rodada e ≥ 5 min entre mensagens; mesma oferta 1× a cada 24 h; links de afiliado do anúncio primeiro; 0h–7h (BRT) só ofertas novas. **Kill switch:** variável do repositório `SOCIAL_AUTO` (`1` = ligado; ligado em 14/10/2026). Diário de envios no cache do Actions; só entra envio confirmado pela Bot API.

**Pendências não bloqueantes:** cadastrar links de afiliado por anúncio em `config/affiliates.json` (sem eles os posts usam a URL da loja); Instagram, TikTok e YouTube ainda não iniciados como publisher.

## Onde estamos — 15/10/2026 (noite)

> **Publicação travada até ~16/10 à tarde.** A Vercel (plano gratuito) bateu o limite de 100 deploys/dia: cada gravação do robô no ramo `data` gerava um deploy com erro. [#754](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/754) desliga isso. Produção está no #734 (`4fb454f`); os merges #735–#754 entram na próxima publicação (Redeploy do commit mais novo da `main` quando a cota reiniciar). Smoke público de 15/10 (run 38767160422) falhou por isso — esperado até publicar.

| Fase / frente | Estado | Evidência / o que falta |
|---|---|---|
| **Fase 1 — confiabilidade** | Código pronto; **burn-in em curso** | Robô a cada 15 min ([#717](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/717)); 7º dia verde ~23/10. `DISPATCHER_ATIVO` já estava ligado desde 12/10. |
| Fase 2 — fluxo do site | Concluída | #53, #82, #83 fechadas. |
| **Fase 3 — frete por CEP** | Código integrado, desligado | Lojas VTEX respondem 429 aos IPs de nuvem; #84 aberta. |
| **Fase 4 — contas e alertas** | **Quase concluída** | Isolamento, cooldown, retry, alerta explicado, regras Firestore no emulador 29/29 ([#733](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/733)). **Decidido: alerta por usuário via Telegram** — implementado em branch local `feat/alertas-telegram-usuario`, sobe em 16/10; ligar exige conta de serviço (`FIREBASE_SERVICE_ACCOUNT`), publicar regras e `ALERTAS_TELEGRAM_USUARIO=1`. |
| **Fase 5 — Opportunity Engine** | **Concluída no código** | **Decidido:** 12 referências c30-* do Instagram viram referência da comunidade ([#747](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/747)); rótulo "Ref. da comunidade" no site ([#749](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/749)). Aguarda publicação. |
| **Fase 6 — afiliados e lojas** | **Concluída no código** | Selo "Link de afiliado" com ⓘ ([#746](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/746)); limpeza do `sources.json` (139 → 122 lojas, [#748](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/748)). Candidatas Pirlimpimpim (Magazord, sem adapter/CNPJ) e Oitopeia (~4 SKUs, robots não confirmado) **não entraram**. |
| **Fase 7 — agentes** | Em andamento | 1–5: Dispatcher, QA e Vigia ativos; teto de 60 despachos/24 h ([#750](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/750)), Vigia detecta deploy falho ([#751](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/751)) e abre issue de incidente com `VIGIA_ISSUES=true` ([#752](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/752)). 6–8 (catálogo, saúde das lojas, inteligência de preço, só relatório): branches locais, sobem em 16/10. |
| **Fase 8 — hardening** | Parcial | **Decididos:** merge humano é o gate até o lançamento ([#753](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/753)); domínio canônico **tcgpricehunter.com.br** ([#745](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/745)); backup diário do ramo `data` 01:37 BRT, primeiro em 15/10 ([#744](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/744)). Falta: burn-in de 7 dias. |
| Lote F — performance | Concluído | HTML 509 KB → 29 KB; nenhuma página baixa o `state.json` inteiro. |
| Social Media | Em operação | Telegram e WhatsApp, afiliados, cupom, disclosure. 34 produtos com foto da loja; refazer recorte aguarda revisão do proprietário. |

**Fase atual:** fechamento das Fases 1, 4 e 8 (burn-in e configurações) e Fase 7 em andamento.

**Pendências do proprietário:** Redeploy quando a cota da Vercel reiniciar; redirect 307 → 308 na Vercel; `VIGIA_ISSUES=true`; Search Console com o domínio novo; desligar GitHub Pages; zip das fotos refeitas (run 38719018907). Feito em 15/10: Firebase com o domínio novo, primeiro backup manual.

## Fase 4 — matriz de saída (15/10/2026)

**Fase 4 NÃO concluída.** Critérios de `docs/PLANO-ENTREGA-TURBO.md` × evidência na `main` (`2d9d612`). Testes de banco rodam no job `test` do CI com PostgreSQL descartável (`.github/workflows/ci.yml`); conferidos também localmente em 15/10 (PostgreSQL 16 descartável, `npm test` verde, 220 arquivos).

| Critério | Estado | Evidência |
|---|---|---|
| Isolamento por usuário — PostgreSQL (favoritos, alertas, entregas) | ✅ comprovado | `test/user-isolation-db-tests.js` (8 grupos: A não lê/edita/apaga de B, rollback, cascata), `test/user-alerts-tests.js` (pela função `src/db/user-alerts.js`); [#134](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/commit/0081e8d), issues [#86](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/issues/86), [#458](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/issues/458) |
| Isolamento por usuário — regras Firestore | ✅ comprovado no emulador (CI, branch `ci/firestore-regras-emulador`, PR aberta) | `.github/workflows/firestore-regras.yml` roda `firebase/test/regras-emulador.mjs` com `@firebase/rules-unit-testing` no emulador (projeto `demo-tcgph`): 29/29 casos — dono lê/grava/apaga `users/{uid}`; A não lê/grava/apaga/lista `users/B`; anônimo negado; campo fora da lista e >200 favoritos/>50 alertas negados; subcoleções e outras coleções negadas — e controle negativo (regras sem checagem de dono são reprovadas). [Run verde](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/actions/runs/38741857988). Estático no `npm test`: `test/firestore-regras-emulador-tests.js`, `test/workflow-security-tests.js` (teste 5), `test/firestore-rules-shape-tests.js`. Igualdade console × repositório continua manual (`docs/firestore-regras.md`) |
| Opt-in/out | ⚠️ parcial | Canal global: sem regras = nada enviado e canal não configurado = só painel (`test/alerts-idempotency-tests.js`, `test/alerts-reliability-tests.js`); `price_alert.active` gravado e isolado (`setActive`). **Falta**: não existe envio por usuário — alertas da conta (Firestore `users.alerts` / `price_alert`) não são lidos por nenhum emissor, então opt-in/out por usuário não tem o que desligar. Exige decisão de produto (canal por usuário, consentimento) |
| Cooldown | ✅ comprovado | `test/alerts-idempotency-tests.js` (cooldown, mudança real, reposição, preferências ausentes), `test/alerts-reliability-tests.js`; [#133](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/commit/3695f48) |
| Retry sem duplicação | ✅ comprovado | `test/alerts-reliability-tests.js` (falha total, fila `pending`, reenvio único, expiração 24 h), `test/alerts-timeout-tests.js`, `test/alerts-dedupe-robustez-tests.js`; unicidade de `alert_delivery` em `test/user-isolation-db-tests.js`; [#45 fila](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/commit/0f062d1) |
| "Queda" não dispara por falha de coleta | ✅ peças na `main`; teste ponta a ponta em PR | `test/alerts-drop-best-tests.js` (10), `test/offer-freshness-tests.js`, `test/offer-change-tests.js`. Encadeamento real `staleCopy → offerEvents → evaluate → dispatch`: [PR #726](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/726) (aberta) |
| Alerta explica produto, loja, mudança, timestamp e motivo de comparabilidade | ⏳ em PR | Na `main`: produto, loja, valor/`de → para`, frete e `Lido em` (`test/alerts-reliability-tests.js`, `test/alerts-shipping-tests.js`); **faltavam motivo e base de comparação** → [PR #724](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/724) (aberta) acrescenta `Motivo:` e `Comparação:` com `test/alerts-explicacao-tests.js` |
| Navegação pública sem login | ✅ comprovado (estático) | `test/account-page-tests.js` ("busca e páginas públicas não passam pelo AuthGate"); issue [#49](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/issues/49) |

**Para fechar a Fase 4:** integrar #724 e #726 com CI verde; integrar o teste de regras no emulador Firestore (`firestore-regras.yml`, run verde na branch); decisão sobre envio por usuário (sem ele, opt-in/out e `capPerUser` — `test/alerts-cap-tests.js`, ainda sem uso na rodada — ficam só no canal global).

## Atualização operacional — SEO técnico (13/10/2026, pós-PRs #597 e #598)

- **PR #597 integrada** — `robots.txt` deixa rastreáveis as rotas privadas que enviam `X-Robots-Tag: noindex`; `/api/` continua bloqueado. Merge commit: `acccfa1e3450b96c68e77487950714423dbf0d9f`.
- **PR #598 integrada** — com dados stale/indisponíveis, o sitemap mantém somente a Home indexável; páginas fixas adicionais entram quando os dados estão utilizáveis. Adicionado teste isolado para cenários stale/fresh. Merge commit: `604f1cea333a68dcb311b4ce0172fa4ac5f7bad6`.
- **PR #599 integrada** — ajusta a description da Home para 155 caracteres e atualiza o teste do auditor SEO para o contrato do sitemap stale.
- **PR #600 integrada** — atualiza esta seção de roadmap com os merges #597 e #598; o documento precisava refletir a integração posterior de #599/#600.
- **PR #601 aberta** — corrige a regressão em `test/robots-consistency-tests.js`: a regra antiga exigia uma rota não-API em `Disallow`, em contradição com a decisão SEO de deixar rotas noindex rastreáveis. A CI de #599/#600 falhou precisamente nesse teste.
- **PR #602 aberta** — acrescenta smoke público somente leitura para Home, `robots.txt`, `sitemap.xml` e cabeçalhos noindex, com execução diária/manual. Ainda não existe evidência de sucesso de runtime até o primeiro run passar.
- O deploy de GitHub Pages associado à `main` em `604f1ce` terminou com `build`, `report-build-status` e `deploy` em sucesso (run [38434740204](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/actions/runs/38434740204)). Isso não substitui smoke test do domínio público Vercel.
- O agente SEO & Content permanece **desativado por padrão**, somente leitura. Burn-in continua exigindo sete dias encerrados consecutivos verdes; a amostra visível mais recente ainda não demonstra a conclusão do gate.
## Decisão de escopo — 13/10/2026: limite para automação e início do Social Media

O proprietário declarou estar satisfeito com o nível atual de automação e autorizou mudar o foco sem perseguir hardening indefinidamente.

- **Última rodada limitada de integridade:** priorizar #626 (contrato de oferta legada sem timestamp) e #627 (isolar timestamp inválido no sync), em PRs pequenas e sequenciais conforme dependência. #620 e #625 estão integradas na `main` pelos commits #629 e #630. Se a correção restante exigir migration, alteração destrutiva, acesso externo indisponível ou mais de uma rodada focada de retrabalho, documentar o limite e estacionar; não prolongar a Fase 1 por refinamentos marginais.
- **Gates operacionais em paralelo:** manter #612 (smoke público), #231 (configuração operacional) e #271 (burn-in de sete dias verdes) abertos até haver evidência real. Eles não bloqueiam o desenvolvimento do MVP Social Media em modo de rascunho; continuam bloqueando qualquer alegação de operação 24/7 plenamente validada e podem limitar publicação automática.
- **Social Media autorizado agora — MVP limitado:** iniciar pela ingestão de ofertas já validadas, deduplicação/frescor, calendário editorial e geração de rascunhos com disclosure de afiliados. Primeira entrega deve ser útil sem depender de todas as contas externas: fila de conteúdo + prévia + aprovação humana + trilha de auditoria.
- **Publicação por etapas:** Telegram primeiro após confirmar se o link fornecido é bot/canal e validar permissões; Instagram via API oficial quando a conta for elegível e as credenciais estiverem configuradas; WhatsApp somente após confirmação da integração oficial e convite real do grupo. Não simular WhatsApp Web.
- **Autopublicação não entra no primeiro corte:** só habilitar após piloto controlado, validação dos links de afiliado, checks de dados atuais, deduplicação, limites de frequência, kill switch e logs auditáveis. Nenhuma publicação promocional se preço, estoque, variante ou frescor estiverem incertos.
- **Critério de mudança de foco:** terminar #626/#627 se forem correções localizadas e seguras; se a frente de automação passar a depender de permissões humanas/infra externa ou exigir expansão significativa, congelar melhorias não críticas e dedicar a capacidade de desenvolvimento ao Social Media. O burn-in segue rodando em segundo plano, sem falsificar ou relaxar seus critérios.

## Fase 6 — matriz de saída (15/10/2026)

**Fase 6 NÃO concluída.** Critérios de `docs/PLANO-ENTREGA-TURBO.md` × evidência na `main` (`cc9d140`).

| Critério | Estado | Evidência |
|---|---|---|
| Link abre o destino correto; parâmetros aprovados auditáveis | ✅ site / ⏳ allowlist em PR | Site: `api/_lib/affiliates.mjs` (único leitor de `config/affiliates.json`; só anúncio ML com link próprio troca destino, link usado inteiro), paridade navegador × servidor (`test/affiliate-destination-parity-tests.js`), sem parâmetro anexado (`test/outbound-links-tests.js`), Amazon só `/dp/<ASIN>?tag=` (`test/amazon-links-tests.js`). Allowlist de todos os arquivos de link e link curto `meli.la` que termina fora do ML: [PR #732](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/732) (aberta). Limite: cadeia real do `meli.la` não observada (proxy bloqueia) |
| Disclosure no lugar apropriado, sem ocultar publicidade | ⚠️ parcial | Posts: divulgação sempre que o link é de afiliado, com cupom e no WhatsApp — [#730](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/730) integrada (`test/social-disclosure-tests.js`). Site: rodapé + Termos/FAQ; aviso visível dentro do bloco "Também na Amazon": [PR #736](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/736) (aberta). **Falta** rótulo visível junto do "Ver oferta" e do link geral do rodapé se o afiliado ML do site for ativado (hoje `anuncios` vazio e `geral.ativo=false`) |
| Receita/conversão só com dados legítimos | ✅ (nada é reportado) | Não existe relatório de receita, comissão ou conversão no código. `src/agents/social/metricas.js`: `publicado`/`clique` sem fonte saem `null`, nunca 0 (`test/social-metricas-tests.js`). Relatório real depende de exportação do painel do provedor |
| Ranking não favorece afiliado | ✅ comprovado (site) | `test/affiliate-links-tests.js` (grupo 4: ranking, melhor oferta e score idênticos com e sem afiliado), `test/affiliate-isolation-tests.js` (nenhum módulo de preço/ranking lê config de afiliado), `test/social-elegiveis-tests.js`. Posts sociais: afiliado primeiro na **fila de envio** por decisão do proprietário (`src/agents/social/auto.js`); preço, nota e texto não mudam |
| Cupom só com fonte, termos, validade e atribuição | ✅ código | `src/agents/social/cupons.js` ([#715](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/715)): fonte = exportação "Meus cupons" do proprietário (`config/social-cupons.json`, 22 cupons de 15/10); vencido ou mínimo acima do preço fica fora; texto curto, não promete desconto (aponta para "Meus cupons"); kill switch `SOCIAL_CUPONS=0`. A linha "Cupons… Adiado" acima ficou desatualizada |

**Lojas fora da coleta** (`data/sources.json` do branch `data`, 15/10 00:45 UTC; 65 ACTIVE de 139): 20 BLOCKED por HTTP 403 já no `robots.txt` (ex.: copag.com.br, carrefour, meruru, pichau) e 1 por desafio anti-robô (leitura.com.br); 26 BLOCKED por TIMEOUT no `robots.txt` a partir do GitHub Actions; 7 já retiradas em `config/lojas/removidas.txt` (6 DNS, 1 TLS) mas ainda listadas no `sources.json`; 2 ERROR "plataforma não reconhecida" (kalunga, ggtcg); 2 PAUSED por bloquearem robôs (Liga Pokémon, MYP Cards — `enabled:false`); 10 UNAVAILABLE (marketplaces sem API pública: Amazon, Shopee, Magalu, Americanas, Extra, Ponto Frio; ML entra pela API); 6 PENDING sem domínio confirmado, já removidas de `config/stores.json` em 12/10 (entradas antigas no `sources.json`). Nenhuma foi ativada nem teve bloqueio contornado.

**Para fechar a Fase 6:** integrar #732 e #736; decisão do proprietário sobre o rótulo visível do afiliado ML no site antes de ativá-lo; limpar do `sources.json` as entradas já retiradas (não muda coleta).

## Fase 8 — matriz de saída (15/10/2026)

**Fase 8 NÃO concluída.** Critérios de `docs/PLANO-ENTREGA-TURBO.md` × evidência na `main` (`cc9d140`). Issues citadas: #80, #81, #87, #92, #96, #105, #108, #114, #117, #118 já estavam fechadas (13/10); [#94](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/issues/94) fechada hoje com a evidência da [#718](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/718).

| Critério | Estado | Evidência |
|---|---|---|
| Checks CI/regression/golden verdes | ✅ por PR | `ci.yml` só roda em PR (sem CI em push na `main`); as PRs integradas em 15/10 (#718, #723–#730) e as da Fase 8 (#731, #735, #738) têm `test`, `regression`, `golden`, `qa-review` verdes |
| Zero vulnerabilidade crítica sem mitigação | ✅ | [#718](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/718): `npm audit` 0 (reconferido hoje); `test/supply-chain-tests.js`; limite: transitivas do Baileys/rembg sem lockfile, mitigadas por versão fixa e `--ignore-scripts` |
| API com limites/timeout | ✅ | `api/v1.mjs`: `DEADLINE_MS` 12 s (< `maxDuration` 15 s), teto de OFFSET 10 000, `limite` ≤ 50/60, 405 fora de GET/HEAD; #114 fechada |
| Backup restaurado em ambiente de teste; runbook seguível | ⏳ em PR | [PR #738](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/738): ensaio com o retrato real do ramo `data` (remoto git local + PostgreSQL descartável) → restauração idêntica e `VALIDAÇÃO OK`; achou o `db-stats` faltando no runbook (corrigido + teste). Backup diário de `data/` ligado por decisão do proprietário (15/10): `schedule` 04:37 UTC em `backup-data.yml`, retenção 14 dias / mínimo 3 etiquetas, poda restrita a `data-backup/AAAA-MM-DD` (`test/backup-schedule-tests.js`) — ⏳ PR `ops/backup-diario`. **Limite:** nenhuma etiqueta `data-backup/*` existe no GitHub até a primeira execução depois do merge; banco Supabase sem backup próprio (decisão pendente) |
| Smoke pós-deploy: busca, detalhe, API/dados, links | ⏳ em PR | [PR #731](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/731): `tools/post-deploy-smoke.mjs` no `seo-public-smoke.yml` (busca, `/produto/:slug`, `/api/v1/home`, `/api/v1/site/pagina/*`, links internos, `/assets/web` imutável). Conferência manual em produção (GET, 13:20 UTC) ok. Runtime do passo só depois do merge. Conta/alerta: fora (rotas privadas são casca + noindex, já cobertas pelo smoke SEO) |
| Rodada 24/7 de 7 dias | ⏳ em andamento | [#271](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/issues/271) (burn-in; não alterado) |
| Sem deploy automático baseado só no merge | ❌ | Integração Git da Vercel publica cada merge na `main` em produção (deployments com o SHA de cada merge). Ponte com gates (`tools/release-run.mjs deploy`) existe, mas sem `VERCEL_TOKEN`/sink (#231, #221). **Decisão do proprietário** — opções em `docs/producao-canonica.md` |
| Fonte canônica de produção documentada | ⏳ em PR | [PR #735](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/735): `docs/producao-canonica.md` + teste estático. Vercel é canônico; GitHub Pages é legado (recomendação: desativar). **Achado:** `tcg-price-hunter.vercel.app` faz 307 → `tcgpricehunter.com.br`, mas o código declara o `vercel.app` como canonical |

**Decisões do proprietário:** (1) política de deploy (desligar deploy da `main` na Vercel e usar a Ponte, ou formalizar o merge como gate); (2) domínio canônico (`tcgpricehunter.com.br` × `vercel.app`, e 307 → 308); (3) desativar o GitHub Pages; (4) ~~ligar o backup diário de `data/`~~ decidido em 15/10 (`schedule` diário, PR `ops/backup-diario`); falta decidir o backup do banco.



## Fase 5 — matriz de saída (15/10/2026)

**Fase 5 NÃO concluída** (critério 2 depende de decisão do proprietário). Critérios de `docs/PLANO-ENTREGA-TURBO.md` × evidência na `main` (`cc9d140`) e PRs abertas. Issues #44, #46 e #113 já estavam fechadas (13/10, via [#121](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/121), [#162](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/162), [#155](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/155), todas integradas).

| Critério / item | Estado | Evidência |
|---|---|---|
| Score reproduzível para a mesma entrada | ✅ na `main`; matriz em PR | `src/core/opportunity-engine.js` puro (`now` injetado, `engine_version`); `test/opportunity-engine-tests.js` (cenário 12: empate por id e `deepEqual`), `test/price-engine-tests.js` (mesma entrada em qualquer ordem). Matriz de 840 combinações, entrada congelada, permutações e ponta a ponta: [PR #734](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/734) |
| Score explicável por campos | ✅ na `main`; recomposição em PR | `*_signal`, `raw_score`, `coverage`, `caps`, `reference_kind/value/gap`, `total_cost/cost_basis`, `evidence`, `reasons/warnings` com código (#121 em `test/opportunity-engine-tests.js`; `test/opportunity-criteria-tests.js`, `test/opportunity-reference-tests.js`). Nota recomposta só pelos campos gravados e cada sinal ausente/trava com código: [PR #734](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/734) |
| Fonte não oficial não aparece como Copag confirmada — banco e motores | ✅ na `main`; reforço em PR | CHECK `reference_price_copag_domain_check` (migration 006, `test/reference-evidence-db-tests.js`, `test/reference-db-tests.js`); robô/mapper → `COMMUNITY_REFERENCE` (`test/reference-tests.js`); política 6A (`test/reference-policy-tests.js`). [PR #737](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/737) alinha `isCopagUrl` à regra do banco (ftp:/javascript:, porta, usuário eram aceitos no JS e recusados no banco, abortando o INSERT em lote do sync) |
| Fonte não oficial não aparece como Copag confirmada — site | ⛔ decisão do proprietário | 12 entradas `c30-*` em `config/catalog.json` (fonte Instagram, `OFICIAL`, `manual: true`) aparecem como "Copag confirmada" (`copagStatus`; `api/_lib/read-db.mjs` mantém paridade). No motor já são comunitárias e não entram no score. É a decisão da [PR #186](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/186) (fechada sem merge em 12/10, decisão não registrada) |
| Migrations/lotes não executados por agente sem gates | ✅ comprovado | `db/migrations/**` e `config/catalog.json` são R3 (`test/agents-release-governor-tests.js`); `db.migrate.production` exige aprovação da própria ação (`test/agents-governance-tests.js`); `tarefas.yml` só tem banco descartável (`test/tarefas-workflow-tests.js`); `test/migrations-static-tests.js`. Migration só roda em produção após merge humano (`hunter.yml`) |
| Integridade read-only banco × arquivos (#113) | ⏳ em PR | Detecção por fixtures na `main` (`test/integrity-db-tests.js`, `docs/integridade-referencial.md`). Relatório somente leitura (READ ONLY + ROLLBACK) com reconciliação: [PR #741](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/741). Não executado contra produção |
| Histórico/referência oficial (#46) | ✅ na `main` | #162 (`test/history-quality-tests.js`), `test/copag-vencimento-tests.js` |
| Price Intelligence Agent | ⏸ não iniciado | Ativação pertence à Fase 7 (item 8), com pré-requisito de histórico/comparabilidade confiáveis |
| PR #20 (migration Copag) | — | Fechada sem merge em 12/10; permanece **não integrar** |

**Para fechar a Fase 5:** decisão do proprietário sobre as 12 referências do Instagram (PR #186) e a apresentação no site; integrar #734, #737 (R3: referência) e #741 com CI verde; rodar o relatório de integridade em produção só com autorização.

## Fase 7 — agentes 1–5 (15/10/2026)

Estado observado na `main` (`b445c6d`) e no Actions. "Ativo" só com execução real comprovada.

| Agente | Estado | Evidência | Falta para ativo com segurança |
|---|---|---|---|
| 1. Planner / Backlog Steward | **não existe** | Nenhum código ou workflow. A ordem vem de `Ordem:`/`Depende de:` nas issues (lidos pelo Dispatcher) e de `tools/fila-relatorio.mjs` (só leitura) | Agente só leitura que proponha fatias, ordem e dependências por comentário/issue, sem aplicar `tarefa:aprovada`. Não iniciado: a fila está vazia e a aprovação continua humana |
| 2. Dispatcher | **ativo** | Job `despacho` roda após cada Vigia (run [38759736656](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/actions/runs/38759736656), 15/10 15:22 UTC, sucesso) ⇒ `DISPATCHER_ATIVO=true` já vigora desde 12/10 (#231). Despachos reais: #619 (13/10), #656–#668 (14/10, telemetria por execução). `DISPATCHER_ORCAMENTO_USD=100` confirmado no run #157. Janela vazia = 24 h por padrão (`budgetConfig`). Fila hoje: nenhuma issue `tarefa:aprovada` aberta | Teto por contagem independente do custo reportado: [PR #750](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/750). Idempotência (`dispatch:N:T`), quarentena, backoff, rate limit e pré-aprovação por operador (evento de label) já testados (`test/dispatcher-*.js`) |
| 3. QA / PR Reviewer (`qa-review`) | **ativo** | `revisor.yml` roda em toda PR (runs de 15/10 com sucesso). `qa-review` é check obrigatório da `main` junto com `test`, `regression`, `golden` (API de proteção, 15/10) | — (métrica de precisão/retrabalho ainda não medida) |
| 4. Release Governor + Executor Bridge | **existe, desligado** | `src/agents/release-governor.js`, `release-executor-bridge.js`, `tools/release-run.mjs` com testes. Nenhum workflow invoca a Ponte; merge e deploy não são automáticos | `RELEASE_AUDIT_*`, `VERCEL_TOKEN`, deploy da Vercel fora do merge. **Adiado por decisão do proprietário** (abaixo) |
| 5. SRE / Operations (Vigia) | **ativo (avisos); diagnóstico em issue em PR** | `watchdog.yml` a cada 15 min por `workflow_dispatch` (ex.: run [38759689297](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/actions/runs/38759689297)). Já detecta: dados parados, robô sem disparo, rodadas falhando, sync do banco atrasado, banco inacessível, leitor oficial, fonte vigiada e motor parado. Avisa no Telegram/ntfy | Deploy de produção falho/preso, só leitura: [PR #751](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/751). Issue de incidente idempotente com diagnóstico, atrás de `VIGIA_ISSUES`: [PR #752](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/752). Fila travada do Dispatcher e falhas por loja além da fonte vigiada: não cobertos |

**Decisão do proprietário (15/10/2026) — gate de publicação:** até o lançamento, o **merge humano na `main` é o gate de publicação**: a integração Git da Vercel publica cada merge. A Release Executor Bridge com `VERCEL_TOKEN` fica para depois do lançamento. Enquanto isso:
- nenhum agente faz merge;
- o Release Governor só avalia (`release-run.mjs --avaliar`);
- o critério da Fase 8 "sem deploy automático baseado só no merge" fica aceito como risco conhecido até a Ponte entrar.

**Ordem para o proprietário:**
1. Revisar e integrar #750, #751 e #752 (R3: workflow), nesta ordem.
2. Opcional: fixar `DISPATCHER_ORCAMENTO_JANELA_H=24`, que já é o efeito padrão, e `DISPATCHER_MAX_DESPACHOS_JANELA` se quiser outro teto que não 60.
3. Depois da #752: `VIGIA_ISSUES=true`.
4. Só então aprovar issues com `tarefa:aprovada`.

`DISPATCHER_ATIVO` já está ligado.

## Fase 7 — agentes 6–8 (15/10/2026)

Os três em modo **só proposta/relatório**: módulo puro + CLI (Markdown/JSON) + testes sintéticos + workflow manual opcional (`workflow_dispatch`, `contents: read`, sem secrets, job desligado por variável). Nenhum grava dados, catálogo, fila, ranking, preço ou score. **Integrados em 16/10/2026:** #765, #766 e #767 mesclados na `main`; os workflows seguem desligados por variável. Números abaixo: CLI rodada localmente sobre o ramo `data` em `8e89693` (rodada de 15/10 16:30 UTC); não é execução em produção.

| Agente | Branch / commit | Produz | Reusa | Variável (desligada) |
|---|---|---|---|---|
| 6. Catalog | `fase7/catalog-agent` `d20ad64` | `tools/agente-catalogo.mjs`: duplicata de produto, coleção fora do catálogo, EAN observado em anúncios, EAN divergente, mesmo EAN em produtos diferentes, contagem de boosters divergente, oferta duplicada, mesma URL em produtos diferentes, revisão de matching. Tudo `needs_review`, conflito nunca resolvido. Amostra: 102 propostas (7 duplicatas `ev09`×`sv9`, 48 EAN, 8 EAN em 2 produtos — ex.: Copag com o mesmo EAN em ETB ME04 e ME05) | `duplicates.js`, `offer-key.js`, `matching-review.js`, `golden-eval.js` | `AGENTE_CATALOGO` |
| 7. Marketplace Health | `fase7/marketplace-health-agent` `4917c16` | `tools/agente-saude-lojas.mjs`: saúde por plataforma e motivo de falha, frescor, cobertura, tendência de `ops.runs` e propostas de uma lista fechada de ações. Nunca propõe UA/proxy/CAPTCHA/ignorar robots/contornar login/reativar. Amostra: 122 lojas, 61 ativas frescas; 62 propostas (21 Cloudflare → pausar/pedir liberação, 26 timeout persistente, 6 lojas JSON-LD com adaptador VTEX/Shopify disponível, 3 lentas em ≥ 90% das rodadas) | `tools/coleta-relatorio.mjs` (waf), `ops.runs` de `opstate.js` | `AGENTE_SAUDE_LOJAS` |
| 8. Price Intelligence | `fase7/price-intel-agent` `490cac7` | `tools/agente-preco.mjs`: menor preço do dia × mediana de 7 dias, causa provável (preço na loja × composição), persistente × pontual, anomalia (MAD), ressalvas Pix/frete/estoque e incerteza; abstém-se com amostra curta/defasada. Não define preço oficial, referência, score, oportunidade nem alerta. Amostra: 142 produtos, 30 abstenções, 30 variações ≥ 5% (18 por composição), 3 anomalias | `history.js` (`cleanPoints`), `distrust.js`, `price-engine.js` | `AGENTE_INTELIGENCIA_PRECO` |

**Pré-requisitos do plano (medidos pelos próprios relatórios):**

| Agente | Pré-requisito | Estado |
|---|---|---|
| Catalog | matching/golden estáveis | **parcial**: golden 31/31 ok, mas só sintético; precisão real não medida |
| Catalog | contrato de evidência / fila de revisão | atendido / parcial (sem tela própria) |
| Catalog | autorização de IA | não atendido (o agente é determinístico) |
| Marketplace | contratos de adaptadores | atendido (`adapter-contract-tests`) |
| Marketplace | rate limits estáveis | **parcial**: backoff e Retry-After no código; VTEX 429 a IP de nuvem no frete (#84) |
| Marketplace | telemetria por loja / histórico de rodadas | atendido (49/49 falhas com classe; 96 rodadas) |
| Price Intel | histórico suficiente | **parcial**: mediana de 6 dias por produto (30 para variação de 30 dias) |
| Price Intel | histórico confiável / comparabilidade | parcial / **não atendido**: ponto do histórico é só `[dia, total]`, sem Pix × normal nem com/sem frete |
| Price Intel | golden temporais | não atendido (nenhum caso temporal em `test/golden/cases.json`) |

**Limitações:** EAN "de 2 lojas" pode vir do mesmo grupo (Ri Happy/PB Kids); `lenta_recorrente` usa só o top 3 por rodada; causa de preço é inferência sobre o menor total diário. Nenhum agente vira ativo sem: integrar as PRs, ligar a variável, rodar o workflow e registrar o run.

**Ordem para o proprietário:** subir as três branches (R3 por trazerem workflow) → revisar → ligar uma variável por vez e rodar manualmente. Promover qualquer um a gravar na fila (`review_item`) é outra PR, com autorização.

## Regras de operação

- Não fazer merge de PRs de produto, deploy, migration, nem alterar secrets/configuração de produção sem autorização explícita.
- Não marcar tarefa concluída apenas por label. Exigir diff versionado, testes apropriados e evidência verificável (CI/log/execução).
- Não presumir que o executor local `~/pph-executor` está sincronizado só porque `master` remoto está atualizado.
- Preferir trabalho remoto que não dependa do computador do usuário. Não inventar evidência de runtime.
- Manter branches/PRs pequenas e baseadas na `main` atual; evitar integrar branches empilhadas com conflitos.
- Não ligar `SHIPPING_CALC_ENABLED` sem validação real de cotação e autorização separada.

## Mapa de agentes

Detalhamento completo das responsabilidades, limites, dependências, status de implementação e critérios de ativação: [docs/MAPA-DE-AGENTES.md](./MAPA-DE-AGENTES.md). O inventário separa o que já está implementado do que ainda é futuro. Por decisão de escopo de 13/10/2026, o MVP de Social Media está autorizado em paralelo e com publicação inicialmente controlada; UX Research, UI & Design System, Growth & CRO e Brand & Creative continuam futuras e bloqueadas por dependências. SEO & Content permanece limitado ao MVP de auditoria somente leitura até satisfazer seu gate de prontidão.

## Contrato de autonomia e comunicação

- **Executor:** Claude Code conduz o desenvolvimento ponta a ponta. Não pede permissão para commits, branches, PRs, resolver CI ou continuar trabalho seguro. Merge/deploy são automáticos para R0/R1 e R2 quando Release Governor, permissões técnicas, CI, auditoria e smoke aplicáveis aprovarem.
- **Fronteira:** `tarefas.yml` continua branch + PR. Não conferir ao worker poderes novos para merge/deploy; usar Release Executor Bridge/Governor. R3 e R-STOP continuam a exigir intervenção do proprietário e não podem ser contornados.
- **Relatórios:** atualizar este arquivo somente com evidências reais, inclusive ao final de cada fase. O relatório de fase inclui critérios de saída, PRs/commits, CI, merges/deploys/smoke, métricas disponíveis, estabilidade, pendências e fase seguinte.
- **Canal do usuário:** o monitor do ChatGPT deve apresentar os relatórios quando uma fase completar seus critérios e notificar antes quando existir ação crítica realmente não aprovável automaticamente. Sem atualizações repetitivas a cada PR; não confundir a verificação horária do monitor com alerta instantâneo.
- **Bloqueio:** registrar no GitHub evidência, impacto, recomendação e uma única decisão necessária. Continuar tarefas independentes e seguras enquanto o bloqueio persistir.


## Atualização operacional — 12/10/2026 (pós-PRs #252 e #250)

### Evidências confirmadas
- PR [#252](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/252) integrada: `claude_despacho` permite explicitamente `github-actions` e o teste de contrato restringe a exceção à etapa de despacho; sem wildcard e sem alteração do caminho acionado por `issues`.
- PR [#250](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/250) integrada: `.github/workflows/dispatcher.yml` contém `workflow_run` para iniciar o Dispatcher após o workflow “Vigia do robô” concluído na `main`, além do cron e do acionamento manual.
- O run [Dispatcher #5](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/actions/runs/38225705913) terminou com sucesso antes do merge da #250, mas a #247 ficou em backoff até `2026-10-12T08:59:02Z` (05:59, horário de Brasília). Esse run não comprova o novo gatilho pós-merge nem a execução bem-sucedida da Claude Code Action.
- A última execução observada de “Vigia do robô” antes do merge da #250 foi [run #38226234736](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/actions/runs/38226234736), às 08:52 UTC. É anterior ao merge; portanto, ainda falta evidência de um evento `workflow_run` pós-merge.

### Próximas verificações obrigatórias
1. Capturar uma execução de “Vigia do robô” concluída na `main` depois do merge da #250 e confirmar que ela inicia automaticamente o Dispatcher.
2. No Dispatcher, confirmar o job `despacho` (não apenas `plano`) e verificar se a #247 foi despachada após o backoff, sem duplicar a chave nem remover labels manualmente.
3. No workflow `Tarefas`, verificar que a Claude Code Action executa sem a recusa de ator não humano e que o agente abre a PR documental esperada.
4. Registrar run IDs, commit, logs, PR e CI. Não declarar autonomia ponta a ponta concluída antes dessas evidências.

### Estado executivo atualizado
- Gatilho de workflow: implementado na `main`; validação automática pós-merge pendente.
- Despacho: o Dispatcher #5 executou com sucesso, mas respeitou o backoff da #247; o despacho posterior ao prazo ainda precisa ser comprovado.
- Claude Code: a allowlist restrita foi integrada; execução bem-sucedida após a correção ainda não comprovada.
- Gate de segurança: não usar bypass de branch protection, não usar `allowed_bots: "*"` e não manipular manualmente a chave/labels para contornar backoff.


## Validação em runtime — 12/10/2026, 09:06–09:45 UTC

Esta seção responde às "Próximas verificações obrigatórias" acima. Evidências lidas da API do GitHub; os horários estão em UTC.

| Etapa | Resultado | Evidência |
|---|---|---|
| Vigia na `main` depois do merge da #250 → Dispatcher automático | ✅ **comprovado** | Vigia `38227708569` concluído às 09:06:23 → Dispatcher por `workflow_run` [38227741030](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/actions/runs/38227741030) às 09:06:25. Repetiu às 09:22 (Vigia → Dispatcher → despacho de #257). |
| Job `despacho` real e backoff | ✅ **comprovado** | #247 tentativa 1 às 08:29:02; tentativa 2 só às 09:06:38, depois dos 30 min. Chave `dispatch:247:2`, sem repetição. |
| Worker pelo caminho `workflow_dispatch`, Claude Code Action sem recusa de ator (#252) | ✅ **comprovado** | Issue #257 → worker [38229495517](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/actions/runs/38229495517): `Validar despacho` ✅, `claude_despacho` ✅, issue marcada `executor:done`. |
| PR criada pelo agente | ✅ **comprovado** | PR **#258** aberta pelo `claude[bot]` na branch `tarefa/issue-257-t1`, commit com assinatura verificada, só o arquivo pedido, com `Closes #257`. CI `test`/`regression`/`golden` ✅. |
| Revisão independente da PR do agente | ✅ **comprovado depois da correção** | Primeiro `qa-review` da #258 recusado pela action ("non-human actor: claude"), com veredito fail-closed. Corrigido pela **#261** (integrada; a #259 ficou redundante). Depois de atualizar a branch da #258, o `qa-review` revisou a PR e **aprovou sem bloqueantes** (09:50 UTC). |
| Governor sobre a PR do agente | ⚠️ **defeito** | A `main` dava `R0 · autonomous` para a #258 com `qa-review` ❌. Correção: **#260** (exige `qa-review` no mesmo SHA). |
| #247 | ⚠️ **quarentena indevida** | O ciclo das 09:07:23 viu a tentativa 2 (em curso) como concluída, por causa do label `executor:failed` da tentativa 1, e aplicou quarentena. O worker recusou a tentativa 2. Correção: **#256** (lease pela tentativa atual; reinício só por operador). O label **não** foi removido manualmente. |
| #255 | ℹ️ **sem defeito** | Tarefa de relatório pelo caminho de label: o Claude terminou com sucesso sem PR, e o worker marcou `executor:failed` por desenho (só conta como entregue com PR). |

**Testes:**
- **Local:** `npm test` passou nas branches #256, #259 e #260. A única falha é o teste de busca sem acento, que falha só no ambiente local e passa na CI.
- **CI:** `test`, `regression` e `golden` passaram nas três; `qa-review` passou na #256 e na #259.
- **Regressão da #256:** o teste reproduz o incidente com os horários reais e falha na `main` anterior.

**Pendências com causa concreta:**
- Merges R3 (aprovação humana obrigatória): #256, #260, #254 (ou esta PR, que a inclui), #248 e #221. A #259 é redundante com a #261.
- **#247:** só um operador pode tirar `executor:quarentena`. Depois da #256, isso abre uma nova tentativa (`dispatch:247:3`).
- **Proteção da `main`:** tornar `qa-review` check obrigatório. A aprovação humana obrigatória impede merge autônomo, inclusive R0 (#231, item 8).
- **Ponte (#221):** o sink de auditoria e o `VERCEL_TOKEN` não estão definidos. Merge e deploy governados continuam inoperantes.
- **Rotina agendada do Claude Code:** não criada.

**Próxima prioridade objetiva:** integrar a #260 e a #256. A #258 já tem os 4 checks ✅ e o Governor, pela política da #260, dá `R0 · autonomous`, mas o merge depende da aprovação obrigatória e da Ponte (#221). Depois, a Ponte (#221), após a decisão do sink de auditoria.

## Relatório de desenvolvimento — 12/10/2026 (fechamento da rodada de agentes)

Esta seção atualiza as pendências da seção anterior. O fluxo Vigia → Dispatcher → worker → PR do agente → `qa-review` → Release Governor foi comprovado ponta a ponta em runtime (ver tabela acima). Isso não inclui merge/deploy autônomo: a aprovação obrigatória e a Ponte ainda bloqueiam essa parte.

### Entregas integradas na `main`

| Área | PRs | Resultado |
|---|---|---|
| Dispatcher | #240, #243, #250, #251, #256 | Plano read-only; disparo real com revalidação no worker; gatilho `workflow_run` após o Vigia (o cron não disparava); lease pela tentativa atual; reinício de quarentena só por operador. |
| Worker (`tarefas.yml`) | #241, #252, #246, #248 | `GH_TOKEN` só nos passos com `gh`; despacho por `workflow_dispatch` aceito pela action; esforço adaptativo ligado (classe → modelo/esforço, escalada só com falha). |
| Revisor independente | #244, #261 | Check `qa-review` fail-closed; também revisa PRs abertas pelo `claude[bot]`. |
| Release Governor | #260 | Exige `qa-review` aprovado no mesmo SHA para qualquer merge. |
| Release Executor Bridge | #221 | Integrada; inoperante até o sink de auditoria e o `VERCEL_TOKEN` estarem definidos. |
| Smoke e docs | #249, #258, #262 | Evidência do primeiro despacho (`docs/smoke/despacho-2026-10-12.md`, PR do agente) e docs de governança atualizados. |

### Defeitos encontrados em runtime e corrigidos

| Defeito | Causa | Correção |
|---|---|---|
| Dispatcher nunca executava | O cron não dispara neste repositório | #250 |
| Worker recusado pela action | Ator `github-actions` fora da allowlist | #252 |
| Quarentena indevida da #247 | Um label antigo `executor:failed` mascarava a tentativa em curso | #256 |
| `qa-review` falhava em PR do agente | Ator `claude` fora da allowlist | #261 |
| Governor liberava merge com `qa-review` ❌ | Check não exigido | #260 |
| `npm test` quebrado na `main` depois de integrar #221 + #260 | Os fixtures da Ponte não tinham `qa-review` (conflito semântico, sem conflito de texto) | Esta PR: fixtures atualizados e novo teste garantindo que a Ponte não faz merge sem `qa-review` no SHA |

### Limpeza
- PRs #254 e #259 fechadas sem merge: o conteúdo já estava na `main` via #262 e #261.
- Issue #247 fechada como concluída: o objetivo foi atendido pela #257/#258.

### Pendências humanas (registradas na #231)
1. Tornar `qa-review` check obrigatório na proteção da `main`.
2. Decidir a regra de aprovação obrigatória, que hoje impede o merge autônomo inclusive em R0.
3. Ponte (#221): definir o sink de auditoria e configurar o `VERCEL_TOKEN`.
4. Criar a rotina horária pela interface (`rotina-horaria-prompt.md`); a criação pela sessão foi bloqueada pelo ambiente.

### Fora do fluxo, por decisão
- #20: não integrar.
- #186: decisão comercial.
- #195: frete atrás de `SHIPPING_CALC_ENABLED`, desligado.
- #239: docs, revisar se continua necessária após a #262.

### Próximo passo técnico
Telemetria real do worker: implementada (ver item 1 das lacunas abaixo), com validação em runtime pendente.

## Atualização — 12/10/2026, tarde (modo turbo)

- **Concorrência:** `TAREFAS_MAX=10` configurado pelo proprietário em Actions Variables. A comprovação em runtime (mais de 3 tarefas simultâneas) vem com a próxima leva.
- **Fila de PRs limpa pelo proprietário:**
  - integradas: #267 (sink GitHub da Ponte, ainda não ativo), #269, #270 (burn-in), #272, #275 e #276;
  - **fechadas sem merge:** #186 (política Copag) e #195 (frete por CEP), por decisão do proprietário, e #239 (superada).
  - A issue #84 (frete) segue aberta. `SHIPPING_CALC_ENABLED` continua desligada.
- **Fábrica produzindo trabalho de produto:**
  - os inventários #273/#276 (estados da UI) e #274/#275 (acessibilidade) viraram tarefas;
  - leva 1: #277–#281, que geraram as PRs #282–#284 com 4 checks verdes, a US$ 0,13–0,18 cada (sonnet/medium).
- **Burn-in:** a issue #271 recebe o veredito diário. 11/10 foi verde. 12/10 está vermelho por 2 falhas do Dispatcher pela manhã, durante as correções.
- **Gargalo atual:** merge humano por PR. A Ponte autônoma depende de: `qa-review` obrigatório na `main`, `RELEASE_AUDIT_*` configurados para a #267 e `VERCEL_TOKEN`.

## Estado consolidado — 12/10/2026, fim da tarde

**Fila zerada:** nenhuma PR aberta e nenhuma tarefa aprovada pendente. Tudo abaixo está integrado na `main` (`612a6e1`).

**Fábrica de agentes (operando):**
- Ciclo Vigia → Dispatcher → worker → PR → `qa-review` → Governor, comprovado em runtime.
- 10 vagas (`TAREFAS_MAX=10`). Comprovado com 6 agentes simultâneos (#290–#295).
- Telemetria por execução (#264) e orçamento no Dispatcher (#265). Classificador de esforço corrigido (#272): docs saem sonnet/low.
- Burn-in automático (#270, issue #271). Sequência verde 1/7: 11/10 verde, 12/10 vermelho pelas falhas da manhã.
- Suíte por descoberta automática (#304): teste novo é só criar `test/*-tests.js`, sem editar o `package.json`.
- `index.html` é a fonte da interface (#302); o template antigo está defasado e travado.
- Sink de auditoria GitHub da Ponte (#267): integrado, ainda não ativo.
- Custo medido: US$ 0,13–0,31 por tarefa (custo reportado a preço de API).

**Entregas de produto via agentes:**
- testes de carga/retry e fallback (#282, #283);
- duplo envio em alertas e favoritos (#286);
- foco no título ao trocar de página (#284);
- vazios anunciados e focusErr (#287).

**Entregas de produto do proprietário:**
- UX lote A (#288): nota única, CTA único, tipografia, alvos e contraste no celular.
- UX lote B (#305): card compacto em /oportunidades; busca com paginação, ordenação e filtro de tipo.
- SEO lote C + produto lote D (#303): fallbacks SSR, /precos, rotas, descriptions, sitemap, lowPrice.
- SEO lote E (#306): guia SSR com FAQ, /tipo/blister e glossário.
- Backlog futuro de UX/UI/SEO (#285).

**Auditorias integradas (base da próxima leva):** `docs/estados-ui.md`, `docs/acessibilidade-dinamica.md` e `docs/auditorias/` com coletores, matching, api, alertas, seguranca e motor. Cada uma propõe de 3 a 6 tarefas.

**Decisões do proprietário:** #186 (Copag) e #195 (frete) fechadas sem merge. #84 segue aberta e a flag de frete continua desligada.

**Pendências humanas:**
1. `qa-review` obrigatório na proteção da `main` (hoje são exigidas 0 aprovações).
2. Ativar a auditoria da Ponte: `RELEASE_AUDIT_SINK/ISSUE/ACTOR`.
3. `VERCEL_TOKEN`.
4. `DISPATCHER_ORCAMENTO_USD`.
5. Teste de aviso do Vigia (#238).
6. Rotina horária pela interface.

**Próximo passo técnico:** leva 3, com cerca de 10 tarefas tiradas das auditorias, em áreas distintas.

## Fechamento da Fase 2 (dados e backend) — 13/10/2026

**Critério:** lacunas de backend apontadas pelas auditorias atacadas por tarefas pequenas, com testes e PR integrada. **Status: concluída.**

- **Auditorias (21, em `docs/auditorias/` e `docs/estados-ui.md`/`acessibilidade-dinamica.md`):** coletores, adaptadores, matching, matching-novos, API, alertas, alertas-usuario, segurança, motor, motor-oportunidades, frescor-sync, desempenho, cobertura-lojas, dados-historico, banco-migrations, backup-recuperacao, afiliados, contas-firebase, paginas-servidor, agentes-fabrica, agentes-produto, cabecalhos-http, pistas-telegram, observabilidade, rodada-robo.
- **Execução:** cerca de 120 PRs de agentes integradas entre 12 e 13/10 (levas 1 a 19), a US$ 0,10–0,50 cada (custo reportado). Os testes da suíte passaram de 78 para mais de 150 arquivos.
- **Melhorias da fábrica no período:** recusa por capacidade não gasta tentativa (#321), rajada limitada a 4 por ciclo, suíte por descoberta automática (#304), `index.html` como fonte da UI (#302) e burn-in automático (#270).
- **Restos (não bloqueiam):**
  - #548: retry automático.
  - #453: em quarentena, reescopada na #577 com autorização do proprietário para ajustar o `golden` só em `caps`/`explain`.
- **Aprovadas em 13/10 e em execução:** HSTS + Permissions-Policy (#578), gravação de `alerts-sent.json` logo após o envio (#579) e dedupe de pistas entre fontes (#580).
- **Fora da fase, aguardando decisão:** tabela de preferências de notificação (migration).

**Fábrica 24/7, ainda em aberto:**
- burn-in em 0/7, reiniciado em 13/10 (#271);
- pendências do proprietário: `qa-review` obrigatório, auditoria da Ponte (`RELEASE_AUDIT_*`), `VERCEL_TOKEN`, rotina horária e `DISPATCHER_ORCAMENTO_USD`;
- 53 issues antigas já entregues aguardam fechamento manual.

**Próxima fase:** Fase 3 iniciada pela frente SEO & Content Agent (PR #595), em modo de auditoria somente leitura. O gate segue bloqueado; não declarar agente ativo nem conteúdo publicado. O backlog de UX/UI/SEO continua na #285.

## Estado executivo

### Meta de operação 24/7 — lacunas para fechar
**Coleta periódica e watchdog estão codificados; desenvolvimento autônomo de ponta a ponta ainda precisa do Planner/Dispatcher.** O plano completo está em [PLANO-ENTREGA-TURBO.md](./PLANO-ENTREGA-TURBO.md).

- Hunter `hunter.yml`: cron a cada 15 min, mínimo entre rodadas de 8 min por padrão e descoberta/Copag diária. Schedule do GitHub é best-effort; verificar cron-job.org e a saúde real dos dados para comprovar continuidade.
- Vigia `watchdog.yml`: cron de fallback a cada 30 min e configuração documentada para disparo externo a cada 15 min. A existência do workflow não prova que o cron externo está ativo: verificar runs `workflow_dispatch`, teste de notificação e recuperação.
- Executor Claude: já foi validado em smoke real (#225 → PR #228 → CI verde), mas ainda depende de issue/label; não existe ainda Dispatcher de backlog comprovado que selecione e envie tarefas elegíveis sem ação por tarefa.
- Concorrência: workflow suporta 1–10, padrão 3. Confirmar `TAREFAS_MAX=10` em Actions Variables antes de anunciar 10 workers ativos. Realizar teste gradual antes de manter 10 em uso contínuo.
- Release: manter separação dos workers de implementação e do Release Governor. Nenhum worker de tarefa ganha permissão de merge/deploy; release bridge precisa de configuração, CI, gates e smoke real comprovados.
- Decisões R3/bloqueios acionáveis devem ser registrados com evidência e recomendação; aviso ao usuário por meio do monitor de projeto do ChatGPT já configurado. Telegram/ntfy seguem para incidentes operacionais, não como substituto da aprovação de decisão.


### Gestão adaptativa de esforço e consumo Claude — prioridade Fase 0
**Objetivo:** manter a fábrica progredindo sem desperdiçar tokens ou esgotar a cota com sessões desnecessárias.

- Classificar tarefas de forma determinística usando tipo, risco, escopo, dependências e falhas anteriores; não chamar um modelo separado para tarefas simples só para escolher esforço.
- Ajustar esforço por sessão/tarefa com os parâmetros oficialmente suportados pelo modelo/runtime real. Início orientativo: Low (mecânico/documentação), Medium (desenvolvimento comum), High (depuração/arquitetura), nível máximo suportado somente em exceções justificadas. Não reduzir análise de R3/segurança.
- Roteamento de modelos econômicos apenas quando suportado e validado; revisão independente continua obrigatória.
- Concorrência adaptativa, retries limitados, backoff para quota/rate limit, fila persistente, checkpoint/retomada, idempotência e controle contra ciclos de tentativas caras. Em falta de cota, preservar estado e aguardar capacidade; não contornar limites.
- Instrumentar modelo/esforço/tokens/cache/duração/custo apenas se dados reais estiverem disponíveis. Medir custo por PR aprovada, retrabalho e qualidade; documentar métricas indisponíveis em vez de estimar ou inventar.
- Validar em sandbox/CI com tarefas representativas e comparar consumo junto com sucesso, regressões e defeitos; economia não pode relaxar testes, revisão, segurança ou governança.
- **Estado:** requisito incorporado ao plano; implementação ainda não declarada como concluída. Próximo passo é auditar o executor real e abrir PRs pequenas cobrindo configuração por sessão, budget/queue/retry e telemetria conforme dependências.

### Executor paralelo do Claude Code — GitHub Actions
**Status: primeira execução ponta a ponta comprovada; capacidade instalada para até 10 tarefas, mas valor de concorrência ativo ainda precisa ser conferido/configurado.**

- Workflow: [`.github/workflows/tarefas.yml`](../.github/workflows/tarefas.yml). Uma issue aberta, criada por operador autorizado, recebe `executor:github` e inicia uma sessão isolada numa branch `tarefa/*`; o resultado esperado é uma PR para `main`.
- Segurança integrada pelas PRs [#224](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/224), [#226](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/226) e [#227](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/227): trigger restrito a operadores; permissões mínimas; ação Anthropic fixada por SHA; runner `ubuntu-24.04-firewall`; allowlist de saída sem wildcards; PostgreSQL descartável para teste; pré-checagem do secret; relatório de falhas; nenhuma permissão de merge ou deploy no workflow.
- [Smoke test #225](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/issues/225) concluído. [Run #38189573700](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/actions/runs/38189573700) terminou `success`: container/runner, `npm ci`, validação da credencial e Claude Code Action passaram; o agente abriu a [PR #228](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/228), limitada a documentação. A execução reportou `npm test` com exit 0; a [CI da PR #228, run #38189888732](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/actions/runs/38189888732) também terminou `success`. A PR #228 foi integrada por squash no commit `eb6554a1b84a88ffe0e45cbfb647518748e51e5e`.
- Diagnósticos que levaram ao sucesso: [#38188101767](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/actions/runs/38188101767) identificou hostname ausente na allowlist; [#38188341990](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/actions/runs/38188341990) identificou secret Claude ausente; a correção de rede entrou na #226 e o preflight fail-fast na #227. Não repetir essa investigação sem novos sinais.
- Documentação operacional e de troubleshooting: [`docs/tarefas-paralelas.md`](./tarefas-paralelas.md). Labels: `executor:github` agenda, `executor:running` executa, `executor:done` significa execução bem-sucedida com PR aberta, `executor:failed` exige consultar o comentário/log.
- **Concorrência:** o código suporta `TAREFAS_MAX=1..10`; sem a variável de Actions, o padrão é **3**, não 10. Próxima ação operacional é confirmar/criar a variável em **Settings → Secrets and variables → Actions → Variables → `TAREFAS_MAX=10`**. A ferramenta de acesso usada nesta atualização não confirma nem altera variáveis de Actions, então não declarar que 10 vagas já estão ativadas até verificar a configuração na conta.
- Atingir 10 vagas significa até 10 sessões Claude simultâneas — uso de cota maior e mais conflitos se várias tasks alterarem os mesmos arquivos. Decompor trabalho por áreas/arquivos, não enfileirar PRs concorrentes que modificam `package.json`, `index.html`, `api/v1.mjs` ou o mesmo workflow sem dependências definidas.
- **Limite inviolável:** este runner só produz branch + PR; nunca merge, deploy, migration ou escrita em banco de produção. Merge/deploy rotineiros pertencem ao processo Release Governor separado e só podem avançar com gates e evidência. R3 (segurança, secrets, permissões, migrations críticas, dados/impacto financeiro) escala ao humano conforme a política; este roadmap não concede exceções.

### Ciclo autônomo de release (Release Governor + Executor Bridge)
**Status: merge R0 ponta a ponta comprovado; deploy pelo código bloqueado por credencial; ponte aguardando merge humano (R3).**

- Governor e auditoria (`src/agents/release-governor*.js`) estão na `main`. Checks da CI: `test` (com PostgreSQL), `regression`, `golden`.
- [PR #221](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/221) — Release Executor Bridge (`runMerge`/`runDeploy`, lock `pg_try_advisory_lock`, idempotência, fail-closed, smoke, CLI `tools/release-run.mjs`). 27 grupos de testes (mocks + PostgreSQL descartável) no `npm test`; CI verde. **R3 pela política: merge humano obrigatório**, o Governor bloqueia o merge autônomo dela.
- Ciclo real executado em 11/10 com o código da #221: [PR #222](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/222) (só `docs/`) → CI verde → Governor `R0 / autonomous` com evidência lida da API do GitHub → merge pela ponte com SHA fixado (`593f673`) → auditoria `RELEASE_GOVERNOR_DECISION` ×2 + `RELEASE_EXECUTION` started/succeeded → repetição respondeu idempotente → deploy decidido como `not_required` (docs-only, sem tocar na Vercel). A auditoria desse ciclo ficou num PostgreSQL local descartável, não no banco de produção.
- **Não comprovado ainda:** deploy + smoke de produção pela ponte. Faltam (a) `VERCEL_TOKEN` no ambiente do executor e (b) um PR R1/R2 elegível. O sandbox do Claude não alcança `*.vercel.app` nem `api.vercel.com`, então o smoke precisa rodar no executor ou numa Action.
- **403 "Not authorized to access scope tonywatanabeart-1457s-projects":** a conta do usuário (via integração Vercel) acessa normalmente o time `team_lQeGJ3CtqA0g9zbhvrcAxY8h` (slug `tonywatanabeart-1457s-projects`) e o projeto `prj_Y4MFVCbc8h7aqX9pMSnwcY1TwH5b`. O 403 vem do token/CLI usado no executor, que pertence a outra conta ou foi criado com escopo diferente desse time. Correção (humana, no painel da Vercel): criar um token com escopo **tonywatanabeart-1457's projects** e guardá-lo como secret do executor/Action (`VERCEL_TOKEN`, `VERCEL_TEAM_ID=team_lQeGJ3CtqA0g9zbhvrcAxY8h`). Nunca colar em chat, terminal compartilhado, log ou arquivo versionado.
- Hunter Orchestrator: passo "Agentes (fila de revisão)" do workflow `hunter.yml` com `success` em todas as rodadas de 15 min observadas em 11/10, sem anotações de aviso. Testes: orquestrador 16 (puro) + 5 (banco), integração 9, revisão humana 13. O workflow de revisão nunca foi acionado manualmente.


### Fase 1 — Confiabilidade operacional e executor
**Status: código remoto avançou; sincronização do runtime local ainda não confirmada.**

- Repositório privado do executor: [pokemon-price-hunter-executor](https://github.com/TonyWatanabe-dev/pokemon-price-hunter-executor).
- Último `master` confirmado na auditoria: `5de582bf67312c2e43f30b84d689a79448cebfb8`.
- PRs #7 e #8 integradas; CI verde registrado. A PR #8 reportou 139 testes aprovados e zero falhas.
- [Issue #31 — versionar executor e preservar estado](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/issues/31): fechada com `executor:done`, mas falta confirmação atual do runtime local após as últimas integrações.
- [Issue #30 — idempotência e recuperação](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/issues/30): histórico remoto de código/testes e recuperação registrado; não confundir esse histórico com prova de que a máquina está executando a versão atual.
- [Issue #33 — circuito completo e canário com entrega](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/issues/33): já existe; canário histórico e CI foram documentados. Não criar issue duplicada.
- **Bloqueio humano único quando voltar ao computador:** seguir o README do executor para verificar fila/estado, parar com segurança, atualizar por fast-forward sem sobrescrever alterações, rodar a suíte e reiniciar/verificar PID + heartbeat + log + blob do script. Não executar atualização cega enquanto o processo estiver ativo.

### Fase 2 — Comparador confiável e dados
**Status: núcleo em evolução; consolidar lacunas e validar regressões antes de expandir.**

Prioridades:
1. Matching conservador de produtos e variantes, sem falsos positivos.
2. Preço/estoque/frete com origem, validade e incerteza explícitas.
3. Alertas comparáveis apenas na mesma base de frete; frete desconhecido nunca é zero.
4. Integridade do Opportunity Engine e coerência entre robô, API, home e banco.
5. Busca sem acentos e robustez dos dados, validando as PRs/issues ativas antes de iniciar trabalho duplicado.

### Fase 3 — Experiência de compra
- Fluxo de busca e comparação claro, landing/home com hierarquia visual de ecommerce, cards e estados de carregamento/erro/vazio.
- Acessibilidade, responsividade e navegação mobile.
- Frete por CEP: [PR #195](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/195) — draft. Em 11/10 a `main` foi integrada na branch (`d732af8`; conflito só no script de teste, as duas listas preservadas). Bloqueios: revisão humana, tirar de draft (decisão do usuário) e, para ativar, validação real de cotação + autorização separada. `SHIPPING_CALC_ENABLED` segue desligada.

### Fase 4 — Retenção e alertas
- Watchlist, notificações confiáveis, deduplicação/anti-spam, preferências e estados claros.
- Alertas de queda devem refletir novo melhor preço comparável, sem confundir uma oferta isolada com oportunidade real.
- Respeitar opt-in, limites e proteção de dados.

### Fase 5 — Inteligência de mercado
- Explicabilidade de scores e oportunidades, qualidade das referências oficiais, validade das evidências e distinção entre preço oficial confirmado e referência pendente.
- [PR #186 — política Copag](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/186): draft, CI verde e sem conflito em 11/10, 11 commits atrás da `main`. Bloqueio único: decisão comercial do responsável sobre os 11 produtos cuja referência vinha do Instagram. Manter em draft até essa decisão.
- [PR #20 — migration Copag](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/20): marcada explicitamente como **NÃO INTEGRAR sem autorização**; pode executar migration em produção e alterar notas do Opportunity Engine. Em 11/10: draft, com conflito, 152 commits atrás da `main`; a parte de política foi extraída para a #186. Não fechar sem decisão do usuário.

### Fase 6 — Segurança, escala e automação
- Segurança de workflows, cadeia de dependências, TLS, proteção de configuração e regras do Firestore versionadas.
- A PR #17 foi relatada como integrada em 11/10; confirmar o estado de CI/deploy por evidência específica antes de alegar que está publicado.
- Regras Firebase/Firestore e alterações de produção devem seguir revisão e procedimento de rollback; documentação ou commit não substituem confirmação do estado real do console.
- UX Research, UI/Design System, Growth/CRO e Brand/Creative permanecem **planejamento futuro** até produto/infra estarem maduros e haver autorização explícita. Social Media recebeu autorização específica para um MVP limitado em paralelo, conforme a decisão de escopo de 13/10/2026; SEO/Content segue sujeito ao seu gate próprio.

## Próximos passos ordenados

1. **Esforço/custo adaptativos:** auditar o executor para configurar esforço por sessão, roteamento de modelo suportado, orçamento, retries/backoff, fila retomável e métricas de consumo. Validar economia junto com qualidade antes de aumentar workers.
2. **Fábrica 24/7:** conferir `TAREFAS_MAX`, operadores autorizados, app/secret Claude e runner de firewall; confirmar cron-job.org para Hunter/Vigia e o fluxo de aviso/recuperação. O valor atual da variável e o cron externo não são verificáveis apenas pelo código do repo.
3. **Planner + Dispatcher + QA Reviewer:** implementar fila de issues pré-aprovadas, seleção por dependência/risco/arquivos, despacho idempotente, quarentena/retry e revisão independente. A action atual continua por label até que o novo dispatcher tenha CI e testes; não relaxar permissões do trigger.
4. **Release bridge (#221):** revalidar PR/diff/checks, cumprir o gate humano R3 estabelecido, configurar credencial Vercel no ambiente seguro e provar deploy + smoke com um PR elegível. Não confundir merge com publicação.
5. **Dados e matching:** usar as issues existentes de contratos de coletores (#47/#103/#106), matching (#42/#109/#110), preço/moeda (#79), frescor/histórico (#104/#46/#112/#113), dedupe (#78) e referência Copag (#41). Não duplicar issues.
6. **Fluxo do site:** busca/detalhe/comparação (#43), estados vazios/loading/erro (#83), acessibilidade/mobile (#82/#98), erros seguros (#100/#115), diretório de lojas (#55) e links/tracking (#116).
7. **Frete (#195/#84):** resolver conflitos e validar cotações reais da VTEX; manter flag desligada até smoke/rollout e autorização. Ampliar para outras plataformas somente via contratos reais de cada loja.
8. **Retenção e alertas:** favoritos/contas (#49/#86), quedas/restocks reais (#45), opt-in/dedupe/preferências (#85); provar isolamento entre usuários e entrega idempotente.
9. **Opportunity Engine e monetização:** score explicável (#44), histórico/fonte oficial, links Meli/Amazon e disclosure. A #186 exige decisão de negócio; #20 permanece bloqueada sem autorização específica de migration e plano de rollback.
10. **Ativar especialistas por dependência:** Catalog → Marketplace Health → Price Intelligence → Shipping Verification → Alert → Affiliate. UX Research, UI & Design System, SEO & Content, Social Media, Growth & CRO e Brand & Creative continuam futuros até produto/analytics/brand readiness e aprovação.
11. **Hardening + estabilidade:** segurança/dependências/SSRF (#94/#105), API/paginação/performance (#80/#81/#114), backup/restore/runbook (#87/#108/#118), painel de saúde (#92), SEO (#96) e E2E. Exigir sete dias de observação 24/7 com coleta, sync, fila, CI, deploy e recuperação verificados antes de declarar conclusão.

## Discovery Intelligence Engine v0 — 12/10/2026 (branch `discovery-engine`, PR a abrir)

- Entregue em código (não validado ao vivo): `src/discovery/` (conectores brave/bing/serper, `queries.js`, `ledger.js`, `hosts.js`, `pipeline.js`, `handoff.js`, `index.js`, `cli.js`), `npm run discovery`, `npm run discovery:relatorio` (`tools/discovery-relatorio.mjs`), `test/discovery-tests.js` (offline), `docs/discovery-engine.md`.
- `hunter.yml`: passo diário usa `npm run discovery` (ou o `discover.js` legado com a variável `HUNTER_DISCOVERY=0`); entrada `discovery` no `workflow_dispatch` força uma rodada; secrets `BING_SEARCH_KEY`/`SERPER_API_KEY` opcionais (ausentes = conector indisponível, nada simulado).
- `src/run.js`: 4 linhas de hand-off (`data/discovery-urls.json` → `store.productUrls`, consumo após anúncio, 3 tentativas).
- Escritas do motor: `config/lojas/descobertas.txt` (linha ativa = loja aceita; `# candidata` = conferir), `data/discovery-urls.json`, `data/discovery.json` (ledger), `data/meta.json.discovery`.
- Pendente de evidência: primeira rodada real com `BRAVE_API_KEY` no Actions, relatório baseline × combinado após alguns dias, ajuste dos pesos da heurística pelas métricas. Bing e Serper nunca foram exercitados contra o serviço real.

## Evidências recentes registradas

- 11/10 à noite: primeira execução do executor Claude Code Actions concluída ponta a ponta; run #38189573700 success; smoke issue #225; PR #228 mergeada após CI #38189888732 success; merge commit `eb6554a1b84a88ffe0e45cbfb647518748e51e5e`.
- Configuração de concorrência `TAREFAS_MAX`: o workflow aceita até 10, mas o default de código é 3. O valor real configurado nas Actions não foi verificável pela conexão usada nesta revisão; confirmar e configurar como `10` antes de lançar a fila em escala.
- Hardening do executor verificado nesta etapa: correção da allowlist Docker na #226 e preflight de credencial na #227. CI dessas PRs: runs #38188177289 e #38188485587, ambos success.
- 11/10: `main` `593f673` (merge da #222 pela Release Executor Bridge); produção `f66c929` (#217, deploy `dpl_GxgGmsGFysrbi8AgZ1oaMNN861Mw` READY). A diferença main→produção é só Governor/CI/docs, que o site não importa.
- Base de referência anterior: commit `0e3adbfd6d143c637e5f695014a7e2de99a77475` — documentação do deploy da Fase 6C.0 (#212) em produção.
- Executor privado: `master` `5de582bf67312c2e43f30b84d689a79448cebfb8` (última SHA confirmada na auditoria do executor; conferir novamente antes de agir).
- PRs/Issues vinculadas: [#31](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/issues/31), [#30](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/issues/30), [#33](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/issues/33), [#195](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/195), [#186](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/186), [#20](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/20).


## Atualização operacional — autonomia dos agentes (12/10/2026, revisão mais recente)

> Esta seção prevalece sobre notas anteriores deste arquivo que descrevam o ciclo Planner/Dispatcher/worker/revisor como ainda não comprovado. As evidências históricas permanecem preservadas para auditoria.

### Estado do ciclo de desenvolvimento autônomo

- **Comprovado em runtime:** Vigia → Dispatcher → worker Claude Code → PR do agente → revisão independente qa-review → classificação pelo Release Governor. O canário #257 gerou a PR #258, com commit verificado e CI verde; qa-review aprovou a mesma SHA e a PR foi integrada.
- **Correções integradas reportadas:** #250 (gatilho do Dispatcher após o Vigia), #252 (ator github-actions restrito ao despacho), #256 (lease/quarentena considera a tentativa atual), #260 (Governor exige qa-review aprovado na mesma SHA) e #261 (revisor aceita PRs de agentes sem abrir a allowlist de forma ampla). #243/#244/#246 também integram partes do Dispatcher, QA e classificação de esforço.
- **Esforço adaptativo:** classificador integrado; ligação ao worker reportada como concluída/destravada. Isso não equivale a telemetria real de tokens/custos, que continua sendo a próxima tarefa técnica.
- **Limpeza reportada:** #254 e #259 foram fechadas sem merge por redundância; #247 foi concluída com o canário #257/#258. Revalidar no GitHub antes de usar estes itens para decisões futuras.
- **Conclusão:** a cadeia funcional foi demonstrada, mas isso ainda não prova operação 24/7 sustentada nem autonomia completa de release/deploy.

### Lacunas para a fábrica 24/7

1. **Telemetria real por execução (próxima tarefa técnica):** instrumentar modelo/esforço efetivamente usados, tokens de entrada/saída/cache e custo apenas quando disponibilizados pelo runtime/provedor; duração, tentativas, resultado, escaladas e custo por tarefa/PR aprovada. Não estimar nem inventar valores. Incluir logs sanitizados e testes.
   - **Status (12/10):** implementada na branch `feat/telemetria-worker` (PR de telemetria, empilhada sobre a #263).
     - O worker publica um registro por execução, a partir do `execution_file`. O registro tem perfil solicitado, modelo(s) usados, turnos, duração, tokens, custo reportado pelo runtime (a preço de API, não a cobrança da assinatura), status, PR, chave e tentativa. Campo ausente fica `n/d`.
     - `tools/telemetria.mjs resumo` agrega os registros e calcula o custo por PR integrada, incluindo o retrabalho.
     - Detalhes: [tarefas-paralelas.md](./tarefas-paralelas.md#telemetria-por-execução).
     - Integrada na `main` pela #264, que também levou o conteúdo da #263 (a #263 ficou redundante).
     - **Orçamento no Dispatcher (branch `feat/dispatcher-orcamento`):** `DISPATCHER_ORCAMENTO_USD`/`_JANELA_H` pausam despachos quando o custo reportado na janela atinge o limite. Com limite definido, configuração inválida ou telemetria ilegível também pausa (fail-closed).
     - **Falta:** validar em runtime a primeira execução real com comentário de telemetria. Depois, o proprietário decide se define um limite (#231).
2. **Rotina recorrente:** ativar a rotina horária pelo mecanismo de agendamento disponível e validar execuções consecutivas, idempotência, ausência de duplicação e aviso de incidentes. O arquivo rotina-horaria-prompt.md contém o roteiro; a rotina não deve ser declarada ativa sem confirmação de execução real.
3. **Concorrência:** confirmar TAREFAS_MAX nas Actions Variables. O workflow suporta até 10, mas o padrão no YAML é 3; não anunciar 10 workers ativos sem comprovar o valor configurado e a estabilidade.
4. **Release Governor / bridge #221:** continua bloqueada por gate humano R3. A ponte não deve ser considerada operacional para deploy até concluir a revisão/decisão de auditoria, configurar VERCEL_TOKEN com segurança e comprovar deploy real + smoke pós-deploy de um SHA elegível.
5. **Auditoria de release:** a decisão do sink ainda depende do proprietário. A recomendação documentada é começar com comentários append-only no GitHub (opção C); isso é recomendação, não decisão aprovada.
6. **Proteção da main:** confirmar nos Settings os checks obrigatórios e manter PR, test, regression, golden e revisão independente. Não contornar branch protection nem converter qa-review em aprovação humana.
7. **Burn-in operacional:** reunir evidências por sete dias de scheduler, coleta/frescor, sincronização, fila, CI, releases, smoke e recuperação antes de declarar a fábrica 24/7 concluída.
   - **Status (12/10):** medição automática na branch `feat/burnin-fabrica` (`burnin.yml` + `tools/burnin.mjs`; critérios em [burnin.md](./burnin.md)). Publica um comentário por dia na issue `burnin:diario`.
     - Leitura real, somente leitura, em 12/10: dia **11/10 verde**. Hunter e Vigia tiveram 102 rodadas cada, maior intervalo de 15 min e 100% de sucesso. Sync, leitor e motor ficaram ok em 67 rodadas.
     - O dia 12/10, em curso, está **vermelho** por 2 falhas do Dispatcher durante a correção da manhã.
     - **Ainda não coberto pela medição:** releases/smoke pela Ponte (dependem da decisão do sink e do `VERCEL_TOKEN`) e evidência manual de alerta/recuperação (#238).

### Decisões e limites

- A issue [#231 — decisões pendentes do proprietário](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/issues/231) continua sendo o registro único de decisões humanas: sink de auditoria, credencial Vercel segura, configuração de proteção/checks e ativação de rotina.
- O executor de tarefas continua responsável por branch + PR; merge/deploy só pela ponte e pelo Governor, com permissões próprias e evidência. R3 e R-STOP continuam bloqueados até a decisão/autorização exigida.
- Não alterar nem ativar automaticamente SHIPPING_CALC_ENABLED; #195 permanece dependente de cotação real e autorização. #186 continua dependendo da decisão comercial Copag; #20 permanece explicitamente **NÃO INTEGRAR** sem autorização específica.
- Enquanto existir bloqueio humano de release, continuar em paralelo as tarefas R0–R2 pré-aprovadas e independentes. Notificar o usuário apenas por marco material, incidente crítico ou decisão real, não por cada PR.
- Critério de sucesso: cadeia autônoma comprovada + rotina recorrente real + métricas observáveis + governança de release validada + sete dias de estabilidade. Uma execução canário bem-sucedida não substitui esses critérios.

---
*Este roadmap é um resumo operacional versionado. Atualizar data/hora e evidências em cada revisão; nunca substituir validação de CI/runtime/produção por texto de status.*


## Atualização de desenvolvimento — 12/10/2026, 13:45 (America/Sao_Paulo)

### Base verificada no GitHub
- `main`: `5a70b1c1a008890082f21890c8f73c2bda985d19` — PR [#335](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/335) integrada.
- Fila de PRs abertas: **zero no momento da consulta**.
- PRs recentes integradas: [#335](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/335) loja oficial Pokémon no Mercado Livre e prioridade no catálogo; [#334](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/334) testes de histórico; [#332](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/332) limpeza de alertas enviados; [#331](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/331) testes para anomalias, score de loja e seleção de preço; [#330](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/330) proteção de credenciais em redirects cross-origin; [#329](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/329) testes de dependências; [#328](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/328) validação numérica estrita na API; [#327](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/327) rejeição de títulos em idioma não português; [#326](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/326) limites no JSON-LD; [#325](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/325) correção de título VTEX; [#333](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/333) disponibilidade de publicação de catálogo Mercado Livre.
- Outras entregas integradas na mesma rodada: [#322](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/322) diagnóstico seguro de bloqueios e filtros de sitemap; [#324](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/324) diretório `/lojas` e busca alternativa; [#323](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/323) disponibilidade baseada no catálogo oficial do Mercado Livre.
- Workflows após #335 ainda estavam em execução quando consultados: [deploy Pages #38279377618](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/actions/runs/38279377618), [CI #38279230164](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/actions/runs/38279230164) e [qa-review #38279230132](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/actions/runs/38279230132). Não declarar o deploy validado até obter conclusão e smoke test adequado.
- A sequência de burn-in de sete dias **não está concluída**: 11/10 foi verde e 12/10 teve falhas do Dispatcher durante a rodada da manhã. Uma execução posterior bem-sucedida não substitui sete dias verdes consecutivos.

### Estado por frente
| Frente | Estado observado | Próximo critério de saída |
|---|---|---|
| Catálogo e descoberta | Diretório de lojas, caminhos de busca alternativos e disponibilidade do catálogo ML integrados | Confirmar cobertura/frescor e links finais em runtime; não tratar catálogo publicado como estoque físico confirmado sem evidência |
| Qualidade de dados | Validação de idioma, limites JSON-LD, consistência de ofertas e validação numérica integradas | Medir falsos positivos/falsos negativos e frescor usando dados reais; registrar cobertura por loja |
| Segurança e manutenção | Redirect cross-origin sem encaminhar auth/cookie; limpeza de histórico/alertas e testes integrados | Manter CI verde e revisar logs de segurança sem expor credenciais |
| UX/SEO | Melhorias anteriores e backlog futuro documentado em [#285](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/285) | Preservar backlog; não iniciar agentes futuros de UX Research, UI & Design System, Social, SEO & Content, Growth/CRO ou Brand sem replanejamento |
| Frete por CEP | Não lançado; #195 fechada sem merge por decisão do proprietário; #84 permanece aberta | Implementar somente com cotações reais por CEP e métodos oferecidos pela loja, teste de contrato e feature flag desligada por padrão |
| Copag/preço de referência | #186 fechada sem merge por decisão comercial; #20 explicitamente não integrar | Não alterar a política de selo Copag nem migrar sem nova decisão explícita |
| Fábrica de agentes | Fluxo Vigia → Dispatcher → worker → PR → qa-review → Governor provado; capacidade até 10 configurada anteriormente | Revalidar concorrência/capacidade com runs recentes; merge/deploy autônomos só pela Ponte/Governor e gates reais |
| Release/produção | Deploy iniciado após #335, resultado ainda pendente na consulta | Confirmar Actions, commit publicado e smoke pós-deploy; não inferir saúde da Vercel a partir de Pages/CI |
| Operação 24/7 | Burn-in automático implementado, sem sete dias verdes | Corrigir/explicar falhas, validar alertas e recuperação e acumular sete dias consecutivos dentro dos limites definidos |

### Próximos passos priorizados
1. **Fechar o ciclo da PR #335:** verificar os runs de CI, revisor e deploy; se falhar, corrigir e reexecutar. Fazer smoke do diretório `/lojas`, página de produto, destino oficial do Mercado Livre e ordenação do catálogo; registrar SHA e URLs verificadas.
2. **Auditar a cobertura de lojas e o frescor dos dados:** medir por loja última coleta bem-sucedida, ofertas válidas, bloqueios, erros e participação no ranking. Priorizar melhorias de coletores sem contornar bloqueios, CAPTCHA ou regras de acesso.
3. **Validar a integridade do ranking:** usar casos dourados e amostras reais para confirmar correspondência exata de idioma/coleção/quantidade, preço selecionado, disponibilidade e ausência de influência de comissão afiliada. Não alterar score/ranking em massa sem revisão R3.
4. **Retomar a fábrica com uma leva limitada e paralela:** tarefas independentes de testes, diagnóstico e qualidade de dados; cada tarefa com branch/PR, CI, `qa-review` no mesmo SHA e Governor. Não abrir volume artificial de PRs; manter foco em entregas que removam riscos ou aumentem cobertura.
5. **Desbloquear governança de release sem contornar gates:** acompanhar a issue [#231](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/issues/231), confirmar `qa-review` obrigatório, decisão de auditoria e pré-requisitos da Ponte/`VERCEL_TOKEN`. Segredos só pela configuração oficial do GitHub/Vercel; nunca em commits ou chat.
6. **Continuar o burn-in de sete dias:** registrar diariamente Hunter, Vigia, Dispatcher, sincronização, frescor, releases/smoke e recuperação. Falha ou dado ausente mantém o dia não verde; não declarar 24/7 antes de sete dias consecutivos aprovados.
7. **Manter itens bloqueados fora do lançamento:** `SHIPPING_CALC_ENABLED` desligada; #195 sem merge; #186 sem merge; #20 não integrar. Não iniciar o backlog futuro de agentes de UX/Growth/Brand sem replanejamento.

### Critérios para declarar a próxima fase concluída
- PRs relevantes integradas com CI obrigatório e revisão independente no mesmo SHA.
- Deploy com commit identificado, resultado verde e smoke pós-deploy registrado.
- Nenhuma alteração de ranking/preço de referência sem regressão e aprovação compatível com o risco.
- Métricas de coleta/frescor por loja disponíveis, com falhas e dados ausentes explícitos.
- Burn-in reportado separadamente; não declarar operação 24/7 até cumprir sete dias consecutivos verdes.
- Pendências R3/R-STOP continuam bloqueadas e são escaladas somente com evidência, impacto e uma decisão concreta.


## Atualização de planejamento — 13/10/2026

### Fase 2 — dados e backend
- **Status confirmado: concluída**, conforme relatório de fechamento desta própria roadmap.
- A próxima fase registrada é a **Fase 3 — experiência de compra**.
- A conclusão da Fase 2 não implica que a fábrica de desenvolvimento/oper operação 24/7 esteja concluída: burn-in, governança de release e configurações pendentes permanecem controlados pelas evidências operacionais acima.

### Frente autorizada — MVP Social Media e comunidade em paralelo
- Planejamento registrado na issue [#560 — Agente Social Media e comunidade TCG Price Hunter](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/issues/560).
- **Implementação autorizada agora dentro do escopo limitado acima.** Não esperar o burn-in completo para desenvolver rascunhos e calendário; gates de estabilidade continuam exigidos para declarar operação 24/7 e para ativar autopublicação.
- Comunidade: **TCG Price Hunter**.
- Instagram informado: **@tcgpricehunter151**.
- Telegram informado: [t.me/PokemonTCGHunterBR_bot](https://t.me/PokemonTCGHunterBR_bot). O endereço parece ser de bot; confirmar o link correto do canal/grupo e as permissões antes da integração.
- WhatsApp: pendente. O link fornecido inicialmente era o mesmo endereço do Telegram; aguardar convite real do grupo criado pelo proprietário.
- Afiliados já informados: Mercado Livre — https://meli.la/1BzQ4PU; Amazon — https://link.amazon/B0bVBmGRD. Shopee e outras contas/canais continuam pendentes.
- Escopo previsto: conteúdo e criativos (artes, roteiros, Reels/cortes), calendário editorial, publicação multicanal, moderação, roteamento de links afiliados e análise de desempenho.
- Piloto previsto: Telegram e Instagram primeiro; WhatsApp após validar uma integração oficial adequada à conta. Não usar automação que simule WhatsApp Web ou contorne controles da plataforma.
- Regras: ofertas precisam vir do catálogo validado, com preço/estoque/frescor confirmados; prevenir duplicatas; divulgar links afiliados; nunca influenciar o ranking pela comissão; proteger credenciais; publicar automaticamente somente após validação e testes.
- Ordem de entrega: (1) contrato de dados, frescor, dedupe e disclosure; (2) calendário/fila, gerador de rascunhos e prévia; (3) aprovação humana e auditoria; (4) piloto de publicação Telegram; (5) Instagram pela API oficial; (6) WhatsApp apenas após validar API oficial e convite. O link da Shopee e demais contas ficam como dependências, não bloqueiam o primeiro corte.

### Frente SEO & Content Agent — gate de prontidão (issue #594; PR #595 integrada em 13/10/2026)
- Autorização do proprietário para começar a Fase 3 pelo agente de conteúdo, com escopo restrito a leitura e proposta, sem publicação externa (issue [#594](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/issues/594)). Merge: [PR #595](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/595), commit `2ee66dd6619a0dd69c24af0fe4c5ae00dfca882e`.
- Entregue e integrada: auditor somente leitura `src/agents/seo-content.js` (sem imports e não registrado como handler), CLI offline `tools/seo-audit.mjs`, evidências versionadas `docs/seo-content-readiness.json`, relatório `docs/seo-content-agent.md` e `test/seo-content-agent-tests.js`. Correções adicionais na mesma PR alinharam o relógio do ciclo de agentes e o teste de contrato do worker, sem alterar workflows.
- **Gate: bloqueado, agente desativado por padrão.** Faltam evidências de burn-in de 7 dias (0/7), Search Console, política de conteúdo, acesso autorizado ao analytics e decisão de fonte canônica (Pages × Vercel). Comprovados no código e nos testes: SSR/canonical/sitemap/metadados, frescor e testes de indexabilidade.
- Validação reportada na PR: `npm test` com 165 arquivos OK; 20 casos específicos do agente; `npm run golden:eval` 31/31. O inventário offline examinou 159 URLs do sitemap a partir do `state.json` do ramo `data` (13/10, 15:30 UTC), sem achado de página. Propostas não aplicadas: `robots.txt` bloqueia o `noindex` de 4 rotas privadas (baixa); sem dados em dia, 8 páginas fixas saem `noindex` mas continuam no sitemap (média); description estática da Home tem 199 caracteres (baixa).
- **Deploy:** checks `build` e `report-build-status` passaram no run [38431199161](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/actions/runs/38431199161); o job `deploy` ainda estava em execução na última consulta. Produção não declarada validada; host público ainda não foi auditado.
- **Gate bloqueado:** burn-in 0/7, Search Console não verificado, política editorial ausente, acesso autorizado aos dados de analytics não comprovado e fonte canônica (Pages × Vercel) não decidida. O agente continua desativado por padrão.

### Convenção de atualização deste documento
Atualizar este roadmap quando houver mudança comprovada de fase, entrega integrada, bloqueio ou decisão do proprietário. Usar issues, PRs, commits, CI, logs e smoke tests como evidência; não inferir conclusão apenas por labels, quantidade de PRs ou sucesso isolado de workflow. O Plano de Entrega Turbo continua sendo a fonte dos critérios de saída; este roadmap registra o estado observado e a próxima prioridade.

---


### Atualização de execução — 13/10/2026 (PR #624)

- **Integrada:** PR [#624](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/624), commit `0b031afe537109b482b37d4b4fb4eae7def342bc7`. O `state.json` agora separa o horário da rodada (`generatedAt`) da última leitura real (`dataAt`); API, páginas, sitemap, cache SEO, auditor SEO e barra da UI usam o timestamp de dados para avaliar frescor, preservando compatibilidade com state.json legado.
- **Validação reportada na PR:** 172 arquivos de teste passaram; revisão independente registrou ausência de bloqueantes. Isso não equivale a smoke pós-deploy em produção, que permanece sem confirmação nesta atualização.
- **Issue #618:** fechada como concluída após a integração da correção de falha total dos coletores.
- **Próximas correções de frescor na fila:** [#619](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/issues/619), loja JSON-LD sem sucesso quando todas as páginas falham; [#620](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/issues/620), impedir que timestamp futuro contamine a sincronização. #620 está explicitamente dependente de #619 para evitar concorrência em áreas compartilhadas.
- **Não declarar Fase 1 nem operação 24/7 concluídas por causa deste merge isolado:** confirmar execução das tarefas seguintes, CI/revisão, smoke aplicável e os sete dias consecutivos de burn-in exigidos.


### Fila Turbo — encerramento da Fase 1 (atualizado em 13/10/2026, 20:40 UTC)

**Escopo da Fase 1:** integridade dos dados e do catálogo. A fila de execução foi restringida às correções de frescor ainda necessárias; tarefas de experiência, oportunidades e frete foram retiradas da elegibilidade automática para não misturar as Fases 2/3/5 com o gate de conclusão da Fase 1.

**Evidência nova:** a PR [#628](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/pull/628) foi integrada no commit `c5b6ceca309aadb55172656352e3bcd38f184aa9`, fechando a issue [#619](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/issues/619): quando todas as páginas JSON-LD falham, a loja não pode parecer saudável. O Dispatcher #157 leu `DISPATCHER_ORCAMENTO_USD=100`, registrou US$ 55,54 de gasto reportado e despachou #619. **O runtime mostrou `DISPATCHER_ORCAMENTO_JANELA_H` vazia**, então essa configuração continua pendente; não inferir que a janela de 24 h está ativa.

#### Fila de implementação — ordem por dependência

1. [#620 — rejeitar timestamp futuro e permitir recuperação de leituras válidas](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/issues/620) — elegível após #619 integrada.
2. [#625 — expor frescor por oferta na API](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/issues/625) — depende de #620.
3. [#626 — contrato para ofertas legadas sem timestamp](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/issues/626) — depende de #625.
4. [#627 — isolar oferta com timestamp inválido no sync](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/issues/627) — depende de #626.

As quatro issues mantêm a etiqueta `tarefa:aprovada`. Não foram adicionadas tarefas duplicadas. As issues #94, #82, #83, #53 e #84 continuam no backlog para suas fases próprias, mas tiveram a etiqueta de elegibilidade automática removida: revisão de dependências/hardening, acessibilidade, recuperação da UI, oportunidades e frete não são pré-requisitos diretos do critério de saída da Fase 1. A flag de frete permanece desligada.

#### Gates obrigatórios de encerramento — não automatizar como se fossem tarefas de código

- [#612 — smoke SEO público](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/issues/612): continua manual/operacional. Exige um run real no domínio público e evidência de Home, canonical, robots, sitemap e rotas privadas com noindex. Testes offline não substituem esse gate.
- [#231 — configurações finais de autonomia/release](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/issues/231): continua aberta. Teto de orçamento US$ 100 confirmado no Dispatcher #157; `DISPATCHER_ORCAMENTO_JANELA_H` apareceu vazio e precisa ser definido/verificado. Também faltam as configurações de auditoria de release, escopo do token Vercel, proteção/checks da `main`, rotina horária e validação de recuperação/alerta conforme checklist.
- [#271 — burn-in 24/7](https://github.com/TonyWatanabe-dev/pokemon-price-hunter/issues/271): permanece aberta. Critério rígido de sete dias encerrados consecutivos verdes. Último registro consultado: 13/10 parcial, sequência 0/7; o dia vermelho de 12/10 reiniciou a contagem.

#### Critérios para declarar Fase 1 concluída

1. #620, #625, #626 e #627 integradas com testes de contrato/regressão, CI `test`, `regression`, `golden` e `qa-review` verdes.
2. Golden tests demonstram que variante/idioma/quantidade e fonte oficial continuam corretos; ofertas stale, inválidas ou sem evidência não recebem selo/score/alerta como se estivessem atuais.
3. Smoke público executado e registrado com evidência real; falhas de rede/permissão distinguidas de falhas reais do site.
4. Configuração operacional e de release validada sem bypass de branch protection nem exposição de secrets.
5. Sete dias consecutivos verdes de burn-in registrados em #271.
6. Roadmap atualizado com PRs/commits, runs, checks, smoke, resultado de burn-in e bloqueios remanescentes. Até todos os critérios serem provados, **Fase 1 continua aberta**.

**Concorrência:** o runtime reportou `TAREFAS_MAX=10`, mas isso representa capacidade, não garantia de dez workers simultâneos. A fila deve respeitar dependências e os limites de orçamento; nunca executar em paralelo duas tarefas que alterem os mesmos contratos/arquivos compartilhados sem isolamento demonstrado.

## Base de cartas em português (16/10/2026)

Decisão do proprietário: linha editorial no Instagram/TikTok (Aura/ilustradores, rankings, temáticos) em vez de posts automáticos de oferta. Para isso entrou a base `config/cartas/cartas-pt.json.gz` (14.360 cartas físicas com nome em português, 105 coleções de Preto & Branco à Celebração de 30 Anos) e `config/cartas/artistas-pt.json` (325 ilustradores), geradas por `tools/cartas-pt-gerar.py` a partir do [tcgdex/cards-database](https://github.com/tcgdex/cards-database) (MIT); consulta em `src/cartas-pt.js`. Imagens ficam no `assets.tcgdex.net` (© Pokémon/Nintendo/Creatures/GAME FREAK, sempre com crédito); o TCG Pocket (app) fica fora. Regenerar: `python3 tools/cartas-pt-gerar.py --clonar /tmp/tcgdex --saida config/cartas`.

## Social editorial — Instagram e TikTok (16/10/2026)

Decisão do proprietário: IG/TikTok são linha editorial, sem post automático de oferta; nenhum post mostra preço de oferta (o único valor é o que o proprietário pagou nos packs, formato Deu Lucro?); todo CTA leva ao grupo do WhatsApp pelo link da bio.

- Agendamento pela Zernio: `.github/workflows/social-agendar.yml` (manual; modos simular, agendar, cancelar) lendo `config/social/agenda/semana*.json` (#770, #771, #772, #773, #775).
- Link da bio `tcgpricehunter.com.br/grupos` → grupo do WhatsApp (307; #774). Verificado em produção em 16/10.
- Imagens oficiais das cartas via `.github/workflows/cartas-imagens.yml` → ramo `cartas-imagens` (#769).
- Semana 1 (19–25/10): 6 posts de arte (Instagram) + 5 vídeos (Instagram e TikTok) agendados. Semana 2 (26/10–01/11): 6 posts de arte agendados; 3 vídeos aguardam material.
- Bio do Instagram e do TikTok apontando para `/grupos`: feito em 16/10.
- GitHub Pages despublicado em 16/10 (fonte em GitHub Actions, sem workflow de Pages): o site vive só na Vercel.
- Pendências do proprietário: figurinha de link e enquetes nos stories pelo app; vídeos da semana 2 (unboxing Miraidon e próxima abertura) no Drive "Cortes Rede Sociais" com acesso por link; depois preencher `drive` em `semana2.json` e agendar.
