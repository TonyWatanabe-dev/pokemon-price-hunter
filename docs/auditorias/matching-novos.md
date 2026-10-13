# Auditoria de lacunas: matching de lançamentos e produtos novos

Escopo: produto fora do catálogo, pré-venda e coleção nova. Complementa `docs/auditorias/matching.md` (idioma, mega, EAN, aliases já listados lá: não repetidos aqui).
Fontes lidas (só leitura): `src/match.js`, `src/discover.js`, `src/run.js`, `config/catalog.json`, `tools/review.mjs`, `test/sealed-matching-tests.js`, `test/review-tests.js`. Sondagens com `matchProduct` e títulos sintéticos; nada foi alterado.

## 1. Mapa (arquivo e trecho)
| Onde | Trecho | Papel para produto novo |
|---|---|---|
| `src/match.js` `detectCollection` | `fallbackAliases` (`fb.length === 1`) | coleção só por alias do catálogo; fallback devolve `fallback: true` |
| `src/match.js` `detectStock` | `/\b(pre ?venda\|pre-venda\|encomenda\|lancamento previsto\|reserva)\b/` | marca `parsed.preorder` |
| `src/match.js` `matchProduct` | `'coleção não identificada'`, `confidence -= 0.1` no fallback | coleção nova vira não casado |
| `src/match.js` `applyOverride` | `OVERRIDABLE` | revisão humana só resolve 3 motivos; coleção inexistente no catálogo é recusada (`catalog.collections.some`) |
| `src/run.js` l.261 | `unmatched.push(...)` se título tem "pokémon"; l.489 `unmatched.slice(0, 200)` | fila de itens sem match |
| `src/run.js` l.270 | `m.parsed.preorder && stock !== 'OUT_OF_STOCK'` | pré-venda só altera estoque, não o match |
| `src/discover.js` | `QUERIES` + `catalog.collections.map(...)` | descobre **lojas**, não produtos; consultas derivam só de coleções já cadastradas |
| `config/catalog.json` | 24 coleções, 2 `products` fixos | produto novo exige edição manual do catálogo |

## 2. Já coberto
- `parsed.preorder` marcado com "Pré-venda" e falso sem o termo: `test/sealed-matching-tests.js` (l.166).
- Pré-venda → estoque é lançamento, não restock; JSON-LD `PreOrder`: `test/availability-tests.js` (l.11-47).
- Teto de score para pré-venda: `src/core/opportunity-engine.js` (`CAPS.preorder`), `test/golden-eval-tests.js` (l.45).
- Overrides (enabled, motivos permitidos, coleção divergente): `test/review-tests.js`.
- Coleção desconhecida não casa ("coleção não identificada"): sondagem abaixo; teste direto não localizado.

## 3. Lacunas priorizadas
**Alta**
1. *Coleção nova da família "Mega Evolução" cai em `me01`.* `me01` tem o fallback `mega evolucao`. Sondagem: "Booster Box 36 boosters Mega Evolução 99" → `me01-box36` (confiança 0.7); "Box Coleção Mega Evolução 6 Pré-venda" → `parsed.collection = me01`, `collectionFallback = true`. Uma expansão futura (me06...) sem alias no catálogo é misturada com `me01` e entra em preço/ofertas. Nenhum teste cobre "número de coleção desconhecido".
2. *Pré-venda não derruba a confiança nem sinaliza coleção nova.* `matchProduct` ignora `parsed.preorder`; um lançamento com fallback casa com 0.7 e é publicado.

**Média**
3. *"pre-order"/"preorder"/"pré-lançamento" não são detectados.* `detectStock` não os inclui. Sondagem: "ETB Treinador Avançado Fogo Branco Pre-order" → `parsed.preorder = false`. Sem teste.
4. *Fila de revisão perde coleção nova.* `unmatched.slice(0, 200)` (`src/run.js` l.489) e `applyOverride` recusa coleção fora do catálogo: não há caminho para o revisor cadastrar a coleção nova; só o catálogo manual.
5. *"Box 36 Fogo Branco" sem a palavra "boosters"* → "quantidade de boosters não informada" (falso negativo seguro, comum em pré-venda com título curto). Sem teste.

**Baixa**
6. *Sem agrupamento de não casados por coleção provável.* Itens "coleção não identificada" não são contados por termo recorrente, então um lançamento aparece como vários itens soltos.

## 4. Tarefas propostas (pequenas, independentes)
| # | Tarefa | Arquivos | Risco | Aceite testável |
|---|---|---|---|---|
| T1 | Teste que documenta o fallback `mega evolucao` com número desconhecido (hoje → `me01`) e decide: rejeitar quando o título traz número de coleção fora dos aliases | `test/sealed-matching-tests.js`; `src/match.js` se decidido | R1 | "Mega Evolução 99" não casa `me01`; "Mega Evolução" sem número segue como hoje |
| T2 | Detectar "pre-order", "preorder", "pré-lançamento" em `detectStock` | `src/match.js`, `test/sealed-matching-tests.js` | R0 | os três títulos dão `parsed.preorder === true`; "Reservado" e títulos normais não |
| T3 | Teste: coleção desconhecida (sem fallback) → `productId` nulo e `why` "coleção não identificada", inclusive com "Pré-venda" | `test/sealed-matching-tests.js` | R0 | falha se coleção desconhecida passar a casar |
| T4 | Reduzir 0.05 de confiança quando `preorder` e fallback juntos (sinal de coleção nova) | `src/match.js`, `test/sealed-matching-tests.js` | R1 | pré-venda + fallback ≤ 0.65; pré-venda com alias exato mantém confiança |
| T5 | Teste de integridade: toda coleção do catálogo tem `fallbackAliases` que não contêm alias de outra coleção | `test/catalog-metadata-tests.js` | R0 | falha ao duplicar alias/fallback entre coleções |
| T6 | Aceitar título curto "Box 36 <coleção>" como 36 boosters apenas com confiança reduzida | `src/match.js`, `test/sealed-matching-tests.js` | R2 | "Booster Box 36 Fogo Branco" casa `sv10_5w-box36` com `boostersInferred`; "36 cartas" continua não casando |
