# Arquitetura, estado e matriz de testes

Visão única do que existe no repositório, do que é testado e do que continua bloqueado ou planejado. Descreve o código da branch `main` na data do levantamento (2026-10-10), não o plano ideal.

**Limites deste levantamento.** Foi feito lendo código, workflows e cabeçalhos dos testes. Os testes **não foram executados** para escrever este documento, então a coluna "Status" diz o que o código e os testes declaram, não um resultado de execução. Não foi possível consultar PRs abertas nem o histórico de execuções do Actions: onde isso importa, está marcado "sem evidência". Revise a matriz quando uma PR mudar o comportamento descrito.

Legenda: **Implementado** = existe no código e tem teste; **Implementado, sem teste dedicado** = existe, sem teste próprio; **Desligado** = existe mas está desativado por configuração; **Planejado** = não existe no código; **Externo** = depende de configuração fora do repositório.

## 1. Fluxo V1 (uma rodada)

Disparo: `hunter.yml` (cron a cada 15 min, mais uma rodada diária às 09:17 UTC que também roda `discover` e `copag-check`; também manual). Cron-job.org dispara o mesmo workflow (ver `PRODUCT.md`, `docs/vigia.md`).

1. `src/run.js` (`runOnce`) lê `config/stores.json`, `config/catalog.json`, `config/watchlist.json`.
2. Coleta por loja com o adaptador da plataforma (`src/adapters/*`), respeitando `src/robots.js` e a trava de link `src/gate.js`.
3. Casa o anúncio com o catálogo (`src/match.js`; overrides de revisão em `config/matching-overrides.json`, desligados). Na dúvida, não casa.
4. Registra preço, frete e estoque (`src/history.js`, `data/history.jsonl`), calcula desconto, R$/booster, anomalia e reputação (`src/score.js`, `src/distrust.js`).
5. Lê a nota oficial de oportunidade do banco (`src/opportunity-read.js`); sem nota válida, não inventa nota.
6. Avalia alertas (`src/alerts.js`) e envia por Telegram e ntfy.
7. Grava `data/state.json`, `data/meta.json` (seção `ops`) e publica no ramo `data` (`tools/push-data.sh`).
8. Passo "Sincronizar com o banco" (`tools/db-sync.mjs`, `src/core/sync.js`): grava no PostgreSQL e roda o Opportunity Engine (`tools/db-opportunity.mjs`). Sem o secret `DATABASE_URL`, o passo pula.
9. Passo "Agentes (fila de revisão)" (`tools/agents-run.mjs`): `continue-on-error`, nunca derruba a rodada.

Leitura: `index.html` (painel estático) e `api/v1.mjs` (função da Vercel). A API lê o banco quando há `API_DATABASE_URL` e cai para `data/state.json` quando o banco falha ou está velho (`api/_lib/freshness.mjs`).

## 2. Fontes de dados

| Fonte | Onde | Observação |
|---|---|---|
| Lojas | `config/stores.json` | 20 entradas; 2 com `enabled: false` (bloqueiam robôs); 3 marcadas `unsupported`; 1 `mercadolivre`; 1 `vtex`; as demais `auto` |
| Catálogo | `config/catalog.json` | coleções, tipos, boosters; preço Copag manual vence o capturado |
| Referência Copag | `data/copag-msrp.json`, `db/reference-imports/`, `tools/copag-reference-audit.json` | ver seção 3 |
| Pistas e dicas | `config/pistas.json`, `src/tips.js`, `data/tips.json` | |
| Reputação | `config/reclameaqui.json`, campo `evidence` das lojas | sem evidência, loja sem validação |
| Estado publicado | `data/state.json`, `data/offers.json`, `data/history.jsonl`, `data/meta.json` | ramo `data` é a fonte oficial publicada |
| Banco | PostgreSQL, `db/migrations/001`–`009` | Marketplace Core, preços, referências, oportunidades, revisão |

## 3. Referência Copag

