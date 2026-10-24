# K5 — candidatos de acessórios oficiais/licenciados (para revisão do dono)

Levantamento por busca web em 24/10/2026. **Nenhum item foi confirmado com a página aberta**: as páginas de produto (Liga
Pokémon, Magalu, Amazon, Mercado Livre) recusaram a leitura automática; os nomes vêm dos títulos nos resultados de busca.
Preço e estoque não foram lidos; código só onde aparece no título. Cada link precisa ser conferido à mão antes de entrar.

## Achados que mudam a K5
- **A Copag não vende acessórios avulsos de Pokémon na loja oficial** (a seção de acessórios não tem sleeve, fichário,
  deck box nem playmat Pokémon). Para acessórios não existe preço sugerido Copag: a comparação é só entre lojas.
- A linha licenciada encontrada no Brasil é **Ultra PRO** (licença Pokémon). Classificador: `oficial: 'licenciado'` só com
  "Ultra PRO" + "Pokémon" no título (`api/_lib/acessorios.mjs`).
- Páginas avulsas para fichário com licença Pokémon: **nenhuma** encontrada (só genéricas Ultra PRO, que ficam fora).
- Nos dados do robô de 24/10 (amostra de 200 não casados) havia só 3 anúncios de sleeve; a oferta de acessórios lida
  hoje é pequena porque o robô busca "pokemon" nas lojas e descarta acessório antes de guardar.

## Auditoria dos candidatos (24/10/2026, noite)
O que foi possível conferir sem contornar bloqueio:
- **Linha do fabricante.** Cada linha existe no catálogo internacional da Ultra PRO. A referência de distribuidor (Asmodee) é citada quando aparece. Exemplos: sleeve Pikachu 65 un. **UPR16539**; PRO-Binder 9 bolsos Pikachu **UPR16541**.
- **Item no Brasil.** Preço, estoque, link e edição não foram confirmados. A Liga Pokémon está pausada no robô porque bloqueia robôs. Amazon e Magalu recusam leitura automática. A edição brasileira pode ser outra versão do mesmo modelo.
- **Classificador.** 12 dos 15 títulos caem na categoria certa (`test/acessorio-nao-contamina-tests.js`). Ficam sem categoria:
  - "Ultra PRO Edição Pikachu 2025 65ct": o título não diz "sleeve";
  - "Alcove Flip": o título não diz "deck box";
  - os dados de Treinador Avançado: de propósito, porque o classificador os trata como parte do produto lacrado (decisão 2).
- **Casamento.** Nenhum dos títulos casa com produto lacrado. "Deck Box Pokémon <nome> ex" casava com "Box Pokémon ex" e foi corrigido nesta rodada.

