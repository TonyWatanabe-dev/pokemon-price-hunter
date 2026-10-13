# SEO & Content Agent — gate de prontidão e MVP somente leitura (issue #594)

> **Estado: bloqueado e desativado por padrão.** O MVP só lê e propõe. Não publica, não altera páginas, sitemap, robots,
> configuração nem conteúdo externo, e não é registrado como handler do orquestrador. Risco R0/R1 enquanto continuar assim.

## O que já existia (não foi refeito)

| Área | Onde | Testes |
|---|---|---|
| SSR com título, description de até 160 caracteres (`fitDesc`), canonical, OG e JSON-LD (Product/AggregateOffer, BreadcrumbList, ItemList, FAQPage, DefinedTermSet) | `api/pagina.mjs`, `api/_lib/guia.mjs` | `test/seo-lote-c-tests.js`, `test/seo-lote-e-tests.js` |
| Sitemap com `lastmod` por produto, sem produto sem estoque e só páginas fixas quando os dados estão velhos | `api/sitemap.mjs` | `test/sitemap-falha-tests.js`, `test/seo-lote-c-tests.js` |
| Frescor (atual ≤ 30 min, atrasado ≤ 90 min) decidindo se a página leva preço; sem dados em dia, `noindex` (exceto na Home) | `api/_lib/freshness.mjs`, `api/pagina.mjs` | `test/freshness-tests.js` |
| `X-Robots-Tag: noindex` nas rotas privadas/busca; robots.txt com Sitemap | `vercel.json`, `robots.txt` | `test/robots-consistency-tests.js`, `test/vercel-headers-tests.js` |
| Analytics anônimo e sem cookies, informado na Privacidade | `index.html` (`/_vercel/insights/script.js`) | — |

## O que esta entrega adiciona

- `src/agents/seo-content.js`: módulo puro, sem nenhum `import` (logo sem rede, banco ou disco).
  - `readiness(evidencia, { authorized })`: um pré-requisito só fica "comprovado" com `ok: true` **e** uma referência (arquivo ou URL). Ausência de evidência é bloqueio. Mesmo com tudo comprovado, o agente só liga com `authorized: true`. `SEO_AGENT_ENABLED_DEFAULT = false`.
  - `auditPage`, `auditSitemap`, `auditRoutes` e `report`: cada achado traz `regra`, `severidade` (alta/média/baixa), `url`, `file`, `evidencia` e `recomendacao`. Sem HTML, sitemap ou configuração, a função se abstém e registra a abstenção, sem recomendar nada.
- `tools/seo-audit.mjs`: renderiza localmente o sitemap e cada página dele pelas próprias funções do site, com `fetch` local e sem banco, e imprime o relatório JSON. Uso: `node tools/seo-audit.mjs [--state state.json] [--agora ISO] [--evidencia arquivo] [--out arquivo]`.
- `docs/seo-content-readiness.json`: evidências versionadas do gate. O teste confere que toda referência local existe.
- `test/seo-content-agent-tests.js`: 20 casos offline, entre eles conteúdo vazio, dado desatualizado, canonical/metadados, JSON-LD inválido, ausência de evidência, sitemap, robots × noindex, gate e CLI de ponta a ponta.

### Regras do auditor

