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
- Cálculo de frete por CEP no site (#84): núcleo em `api/_lib/shipping-calc.mjs` (vai no pacote da função da Vercel; `src/` não vai, ver `.vercelignore`), reexportado por `src/shipping-calc.js`. Testes sem rede: `test/shipping-calc-tests.js` (núcleo) e `test/shipping-calc-route-tests.js` (rota, `resolveVtexOffer`, cliente HTTP da API e interface em sandbox).
  - CEP: 8 dígitos, normalizado para `12345678`; recusa formato errado, faixa `00…` (inexistente) e sequências de um dígito só (`11111-111`).
  - Destino só do servidor: o cliente manda `offerId`, `cep` e `quantity`. Loja, item e vendedor vêm de `resolveOffer` no servidor; `base`/`itemId`/`sellerId` vindos do pedido são ignorados (evita SSRF).
  - Cotação VTEX (`orderForms/simulation`). Na API: `apiVtexFetchQuote` (`api/_lib/shipping-fetch.mjs`): `assertSafeUrl` antes de conectar, robots.txt da loja (cache de 1 h; proibido = "não disponível"; robots que não abre = não consulta), redirecionamento não seguido, UA do robô, timeout (3 s robots + 6 s cotação, abaixo do prazo de 12 s da função), resposta até 1 MB, uma requisição por loja por vez. No robô/scripts: `vtexFetchQuote` de `src/shipping-calc.js`, por `request()` de `src/http.js`. `assertSafeUrl` e as regras do robots.txt moram em `api/_lib/urlguard.mjs` e `api/_lib/robots-rules.mjs` (src/ reexporta/usa; mesma lógica de antes).
  - Cache: só cotação OK, por loja+item+vendedor+quantidade+CEP, TTL de 5 min (`QUOTE_TTL_MS`). Falha não é cacheada.
  - Rate limit: 10 consultas novas/min por cliente (IP) e 3/min por chave. Cache hit não conta.
  - 429 ou bloqueio: cooldown **por loja** de no mínimo 30 min. Um `Retry-After` maior é respeitado até 6 h. Até vencer, a loja não é chamada (desenho da #188: não insistir).
  - Frete desconhecido (falha, timeout, 5xx, sem opção, cooldown): `shippingKnown:false`, sem preço de frete e sem total. Nunca R$ 0,00.
  - Ordenação por "menor total": sempre `byComparableTotal` de `api/_lib/offer-rank.mjs` (`rankByComparableTotal`). Não há regra própria.
  - Auditoria: origem, horário e só o prefixo de 3 dígitos do CEP.
  - **Rota atrás da flag, desligada por padrão**: `GET /api/v1/frete?oferta&cep&quantidade` e `GET /api/v1/frete/estado` (em `api/v1.mjs`). Sem `SHIPPING_CALC_ENABLED=1` as duas respondem 404 sem carregar o módulo nem ler dados. Respostas `no-store` (nada de CDN); 429 do limite por IP vai com `Retry-After: 60`.
  - **Só VTEX. De onde vêm item e vendedor** (`resolveVtexOffer`): do `state.json` do robô (o mesmo que a API já lê por `legacyState`). A oferta guarda `sku` = `itemId` da VTEX (`src/adapters/vtex.js`: `sku: it.itemId`) e `sellerId` (vendedor padrão); a fonte da loja (`st.sources`) guarda `platform: "vtex"`, `status` e `url` (a base do coletor). Só cota oferta com estoque, leitura atual e sem anomalia, de loja VTEX `ACTIVE` com base `https` no mesmo host do link da oferta; item/vendedor fora de `[\w.-]{1,40}` são recusados. Nada novo é persistido: o `state.json` do ramo `data` já tem esses campos (o `data/state.json` da `main` é uma cópia antiga, anterior ao `sellerId` nas ofertas). No modo banco os ids das ofertas são os mesmos (`legacy_id`), então a página usa o mesmo id.
  - **Limites por instância**: cache, limites e cooldown vivem na memória da instância da função (como o cache da API). É proteção por instância, não global; um limite global precisaria de armazenamento compartilhado (fora deste escopo).
  - **Interface** (`index.html`, página do produto, card "Calcular frete" depois de "Onde comprar"): só aparece quando `/api/v1/frete/estado` responde 200 e há oferta com estoque de loja listada (até 5 ofertas, das mais baratas). Campo "CEP de entrega" com `label`, dica e erro ligados por `aria-describedby`, `aria-invalid` no erro e foco de volta no campo; aviso em `role="status"`/`aria-live="polite"` (calculando, resultado, escolha, expirada); foco vai para o título do resultado. Lista ordenada por `byComparableTotal` (cópia na página idêntica à de `offer-rank.mjs`, conferida no teste): frete confirmado primeiro, por total; frete desconhecido (falha, timeout, cooldown com horário, limite, indisponível, expirada) aparece como "Preço antes do frete · frete a calcular", nunca R$ 0,00. Escolha da modalidade por rádio recalcula total e ordem. Cotação vence em 5 min: a página redesenha e pede para calcular de novo. O `tools/page.template.html` não recebeu a interface: ele já está atrás do `index.html` na página do produto (não tem as mudanças da #178) e o `index.html` é o arquivo publicado.
  - Lojas sem fonte autorizada mostram "Frete não disponível para cálculo no site" e o link da loja.
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