| # | Categoria | Item (título encontrado) | Marca | Origem do título | Código | Preço/estoque | Adequação | Falta confirmar |
|---|---|---|---|---|---|---|---|---|
| 1 | protection.sleeve | Shield Ultra Pro – Pokémon – Pikachu (65 un.) | Ultra PRO | Liga Pokémon, pcode 108106 | linha UPR16539 (fabricante) | não lido | iniciante, todos | página, preço, edição |
| 2 | protection.sleeve | Shield Ultra Pro – Pokémon – Eevee (65 un.) | Ultra PRO | Liga Pokémon, pcode 108110 | — | não lido | alternativa ao 1 | página, preço |
| 3 | protection.sleeve | Sleeve Standard Ultra PRO – Pokémon TCG: Charizard (65 un.) | Ultra PRO | Magalu (busca) | — | não lido | alternativa ao 1 | vendedor, preço |
| 4 | protection.sleeve | Ultra PRO Edição Pikachu 2025 65ct | Ultra PRO | Amazon, B0DTQBPDMC | — | não lido | duplicata provável do 1 | título sem "sleeve" |
| 5 | organization.binder | Fichário Fixo Ultra Pro 9 bolsos – Pokémon – Pikachu (PRO-Binder) | Ultra PRO | Liga Pokémon, pcode 108095 | linha UPR16541 (fabricante) | não lido | colecionador | página, preço |
| 6 | organization.binder | Fichário Fixo Ultra Pro 9 bolsos – Pokémon – Pokébola | Ultra PRO | Liga Pokémon, pcode 108096 | — | não lido | alternativa ao 5 | página, preço |
| 7 | organization.binder | Fichário Ultra Pro Elite Series: Charizard 9 bolsos com zíper | Ultra PRO | Liga Pokémon, pcode 129319 | — | não lido | colecionador (topo de preço) | página, preço |
| 8 | organization.binder | Ultra PRO Pokémon Snorlax & Munchlax PRO-Binder 9 bolsos | Ultra PRO | Amazon, B09TDG45FC | — | não lido | alternativa ao 5 | vendedor, preço |
| 9 | organization.deck_box | Deck Box Ultra Pro – Pokémon – Pikachu | Ultra PRO | Liga Pokémon, pcode 108101 | — | não lido | jogador | modelo (Full View ou outro), preço |
| 10 | organization.deck_box | Deck Box Ultra Pro – Pokémon – Charizard | Ultra PRO | Liga Pokémon, pcode 108103 | linha "Full View Deck Box Charizard" (fabricante) | não lido | jogador | página, preço |
| 11 | organization.deck_box | Ultra Pro Alcove Flip Elite Series Lucario (ULP16414) | Ultra PRO | Amazon, B0DK7ZL58G | ULP16414 (no título) | não lido | jogador (topo de preço) | título sem "deck box" |
| 12 | protection.top_loader | Ultra PRO Pikachu Toploader + Penny Sleeves (25) | Ultra PRO | Amazon, B0GTMZ76NY | — | não lido | cartas especiais | vendedor, preço |
| 13 | gameplay.playmat | Playmat Ultra Pro – Pokémon – Pikachu | Ultra PRO | Liga Pokémon, pcode 108097 | linha "Playmat Pokémon Pikachu (2025)" (fabricante) | não lido | jogador | página, preço |
| 14 | gameplay.playmat | Playmat Ultra PRO – Pokémon TCG: Charizard | Ultra PRO | Magalu (busca) | — | não lido | alternativa ao 13 | vendedor, preço |
| 15 | gameplay.dice | Conjunto de 7 dados D6 de Treinador Avançado / Ferramentas de Treinador | não confirmada | Liga Pokémon, pcodes 133858 e 121502 | — | não lido | jogador | decisão 2 do dono (o classificador os trata como parte do lacrado) |

## Seleção inicial proposta (não publicada)
O kit sugere **só a categoria** e diz que o preço dos acessórios não entra no valor (`api/_lib/kit.mjs`). Nenhum produto da tabela aparece no site antes da confirmação manual e da decisão 1 do dono.

| Perfil (modelo do kit) | Categorias sugeridas | Candidatos, depois de confirmados |
|---|---|---|
| Iniciante que quer proteger as primeiras cartas (`primeira_colecao`) | sleeve, fichário | 1, 5 |
| Colecionador que quer organizar cartas (`colecionador`) | fichário, sleeve | 5 (ou 7), 1 |
| Jogador que precisa guardar o deck (`jogar`) | sleeve, deck box, playmat | 1, 10, 13 |
| Cartas especiais com proteção extra (`especiais`) | sleeve, **toploader** (novo nesta rodada) | 1, 12 |

Fora por provável falta de licença: álbuns "Escarlate e Violeta" da marca Yes TCG (Extra/Casas Bahia) e dados avulsos genéricos.

## Decisões do dono antes de ligar acessórios no kit
1. Quais itens acima entram na lista curada (opção B de `docs/monte-seu-kit.md` §3).
2. Se dados tirados de produto lacrado (vendidos avulsos) contam como acessório oficial.
3. Se marketplaces (Amazon/Magalu, vendedor parceiro) entram para acessórios.
