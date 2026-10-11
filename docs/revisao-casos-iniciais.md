# Revisão — 24 casos iniciais

Rodada de 2026-10-09T19:15:18.850Z (ramo `data`). São os itens que o primeiro ciclo de agentes vai abrir em `review_item` depois do merge. **Sugestões para conferência humana: nenhuma é aplicada sozinha.** O teste `test/review-tests.js` usa este mesmo conjunto (`test/fixtures/review-initial-cases.json`) e prova que cada aprovação sugerida passa pela validação e leva o anúncio só ao produto indicado.

Resumo: 17 aprovar (4 só confirmam o matching atual), 4 rejeitar, 3 conferir (👁: exigem olhar a foto ou a embalagem na página da loja).

**Conferência das páginas (09/10/2026).**
- **#14 e #17 (Box 30 Anos):** a página resolveu, sem precisar de foto. São 8 boosters mais uma promo do Pikachu, sem marca e indisponíveis. Não são o `c30-colecao` do catálogo, que tem 20 boosters, então a sugestão passou a ser rejeitar.
- **#5 e #8 (18 boosters):** os dois são Copag, com EAN na página. O formato de 18 boosters não existe no catálogo, então nenhum dos dois pode ser aprovado sem antes decidir o catálogo.
- **#5:** precisa olhar a foto para saber se é caixa ou blister.
- **#8:** a identidade está clara; falta conferir o lacre.
- **#20 (Box Eevee):** precisa olhar a embalagem. A página não diz quantos boosters vêm na caixa, e o produto está indisponível.

**Duplicidades** (mesma decisão, páginas diferentes): #15 e #16 (mesmo PACK 36 em Ri Happy e PB Kids); #14 e #17 (mesmo produto, código 1003258159); #21, #22 e #23 (`me01-box36` em três lojas). Decida juntos: `ids: 15,16`.

