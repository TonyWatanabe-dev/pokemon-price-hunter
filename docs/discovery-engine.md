# Discovery Intelligence Engine (DIE) — v0

Descoberta de lojas e páginas de produto para o TCG Price Hunter, substituindo (atrás de flag) o `src/discover.js` legado.
Código em `src/discovery/`. Comando: `npm run discovery`. Relatório: `npm run discovery:relatorio`.

## Política (inegociável)
- Agente honesto: toda requisição sai por `src/http.js` (UA identificado `PokeHunterBR/1.0`, intervalo por host, guarda SSRF de `src/urlguard.js`). `robots.txt` é respeitado (`src/robots.js`). Nada de proxy, troca de UA, contorno de WAF/captcha.
- Nada simulado: conector sem chave fica registrado como **indisponível ("sem chave")** e a rodada diz isso no log e no ledger. Nenhum resultado é inventado.
- Limite de requisições (429) de um conector = conector **esgotado** nesta rodada (Retry-After anotado). Não insiste.

## Arquitetura (uma rodada)
```
connectors/  →  queries.js  →  ledger.js (seleção)  →  conector.search  →  pipeline.js  →  escritas
 brave/bing/     catálogo →      score heurístico       [{url,title,snippet}]   classifica/valida   data/discovery-stores.txt
 serper          consultas       budget por rodada                                                  data/discovery-urls.json
                                                                                                    data/discovery.json (ledger)
                                                                                                    data/meta.json (chave discovery)
```
`index.js` orquestra (`runDiscovery`) e nunca lança para quem chamou: erro vira `{ ok: false, error }`. `cli.js` sai sempre com 0 (melhor esforço; `DISCOVERY_STRICT=1` faz sair com 1 quando `ok: false`).

### Conectores (`src/discovery/connectors/`)
Contrato: `{ id, keyName, available(): boolean, reason, search(q, { count }) → [{ url, title, snippet }], cost: { unit: 'query', estimate } }`.

| id | chave | endpoint | estado |
|---|---|---|---|
| `brave` | `BRAVE_API_KEY` | `api.search.brave.com/res/v1/web/search` (country=BR, pt-br, count≤20) | usado em produção pelo `discover.js` legado; aqui com 429 → esgotado |
| `bing` | `BING_SEARCH_KEY` | `api.bing.microsoft.com/v7.0/search` (mkt=pt-BR) | implementação REST real, **não validada ao vivo**; a Microsoft anunciou a aposentadoria das Bing Search APIs (ago/2025) |
| `serper` | `SERPER_API_KEY` | `POST google.serper.dev/search` (gl=br, hl=pt-br) | implementação REST real, **não validada ao vivo** |

Escolha: `DISCOVERY_CONNECTOR=<id>` se disponível, senão o primeiro disponível na ordem do registro. Uma rodada usa um único conector.
Para adicionar um conector: criar `connectors/<id>.js` com `create(env)` seguindo o contrato (chamadas via `http.request`, nunca `fetch` direto, para o teste conseguir simular com `http.setFetch`) e incluir em `FACTORIES` de `connectors/index.js`. Sem chave, `available()` deve devolver `false` com `reason: 'sem chave'`.

### Consultas (`queries.js`)
Determinísticas a partir de `config/catalog.json`, mais novas primeiro (ordem inversa do catálogo). Tipos (`kind`):
- `store`: intenções de loja ("loja pokémon tcg lacrado", "booster box pokémon comprar", …), "loja de card game {cidade}" para 8 capitais, e por coleção "pokémon tcg {coleção} booster box", "blister pokémon {coleção}", "elite trainer box {coleção} comprar".
- `product`: coleção × formato (`PRODUCT_TYPES`: booster_box, etb, blister_4/3/2, lata, colecao, deck; rótulos de `TYPE_LABEL` sem parênteses).
- `ean`: `"<ean>"` para cada produto do catálogo com EAN.
Strings iguais (normalizadas por `match.normalize`) viram uma só. Com o catálogo atual: ~257 consultas.

