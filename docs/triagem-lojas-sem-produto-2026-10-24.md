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
| matching pendente | 3 | baixo: 1 a 2 ofertas cada; 2 corrigidas (#885 Mais Coimbra, #889 Bynx) e 1 sem validação (Maximux, Pokémon GO) |
| sem catálogo relevante | 8 | nenhum; inclui a **BQD**: 29 ofertas de produtos removidos, preservadas como não confirmadas |
| falha de coleta | 4 | grupo Tray: o preço não aparece escrito na página e o estoque não é verificável (prova de conceito #891, não integrada) |
| fonte bloqueada ou indisponível | 1 | nenhum enquanto a loja estiver fechada |
| inconclusiva | 13 | sem mapa do site, mapa sem página candidata ou página sem nenhum preço (TCG Pro) |

## Lojas
| Loja | Leitor | Classificação | Evidência | Impacto | Próxima ação |
|---|---|---|---|---|---|
| bqd.com.br | JSON-LD (Nuvemshop) | **sem catálogo relevante (produtos removidos)** | atualizado na 2ª rodada: as 29 páginas das ofertas abrem a página de erro da loja ("Erro - 404", com HTTP 200); a última leitura válida das 29 foi às 13h UTC de 24/10, **esgotadas**; o robots.txt veta a busca da loja. Detalhe na seção BQD | 0 hoje (29 ofertas preservadas como não confirmadas) | nenhuma; reavaliar se a loja republicar no mapa do site |
| virtualgift.com.br | JSON-LD (Tray) | falha de coleta | prova Tray (sonda 40119481265): 20 páginas, 5 lidas; preço do dataLayer = GA4 (ex.: 44,99), sem JSON-LD; estoque só pelo dataLayer, que não é confiável (ver Universal Geek); 15 páginas com nome que não bate; produtos de 2020 (EE2, Galar) | baixo | nenhuma até haver fonte de estoque verificável |
| fngames.com.br | JSON-LD (Tray) | falha de coleta | prova Tray: 20 páginas; o JSON-LD traz sempre 97% do `priceSell` do dataLayer (58,10 × 59,90; 67,80 × 69,90; provável Pix com 3% de desconto) e não há GA4. Preço sem confirmação independente; a página não escreve o preço | 26 páginas | conferência manual de 2 ou 3 produtos (preço exibido e no Pix) antes de qualquer integração |
| universalgeek.com.br | JSON-LD (Tray) | falha de coleta | prova Tray: 12 páginas, 11 lidas (9 casam); preço do dataLayer = GA4 (ex.: 159,90; o JSON-LD traz 0,00); **estoque contraditório**: dataLayer "YES" × JSON-LD esgotado nas 8 amostradas, e a página diz esgotado | 0 com estoque hoje | nenhuma; os produtos estão esgotados |
| tcgpro.com.br | JSON-LD | inconclusiva | 20 páginas atuais (ME04, ME05, Celebração 30 anos) **sem nenhum preço**: nem texto, nem JSON-LD, nem meta, nem dataLayer (sonda 40117461673). O título da página diz "TCGPro - Distribui…" (provável distribuidora, venda a lojistas). A API WooCommerce responde 403 (não contornada) | desconhecido | confirmar se há venda ao consumidor; sem preço público, não entra |
| parlendabrinquedos.com.br | JSON-LD | falha de coleta | 1 página (Box Ferramentas de Treinador Fezandipiti ex); JSON-LD 287,12 × 296,00 em outro script (mesmo padrão de Pix); não é Tray; preço não escrito na página | 1 | nenhuma (impacto mínimo) |
| fatimacrianca.com.br | JSON-LD | inconclusiva | o mapa declarado é `sitemap_index.xml.gz` e a leitura volta com 0 links: pode ser mapa vazio ou mapa comprimido não lido (não verificado) | desconhecido | conferir a leitura de mapa `.gz` |
| maiscoimbra.com.br | VTEX | matching pendente | supermercado; 2 anúncios, 1 Pokémon: "Jogo de Cartas Copag Pokémon Batalha de Liga Mewtwo ex" | 1 oferta | **corrigido na #885**; validar na próxima rodada |
| bynx.gg | JSON-LD | matching pendente → **corrigido (#889)** | quase só cartas avulsas (fora do escopo); "Elite Trainer Box - Pitch Black" agora casa com `me05-etb-en` (alias em inglês de Escuridão Absoluta) | 1 oferta | validar na próxima rodada do robô |
| maximuxtcg.com | WooCommerce | matching pendente | 4 anúncios: deck box (acessório), "Box Colecionável Equipes do Pokémon GO" (coleção ausente do catálogo), "Box Colecionável dia do Pokémon 30 anos (Inglês)" (produto ambíguo), "Pokébolas" | 1–2 | coleção Pokémon GO no catálogo (R3, dono) |
| lojapokemonsuper.com | WooCommerce | sem catálogo relevante | os 43 links apontam para **supertcg.com.br**, que já é lida (espelho). O contrato recusa link fora do domínio | 0 (já coberta) | **registrada como espelho da Super TCG (#890)**, pausada e reversível |
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

## BQD — auditoria das 29 ofertas (24/10/2026, 2ª rodada)
**Evidência:**
- **Sonda 40118007104:** as 29 páginas abrem e todas são a página de erro da loja: h1 "Erro - 404", HTTP 200, sem título e sem `LS.product`. O JSON-LD só tem produtos de vitrine (Cubo Mágico, Dobble), que o leitor recusa corretamente. Resumo: `{"paginas":29,"publica":0,"erro404":29,"falha":0,"semDados":0}`.
- **Sonda 40118537418:** a busca da loja (`/search/`) é **vetada pelo robots.txt**. Não foi contornada.
- **Ramo data (24/10, 17:34 UTC):** a última leitura válida das 29 (`lastValid`) foi às 13h UTC de 24/10, todas **esgotadas** (OUT_OF_STOCK). Elas estão no site desde 17/10 e têm 29 linhas no histórico de preços, que fica intacto.

**Leitura:** os produtos ficaram esgotados e depois saíram desses links. O mapa do site ainda lista as URLs. Não há sinal de troca de tema nem de falha do coletor: a página de outros produtos da loja continua publicando normalmente (ex.: "Arkham Horror… Tommy Muldoon").

**Classificação das 29:** **produto removido ou indisponível**. Nenhuma foi confirmada, nenhuma tem correspondência incorreta (o casamento delas estava certo enquanto a página existia) e nenhuma é inconclusiva.

**Estado mantido:** as ofertas continuam `stale` e não confirmadas, com estoque desconhecido. O robô já faz isso ("zero casados após 29: ofertas mantidas como não confirmadas, sem remoção"). Nada foi reativado nem apagado.

**Próxima ação:** nenhuma na coleta.
- Se a loja republicar os produtos no mapa do site, o robô volta a ler sozinho.
- **Melhoria proposta, fora desta rodada:** tratar página com h1 de erro e HTTP 200 como "página não serve". Isso mudaria o comportamento do robô diário e exige PR própria com teste.

| Produto | Título | Última leitura válida (preço · estoque · data) | Link |
|---|---|---|---|
| me05-combo36 | Pokémon TCG Box Combo 36 Boosters Escuridão Absoluta Copag | R$ 514.09 · OUT_OF_STOCK · 2026-10-24 | /produtos/pokemon-tcg-box-combo-36-boosters-escuridao-absoluta-copag/ |
| me05-combo18 | Pokémon TCG Box Combo 18 Boosters Escuridão Absoluta Copag | R$ 252.19 · OUT_OF_STOCK · 2026-10-24 | /produtos/pokemon-tcg-box-combo-18-boosters-escuridao-absoluta-copag/ |
| me03-box24 | Pokémon TCG Caixa c/ 24 Boosters Equilibrio Perfeito Copag | R$ 339.49 · OUT_OF_STOCK · 2026-10-24 | /produtos/pokemon-tcg-caixa-c-24-boosters-equilibrio-perfeito-copag/ |
| avulsos-deck-mega-diancie | Pokémon TCG Mega Diancie Ex Baralho Batalha Mega Copag | R$ 106.69 · OUT_OF_STOCK · 2026-10-24 | /produtos/pokemon-tcg-mega-diancie-ex-baralho-batalha-mega-copag/ |
| avulsos-deck-melmetal | Pokémon TCG Melmetal Ex Baralho Batalha Ex Copag | R$ 72.74 · OUT_OF_STOCK · 2026-10-24 | /produtos/pokemon-tcg-melmetal-ex-baralho-batalha-ex-copag/ |
| me01-box24 | Pokémon TCG Box Megaevolução Kit 24 Boosters Copag | R$ 339.49 · OUT_OF_STOCK · 2026-10-24 | /produtos/pokemon-tcg-box-megaevolucao-kit-24-boosters-copag/ |
| me04-combo18 | Pokémon TCG Box Combo 18 Boosters Caos Ascendente Copag | R$ 252.19 · OUT_OF_STOCK · 2026-10-24 | /produtos/pokemon-tcg-box-combo-18-boosters-caos-ascendente-copag/ |
| me04-box24 | Pokémon TCG Box c/ 24 Boosters Caos Ascendente Copag | R$ 339.49 · OUT_OF_STOCK · 2026-10-24 | /produtos/pokemon-tcg-box-c-24-boosters-caos-ascendente-copag/ |
| me05-blister4 | Pokémon TCG Quadruplo Binacle Escuridão Absoluta Copag | R$ 58.19 · OUT_OF_STOCK · 2026-10-24 | /produtos/pokemon-tcg-quadruplo-binacle-escuridao-absoluta-copag/ |
| me05-blister3 | Pokémon TCG Triplo Slowpoke Escuridão Absoluta Copag | R$ 43.64 · OUT_OF_STOCK · 2026-10-24 | /produtos/pokemon-tcg-triplo-slowpoke-escuridao-absoluta-copag/ |
| me03-blister3 | Pokémon TCG Triplo Equilibrio Perfeito Makuhita Copag | R$ 48.49 · OUT_OF_STOCK · 2026-10-24 | /produtos/pokemon-tcg-triplo-equilibrio-perfeito-makuhita-copag/ |
| me05-etb | Pokémon TCG Treinador Avançado Escuridão Absoluta Copag | R$ 407.39 · OUT_OF_STOCK · 2026-10-24 | /produtos/pokemon-tcg-treinador-avancado-escuridao-absoluta-copag/ |
| me03-etb | Pokémon TCG Treinador Avançado Equilibrio Perfeito Copag | R$ 387.99 · OUT_OF_STOCK · 2026-10-24 | /produtos/pokemon-tcg-treinador-avancado-equilibrio-perfeito-copag/ |
| me03-blister4 | Pokémon TCG Quadruplo Equilibrio Perfeito Chikorita Copag | R$ 58.19 · OUT_OF_STOCK · 2026-10-24 | /produtos/pokemon-tcg-quadruplo-equilibrio-perfeito-chikorita-copag/ |
| me04-blister4 | Pokémon TCG Quadruplo Toxel Caos Ascendente Copag | R$ 53.34 · OUT_OF_STOCK · 2026-10-24 | /produtos/pokemon-tcg-quadruplo-toxel-caos-ascendente-copag/ |
| me04-blister3 | Pokémon TCG Triplo Charmeleon Caos Ascendente Copag | R$ 43.64 · OUT_OF_STOCK · 2026-10-24 | /produtos/pokemon-tcg-triplo-charmeleon-caos-ascendente-copag/ |
| me04-box36 | Pokémon TCG Box Fechada 36 Boosters Caos Ascendente Copag | R$ 504.39 · OUT_OF_STOCK · 2026-10-24 | /produtos/pokemon-tcg-box-fechada-36-boosters-caos-ascendente-copag/ |
| me01-blister3 | Pokémon TCG Triplo Megaevolução Drifloon Copag | R$ 48.49 · OUT_OF_STOCK · 2026-10-24 | /produtos/pokemon-tcg-triplo-megaevolucao-drifloon-copag/ |
| avulsos-colecao_ex-mega-zygarde | Pokémon TCG Box Coleção Mega Zygarde Ex Copag | R$ 174.59 · OUT_OF_STOCK · 2026-10-24 | /produtos/pokemon-tcg-box-colecao-mega-zygarde-ex-copag/ |
| me01-blister3 | Pokémon TCG Triplo Megaevolução Drifblim Copag | R$ 48.49 · OUT_OF_STOCK · 2026-10-24 | /produtos/pokemon-tcg-triplo-megaevolucao-drifblim-copag/ |
| me01-box36 | Pokémon TCG Box Megaevolução 36 Boosters Copag | R$ 514.09 · OUT_OF_STOCK · 2026-10-24 | /produtos/pokemon-tcg-box-megaevolucao-36-boosters-copag/ |
| me02-combo10 | Pokémon TCG Kit c/ 10 Boosters Fogo Fantasmagorico Copag | R$ 242.49 · OUT_OF_STOCK · 2026-10-24 | /produtos/pokemon-tcg-kit-c-10-boosters-fogo-fantasmagorico-copag/ |
| me02-booster | Pokémon TCG Booster Fogo Fantasmagorico Megaevolução Copag | R$ 24.24 · OUT_OF_STOCK · 2026-10-24 | /produtos/pokemon-tcg-booster-fogo-fantasmagorico-megaevolucao-copag/ |
| me02-box24 | Pokémon TCG Box 24 Boosters Fogo Fantasmagorico Megaevolução | R$ 436.49 · OUT_OF_STOCK · 2026-10-24 | /produtos/pokemon-tcg-box-24-boosters-fogo-fantasmagorico-megaevolucao/ |
| me04-colecao_ex-mega-clefable | Pokémon TCG Box Mega Clefable Ex Coleção Mega Luar Copag | R$ 145.49 · OUT_OF_STOCK · 2026-10-24 | /produtos/pokemon-tcg-box-mega-clefable-ex-colecao-mega-luar-copag/ |
| me02-colecao_ex-mega-venusaur | Pokémon TCG Box Mega Venusaur ex Fogo Fantasmagorico Copag | R$ 174.59 · OUT_OF_STOCK · 2026-10-24 | /produtos/pokemon-tcg-box-mega-venusaur-ex-fogo-fantasmagorico-copag/ |
| me02_5-etb | Pokémon TCG Box Treinador Avançado Herois Excelsos Copag | R$ 775.99 · OUT_OF_STOCK · 2026-10-24 | /produtos/pokemon-tcg-box-treinador-avancado-herois-excelsos-copag-uh9op/ |
| avulsos-colecao_ilustracao-parceiro-inicial-serie-2 | Pokémon TCG Box Coleção Ilustração Parceiro Inicial Serie 2 | R$ 174.59 · OUT_OF_STOCK · 2026-10-24 | /produtos/pokemon-tcg-box-colecao-ilustracao-parceiro-inicial-serie-2-in5ug/ |
| me05-colecao_ex-mega-greninja | Pokémon TCG Box Mega Greninja Ex Copag | R$ 174.59 · OUT_OF_STOCK · 2026-10-24 | /produtos/pokemon-tcg-box-mega-greninja-ex-copag-topdz/ |

## Correções seguras feitas nesta rodada
- **#885 (integrado):** "Batalha de Liga" passou a ser baralho, e não Box Pokémon ex.
  - Mudam 4 dos 3.072 títulos (Mega Lucario, Charizard e 2 de Miraidon), todos de `colecao_ex` para `deck` do mesmo Pokémon.
  - A oferta da Mais Coimbra passa a casar.
- **#886:** deck box deixa de casar com produto lacrado; nenhum título atual muda.
- **2ª rodada (autorizada pelo dono):**
  - #889: apelido "pitch black" na `me05`;
  - #890: a Loja Pokémon Super ficou registrada como espelho da Super TCG.
- **Pokémon GO:** verificado e não criado. O anúncio não diz a equipe nem o idioma.

## Prioridade sugerida (atualizada na 2ª rodada)
1. **BQD:** concluída. Os produtos foram removidos e as ofertas continuam não confirmadas. A melhoria proposta é tratar página de erro com HTTP 200 como "página não serve" (PR própria, muda o robô).
2. **Grupo Tray:** prova de conceito concluída (#891), **não integrar**. Os motivos:
   - o JSON-LD traz o preço no Pix, e zero quando o produto está esgotado;
   - o `availability` do dataLayer diz "YES" em produto esgotado;
   - o preço não aparece escrito na página.

   Só volta à pauta com conferência manual de preços ou com uma fonte oficial (a API da Tray exige credencial da loja).
3. **TCG Pro:** página de produto sem preço; confirmar se vende ao consumidor.
