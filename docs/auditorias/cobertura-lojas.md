# Auditoria de lacunas: cobertura e saúde das lojas monitoradas (issue #374)

Escopo: leitura do código na `main` (`04b20fb`): `config/` (só leitura), `src/discover.js`, montagem da lista de lojas e status em `src/run.js`, `src/opstate.js`, `src/adapters/common.js` (`guard`), `api/_lib/stores.mjs`/`lojas.mjs` e os testes de lojas. Não existe `src/stores*`; o papel é dividido entre esses arquivos. Não repete `coletores.md` (contrato e adaptadores), `observabilidade.md` (`WATCHED_SOURCES` só com o Mercado Livre) nem `frescor-sync.md`. Lacunas "a confirmar" não foram reproduzidas em execução.

**Estado das fontes.** O `data/sources.json` da `main` é uma cópia antiga (`lastCheck` de 2026-10-06 a 2026-10-07); o estado vivo fica no ramo `data`. Contagem feita com script local sobre essa cópia, cruzada com a lista atual (`config/stores.json` + `config/lojas/*.txt`, mesma derivação de `src/run.js:120-134`):
- 116 lojas na lista atual. Na cópia: 35 ACTIVE, 28 BLOCKED, 10 UNAVAILABLE, 2 ERROR, 2 PAUSED e 39 sem registro (entraram depois da cópia).
- ACTIVE com 0 anúncios lidos: 13; com 0 casados: 14.
- Entre as BLOCKED, 6 são "fora do ar ou lento para responder" (timeout/DNS no `robots.txt`) e 1 é o Mercado Livre sem token OAuth. As outras 21 são de fato bloqueio do site.
- 13 registros de lojas que já saíram da lista (6 PENDING, 6 BLOCKED e `tcgculturecom` ACTIVE, retirada em 2026-10-12 para `removidas.txt`).

## 1. Mapa
| Módulo | Função / trecho | Papel |
|---|---|---|
| `config/stores.json` | `stores[]` (14: 1 vtex, 1 mercadolivre, 9 `auto`, 3 `unsupported`; 2 com `enabled:false`) | lojas com metadados e `evidence` |
| `config/lojas/*.txt` | um domínio por linha; `removidas.txt` só comentários | lojas extras (`fromList: true`) |
| `src/run.js:120-134` | leitura de `lojas.txt`, `config/lojas/*.txt`, `data/discovery-stores.txt` | dedupe por host; `id = host.replace(/[^a-z0-9]/gi,'')` |
| `src/run.js:175-181` | pré-checagens | `unsupported`→UNAVAILABLE, sem URL→PENDING, `enabled:false`→PAUSED, `BIG_MARKETPLACES` (linha 12)→UNAVAILABLE |
| `src/run.js:96-109,183-185` | `backoffMs`, espera de BLOCKED/ERROR | 15 min→6 h; 429 com curva própria e `Retry-After` |
| `src/run.js:190-192` | `src.platform \|\| detectPlatform(base)` | plataforma de loja `auto`, guardada em `sources` |
| `src/run.js:318,327-329` | ACTIVE (`listings`, `matched`, `lastNonEmpty`) / `e.blocked ? 'BLOCKED' : 'ERROR'` | status por loja |
| `src/run.js:463,476,484` | `cov` = `Object.values(sources)`; `state.sources` | cobertura e lista publicada |
| `src/opstate.js:22-34,37-49` | `storesSummary`, `classifyError` | resumo em `meta.json`; `e.blocked` → `'bloqueio'` antes de timeout/rede |
| `src/adapters/common.js:5-18` | `guard(url)` | `robots.txt` barrado → 403/429; inacessível → `BlockedError(..., 'unreachable')` |
| `src/discover.js` | `discover()` (Brave; `IGNORE`, `known` só de `stores.json`) | descoberta legada, usada com `HUNTER_DISCOVERY=0` (`hunter.yml:49-53`) |
| `src/discovery/hosts.js:1-25` | inventário de hosts conhecidos e `removidas.txt` | descoberta atual (DIE) não repropõe removidas |
| `api/_lib/lojas.mjs:85`, `api/_lib/stores.mjs:36-41` | `normalizeLojas`, `siteStores` | página/diretório de lojas a partir de `sources` |

## 2. O que já está coberto
| Comportamento | Teste |
|---|---|
| `lojas.txt` e `config/lojas/` somam lojas, ignoram duplicadas e marketplaces grandes | `test/run-tests.js:25,125-129` |
| Motivo real da falha (429, 403, desafio com 200, DNS/TLS/timeout/5xx distintos), sem query/token | `test/store-blocking-tests.js` (bloco 2) |
| `backoffMs`: 429 de 30 min a 2 h, demais até 6 h | `test/store-blocking-tests.js` (bloco 3) |
| Queda brusca para zero casados vira staleCopy, não "removed" | `test/store-blocking-tests.js` (blocos 4-6) |
| `lastFailure`/`waf`/`platformHint`, `removidas.txt` fora da coleta, relatório por WAF | `test/coleta-diagnostico-tests.js` |
| Diretório de lojas: domínio, HTTPS, `sem_ofertas` × `sem_dados_recentes` | `test/stores-tests.js` |
| Página de lojas: texto honesto (nunca "fora do ar"), sem preço | `test/lojas-page-tests.js` |
| Descoberta (DIE): IGNORE, removidas, handoff | `test/discovery-tests.js` |
| Robots e desconfiança por loja | `test/robots-distrust-tests.js` |

