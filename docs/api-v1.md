# API v1 — contratos e validação de entrada

Implementação: `api/v1.mjs` (função única). Somente leitura (`GET`/`HEAD`); outros métodos retornam 405 com `Allow`.

## Endpoints

| Rota | Parâmetros |
|---|---|
| `/api/v1/home` | — |
| `/api/v1/produtos` | `pagina`, `limite`, `colecao`, `tipo`, `categoria`, `estoque`, `busca`, `ordem` |
| `/api/v1/produtos/:id` | `:id` = id ou slug |
| `/api/v1/produtos/:id/ofertas` | `pagina`, `limite`, `todas` |
| `/api/v1/produtos/:id/historico` | `dias` (1–365), `lojas` |
| `/api/v1/produtos/:id/estatisticas` | — |
| `/api/v1/referencias` | `pagina`, `limite`, `status` |
| `/api/v1/oportunidades` | `pagina`, `limite`, `faixa`, `colecao`, `categoria`, `referencia`, `minimo`, `abaixo`, `confianca_minima`, `produto`, `ordem`, `ofertas` |
| `/api/v1/site/produtos` | `modo`, `grupo`, `colecao`, `loja`, `tipo`, `max`, `abaixo`, `estoque`, `ordem`, `pagina`, `limite` |
| `/api/v1/site/ofertas` | `produtos` (até 60 ids), `colecao`, `tipo`, `busca` (ao menos um) |
| `/api/v1/site/produto/:id` | — |

`?fonte=state` força o fallback pelo `state.json`.

## Regras de validação (na borda)

- **Paginação:** `pagina` (mín. 1, máx. 10 000; no site, 1 000) e `limite` (1–50; no site, 1–60) são ajustados ao intervalo. Valor ausente ou não numérico usa o padrão (24; site 48). Não gera erro.
- **IDs/slugs** (`:id`, `produto`, `colecao` em oportunidades, `produtos`): devem casar `^[a-z0-9][a-z0-9_.-]{0,120}$`; senão 400. Id válido inexistente: 404.
- **Enumerações** (`ordem`, `faixa`, `referencia`, `status`, `modo`, `grupo`, `ofertas`): valor fora da lista retorna 400 com a lista aceita.
- **Numéricos:** `minimo`, `abaixo`, `confianca_minima` são ajustados a 0–100; `max` (site) deve ser número finito ≥ 0, senão 400.
- **Textos livres** são aparados e truncados (`busca` 60/80, `colecao`/`tipo` 40 etc.).
- Rota desconhecida: 404.

## Erros

Formato único: `{ "error": "mensagem" }`. Nunca inclui stack trace, SQL, URL ou credenciais. Falha do banco cai no `state.json`; se isso também falhar, 503 com `{ "error": "dados indisponíveis no momento" }`. O detalhe técnico do banco só vai ao log do servidor, com segredos mascarados.

| Status | Quando |
|---|---|
| 400 | parâmetro inválido |
| 404 | rota ou recurso inexistente |
| 405 | método diferente de GET/HEAD |
| 503 | dados indisponíveis ou sem horário confiável |

## Compatibilidade

- Contratos públicos não mudam sem justificativa e teste. Campos podem ser acrescentados; remoção ou mudança de significado exige nova versão (`v2`).
- Mudança neste lote: `site/produtos?max=Infinity` passou de aceito para 400 (valor não finito). Os demais comportamentos permanecem.
- Testes: `test/api-tests.js` cobre parâmetros inválidos, recurso inexistente, método e rota desconhecidos.
