# Inventário dos estados da interface

Etapa 1 da #83. Descreve só o que existe hoje em `index.html` (SPA de arquivo único), `account.js` (módulo Firebase, minificado) e `api/v1.mjs` + `api/_lib/`. Nada aqui é proposta de código, exceto a seção 4.

## 1. Telas e fluxos

| Fluxo | Onde vive | Dados |
|---|---|---|
| Carga inicial | `load()`, `fetchHome()` (`/api/v1/home`), fallback `fetchState()` (`state.json`), `init()` | resumo "slim" da API; cai no `state.json` |
| Frescor global | `fresh()`, `freshTxt()`, `#fresh`, `#mini-t` | `freshState(S)`; limites testados em `test/freshness-tests.js` |
| Busca | `renderSearch()`, `searchBox()`, autocomplete (`.ac-empty`), `loadPage("b:…")` | `site/ofertas?busca=` |
| Produto e comparação | `renderProduct()`, `storeOffer()`, `loadPage("p:…")`, `loadHist()`/`drawHist()`, `loadPpOpp()`, `showScore()` | `site/produto/:id`, `produtos/:id/historico`, `oportunidades?produto=` |
| Lista de produtos | `renderProdutos()`/`renderProdutosApi()`, `moreProdutos()` | `site/produtos?…` (48 por página) |
| Oportunidades | `renderOpp()`, `oppBody()`, `moreOpp()`, `retryOpp()`, `pauseHTML()` | `oportunidades?…` |
| Home | `renderDeals()`, `loadHomeOpp()`, `podiumOppHTML()`, `radarHTML()`, `dropsHTML()` | `oportunidades?limite=…` + resumo da home |
| Favoritos e alertas | `renderFavs()`, `renderAlerts()`, `setFav()`, `setAlert()`, `saveField()`, `onUser()`, `authGate()` | Firestore via `account.js` (`load`/`save`) |

## 2. Estados por tela

"Teste" = arquivo em `test/`. "—" = nenhum teste encontrado que cubra o estado.

### Carga inicial / frescor
| Estado | Existe? | Como aparece | Teste |
|---|---|---|---|
| Carregando | sim | `loading()`: esqueleto `.skel` com `aria-busy`; na home só o pódio (`.pod-skel`) | — |
| Vazio legítimo | n/a | — | — |
| Falha de rede | sim | `load()`: `.empty.err-state` "Não conseguimos carregar os preços agora" + `#retry`; views privadas renderizam direto | `ui-states-tests.js` cobre `refresh()`, não o `load()` |
| Parcial | sim | `fetchHome()` inválida/sem `slim` devolve `null` e cai no `state.json` | — |
| Stale | sim | `freshTxt()`: atual / atrasado / desatualizado / indisponível; nunca "Ao vivo" sem idade | `freshness-tests.js` (4, 5) |

### Busca
| Estado | Existe? | Como aparece | Teste |
|---|---|---|---|
| Carregando | sim | autocomplete: "Carregando os produtos…" enquanto `S` não existe; página: `loading()` via `apiPageReady()` | — |
| Vazio | sim | "Não achamos esse produto" + sugestão de coleção; autocomplete "Nada encontrado…" | `search-product-flow-tests.js` (estado vazio) |
| Falha de rede | parcial | `loadPage` falso → `ensureFull()` (`state.json`); se também falhar, mesmo erro de `load()` com `#retry` | — |
| Parcial | sim | com estoque primeiro, sem estoque sinalizado | `search-product-flow-tests.js` (resultados parciais) |
| Stale | parcial | ofertas `stale` saem da lista salvo filtro "estoque" (`entries()`) | `offer-freshness-tests.js` (origem do dado) |

### Produto e comparação
| Estado | Existe? | Como aparece | Teste |
|---|---|---|---|
| Carregando | sim | `loading()`; nota do motor: "Carregando a explicação…" (`oppPop`) | — |
| Vazio | sim | "Produto não encontrado" (`renderProduct`); sem oferta viva: "Sem estoque confirmado agora" ou "Em pré-venda" | `search-product-flow-tests.js` |
| Falha de rede | parcial | explicação da nota: "Não consegui carregar a explicação agora"; histórico e Amazon (`loadAmz`) falham em silêncio | — |
| Parcial | sim | frete desconhecido: ofertas fora da comparação ("Frete a calcular"); sem nota: "Sem nota oficial" | `search-product-flow-tests.js` |
| Stale | sim | `o.stale`: chip "Leitura antiga: preço pode ter mudado"; `readNote()`: "Data da leitura desconhecida" + "Confira o preço na loja" | `offer-freshness-tests.js`, `search-product-flow-tests.js` |

