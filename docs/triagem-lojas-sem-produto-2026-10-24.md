# Triagem das lojas "lidas · sem produto Pokémon" — 24/10/2026

**Dados:** ramo `data` de 24/10, 16:49 UTC (`sources.json`, `offers.json`, `url-cache.json`).

**Evidência:** sondas só de leitura. Todas usam o mesmo `guard` (robots.txt), o mesmo User-Agent e o mesmo intervalo do robô:
- 40113952087, 40113956394, 40113961823 e 40113966432: amostra de títulos, 29 lojas;
- 40114522371 e 40114526906: diagnóstico de página e APIs dedicadas;
- 40115508850, 40115875105 e 40116052218: motivo da recusa, páginas das ofertas antigas e Kalunga.

Nenhuma loja foi pausada. Nenhum bloqueio, CAPTCHA ou robots.txt foi contornado.

A auditoria anterior contou **31** lojas; neste snapshot são **29**. A contagem foi recalculada com `coleta()` de `api/_lib/lojas.mjs`, o mesmo selo da página /lojas: 75 com ofertas, 18 sem estoque agora, 29 sem produto. As 2 lojas que faltam passaram a ter anúncio lido, sem estoque. O ramo `data` não guarda histórico, então não dá para dizer quais são.

## Resumo
| Classificação | Lojas | Impacto potencial |
|---|---|---|
| matching pendente | 3 | baixo: 1 a 2 ofertas cada; 1 corrigida (#885) e 2 dependem do catálogo (R3) |
| sem catálogo relevante | 7 | nenhum |
| falha de coleta | 5 | **alto no grupo Tray + TCG Pro: ~120 páginas de produto Pokémon** |
| fonte bloqueada ou indisponível | 1 | nenhum enquanto a loja estiver fechada |
| inconclusiva | 13 | **BQD: 29 ofertas** presas como não confirmadas; o resto sem mapa do site ou com mapa sem página candidata |

## Lojas
| Loja | Leitor | Classificação | Evidência | Impacto | Próxima ação |
|---|---|---|---|---|---|
| bqd.com.br | JSON-LD (Nuvemshop) | inconclusiva | 29 ofertas Pokémon reais desde 17/10 (combos 36/18, caixas 24, ETB, baralhos). Desde 24/10 as páginas delas trazem só Products de vitrine (Cubo Mágico, Dobble) e nenhum título, e o leitor recusa corretamente. Hoje lê 29 páginas de brinquedo (Funko, bonecos) e casa 0. As 29 ofertas ficam como não confirmadas, sem remoção | **29 ofertas** | conferência manual de uma página (produto retirado ou tema novo); se for o tema, ajustar o leitor Nuvemshop com teste |
| virtualgift.com.br | JSON-LD (Tray) | falha de coleta | 60 páginas Pokémon no mapa ("pacote cartas pokemon", blisters); sem JSON-LD Product e sem meta de preço | 60 páginas | prova de conceito de leitor Tray (fora do robô) |
| fngames.com.br | JSON-LD (Tray) | falha de coleta | 26 páginas; o JSON-LD tem preço (ex.: 67,80 no Blister Triplo Fogo Fantasmagórico), mas ele **não está escrito** na página. A regra de segurança recusa | 26 páginas | idem |
| universalgeek.com.br | JSON-LD (Tray) | falha de coleta | 12 páginas reais (Booster Fogo Fantasmagórico, Amigos de Jornada); o JSON-LD traz preço **0,00** | 12 páginas | idem |
| tcgpro.com.br | JSON-LD | falha de coleta | 20 páginas atuais (ME04, ME05, Celebração 30 anos); sem JSON-LD e sem meta de preço. A API WooCommerce responde 403 (não contornada) | 20 páginas | investigar a plataforma (link `/produtos/…-id`) |
| parlendabrinquedos.com.br | JSON-LD | falha de coleta | 1 página (Box Ferramentas de Treinador Fezandipiti ex); preço 287,12 no JSON-LD, não escrito na página | 1 | junto do leitor Tray, se servir |
| fatimacrianca.com.br | JSON-LD | inconclusiva | o mapa declarado é `sitemap_index.xml.gz` e a leitura volta com 0 links: pode ser mapa vazio ou mapa comprimido não lido (não verificado) | desconhecido | conferir a leitura de mapa `.gz` |
| maiscoimbra.com.br | VTEX | matching pendente | supermercado; 2 anúncios, 1 Pokémon: "Jogo de Cartas Copag Pokémon Batalha de Liga Mewtwo ex" | 1 oferta | **corrigido na #885**; validar na próxima rodada |
| bynx.gg | JSON-LD | matching pendente | quase só cartas avulsas (fora do escopo); 1 "Elite Trainer Box - Pitch Black". Pitch Black é o nome em inglês de Escuridão Absoluta (`me05`), e o catálogo não tem esse apelido em inglês | 1 oferta | apelido "pitch black" no `config/catalog.json` (R3, dono) |
| maximuxtcg.com | WooCommerce | matching pendente | 4 anúncios: deck box (acessório), "Box Colecionável Equipes do Pokémon GO" (coleção ausente do catálogo), "Box Colecionável dia do Pokémon 30 anos (Inglês)" (produto ambíguo), "Pokébolas" | 1–2 | coleção Pokémon GO no catálogo (R3, dono) |
| lojapokemonsuper.com | WooCommerce | sem catálogo relevante | os 43 links apontam para **supertcg.com.br**, que já é lida (espelho). O contrato recusa link fora do domínio | 0 (já coberta) | marcar como duplicata da Super TCG (config, R3) |
| tabkaramello.com.br | WooCommerce | sem catálogo relevante | boneco, moeda marcador, deck box | 0 hoje | volta com a K5 (acessórios) |
| vip-tcg.com | JSON-LD | sem catálogo relevante | o mapa traz posts de blog e "evento"; a API WooCommerce não tem produto Pokémon | 0 | nenhuma |
| deckcerto.com | JSON-LD | sem catálogo relevante | site de conteúdo ("todas as cartas do Surskit…"), não loja; a API WooCommerce é barrada pelo robots.txt | 0 | nenhuma |
| miragemhobby.wordpress.com | JSON-LD | sem catálogo relevante | blog wordpress.com, sem página de produto | 0 | nenhuma |
| paranaplasticos.com.br | JSON-LD (Tray) | sem catálogo relevante | os 11 links de produto do mapa redirecionam para `/sem-resultados-na-busca` | 0 | nenhuma |
| gatogingado.com.br | JSON-LD | sem catálogo relevante | a única oferta antiga (13/10) dá 404; o mapa não tem página Pokémon | 0 | nenhuma |
| tavernadoturno.com.br | JSON-LD (Shopify) | fonte bloqueada ou indisponível | as páginas das 5 ofertas antigas redirecionam para `/password/` (loja fechada com senha) | 0 agora | aguardar a loja reabrir; não contornar |
| boardtopia.com.br | JSON-LD | inconclusiva | o mapa de produtos existe, mas nenhum link tem palavra de produto Pokémon | desconhecido | conferência manual |
| happynerd.com.br | JSON-LD (Tray) | inconclusiva | mapa Tray sem link candidato | desconhecido | junto do leitor Tray |
| loja.gameofboards.com.br | JSON-LD (Tray) | inconclusiva | mapa Tray sem link candidato; teve leitura não vazia em 21/10 | desconhecido | junto do leitor Tray |
| farmaciasnissei.com.br | JSON-LD | inconclusiva | 1 página Pokémon, sem dados estruturados | baixo | nenhuma agora |
| thesaintcollection.com | Shopify | inconclusiva | a busca Shopify volta sem anúncio | desconhecido | conferência manual |
| livrariacolecionador.com.br | JSON-LD | inconclusiva | sem mapa do site | desconhecido | conferência manual |
| loja.balaiodejogos.com.br | JSON-LD | inconclusiva | sem mapa do site | desconhecido | conferência manual |
| newstation.com.br | JSON-LD | inconclusiva | sem mapa do site | desconhecido | conferência manual |
| pokepolis.com.br | JSON-LD | inconclusiva | sem mapa do site | desconhecido | conferência manual |
| resetnerdstore.com.br | JSON-LD | inconclusiva | sem mapa do site | desconhecido | conferência manual |
| thedragonshop.com.br | JSON-LD | inconclusiva | sem mapa do site | desconhecido | conferência manual |

## Correções seguras feitas nesta rodada
- **#885 (integrado):** "Batalha de Liga" passou a ser baralho, e não Box Pokémon ex.
  - Mudam 4 dos 3.072 títulos (Mega Lucario, Charizard e 2 de Miraidon), todos de `colecao_ex` para `deck` do mesmo Pokémon.
  - A oferta da Mais Coimbra passa a casar.
- **#886:** deck box deixa de casar com produto lacrado; nenhum título atual muda.
- **Não feito (exige R3 ou decisão do dono):**
  - apelidos e coleções novas no catálogo (Pitch Black, Pokémon GO);
  - marcar a Loja Pokémon Super como duplicata.

## Prioridade sugerida
1. **BQD:** maior impacto unitário (29 ofertas reais). Primeiro conferir se é produto retirado ou tema novo.
2. **Grupo Tray:** prova de conceito de leitor Tray fora do robô, no molde da `busca` (#887). Pode recuperar ~100 páginas (Virtual Gift, FN Games, Universal Geek e talvez Happy Nerd e Game of Boards).
3. **TCG Pro:** 20 páginas atuais; identificar a plataforma.
