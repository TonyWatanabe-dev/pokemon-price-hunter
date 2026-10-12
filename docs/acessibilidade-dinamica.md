# Auditoria de acessibilidade do conteúdo dinâmico

Etapa 1 da #98 (Refs #98). Só descreve o que existe no código; nada foi alterado fora deste arquivo.
Fontes lidas: `index.html` (SPA, linhas citadas), `account.js` e `test/a11y-dynamic-tests.js`.
`account.js` é um bundle minificado (Firebase Auth, uma linha): não tem marcação nem foco; a UI da conta vive em `index.html`.

## 1. Inventário (regiões que mudam sem recarregar)

| Região | Onde | Mecanismo |
|---|---|---|
| Conteúdo principal (resultados, preços, páginas) | `#view` (`index.html:1334`), `render()` (2478) | `innerHTML` por view |
| Carregando (esqueleto) | `loading()` (2898), `#view .layout` (2907, 2988) | `<div class="layout" aria-busy="true">` |
| Erro de carga de preços | `index.html:3012`, `3036` | `.empty.err-state role="alert"` |
| Erro/vazio das oportunidades | `OPP.status` (2745–2748), `#opp-more` (2774) | `role="alert"` / `.empty` sem role |
| "Carregar mais" de produtos | `#prod-more` (2995) | `.soft-empty role="alert"` |
| Lista de oportunidades em atualização | `.opp-list` (2755) | `aria-busy="${OPP.status==="loading"}"` |
| Frescor dos dados | `#fresh` / `#fresh-t` (1323) | `aria-live="polite"` |
| Toast | `#toast`, `toast()` (1361, 1428) | `role="status" aria-live="polite"` |
| Ticker de atividade | `.ticker` (1700) | `aria-live="off"` |
| Busca (resultados/vazio) | `renderSearch()` (2575–2578) | título `h2` com contagem, `.empty` |
| Vazios de listas | 1901, 1983, 2748, 2853 | `<div class="empty"><h3>` sem role |
| Alertas de preço | `renderAlerts()` (2462) | `innerHTML` em `#view` |
| Explicação do Opportunity Engine | 1995 | `<p class="hnote" role="status">` |
| Conta (modal) | `#sheet` `<dialog aria-labelledby="sh-title">` (1338, 2264, 2334) | `showModal()`, mensagens 2303–2304 |
| Botões ocupados (login, excluir, favorito) | 2345, 2366, 2377, 2401 | `disabled` + `aria-busy="true"` |

## 2. Auditoria por região

- **`#view` na troca de página:** `render()` troca `innerHTML` e as rotas fazem `scrollTo({top:0})` (1417, 1419, 2568, 2110). Não há `focus()` nem anúncio: o foco permanece no link/botão clicado, que muitas vezes continua no DOM (navegação) ou some (conteúdo substituído), e o leitor de tela não ouve a nova página. `document.title` é atualizado (2486), o que ajuda só parcialmente.
- **Esqueleto:** `aria-busy="true"` existe, mas é removido ao substituir o `innerHTML`; como `#view` não é região live, nada é anunciado ao terminar.
- **Erros (`role="alert"`):** adequado e coberto por teste (`a11y-dynamic-tests.js`). Foco não é movido; o botão "tentar de novo" é alcançável por Tab.
- **Vazios (`.empty`):** sem `role="status"`; na busca, o `h2` com contagem (2575) não é anunciado ao digitar/buscar.
- **Frescor `#fresh`:** `aria-live="polite"` adequado; o botão "Atualizar dados" (`aria-label`) está dentro da região live, então o rótulo pode ser relido a cada atualização do texto.
- **Toast:** adequado (`role=status`). Mensagens repetidas com o mesmo texto podem não ser reanunciadas; o atraso por `toast.until` (1428) as enfileira.
- **Ticker:** `aria-live="off"` deliberado e testado.
- **Alertas (`renderAlerts`):** lista re-renderizada por `innerHTML`; remover/criar alerta confirma por toast, mas o foco é perdido quando o botão acionado é removido.
- **Favoritos:** `data-unfav` fica `disabled` com `aria-busy` (2401), sem texto de estado; ao concluir o botão pode desaparecer (foco perdido).
- **Sheet de conta:** `<dialog>` modal com `aria-labelledby`; erros de campo com `role="alert"` e `focusErr()` (2355) move o foco ao campo/erro; troca de aba foca `#a-email` (2339–2340). Este é o melhor tratamento de foco do app. Em `focusErr`, `.err` (`<p>`) não tem `tabindex`, então `.focus()` não tem efeito nele.
- **Nomes acessíveis:** botões de ícone têm `aria-label` ("Atualizar dados", "Buscar", "Fechar"); a busca tem `aria-label` (1621); navegação usa `aria-current` (2480). Botões `aria-busy` usam `color:transparent` (171), então o texto visível some, mas segue no DOM.
- **Ordem de leitura:** `#view` vem após o cabeçalho; a atualização in loco do DOM não altera a ordem. Modal `<dialog>` isola o fundo.

## 3. Lacunas priorizadas

1. **Alta (leitor de tela e teclado):** troca de página sem mover foco nem anunciar (`render()`).
2. **Alta (teclado):** foco perdido ao remover/re-renderizar itens (alertas, favoritos, "carregar mais").
3. **Média (leitor de tela):** vazios e contagem de resultados da busca sem `role="status"`.
4. **Média:** `focusErr()` tenta focar `<p class="err">` sem `tabindex="-1"`.
5. **Baixa:** botões `aria-busy` sem texto de estado ("Salvando…"); `aria-busy` do esqueleto sem fim anunciado.

## 4. Proposta de quebra (tarefas pequenas e independentes, sem dependência nova)

1. **Foco/título ao trocar de página:** após `render()` das rotas (1417, 1425), focar o `h1/h2` do `#view` com `tabindex="-1"`. Critério: teste em `test/` que lê `index.html` e exige o `tabindex="-1"` e a chamada `focus` no título.
2. **Vazios e contagem da busca anunciados:** `role="status"` em `.empty` de busca/lista e no `h2` de resultados (2575–2578). Critério: asserção de regex em `a11y-dynamic-tests.js`.
3. **Foco após remover alerta/favorito:** mover o foco ao próximo item ou ao título da lista (`renderAlerts`, `data-unfav`). Critério: teste que verifica a chamada `focus` no fluxo.
4. **`focusErr()` funcional:** `tabindex="-1"` nos `<p class="err">` (2303). Critério: asserção de regex no template.
5. **Texto de estado em botões `aria-busy`:** `aria-label`/texto "Salvando…" enquanto ocupado (2345, 2366, 2377). Critério: teste verifica o atributo.