### Oportunidades e home
| Estado | Existe? | Como aparece | Teste |
|---|---|---|---|
| Carregando | sim | `OPP.status==="loading"`: lista com `is-loading` e `aria-busy` | — |
| Vazio | sim | "Nenhuma oportunidade encontrada" / "Nenhuma oportunidade avaliada agora" | `home-page-tests.js` (parcial) |
| Falha de rede | sim | `status==="error"`: `.err-state` + `data-oppretry`; mais páginas: aviso `#opp-more` com nova tentativa | `ui-states-tests.js` |
| Parcial | sim | `status==="nodb"`: "Oportunidades indisponíveis… nenhuma nota é estimada" | `home-page-tests.js` |
| Stale | sim | `isPause()` (`stale_db` ou 503): `pauseHTML()`; retry automático a cada 5 min e ao voltar à aba (`revive()`, `visibilitychange`) | `freshness-tests.js` (5) |

### Favoritos e alertas
| Estado | Existe? | Como aparece | Teste |
|---|---|---|---|
| Carregando | parcial | `.accbtn.is-loading` enquanto `authPending()`; botões com `aria-busy` ao salvar | — |
| Vazio | sim | "Nada salvo ainda." nos favoritos; alertas vazios com chamada para abrir um produto | `account-page-tests.js` (favoritos) |
| Falha de rede | sim | `onUser`: toast "Não consegui carregar seus favoritos e alertas" (`ACC.loadFailed`); `saveErr()`: sessão expirada / sem conexão / genérico, com rollback do valor | `account-page-tests.js` |
| Parcial | sim | perfil sem `createdAt`/`name` é completado em `onUser` | `account-page-tests.js` |
| Stale | n/a | alerta mostra "Alvo … " contra `bestLive()` do `S` atual | — |

## 3. Lacunas (observadas no código)

**Afirma preço/estoque sem dado**
- `dealCard` usa `live(o)` para o estado (`oos` quando não é vivo) e `live()` descarta oferta `stale`; a leitura velha não é distinguida de "sem oferta" nesse cartão (confirmar na renderização).
- `outUrl`/botão "Ver oferta" na página de produto depende só de `best`; o aviso de leitura desconhecida é texto pequeno (`so-ship`), não bloqueia o botão.
- `setAlert` avisa "já tem loja nesse preço" usando `bestLive()` do `S` em memória, que só muda em `init()`/`refresh()`, sem checar `freshState` antes do toast.

**Retry que pode duplicar envio**
- `setAlert` troca o alerta por `p` (`filter` + novo item), então repetir não duplica o item, mas cada tentativa regrava a lista inteira com `at` novo e dispara `track("create_alert")` de novo.
- `setFav` monta `[...old, pid]` sem checar se `pid` já está em `old`; protegido só pela troca de estado do botão (não verificado em teste).
- `submitAlert` não desabilita o botão antes de `authGate`; `submitAcc` e `submitDel` desabilitam (`aria-busy`).
- `refresh()` tem trava (`refreshing`), `#retry`, `data-prodretry` e `data-oppmoreretry` ignoram clique repetido (testado). `retryHomeOpp` não tem trava própria.

**Falta de teste**
- `load()`/`#retry` da carga inicial e `ensureFull()`.
- `loading()` (esqueletos) e `apiPageReady()`.
- Falhas silenciosas: `loadHist`, `loadAmz`, `loadAfil`, `fetchHome` nulo.
- `setAlert`/`setFav`/`submitAlert` (duplo envio) e toast de alerta "já tem loja nesse preço".
- Retry automático por `revive()`/`oppTick()` ao ficar stale.

## 4. Proposta de quebra

1. **Teste de `load()` e `#retry`.** Arquivos: `test/ui-states-tests.js`. Aceite: falha de `fetchHome` e `fetchState` mostra `.err-state` com `#retry`; segundo clique não chama `load()` de novo; sucesso renderiza.
2. **Teste do fallback de página (`apiPageReady`/`ensureFull`).** Arquivos: `test/search-product-flow-tests.js`. Aceite: `loadPage` falso usa `state.json`; sem ele aparece o erro com retry; busca antiga não sobrescreve a nova.
3. **Duplo envio de alertas e favoritos.** Arquivos: `index.html` (`setAlert`, `submitAlert`, `setFav`), `test/account-page-tests.js`. Aceite: dois cliques seguidos geram uma gravação e um `track`; `setFav` não duplica `pid`.
4. **Aviso de leitura velha na ausência de oferta viva.** Arquivos: `index.html` (`dealCard`, `renderProduct`), `test/offer-freshness-tests.js` ou `test/search-product-flow-tests.js`. Aceite: produto só com oferta `stale` mostra que a leitura é antiga, não "Nenhuma loja com oferta agora".
5. **Falhas silenciosas visíveis (histórico).** Arquivos: `index.html` (`loadHist`, `drawHist`), teste novo em `test/ui-states-tests.js`. Aceite: histórico sem resposta mostra mensagem curta e não quebra a página.
6. **Alerta com dado fresco.** Arquivos: `index.html` (`setAlert`), `test/account-page-tests.js`. Aceite: com `freshState` desatualizado, o toast não afirma "já tem loja nesse preço".