- Captura automática na loja oficial: `src/copag-check.js` (`npm run copag-check`), roda na rodada diária. Esgotado na Copag = "não confirmado".
- Cadastro manual em `config/catalog.json` vence o capturado. Marketplace nunca vale como fonte.
- No banco: tipos de referência (migração 006), política de referência atual "Copag atual > mercado robusto > nenhuma" (007, `src/core/references.js`, `api/_lib/references.mjs`), comparação na oportunidade (008). Importação: `tools/db-import-references.mjs` (`npm run db:references`, `src/core/reference-import.js`).
- Sem referência confirmada: sem desconto, score, selo nem alerta de preço.

## 4. Coletores

| Plataforma | Arquivo | Estado |
|---|---|---|
| Shopify | `src/adapters/shopify.js` | Implementado |
| VTEX | `src/adapters/vtex.js` | Implementado; frete por CEP só aqui |
| JSON-LD genérico | `src/adapters/jsonld.js` | Implementado; aceita `productUrls` por loja |
| Mercado Livre | `src/adapters/mercadolivre.js`, `src/mlauth.js`, `api/ml-callback.mjs`, `tools/ml-token.mjs` | Implementado; **só com token OAuth** (Externo). Cache do catálogo preservado em falha total |
| Amazon, Shopee, Magalu | `platform: unsupported` | Planejado/bloqueado: sem API pública, o agente não contorna bloqueio |
| Lojas sem domínio | `config/stores.json` | Bloqueado: "Domínio a confirmar" até preencher `url` |

Falha passageira de coleta não vira remoção, reposição nem queda falsa (testado em `test/collectors-tests.js`).

## 5. Preço e frete