| # | Loja | Anúncio | Tipo | Sugestão | Por quê |
|---|---|---|---|---|---|
| 1 | gatogingado | Booster Box ME02 Fogo Fantasmagórico Pokémon TCG | boosters_desconhecidos | **aprovar** → `me02-box36` | Booster Box de Fogo Fantasmagórico; display Copag tem 36 |
| 2 | gatogingado | Booster Box Megaevolução Pokémon TCG | boosters_desconhecidos | **aprovar** → `me01-box36` | Booster Box Megaevolução; display Copag tem 36 |
| 3 | shogunlivraria | Booster Box Pokemon Coroa Estelar | boosters_desconhecidos | **aprovar** → `sv7-box36` | Booster Box Coroa Estelar; display Copag tem 36 |
| 4 | shogunlivraria | Case Blister Triple De Raio Preto - Pokemon Tcg | tipo_desconhecido | **rejeitar** | case de blisters: várias unidades, não é produto Copag avulso |
| 5 | lojaarenagames | Trading Card Game Pokemon - Pokémon Booster Escuridão Absoluta (108 Ca | tipo_desconhecido | **conferir** 👁 | página: 18 boosters (108 cartas), Copag, lacrado, EAN 0196214156180; não diz se é caixa ou blister. Conferir a foto. Formato de 18 não existe no catálogo: mesmo conferido, aprovar exige decidir o catálogo antes |
| 6 | lojaarenagames | Trading Card Game Pokemon - Pokémon Booster Fogo Fantasmagórico (6 Car | tipo_desconhecido | **aprovar** → `me02-booster` | (6 cartas)(01 booster): booster unitário |
| 7 | lojaarenagames | Trading Card Game Pokemon - Pokémon Booster Amigos De Jornada (6 Carta | tipo_desconhecido | **aprovar** → `sv9-booster` | (6 cartas)(01 booster): booster unitário |
| 8 | lojaarenagames | Trading Card Game Pokemon - Pokémon Mini Display Booster Megaevolução  | tipo_desconhecido | **conferir** 👁 | página: Mini Display de 18 boosters, Copag, EAN 7896192356642; identidade clara, lacre não informado (conferir foto). Formato de 18 não existe no catálogo: decisão de catálogo antes de aprovar |
| 9 | lojaarenagames | Trading Card Game Pokemon - Pokémon Booster Equilibrio Perfeito (6 Car | tipo_desconhecido | **aprovar** → `me03-booster` | (6 cartas)(01 booster): booster unitário |
| 10 | lojaarenagames | Trading Card Game Pokemon - Pokémon Booster Rivais Predestinados (6 Ca | tipo_desconhecido | **aprovar** → `sv10-booster` | (6 cartas)(01 booster): booster unitário |
| 11 | lojaarenagames | Trading Card Game Pokemon - Blister Fogo Fantasmagórico (6 Cartas) (01 | tipo_desconhecido | **aprovar** → `me02-blister1` | (01 blister sortido): blister unitário |
| 12 | lojaarenagames | Trading Card Game Pokemon - Pokémon Booster Rivais Predestinados (216  | tipo_desconhecido | **aprovar** → `sv10-box36` | (216 cartas)(36 boosters) |
| 13 | lojaarenagames | Trading Card Game Pokemon - Blister Mega Evolução (6 Cartas) (01 Blist | tipo_desconhecido | **aprovar** → `me01-blister1` | (01 blister sortido): blister unitário |
| 14 | rihappy | Box de 30 Anos de Pokémon - Coleção Dia de Pokémon 2026 | tipo_desconhecido | **rejeitar** | página: 8 boosters de expansões variadas + carta promo Pikachu, sem marca, indisponível. Não é c30-colecao (20 boosters no catálogo); produto fora do catálogo |
| 15 | rihappy | POKEMON TCG PACK 36 BOOSTER POKEMON ESCURIDAO ABSOLUTA - COPAG | tipo_desconhecido | **aprovar** → `me05-box36` | 36 boosters Escuridão Absoluta, Copag |
| 16 | pbkids | POKEMON TCG PACK 36 BOOSTER POKEMON ESCURIDAO ABSOLUTA - COPAG | tipo_desconhecido | **aprovar** → `me05-box36` | mesmo anúncio do #15 em outra loja |
| 17 | pbkids | Box de 30 Anos de Pokémon - Coleção Dia de Pokémon 2026 | tipo_desconhecido | **rejeitar** | mesmo produto do #14 (mesmo código 1003258159): 8 boosters + promo Pikachu, indisponível. Não é c30-colecao |
| 18 | pbkids | Jogo de Cartas - Fenda Paradoxal - Pokémon - Escarlate e Violeta - Cop | tipo_desconhecido | **rejeitar** | título só diz "Jogo de Cartas": tipo indeterminável |
| 19 | pbkids | Jogo De Cartas Pokemon Evolucoes Em Paldea Escarlate x Violeta Booster | boosters_desconhecidos | **aprovar** → `sv2-box36` | Booster Box com 36 unidades |
| 20 | pbkids | Box Coleçao Evoluçoes Prismaticas Evee Pokemon - Copag | tipo_desconhecido | **conferir** 👁 | página: Espeon e Umbreon ex, 62 cartas, miniatura, broche e sleeves, EAN 7896192352590, indisponível; não diz quantos boosters. Conferir a embalagem para escolher o tipo (Box Coleção ou Coleção com Miniatura) |
| 21 | ludostation | Box Display - Mega Evolução | baixa_confianca | **aprovar** → `me01-box36` | confirma o matching atual (me01-box36) |
| 22 | bravojogos | Pokémon : Caixa de Boosters - Megaevolução - Inclui 1 carta Promociona | baixa_confianca | **aprovar** → `me01-box36` | confirma o matching atual (me01-box36) |
| 23 | omniverse | Megaevolução - Caixa de Booster - Pokémon | baixa_confianca | **aprovar** → `me01-box36` | confirma o matching atual (me01-box36) |
| 24 | omniverse | Escarlate e Violeta - Caixa de Booster (36U) - Pokémon | baixa_confianca | **aprovar** → `sv1-box36` | Caixa de Booster (36U): confirma sv1-box36 |

## Como decidir

Actions → **Revisão** → Run workflow. `triage` mostra os ids reais no banco e os grupos. Depois `approve` (coleção, tipo, boosters, motivo), `reject` ou `dismiss` (motivo). Ao terminar, `export` grava `config/matching-overrides.json` (com `enabled: false`) num branch `review/overrides-*` e mostra o link do PR; o arquivo só chega à `main` por PR com CI verde e sua aprovação.

**Ligar no robô** é um passo à parte e manual: conferir o diff do arquivo exportado e trocar `enabled` para `true`. A partir da rodada seguinte, os anúncios aprovados entram como oferta normal, passando pela trava de link, pela referência Copag e pelo Opportunity Engine como qualquer outra.
