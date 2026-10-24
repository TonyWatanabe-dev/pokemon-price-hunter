# "Monte seu kit" — arquitetura e plano (P2)

Estado: **desenho**. Nada publicado. Ordem do roadmap: confiabilidade → dados → ofertas/custo → kit (ROADMAP-OPERACIONAL, 24/10/2026).
Este documento diz o que o kit reaproveita, o que falta nos dados, os critérios para liberar recomendação real e as tarefas.

## 1. Princípio: nada paralelo

| Precisa de | Reaproveita | Não criar |
|---|---|---|
| Produtos | catálogo do robô (`state.products`, ids `colecao-tipo[-variante][-idioma]`, `TYPE_LABEL`, idioma pelo sufixo) | catálogo próprio |
| Preço, estoque, loja, link | `/api/v1/site/ofertas?produtos=…` (até 60 ids) e `/api/v1/oportunidades` | tabela de preços |
| Ordem das sugestões | Opportunity Engine (`opportunity_score`, `confidence`), `byComparableTotal` (`api/_lib/offer-rank.mjs`) | ranking próprio |
| Frete | `shippingKnown`/`shipping`, selo de frete grátis por loja (`config/frete-gratis.json`) | cotação por CEP (#84 segue desligada) |
| Histórico | `/api/v1/produtos/:id/historico` | — |
| Medição | Vercel Web Analytics por página (plano gratuito: sem eventos customizados; ver §7) | serviço novo de analytics |

O kit é uma **cesta virtual**: lista de ids de produto + quantidade. Toda informação de preço vem da API no momento da consulta.

## 2. O que existe nos dados hoje (24/10/2026)

- Lacrados em português: 1.114 ofertas com estoque; inglês 33, japonês 11, chinês 1. Frete conhecido em 288 de 1.159.
- Tipos úteis por objetivo: boosters (`booster_pack`, blisters, `combo`, `booster_box`), coleção (`etb`, `colecao*`, `lata`, `minilata`), jogar (`deck`, `kit_treinador`, `desafio`).
- **Lacuna principal: acessórios.** Sleeve, fichário avulso, deck box, playmat e toploader são **recusados** pelo casamento (`REJECT` em `src/match.js`, motivo "acessório ou item não-TCG"), junto com pelúcia e caneca. Não há produto de acessório no catálogo.
- Não há dado de conteúdo garantido (carta promo específica) além do nome do produto: o kit não pode prometer carta.

## 3. Acessórios: opções

| Opção | Como | Prós | Contras |
|---|---|---|---|
| A. Casar acessórios no robô | Tipos novos (`acc_sleeve`, `acc_fichario`, `acc_deckbox`, `acc_playmat`, `acc_toploader`) com identidade marca + tipo + capacidade (ex.: sleeve 65 un.) | Preço comparado entre lojas | Identidade difusa (estampa, marca genérica); risco de falso positivo; mexe no casamento (precisa golden) |
| B. Lista curada (recomendada para começar) | `config/kit-acessorios.json`: poucos itens oficiais (Copag/licenciados), cada um com ids/termos de casamento estritos | Controle de qualidade; pouco risco | Cobertura menor; manutenção manual |
| C. Só link de busca | "Procure sleeves nestas lojas" (padrão de `/lojas`) | Zero risco | Sem preço, sem total |

Proposta: **B agora, A depois** com dados medidos. Acessório nunca entra no ranking de lacrados nem na nota de oportunidade; categoria separada (`accessory.*` em `src/core/taxonomy.js`) para o banco não misturar. Enquanto B não existir, o kit mostra C para acessórios e deixa claro que o preço não está incluído.

## 4. Questionário e regras de recomendação

Perguntas (uma por etapa, com voltar/avançar, respostas na sessão — `sessionStorage` com try/catch):
1. Objetivo: colecionar · jogar · presentear · abrir boosters · proteger cartas.
2. Orçamento: R$ 50 · 100 · 200 · 400 · outro valor.
3. Preferência: boosters · lacrados de coleção · acessórios · combinação.
4. Idioma: português · inglês · japonês · sem preferência (padrão português).
5. Opcional: Pokémon favorito (texto livre, só filtra por nome), o que já tem, acessórios desejados.

Combos (modelos em `src/kit/modelos.js`, dados puros separados da lógica; `config/` é R3):
- **Minha primeira coleção:** blister/booster + (opcional) sleeve e fichário.
- **Colecionador organizado:** ETB ou coleção com boosters + fichário + sleeves.
- **Quero aprender a jogar:** `deck`/`kit_treinador` + sleeves + deck box (+ playmat opcional).
- **Quero cartas especiais:** `colecao_ex`/`colecao_premium`/`colecao_ilustracao` alinhados ao favorito, acessório de proteção como complemento.

Regras:
- Só produto **com oferta em estoque agora**, no idioma pedido (sufixo do id), na categoria do modelo. Nunca misturar idioma, variante ou categoria.
- Dentro do modelo, escolher pelo menor preço comparável (`byComparableTotal`); desempate por nota. Afiliado nunca muda a ordem.
- Respeitar o orçamento pelo **preço do produto**; mostrar o total com frete só quando todos os fretes forem conhecidos. Senão: "R$ X em produtos + frete a calcular".
- Texto explica por que cada item entrou ("abre 3 boosters", "deck pronto para começar a jogar"). Nunca citar carta, raridade ou chance.
- Sem dado suficiente: dizer isso e sugerir a alternativa verificada mais próxima (outro formato no orçamento) ou nenhuma.

## 5. Cesta e comparação de lojas

- Adicionar/remover/trocar item, quantidade, subtotal, link de cada oferta (o mesmo destino do site).
- **Uma loja × várias lojas:** para cada loja que tem todos os itens, subtotal da loja; para a divisão, o menor preço por item. Frete: soma só fretes conhecidos e **por loja** (um frete por pedido, nunca por item); loja com frete desconhecido marca a linha "frete a calcular". O selo de frete grátis por loja vale quando o subtotal daquela loja passa do mínimo publicado.
- Nunca afirmar "mais barato" se algum frete relevante for desconhecido; mostrar a diferença só nos produtos.

## 6. Critério para liberar recomendação real (do roadmap)

Golden/regressão em `test/` cobrindo: casamento correto dos itens sugeridos; só estoque atual; preço rastreável (oferta + data); orçamento respeitado; total honesto (frete desconhecido ≠ 0, frete por loja); sem mistura de idioma/variante/categoria; links de destino corretos. Até isso passar, a página fica **fora do menu e do índice** (`noindex`) e mostra o aviso de protótipo.

## 7. Medição

O Vercel Analytics gratuito conta páginas, não eventos. Mesmo truque do `/entrar` (#851): cada passo vira um caminho próprio (`/monte-seu-kit/objetivo`, `/orcamento`, …, `/resultado/<modelo>`) e o clique na loja passa por `/ir/kit/<loja>` → funil por página vista, anônimo e sem cookie. Eventos (`va('event')`) ficam no código para quando houver plano pago. Conversão afiliada só com dados do provedor.

## 8. Tarefas (cada uma em PR própria)

| # | Tarefa | Depende de | Aceite |
|---|---|---|---|
| K1 | Este documento | — | merge |
| K2 | `src/kit/modelos.js` + `src/kit/recomendar.js` (puro: produtos + ofertas + respostas → cesta) com golden de §6 usando fixtures sintéticas | K1 | testes verdes |
| K3 | Rota `/monte-seu-kit/*` oculta (`noindex`, fora do menu), questionário e resultado chamando `/api/v1/site/ofertas` | K2 | smoke da rota; aviso de protótipo |
| K4 | Cesta e comparação uma × várias lojas | K3 | golden de frete por loja |
| K5 | Acessórios opção B (`config/kit-acessorios.json`, categoria `accessory.*`) | K2, decisão do dono sobre itens | casamento estrito com golden; fora do ranking de lacrados |
| K6 | Liberar: menu desktop/mobile, chamada na Home ("Sua jornada Pokémon começa aqui" / CTA "Descobrir meu kit ideal"), sitemap | §6 verde + burn-in 7/7 | smoke no SHA publicado |

Decisões do dono antes de K5/K6: quais acessórios oficiais entram na lista curada; faixas de orçamento padrão.