- Preço: Pix preferido (`src/score.js`, `pickPrice`); anomalia (`isAnomalous`); estatísticas em `src/core/price-stats.js`; motor de preço no banco em `src/core/price-engine.js`.
- Cálculo de frete por CEP no site (#84): `src/shipping-calc.js` é o núcleo (validação de CEP, opções com modalidade/preço/prazo como a loja devolveu, cache curto por loja+item+vendedor+quantidade+CEP, rate limit, origem e horário, auditoria só com prefixo do CEP). Frete sem cotação confirmada é desconhecido, nunca R$ 0,00. Lacuna aberta: o endpoint e o botão "Calcular frete" na oferta ainda não estão ligados (a API pública da oferta não expõe `sellerId`/item VTEX); só VTEX tem fonte autorizada, as demais lojas mostram "Frete não disponível para cálculo no site" e o link da loja.
- Frete: calculado só em VTEX, via CEP (`HUNTER_CEP`). Nas outras lojas "não informado" e o total é só o produto. Falha da simulação não vira queda de frete: o último frete fica, com data e motivo.
- Mercado composto e deduplicado: `src/core/price-engine.js` e testes `market-*`.

## 6. Alertas

- `src/alerts.js`: regras de `config/watchlist.json`, anti-spam (`data/alerts-sent.json`), canais Telegram e ntfy. Nota lida da oportunidade oficial.
- Não existe: WhatsApp, e-mail, cupom/cashback, modos Investimento, Abertura e Colecionador (**Planejado**).

## 7. Opportunity Engine

`src/core/opportunity-engine.js` (puro) e `src/core/opportunity-run.js` (banco), nota 0–100, faixas excelente/boa/normal/baixa. Escreve só no banco; o robô só lê. API: `/api/v1/oportunidades`. Snapshots de comparação em `db/snapshots/` e ferramentas `tools/opportunity-*.mjs`.

## 8. Agentes e revisão humana

Detalhe em `docs/agentes.md`. Resumo do que o código faz:

- **Orchestrator** (`src/agents/orchestrator.js`, `stores.js`): fila sobre `automation_job`, idempotência, retry, timeout, lease. Testado.
- **Handler `review.propose`** (sem IA): vira `review_item` aberto a partir de anúncios recusados ou aceitos com baixa confiança. Ligado no `hunter.yml`.
- **IA**: opcional por `AI_AGENTS_ENABLED=1`; **nenhum handler de IA está registrado** neste repositório. Catalog Agent com IA é **Planejado**.
- **Agente operacional?** Existe integração no workflow e testes. **Não há evidência neste levantamento** de execuções reais em produção; não declarar operacional sem conferir os logs do passo "Agentes" no Actions.
- **Revisão humana**: `src/core/review.js`, `tools/review.mjs`, `review.yml` (manual). Decisão auditada em `system_event`. Aprovação exporta para `config/matching-overrides.json` via PR em branch `review/overrides-*`; o override está **Desligado** (`enabled: false`). Tela própria da fila: **Planejado** (hoje Actions/CLI).

## 9. Vigia

`src/ops-watch.js`, `tools/watchdog.mjs`, `watchdog.yml` (cron 7,37 de cada hora no repositório). Regras e estados em `docs/vigia.md`. O job de 15 min no cron-job.org é **Externo** (dono da conta).

## 10. Workflows

| Workflow | Gatilho | Para quê |
|---|---|---|
| `ci.yml` | PR para `main` | `npm ci` + `npm test` com PostgreSQL descartável |
| `hunter.yml` | cron 15 min, diário 09:17, manual | rodada do robô (**mexe em produção**) |
| `watchdog.yml` | cron e manual | vigia |
| `review.yml` | manual | operar a fila de revisão |
| `db-validate.yml` | manual | validar migrations no banco real (usa secret) |
| `ml-auth.yml`, `logos.yml`, `diag.yml` | manual | autorizar ML, baixar logos, diagnosticar páginas |

## 11. Matriz feature → módulo → teste → status

Arquivos de teste em `test/`. "Banco" = só roda com `TEST_DATABASE_URL`; sem ela, o teste imprime que pulou e sai com sucesso.

| Feature | Módulo | Teste | Status conhecido |
|---|---|---|---|
| Coleta Shopify/VTEX/JSON-LD, lojas bloqueadas | `src/adapters/*`, `src/run.js` | `run-tests.js` | Implementado |
| Falha passageira de coleta, frete VTEX, ML cache | `src/adapters/*`, `src/run.js` | `collectors-tests.js` | Implementado |
| Mercado Livre (token, renovação, catálogo) | `src/adapters/mercadolivre.js`, `src/mlauth.js` | `ml-tests.js` | Implementado; produção depende de token (Externo) |
| Casamento com catálogo e overrides | `src/match.js` | `run-tests.js`, `review-tests.js` | Implementado; overrides desligados |
| Conversões do Core | `src/core/mappers.js`, `taxonomy.js` | `core-tests.js` | Implementado |
| Price Engine | `src/core/price-engine.js`, `price-stats.js` | `price-engine-tests.js`, `price-db-tests.js` (banco) | Implementado |
| Sync com o banco, duplicidades | `src/core/sync.js`, `src/db/*` | `db-tests.js` (banco) | Implementado |
| Referências (tipos, escopo, importação) | `src/core/references.js`, `reference-import.js` | `reference-tests.js`, `reference-db-tests.js` (banco) | Implementado |
| Política de referência atual | `src/core/references.js` | `reference-policy-tests.js` | Implementado |
| Dedup e composição do mercado | `src/core/price-engine.js` | `market-dedup-tests.js`, `market-composition-tests.js` | Implementado |
| Opportunity Engine | `src/core/opportunity-engine.js`, `opportunity-run.js` | `opportunity-engine-tests.js`, `opportunity-db-tests.js` (banco) | Implementado |
| Contrato `/api/v1/oportunidades` | `api/v1.mjs`, `api/_lib/read-db.mjs` | `opportunity-contract-tests.js` (parte B: banco) | Implementado |
| API v1 (home, produtos, ofertas, histórico, site) | `api/v1.mjs`, `api/_lib/*` | `api-tests.js` (parte B: banco) | Implementado |
| Frescor e fallback para `state.json` | `api/_lib/freshness.mjs` | `freshness-tests.js` (parte do banco) | Implementado |
| Segurança de deploy (imports da Vercel) | `api/**`, `.vercelignore` | `deploy-safety-tests.js` | Implementado |
| Página de oportunidades, home, conta | `index.html` | `opportunities-page-tests.js`, `home-page-tests.js`, `account-page-tests.js` | Implementado (sandbox, sem navegador real) |
| Consistência da nota na página | `index.html`, `src/server.js` | `score-consistency-tests.js` | Implementado |
| Alertas pela nota oficial | `src/alerts.js`, `src/opportunity-read.js` | `alerts-opportunity-tests.js` (parte B: banco) | Implementado |
| Vigia e estado operacional | `src/ops-watch.js`, `opstate.js`, `db-health.js` | `ops-detection-tests.js` (teste 19: banco) | Implementado; job externo pendente (Externo) |
| Orchestrator de agentes | `src/agents/orchestrator.js`, `stores.js` | `agents-orchestrator-tests.js`, `agents-db-tests.js` (banco) | Implementado |
| Integração dos agentes na rodada | `src/agents/cycle.js`, `matching-review.js`, `notify.js` | `agents-integration-tests.js` (parte banco) | Implementado; execução real sem evidência |
| Revisão humana | `src/core/review.js`, `tools/review.mjs` | `review-tests.js` (parte banco) | Implementado; fixture de 24 casos |
| Captura de preço Copag | `src/copag-check.js` | nenhum dedicado | Implementado, sem teste dedicado |
| Descoberta de lojas | `src/discover.js` | nenhum | Implementado, sem teste dedicado; precisa `BRAVE_API_KEY` (Externo) |
| Histórico e dicas | `src/history.js`, `src/tips.js` | cobertura indireta em `run-tests.js` | Sem teste dedicado |
| Inbox de lojas/produtos | `src/inbox.js` | cobertura indireta em `run-tests.js` | Sem teste dedicado |
| Servidor local e API legada | `src/server.js`, `api/_lib/legacy.mjs` | `score-consistency-tests.js` (parcial) | Parcial |
| SEO, sitemap, página | `api/_seo.mjs`, `api/sitemap.mjs`, `api/pagina.mjs` | nenhum dedicado | Sem teste dedicado |
| Telas de conta (Firebase) | `account.js`, `tools/account.src.js` | `account-page-tests.js` (Firebase simulado) | Parcial |
| Tela da fila de revisão | n/a | n/a | Planejado |
| Catalog Agent com IA | n/a | n/a | Planejado |
| WhatsApp, e-mail, cupom/cashback, modos Investimento/Abertura/Colecionador | n/a | n/a | Planejado |
| Amazon, Shopee, Magalu | `config/stores.json` (`unsupported`) | n/a | Bloqueado |

## 12. Comandos reprodutíveis

Requisitos: Node 20+ (o CI usa Node 22) e `npm ci`.

```bash
npm ci --no-audit --no-fund
npm test                      # suíte completa (28 arquivos em sequência); testes de banco são pulados sem TEST_DATABASE_URL
node test/collectors-tests.js # um arquivo isolado (o mesmo vale para qualquer test/*-tests.js)
```

Testes de banco, só contra um PostgreSQL **descartável** (nunca o de produção). Exemplo igual ao do CI:

```bash
docker run --rm -d -p 5432:5432 -e POSTGRES_PASSWORD=pw postgres:17
TEST_DATABASE_URL=postgres://postgres:pw@localhost:5432/postgres npm test
```

No PowerShell: `$env:TEST_DATABASE_URL = 'postgres://postgres:pw@localhost:5432/postgres'` e depois `npm test`.

Outros comandos (não são testes; os que tocam banco exigem `DATABASE_URL` e não devem apontar para produção sem autorização):

```bash
npm run hunt            # uma rodada local (escreve em data/)
npm run serve           # painel e API local em http://localhost:8787
npm run copag-check     # captura preços na loja Copag (acessa a rede)
npm run opportunity:compare   # compara oportunidade sobre data/
npm run api:compare           # compara API sobre data/
```

Sem `TEST_DATABASE_URL` os testes marcados "banco" passam sem exercitar o PostgreSQL: um `npm test` verde local não prova essa parte. O CI roda com banco.

## 13. Manutenção deste documento

Ao entregar uma feature, atualize a seção correspondente e a matriz. Marque como implementado só o que existe no código; marque como operacional só com evidência de execução (log do Actions, registro em `data/meta.json → ops`).