| Regra | Severidade | Quando |
|---|---|---|
| `SEO-TITULO` | alta | Página indexável sem `<title>` |
| `SEO-CANONICAL-AUSENTE` | alta | Página indexável sem canonical |
| `SEO-CANONICAL-HOST` | alta | Canonical fora do host de `SITE` (`api/_seo.mjs`) |
| `SEO-CANONICAL-URL` | alta | Canonical diferente da própria URL numa página indexável |
| `SEO-DADOS-DESATUALIZADOS` | alta | Frescor fora de atual/atrasado com preço no HTML indexável |
| `SEO-DESCRICAO` | média | Página indexável sem description |
| `SEO-NOINDEX-NO-SITEMAP` | média | Página `noindex` listada no sitemap |
| `SEO-CONTEUDO-VAZIO` | média | Página indexável sem conteúdo pré-renderizado, com dados em dia ou frescor desconhecido |
| `SEO-JSONLD-INVALIDO` | média | Bloco JSON-LD que não é JSON válido |
| `SEO-SITEMAP-HOST` / `-DUPLICADA` / `-LASTMOD` | alta / média / baixa | URL fora do host, repetida ou com data inválida |
| `SEO-ROBOTS-SEM-SITEMAP` / `-SITEMAP-HOST` | média / alta | robots.txt sem Sitemap ou com Sitemap noutro host |
| `SEO-ROBOTS-BLOQUEIA-NOINDEX` | baixa | Caminho com `Disallow` que também tem `X-Robots-Tag: noindex` |
| `SEO-DESCRICAO-LONGA` | baixa | Description acima de 160 caracteres |

Sem frescor informado, as regras de frescor se abstêm. Sem dados em dia, a página sem SSR é o comportamento previsto e não vira `SEO-CONTEUDO-VAZIO`.