### Ledger e seleção adaptativa (`ledger.js`, `data/discovery.json`)
```
{ version, queries: { [id]: { q, kind, runs, hits, newHosts, acceptedStores, acceptedUrls, lastRun, lastNewAt } },
  hosts: { [host]: { firstSeen, lastSeen, seenIn[], verdict, reason, verdictAt, why: { query, connector, signals } } },
  connectors: { [id]: { calls, errors, lastStatus, lastAt } },
  runs: [ { at, connector, queriesRun, queriesPlanned, queriesTotal, hits, newHosts, storesAccepted, storesCandidates, urlsAccepted, errors, stopped, durationMs, baseline, found, cost, counts, connectors } ] (últimas 30) }
```
Fórmula (heurística simples, **não é IA**; pesos iniciais a ajustar com o relatório):
```
score(q) = (acceptedStores + acceptedUrls + hits/20) / (runs + 1) + bônus
bônus    = 1,0 se runs == 0 (exploração) | 0,25 se a última rodada foi há mais de 7 dias (reativação) | 0 caso contrário
```
Seleção por rodada: as `DISCOVERY_BUDGET` (padrão 40) melhores, com no máximo 1/3 de consultas nunca rodadas; se faltarem consultas já rodadas, as vagas sobram para as nunca rodadas. Empate: ordem de geração.

### Pipeline (`pipeline.js`)
Para cada resultado: `assertSafeUrl` → host sem `www` → classificação:
- **marketplace/site da lista** (`hosts.IGNORE`, espelho de `BIG_MARKETPLACES` do `run.js` + `IGNORE` do `discover.js`) → `ignored`, sem requisição.
- **host de `config/lojas/removidas.txt`** (formato `# host | data | motivo`) → `removed`: nunca reproposto.
- **host conhecido** (`config/stores.json`, `config/lojas/*.txt`, `data/sources.json`, ofertas de `data/state.json`): se a URL parece página de produto (`isProductCandidate` de `src/adapters/jsonld.js`), a loja é jsonld/auto (plataforma observada em `sources.json`) e a URL não está nas ofertas nem no `url-cache.json` → entra em `data/discovery-urls.json[storeId]` (`storeId` = id de `stores.json`, ou `host.replace(/[^a-z0-9]/gi,'').toLowerCase()` como o `run.js` deriva para as listas `.txt`).
- **host novo** → validação honesta (uma vez por host por rodada; veredito guardado por `DISCOVERY_REVALIDATE_DAYS` = 30 dias): robots permite → página inicial via `http.get` → sinais BR (`.br`, `R$`, `lang=pt-BR`) → menciona Pokémon → TCG lacrado (`booster|treinador avan|elite trainer|tcg|estampas ilustradas`) → `detectPlatform`.
  - `accepted` (BR + lacrado + **preço em R$** + plataforma): linha **ativa** em `data/discovery-stores.txt` (ramo data; a main é protegida): `https://host  # DIE <conector> <queryId> <data>` → entra na coleta na próxima rodada do `run.js` (que lê qualquer `config/lojas/*.txt`).
  - `candidate` (BR + Pokémon, mas sem lacrado ou sem plataforma): linha comentada `# candidata https://host  # motivo (DIE …)` — conferir à mão.
  - `rejected`: só no ledger, com motivo.
Limites por rodada: `DISCOVERY_MAX_NEW_STORES` (10), `DISCOVERY_MAX_URLS` (50), `DISCOVERY_MAX_VALIDATIONS` (40 hosts validados; cada validação custa até ~5 requisições: robots, home, Shopify, VTEX, JSON-LD).

### Hand-off ao coletor (`handoff.js` + 4 linhas em `src/run.js`)
`loadHandoff(stores)` junta `data/discovery-urls.json[storeId]` em `store.productUrls` (só lojas `auto`/`jsonld`, mesmo host). O adaptador JSON-LD já lê `productUrls` fora do teto de 25 páginas novas. Depois da leitura, `handoff.seen(storeId, raw)`: URL que apareceu em anúncio sai da fila (passa a viver em `url-cache.relevant`); as outras contam uma tentativa e saem após 3 (`MAX_TRIES`). `handoff.save()` grava junto com o `url-cache.json`.

## Flags e variáveis
| nome | onde | efeito |
|---|---|---|
| `HUNTER_DISCOVERY` | var do repositório / env | `0` desliga o DIE (sem rede, sem escrita); no `hunter.yml` volta ao `npm run discover` legado. Qualquer outro valor/ausente: ligado, mas só age se houver conector disponível. |
| `BRAVE_API_KEY`, `BING_SEARCH_KEY`, `SERPER_API_KEY` | secrets | chaves dos conectores (ausentes = indisponível) |
| `DISCOVERY_CONNECTOR` | env | força um conector (se disponível) |
| `DISCOVERY_BUDGET` | var / env | consultas por rodada (40) |
| `DISCOVERY_MAX_NEW_STORES`, `DISCOVERY_MAX_URLS`, `DISCOVERY_MAX_VALIDATIONS`, `DISCOVERY_REVALIDATE_DAYS` | env | limites do pipeline (10 / 50 / 40 / 30) |
| `DISCOVERY_STRICT` | env | `1`: o CLI sai com 1 quando a rodada não teve sucesso |

