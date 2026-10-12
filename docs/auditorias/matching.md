# Auditoria de lacunas: matching de produtos selados

Escopo: `src/match.js` (único módulo de matching), `config/catalog.json` (só leitura) e testes em `test/`.
Estado lido na `main` (c283216). Sondagens feitas chamando `matchProduct` com títulos sintéticos; nada foi alterado.

## 1. Mapa (`src/match.js`)
| Função / constante | Papel |
|---|---|
| `normalize` (l.5) | NFD sem acento, minúsculas, remove símbolos |
| `wordRe` (l.10) | regex de alias com fronteira de palavra |
| `REJECT`, `LOOSE_BINDER`, `MULTI_UNIT`, `BUNDLE`, `UNITS` (l.12-26) | rejeição: usado, avulso, acessório, lote |
| `LANG_TOKENS` / `detectLanguage` (l.30-51) | idioma só por palavra/abreviação explícita no título |
| `detectCollection` (l.69) | aliases, `combines` (produto conjunto), `fallbackAliases` |
| `detectBoosters` (l.83) | contagem de boosters (número, extenso, "box display"=36, 108/144/216 cartas) |
| `detectVariant` (l.100) | variante "X ex" / "ex X" / mega |
| `detectType` (l.111) | tipo: ETB, blister, lata, deck, combo, box, coleções |
| `parseListing` (l.168) | junta tudo e acumula `rejects` |
| `describeProduct` / `productIdOf` / `msrpKeys` (l.161-212) | id canônico `colecao-tipo[-variante]` |
| `matchProduct` (l.214) | EAN, rejeições, confiança (0.8 base) |
| `canonicalUrl`, `overridesIndex`, `applyOverride` (l.238-266) | overrides de revisão humana |

Catálogo: `config/catalog.json` tem `collections` (aliases, `fallbackAliases`, `combines`) e `products` (EAN fixo, poucos itens).

## 2. Já coberto (teste que garante)
- ETB x box x blister x combo x coleção viram produtos distintos: `test/sealed-matching-tests.js` (l.29).
- Contagem de boosters; box sem contagem não casa: `sealed-matching-tests.js` (l.52).
- Idioma diferente de PT não casa, nem com EAN: `sealed-matching-tests.js` (l.70).
- Coleção diferente / duas coleções: `sealed-matching-tests.js` (l.84).
- Variante e "X ou Y": `sealed-matching-tests.js` (l.97).
- Acessórios, usado/aberto, case/lote/kit da loja: `sealed-matching-tests.js` (l.107-120).
- EAN cadastrado vence, divergente bloqueia: `sealed-matching-tests.js` (l.126).
- Lote, "+ Box", caixa vazia, bundle, Box+Fichário/Pôster, booster x36: `test/sealed-false-positive-tests.js`.
- Overrides e `canonicalUrl`: `test/review-tests.js`, `test/agents-integration-tests.js`.

## 3. Lacunas atuais
**Alta**
1. *Idioma não-PT escapa (dado errado ao usuário).* `LANG_TOKENS` (l.30-40) só tem formas por extenso para es/fr/de/it e nenhuma abreviação (fr, de, it, es) nem "deutsch"/"espanol"/"español". Sondagem: "Booster Box Fenda Paradoxal 36 boosters FR", "ETB Fenda Paradoxal Deutsch" e "ETB Fenda Paradoxal Español" casaram (`sv4-box36`, `sv4-etb`); "... 36 boosters ES" também casou `sv4-box36`. Os testes de idioma (l.70) não cobrem essas formas.
2. *Variante mega perdida.* `detectVariant` (l.102-105) só reconhece "mega" antes de "X ex" ou depois de "ex"; "Box Pokemon ex Greninja ev6 mega" gerou `sv6-colecao_ex-greninja` (sem `mega-`), podendo misturar produtos no mesmo id. Sem teste de ordem do "mega".

**Média**
3. *Box 24 sem teste de tipo.* `detectType` l.130 aceita qualquer contagem >= 24 como `booster_box` (sondagem: "Booster Box ... 24 boosters" => `sv4-box24`); não há valor permitido validado contra o catálogo, e só `me04-box36` tem produto fixo com EAN.
4. *Pré-venda não influencia o match.* `preorder` é calculado (l.198), mas `matchProduct` ignora; sem teste que verifique o consumo do campo (só `availability-tests.js` para `stockOf`).
5. *Catálogo sem validação de aliases.* `detectCollection` assume aliases únicos entre coleções (l.70); nenhum teste varre `config/catalog.json` atrás de alias duplicado ou de `combines` apontando id inexistente (`catalog-metadata-tests.js` não testa isso).
6. *Overrides: comparação de EAN duplicada.* `applyOverride` (l.264) repete a normalização de `matchProduct` (l.216) em vez de reutilizar; divergência futura é risco (sem teste de EAN com zeros à esquerda no override).

**Baixa**
7. *Confiança quase constante.* `matchProduct` (l.230-234) usa 0.8/0.7/+0.05; sem teste de limites (inferido + fallback = 0.6).
8. *`GENERIC_OK` (l.109)* é lista fixa; palavra nova de loja ("original", "sealed") pode virar `extra` e bloquear "coleção" genérica (falso negativo, seguro, mas sem teste).

## 4. Tarefas propostas (pequenas, independentes)
| # | Tarefa | Arquivos prováveis | Risco | Critério de aceite |
|---|---|---|---|---|
| T1 | Ampliar `LANG_TOKENS` (fr, de, it, es, deutsch, espanol) com cuidado para "de"/"it" ambíguos | `src/match.js`, `test/sealed-matching-tests.js` | R1 | títulos "FR", "Deutsch", "Español", "ES" viram `rejects` com "idioma diferente de PT"; casos PT existentes seguem casando |
| T2 | Preservar "mega" em qualquer posição na variante | `src/match.js`, `test/sealed-matching-tests.js` | R1 | "Box Pokemon ex Greninja mega" e "Mega Greninja ex" geram o mesmo id `mega-greninja`; sem "mega" continua `greninja` |
| T3 | Teste de integridade do catálogo (alias único, `combines` válidos, EAN só dígitos) | `test/catalog-metadata-tests.js` (só teste) | R0 | teste falha ao duplicar alias ou apontar `combines` inexistente |
| T4 | Teste de contagem de boosters aceita (24/36 etc.) e decisão sobre outros valores | `test/sealed-matching-tests.js`, `src/match.js` se decidido | R1 | contagens documentadas casam; valor fora da lista não casa |
| T5 | Teste de `preorder` e de confiança em `matchProduct` | `test/sealed-matching-tests.js` | R0 | "Pré-venda" => `parsed.preorder` true; confiança 0.6 para inferido+fallback |
| T6 | Extrair normalização de EAN para helper único usado por `matchProduct` e `applyOverride` | `src/match.js`, `test/review-tests.js` | R1 | override com EAN zero-padded se comporta igual ao match direto |