Endurecimento (issue #607): frescor sem estado conhecido de `classify()` (`atual`, `atrasado`, `desatualizado`, `indisponivel`) conta como ausente; host do site ausente **ou inválido** gera abstenção, não achado de canonical, sitemap ou robots; o relatório lista também as abstenções parciais de sitemap e rotas (prefixos `sitemap:` e `rotas:`); e `report()` só marca `enabled: true` quando recebe um gate `pronto`, sem bloqueios e com `enabled: true`, falhando fechado diante de objeto forjado ou incompleto.

## Gate de prontidão (conferido em 13/10/2026 na `main` `d85e352`)

| Pré-requisito | Estado | Evidência |
|---|---|---|
| Base técnica estável | **bloqueado** | Burn-in em 0/7, reiniciado em 13/10 (#271): `docs/ROADMAP-OPERACIONAL.md` |
| Analytics legítimo/consentido com acesso autorizado | **bloqueado** | Instrumentação anônima existe (`index.html`), mas não há autorização documentada de acesso aos dados nem medição de volume; eventos personalizados não aparecem no plano gratuito |
| Search Console verificado/autorizado | **bloqueado** | Nenhuma verificação ou autorização no repositório |
| Política de conteúdo/editorial | **bloqueado** | Inexistente no repositório |
| Fonte canônica de produção documentada | **bloqueado** | O código é consistente com `https://tcg-price-hunter.vercel.app` (`api/_seo.mjs`, `index.html`, `robots.txt`), mas a decisão Pages × Vercel segue pendente (Fase 8 do plano) |
| Sitemap, canonical e metadados no servidor | comprovado no código/testes | `api/pagina.mjs`, `api/sitemap.mjs`, testes dos lotes C/E |
| Conteúdo real com frescor verificável | comprovado no código/testes | `api/_lib/freshness.mjs`, `test/freshness-tests.js`, `test/sitemap-falha-tests.js` |
| Testes de renderização/indexabilidade | comprovado | Testes offline no `npm test` |

"Comprovado no código/testes" não equivale a verificação no host de produção, que não foi acessado nesta tarefa.

## Inventário observado (render local, sem rede e sem banco)

- **Com o `state.json` do ramo `data`** (gerado em `2026-10-13T15:30:26Z`, auditado com `--agora 2026-10-13T15:40:00Z`): 159 URLs no sitemap, todas indexáveis, com title, description de até 160 caracteres, canonical próprio, conteúdo SSR e nenhum JSON-LD inválido. **Nenhum achado de página.**
- **Achados de configuração (independem dos dados):**
  - `SEO-ROBOTS-BLOQUEIA-NOINDEX` (baixa) em `/conta`, `/favoritos`, `/alertas` e `/configuracoes`. O `robots.txt` faz `Disallow` e o `vercel.json` manda `noindex`, mas o robô bloqueado não lê o `noindex`. Proposta, não aplicada: se o objetivo for tirar essas URLs do índice, liberar o rastreamento e manter o `noindex`; se for só poupar rastreamento, manter como está.
- **Achados do cenário sem dados em dia** (falha do raw do GitHub ou dados com mais de 90 min):
  - `SEO-NOINDEX-NO-SITEMAP` (média) em 8 páginas fixas: `/oportunidades`, `/precos`, `/pre-vendas`, `/lojas`, `/como-funciona`, `/guia/glossario`, `/termos` e `/privacidade`. O sitemap continua listando essas páginas, mas `api/pagina.mjs` serve todas, exceto a Home, com `noindex`, inclusive as que não dependem de preço (guia, glossário, termos, privacidade). Proposta: decidir se as páginas sem dados de preço devem continuar indexáveis durante a falha ou sair do sitemap nesse cenário.
  - `SEO-DESCRICAO-LONGA` (baixa) na Home: a description estática do `index.html` tem 199 caracteres e é servida quando não há SSR. Proposta: encurtar para até 160 caracteres.

Nenhuma dessas propostas foi implementada: mudar SEO de produção exige tarefa e revisão próprias.

## Contrato (MAPA-DE-AGENTES §6)

1. **Missão:** auditar indexabilidade, canonical, sitemap, metadados, conteúdo vazio e frescor, e propor correções com evidência. Fora do escopo: criar páginas, textos, reviews, preços, ratings, estatísticas ou claims; publicar.
2. **Dono humano:** proprietário do repositório. **Dados:** `api/pagina.mjs`, `api/sitemap.mjs`, `vercel.json`, `robots.txt`, `state.json`.
3. **Entrada:** HTML, sitemap, `vercel.json`, `robots.txt` e frescor. **Saída:** `report()`, com o schema `{ agente, modo, publica, enabled, prontidao, inventario, porSeveridade, findings[], abstencoes[] }`.
4. **Observado × inferido:** só sinais lidos do HTML/configuração. Recomendações são propostas, marcadas como tal.
5. **Permissões:** nenhuma escrita. A CLI só escreve com `--out`, num arquivo local escolhido por quem a executa. Proibido: rede, banco, publicação, alteração de ranking/score/catálogo/preços/Copag.
6. **Idempotência:** determinístico para a mesma entrada, sem efeitos colaterais.
7. **Orçamento:** local, cerca de 2 s para 159 URLs. Sem chamadas de modelo.
8. **Abstinência:** sem HTML, sitemap, configuração, host ou frescor, registra abstenção e não recomenda.
9. **Métricas:** contagem por severidade e abstenções. Precisão/recall em produção ainda não medidas (casos sintéticos medem regressão).
10. **Testes:** `test/seo-content-agent-tests.js` (casos dourados + CLI de ponta a ponta offline) e `test/seo-content-hardening-tests.js` (frescor real/desconhecido, canonical, robots/sitemap, rastreabilidade de toda regra, entradas congeladas, gate fechado e CLI sem escrita fora de `--out`).
11. **Rollout:** desativado por padrão. Ver o plano de ativação.
12. **Aceite:** CI verde no PR e revisão independente.

## Plano de ativação (não iniciar sem os itens abaixo)

1. Fechar os bloqueios do gate: burn-in de 7 dias verdes; fonte canônica documentada (Fase 8); política de conteúdo/editorial aprovada; Search Console verificado e acesso autorizado; acesso autorizado ao analytics, com volume mínimo.
2. Atualizar `docs/seo-content-readiness.json` só com evidência verificável (link de issue/PR/run ou arquivo).
3. Rodar a auditoria contra o host de produção somente em tarefa reclassificada (leitura externa) e com autorização.
4. Ativação recorrente (por exemplo, relatório periódico) só por PR própria, com `authorized: true` vindo de decisão registrada, sem publicação automática. Qualquer mudança de SEO de produção segue o Release Governor.