Workflow (`.github/workflows/hunter.yml`): passo diário (`17 9 * * *`) roda `npm run discovery` (ou `npm run discover` com `HUNTER_DISCOVERY=0`) e depois `npm run copag-check`. `workflow_dispatch` com a entrada `discovery=true` força a descoberta fora do horário (e nessa execução a regra de intervalo não pula a rodada, para que `config/` e `data/` sejam gravados). `config/lojas/descobertas.txt` vai para a `main` por `tools/push-config.sh` (`git add config`); `data/discovery*.json` vão para o ramo `data` por `push-data.sh`.

## Como desligar
Variável `HUNTER_DISCOVERY=0` no repositório (Settings → Variables) → o passo diário volta ao `discover.js`. Para parar toda descoberta, remover também `BRAVE_API_KEY` (o legado também depende dela). Lojas já gravadas em `descobertas.txt` continuam na coleta até serem comentadas/movidas para `removidas.txt`.

## Como medir
`npm run discovery:relatorio` (só leitura): tabela por rodada, consultas com mais rendimento, status dos conectores, hosts por veredito e **baseline × agora** (hosts conhecidos, ofertas, ofertas ao vivo, produtos com oferta — o "antes" é o retrato gravado na primeira rodada do ledger; o "agora" lê o `state.json` atual, que no robô vem do ramo `data`). O resumo da última rodada também fica em `data/meta.json` sob `discovery` (o `mergeOps` do `opstate.js` preserva chaves desconhecidas).

Métricas que decidem se o motor vale a pena: lojas aceitas que viram ofertas casadas (ver `data/sources.json[id].matched`), URLs entregues que viraram `url-cache.relevant`, custo (consultas) por loja/URL aceita. Os pesos da fórmula devem ser revistos com esses números, não antes.

## Limites e custos
- Brave Search API, plano gratuito (conferir no painel, muda sem aviso): na documentação pública consta cerca de 2.000 consultas/mês e 1 consulta/segundo. Com `DISCOVERY_BUDGET=40` e uma rodada por dia: ~1.200 consultas/mês, dentro do limite, sem folga para rodadas forçadas frequentes. Um 429 interrompe a rodada e registra `stopped: 'conector esgotado'`.
- Bing e Serper têm cotas e preços próprios; nenhum dos dois foi exercitado ao vivo neste repositório (só offline, com `http.setFetch`).
- Validação de host novo: até ~5 requisições por host, com o intervalo por domínio do `http.js`; até 40 hosts por rodada.
- O ledger guarda as últimas 30 rodadas; `hosts` cresce com o tempo (um registro por host visto) — poda ainda não implementada.

## O que a v0 não faz
Não usa modelo de linguagem; não lê snippets para decidir; não pontua lojas por qualidade; não revalida vereditos antes de 30 dias; não remove lojas (isso continua manual via `removidas.txt`); não substitui o `discover.js` no código (só no fluxo diário, atrás da flag).

## 1ª rodada real (12/10/2026, conector Serper)

40 consultas, 393 resultados, 74 domínios novos analisados (34 rejeitados: 22 bloqueiam robôs, 8 sem robots.txt acessível, 3 sem Pokémon, 1 sem sinal BR), 5 aceitos, 1 candidato, 48 URLs de produto para lojas conhecidas. Revisão manual dos 5 aceitos: 2 lojas reais (suika.com.br, geralgeek.com.br → `config/lojas/descobertas.txt`) e 3 falsos positivos (loja do jogo digital TCG Pocket, portal B2B da Devir, revenda entre pessoas → `removidas.txt`). Ajustes que saíram dessa rodada:

- aceite exige preço em R$ na página inicial (os 3 falsos positivos não tinham; as 2 reais tinham);
- subdomínios de atacado/B2B (`empresas.`, `atacado.`, `b2b.`…) são ignorados sem requisição;
- URLs de produto não são enviadas para lojas que o robô não lê (BLOCKED/PAUSED/UNAVAILABLE);
- lojas aceitas vão para `data/discovery-stores.txt` (ramo data), lido por `src/run.js`; a escrita em `config/` falhava porque a main é protegida.
- o job do workflow subiu de 12 para 18 min (a rodada com descoberta era cancelada antes de salvar).
