# Revisão — 24 casos iniciais

Rodada de 2026-10-09T19:15:18.850Z (ramo `data`). São os itens que o primeiro ciclo de agentes vai abrir em `review_item` depois do merge. **Sugestões para conferência humana: nenhuma é aplicada sozinha.** O caso de teste `test/review-tests.js` usa este mesmo conjunto (`test/fixtures/review-initial-cases.json`) e prova que cada aprovação sugerida passa pela validação e leva o anúncio só ao produto indicado.

Resumo: 17 aprovar (4 só confirmam o matching atual), 2 rejeitar, 5 conferir na página antes de decidir.

**Duplicidades** (mesma decisão, páginas diferentes): #15 e #16 (mesmo PACK 36 em Ri Happy e PB Kids); #14 e #17 (Box 30 Anos nas mesmas lojas); #21, #22 e #23 (`me01-box36` em três lojas). Decida juntos: `ids: 15,16`.

| # | Loja | Anúncio | Tipo | Sugestão | Por quê |
|---|---|---|---|---|---|
| 1 | gatogingado | Booster Box ME02 Fogo Fantasmagórico Pokémon TCG | boosters_desconhecidos | **aprovar** → `me02-box36` | Booster Box de Fogo Fantasmagórico; display Copag tem 36 |
| 2 | gatogingado | Booster Box Megaevolução Pokémon TCG | boosters_desconhecidos | **aprovar** → `me01-box36` | Booster Box Megaevolução; display Copag tem 36 |
| 3 | shogunlivraria | Booster Box Pokemon Coroa Estelar | boosters_desconhecidos | **aprovar** → `sv7-box36` | Booster Box Coroa Estelar; display Copag tem 36 |
| 4 | shogunlivraria | Case Blister Triple De Raio Preto - Pokemon Tcg | tipo_desconhecido | **rejeitar** | case de blisters: várias unidades, não é produto Copag avulso |
| 5 | lojaarenagames | Trading Card Game Pokemon - Pokémon Booster Escuridão Absoluta (108 Ca | tipo_desconhecido | **conferir** | 18 boosters (meio display) não é formato do catálogo |
| 6 | lojaarenagames | Trading Card Game Pokemon - Pokémon Booster Fogo Fantasmagórico (6 Car | tipo_desconhecido | **aprovar** → `me02-booster` | (6 cartas)(01 booster): booster unitário |
| 7 | lojaarenagames | Trading Card Game Pokemon - Pokémon Booster Amigos De Jornada (6 Carta | tipo_desconhecido | **aprovar** → `sv9-booster` | (6 cartas)(01 booster): booster unitário |
| 8 | lojaarenagames | Trading Card Game Pokemon - Pokémon Mini Display Booster Megaevolução  | tipo_desconhecido | **conferir** | mini display de 18 boosters não é formato do catálogo |
| 9 | lojaarenagames | Trading Card Game Pokemon - Pokémon Booster Equilibrio Perfeito (6 Car | tipo_desconhecido | **aprovar** → `me03-booster` | (6 cartas)(01 booster): booster unitário |
| 10 | lojaarenagames | Trading Card Game Pokemon - Pokémon Booster Rivais Predestinados (6 Ca | tipo_desconhecido | **aprovar** → `sv10-booster` | (6 cartas)(01 booster): booster unitário |
| 11 | lojaarenagames | Trading Card Game Pokemon - Blister Fogo Fantasmagórico (6 Cartas) (01 | tipo_desconhecido | **aprovar** → `me02-blister1` | (01 blister sortido): blister unitário |
| 12 | lojaarenagames | Trading Card Game Pokemon - Pokémon Booster Rivais Predestinados (216  | tipo_desconhecido | **aprovar** → `sv10-box36` | (216 cartas)(36 boosters) |
| 13 | lojaarenagames | Trading Card Game Pokemon - Blister Mega Evolução (6 Cartas) (01 Blist | tipo_desconhecido | **aprovar** → `me01-blister1` | (01 blister sortido): blister unitário |
| 14 | rihappy | Box de 30 Anos de Pokémon - Coleção Dia de Pokémon 2026 | tipo_desconhecido | **conferir** (candidato `c30-colecao`) | pode ser o c30-colecao do catálogo; conferir conteúdo na página |
| 15 | rihappy | POKEMON TCG PACK 36 BOOSTER POKEMON ESCURIDAO ABSOLUTA - COPAG | tipo_desconhecido | **aprovar** → `me05-box36` | 36 boosters Escuridão Absoluta, Copag |
| 16 | pbkids | POKEMON TCG PACK 36 BOOSTER POKEMON ESCURIDAO ABSOLUTA - COPAG | tipo_desconhecido | **aprovar** → `me05-box36` | mesmo anúncio do #15 em outra loja |
| 17 | pbkids | Box de 30 Anos de Pokémon - Coleção Dia de Pokémon 2026 | tipo_desconhecido | **conferir** (candidato `c30-colecao`) | mesmo produto do #14 em outra loja |
| 18 | pbkids | Jogo de Cartas - Fenda Paradoxal - Pokémon - Escarlate e Violeta - Cop | tipo_desconhecido | **rejeitar** | título só diz "Jogo de Cartas": tipo indeterminável |
| 19 | pbkids | Jogo De Cartas Pokemon Evolucoes Em Paldea Escarlate x Violeta Booster | boosters_desconhecidos | **aprovar** → `sv2-box36` | Booster Box com 36 unidades |
| 20 | pbkids | Box Coleçao Evoluçoes Prismaticas Evee Pokemon - Copag | tipo_desconhecido | **conferir** (candidato `sv8_5-colecao`) | há mais de um Box Coleção Eevee; conferir qual |
| 21 | ludostation | Box Display - Mega Evolução | baixa_confianca | **aprovar** → `me01-box36` | confirma o matching atual (me01-box36) |
| 22 | bravojogos | Pokémon : Caixa de Boosters - Megaevolução - Inclui 1 carta Promociona | baixa_confianca | **aprovar** → `me01-box36` | confirma o matching atual (me01-box36) |
| 23 | omniverse | Megaevolução - Caixa de Booster - Pokémon | baixa_confianca | **aprovar** → `me01-box36` | confirma o matching atual (me01-box36) |
| 24 | omniverse | Escarlate e Violeta - Caixa de Booster (36U) - Pokémon | baixa_confianca | **aprovar** → `sv1-box36` | Caixa de Booster (36U): confirma sv1-box36 |

## Como decidir

Actions → **Revisão** → Run workflow. `triage` mostra os ids reais no banco e os grupos. Depois `approve` (coleção, tipo, boosters, motivo), `reject` ou `dismiss` (motivo). Ao terminar, `export` grava `config/matching-overrides.json` com `enabled: false`.

**Ligar no robô** é um passo à parte e manual: conferir o diff do arquivo exportado e trocar `enabled` para `true`. A partir da rodada seguinte, os anúncios aprovados entram como oferta normal, passando pela trava de link, pela referência Copag e pelo Opportunity Engine como qualquer outra.