## 3. Lacunas atuais
**Alta**
- **Lojas retiradas continuam em `sources` para sempre.** Nenhum trecho de `src/run.js` apaga de `sources` uma loja que saiu da lista; `cov` (`run.js:463`), `storesSummary` (`opstate.js:23`) e `state.sources` (`run.js:484`) usam `Object.values(sources)` inteiro. Na cópia, 13 de 90 registros são órfãos: a cobertura (`found`, `blocked`) fica inflada e a página de lojas (`lojas.mjs:85`) mostra lojas retiradas (ex.: `tcgculturecom`, fora do escopo). Sem teste.
- **"Fora do ar" é contado como bloqueio.** `guard` lança `BlockedError` com `status: 'unreachable'` para DNS/timeout/TLS/5xx no `robots.txt` (`common.js:17`); `run.js:327` grava BLOCKED e `classifyError` devolve `'bloqueio'` porque testa `e.blocked` primeiro (`opstate.js:41`). O "não rastrear" é correto (e testado), mas `coverage.blocked`, `storesSummary.blocked` e `errorClass` misturam loja que barra robô com loja fora do ar (6 de 28 na cópia). Não há teste de `classifyError` para `'unreachable'`.

**Média**
- **Plataforma detectada nunca é refeita.** `run.js:190` usa `src.platform` gravado na primeira detecção; nada o apaga em falha (`run.js:319` limpa só `httpStatus`/`netCode`/`retryAfterSec`/`lastFailure`). Loja `auto` que migra de plataforma fica em ERROR com backoff até 6 h, sem nova detecção. A confirmar em execução.
- **Mercado Livre sem token aparece como BLOCKED/`bloqueio`.** `src/adapters/mercadolivre.js:74-75` lança `BlockedError(..., 'auth')`; é falha de credencial nossa, não da loja. Sem classe própria em `classifyError`.
- **ACTIVE vazia sem prazo.** 13 lojas ACTIVE com 0 anúncios na cópia; `lastNonEmpty` existe (`run.js:318`) mas nada o compara com um limite. O alerta por fonte já está em `observabilidade.md` (lacuna 3); aqui falta só o dado (dias desde `lastNonEmpty`) no resumo.

**Baixa**
- **Colisão de id**: `loja-x.com.br` e `lojax.com.br` geram o mesmo `id` (`run.js:132`) e dividem registro e ofertas. Sem teste.
- **`src/discover.js` sem teste e sem `removidas.txt`**: `known` vem só de `stores.json` (linha 15) e grava direto em `config/stores.json` (linha 38); com `HUNTER_DISCOVERY=0` pode repropor loja retirada. Nenhum arquivo de `test/` importa `src/discover.js`.

## 4. Tarefas propostas (pequenas e independentes, sem `index.html`)
1. **Teste e filtro de lojas órfãs** (R1). Arquivos: `src/run.js` (filtrar `sources` pelos ids da lista ao montar `cov`/`state.sources`, sem apagar o arquivo), `test/stores-orfas-tests.js`. Aceite: com uma loja em `sources.json` que não está na lista, `coverage.found` e `state.sources` não a incluem; o registro continua em `data/sources.json`.
2. **Classe própria para inacessível** (R1). Arquivos: `src/opstate.js` (`classifyError`: `status === 'unreachable'` → `timeout`/`rede` antes de `bloqueio`), `test/classify-unreachable-tests.js`. Aceite: DNS e timeout no `robots.txt` dão `rede`/`timeout`; 403, 429 e desafio continuam `bloqueio`; status segue BLOCKED (não rastrear).
3. **Redetecção de plataforma após falhas** (R1). Arquivos: `src/run.js`, `test/platform-redetect-tests.js`. Aceite: loja `auto` com `src.platform` gravado e N falhas seguidas (ex.: 3) chama `detectPlatform` de novo; com menos falhas, não.
4. **Classe `auth` para credencial ausente** (R1). Arquivos: `src/opstate.js`, `test/classify-auth-tests.js`. Aceite: `BlockedError` com `status: 'auth'` vira `errorClass: 'auth'`; os demais casos de `classifyError` não mudam.
5. **Teste de colisão de id** (R0). Arquivos: `test/store-id-collision-tests.js`. Aceite: teste documenta que dois hosts que diferem só por hífen geram o mesmo `id` hoje (fixa o comportamento para decisão posterior).
6. **Teste do `discover.js` legado** (R0). Arquivos: `test/discover-legacy-tests.js` (fetch simulado, `BRAVE_API_KEY` falsa, pasta temporária). Aceite: sem chave não grava nada; host já em `stores.json` e host da `IGNORE` não entram.
