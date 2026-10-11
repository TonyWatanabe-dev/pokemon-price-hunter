# Histórico de preços: origem, qualidade e limitações

Resultado da auditoria da issue #46. Nenhuma migration nova, nenhum dado de produção alterado.

## Onde o histórico mora
| Camada | Onde | Granularidade |
|---|---|---|
| Log bruto | `data/history.jsonl` (45 dias) | uma linha por **mudança** de oferta, com `t` original, preço, frete, total, estoque; `event: 'removed'` quando a oferta some |
| Histórico por dia (legado, usado no site) | `data/hist/<produto>.json` (180 dias) | menor preço total **em estoque** de cada loja em cada dia: `[dia, valor]` |
| Banco | `price_history` (só INSERT, particionado) + `stock_event` | uma linha por mudança, `observed_at` original, `source = 'robot'` |
| Derivados | `price_daily`, `product_stats` (Price Engine) | série diária reconstruída; `history_status` = `ok` / `insufficient` |

## O que já é honesto
- Falha de coleta não vira preço nem estoque: ofertas `stale` não entram no log nem no histórico por dia, e a comparação usa a última leitura **válida** (sem falso restock/queda).
- Frete desconhecido não vira R$ 0: `total_price` fica nulo (CHECK no banco).
- Oferta removida é evento próprio (`removed` → `stock_event`), distinto de estoque esgotado e de preço inalterado (o log só grava mudanças; ausência de linha = inalterado).
- `timestamps` do log e do banco são os da leitura; `UNIQUE (offer_id, observed_at)` evita duplicata.
- O Price Engine exige `MIN_HISTORY_DAYS` (3) dias para estatísticas históricas.

## Mudança desta issue
`histSummary` (resumo usado no ranking "maior queda") agora:
- descarta pontos inválidos (dia malformado, valor nulo, zero, negativo, não numérico) em vez de tratá-los como preço;
- junta duplicatas do mesmo dia (fica o menor) e ordena;
- informa `enough` (>= 3 dias de dados válidos), alinhado ao Price Engine.

## Limitações conhecidas do legado (`data/hist`)
- Só guarda o dia, não a hora original da observação, nem a origem (JSON-LD, API da loja, marketplace) nem quantas leituras sustentam o ponto.
- Não distingue "sem leitura no dia" de "loja sem estoque" ou "falha transitória": dia sem ponto é só ausência de dado. O gráfico liga os pontos existentes; um buraco não significa preço inalterado.
- O backfill a partir do `history.jsonl` descarta preços fora de 0,55x–3x a mediana e usa só linhas em estoque com total > 0; o que veio antes da janela de 45 dias do log não é recuperável.
- Pontos de lojas lidas pela página antes da correção de dados (ver `src/distrust.js`) ficam no arquivo, mas são ignorados nas estatísticas até o dia de corte.
- Linhas de `price_history` anteriores à marcação de origem têm `source = 'robot'` por padrão; não há como separar leitura via API de leitura via página.

## Fora de escopo (decisão deliberada)
Distinguir ausência/falha transitória no esquema exigiria coluna nova em `price_history` e mudança no log do robô. Isso fica para uma migration **aditiva** separada, depois de revisão; a PR #20 não foi integrada nem reaproveitada.
