# Links de afiliado (Mercado Livre)

O site usa links de afiliado do Mercado Livre em **491 anúncios** (mapa de 17/10/2026, renovado em 30/10/2026, gerado pelo dono no Gerador de links do painel a partir das URLs que o site mostrava, etiqueta `tw20261010142247307`). Também em 30/10/2026, o dono gerou 183 links para anúncios que ainda não aparecem no site (catálogo de produtos Pokémon TCG e acessórios): eles só passam a valer quando o robô coletar aquele anúncio. Ficaram de fora os anúncios cujo link gerado se repetia em mais de um anúncio (46 em 17/10; 288 em 30/10, porque o gerador passou a devolver um link por página de catálogo `/p/`, igual para todos os vendedores) e 6 links novos idênticos a um link já mapeado para outro anúncio: não dá para garantir que ele leva a cada um. O link geral do dono (`https://meli.la/1BzQ4PU`) continua guardado e desligado. Anúncio fora do mapa abre na URL original da oferta, como antes.

Em 01/11/2026 entraram mais **191 anúncios** (total 682), gerados com a etiqueta `tcgpricehunter`, criada pelo dono nesse dia. Esses links foram gerados a partir da URL do anúncio (`https://produto.mercadolivre.com.br/MLB-<item_id>-_JM`), e não da página de catálogo. Foi conferido abrindo os links: um link gerado de `/p/MLB…?pdp_filters=item_id…` leva ao perfil social com o **produto de catálogo** e ignora o vendedor. Já o link gerado da URL do anúncio leva ao `item_id` certo. Ficaram de fora 7 anúncios que o gerador recusou por estarem pausados.

Em 03/11/2026 entraram mais **942 anúncios** e **21 links foram trocados** (total 1.913), gerados com a etiqueta `tcgpricehunter` pela mesma regra (URL do anúncio `MLB-<item_id>-_JM`, nunca `/p/`). A lista veio da busca "pokémon blister" do Mercado Livre (25 páginas): blisters unitários, duplos, triplos, quádruplos, gigantes, boosters avulsos, kits e caixas lacradas; cartas avulsas e outros TCGs ficaram de fora. Os 21 links trocados eram anúncios já mapeados com a etiqueta antiga `tw20261010142247307` e passaram para `tcgpricehunter`. Amostras abertas no navegador levaram ao `item_id` certo. O gerador recusou 5 anúncios (2 de produto usado e 3 de vendedor com reputação vermelha ou laranja), que não entraram.

Para renovar o mapa: listar os anúncios do ML em `data/offers.json` (branch `data`), montar a URL de cada anúncio no formato `produto.mercadolivre.com.br/MLB-<id>-_JM`, gerar os links no painel (no máximo 30 por vez), pedir a tabela "URL original ; link gerado" e acrescentar em `anuncios`. Não gere a partir de `/p/`. Link repetido em mais de um anúncio é descartado (o teste `test/affiliate-links-tests.js` recusa).

## Regra do dono (17/10/2026)

Decisão do proprietário, que paga a operação do site com as comissões:

- **Desempate a favor do link do dono.** Quando duas ofertas do mesmo produto têm o **mesmo total comparável** (mesma situação de frete), a que tem link de afiliado do dono aparece primeiro e vira a melhor oferta. Ela **nunca** passa na frente de uma oferta mais barata, nem de uma com frete conhecido quando a dela é desconhecido. Nenhum outro link perde visibilidade.
- **Sem etiqueta no site.** O link de afiliado é tratado como link normal: não há selo "Link de afiliado", ⓘ nem aviso junto do botão ou do bloco "Também na Amazon". A divulgação fica **geral**: rodapé (com a frase do Programa de Associados da Amazon e a regra do desempate) e Termos (seção 4). O atributo invisível `rel="nofollow sponsored"` continua nos links pagos (pedido do Google).
- **Grupos (Telegram/WhatsApp):** ofertas sem link do dono saem uma vez; as com link do dono são postadas e repostadas todo dia, a cada 24 h, espaçadas (regra dos bots, em `src/agents/social/auto.js`).
- **Posts dos grupos sem frase de afiliado (decisão do proprietário, 24/10/2026, PR #873).** O post traz só título, preço, loja, link e dica de cupom; a linha "Link de afiliado: podemos receber comissão…" saiu (`montarLegenda` em `src/agents/social/legenda.js`). A divulgação geral continua no rodapé e nos Termos do site. Os rascunhos editoriais (`rascunho.js`, carrossel) não mudaram.

## Regras que o código garante


1. **O afiliado só desempata.** Preço, frete, estoque e nota não mudam, e os módulos de ranking (`api/_lib/offer-rank.mjs`, `api/_lib/site.mjs`, `src/core/*`) continuam sem ler a configuração. O `offer-rank` tem um desempate registrável (`setTiePreference`), consultado só quando o total comparável empata, antes do id; as rotas que mostram ofertas (`api/v1.mjs`, `api/pagina.mjs`) registram `afiliadoPreferido` de `api/_lib/affiliates.mjs`. Na página, `byTot` e a ordem por preço usam `afPref` (mesma regra, com o mapa de `/api/v1/afiliados`). O Opportunity Engine (banco) não foi alterado: empate lá segue por id. Testes: `test/afiliado-desempate-tests.js` (só em empate, nunca acima de mais barata) e `test/affiliate-links-tests.js` (sem empate, resultados idênticos com e sem afiliado).
2. **A URL original continua sendo o dado.** `o.url` não é alterada em lugar nenhum: nem no robô, nem no banco, nem na API. Só o `href` do botão "Ver oferta" passa por `outUrl()` (em `index.html`), que devolve:
   - o link de afiliado **daquele anúncio**, quando ele está no mapa e passa na validação;
   - a própria URL original, intacta, em qualquer outro caso: outra loja, anúncio do ML fora do mapa, página de catálogo sem vendedor, destino inválido ou config ausente.
3. **Link de outra loja nunca vira link do ML.** A troca só acontece quando a URL da oferta é um anúncio do Mercado Livre (`MLB…` no caminho, ou `pdp_filters=item_id:MLB…`).
4. **O link geral nunca vai para um anúncio.** Ele só pode aparecer no rodapé, com o rótulo "Ver mais no Mercado Livre", sem etiqueta de afiliado (regra de 17/10). Isso exige duas marcações na config: `ativo: true` e `destinoConfirmado: true`.
5. **Nada é anexado à URL.** O link é usado inteiro, exatamente como o painel do ML gerou. Não montamos parâmetro de tracking e não inventamos parâmetro de afiliado. Isso mantém válido o teste `test/outbound-links-tests.js` (#116: "links de saída sem tracking"). A única forma de `href` nova que ele aceita é `${esc(safeUrl(outUrl(<url>)))}`, sempre dentro de `safeUrl`.
6. **Destino validado duas vezes**, no servidor e no navegador. Só é aceito link `https://` em `meli.la`, `mercadolivre.com.br`, `www.mercadolivre.com.br` ou `produto.mercadolivre.com.br`, sem credenciais, sem porta, sem espaço e sem aspas. Se o link for inválido, vale a URL original. Não existe redirecionador interno, então não há risco de open redirect.
7. **Layout igual, sem etiqueta.** Os botões mantêm `target="_blank"`, `rel="noopener"` e o texto `.sr` "(abre em nova aba)" da #181, e não ganham selo nem texto de afiliado (regra de 17/10; `test/affiliate-disclosure-site-tests.js` confere a ausência). Quando o destino é de afiliado, o `rel` ganha `nofollow sponsored` (`outRel` em `index.html`), igual aos links "Ver na Amazon" da #194; é um atributo invisível. O link geral do rodapé sai sempre com `rel="noopener nofollow sponsored"`. A divulgação é o aviso geral do rodapé e dos Termos.
8. **Cliques.** O evento agregado `click_store` que já existe (Vercel Analytics: loja, produto e preço, sem dados pessoais) não mudou. Não foi criado nenhum analytics novo.

## Onde configurar

Tudo fica num lugar só: **`config/affiliates.json`**. Quem lê esse arquivo é apenas `api/_lib/affiliates.mjs`. A página recebe a versão validada por `GET /api/v1/afiliados`, e esse pedido não consulta banco nem state.json.

```json
{
  "mercadolivre": {
    "anuncios": {
      "MLB1234567890": "https://meli.la/XXXXXXX"
    },
    "geral": { "url": "https://meli.la/1BzQ4PU", "rotulo": "Ver mais no Mercado Livre", "ativo": false, "destinoConfirmado": false }
  }
}
```

- **`anuncios`**: mapa do id do anúncio para o link de afiliado gerado para **esse** anúncio. O id é `MLB` seguido dos números. Ele aparece na URL da oferta (`produto.mercadolivre.com.br/MLB-1234567890-...` vira `MLB1234567890`; em `.../p/MLB19876543?pdp_filters=item_id%3AMLB4455667788`, o id é o do `item_id`: `MLB4455667788`). Uma entrada inválida é ignorada e não derruba o site.
- **`geral`**: o link geral do dono. Ele só é publicado (no rodapé) com `ativo: true` **e** `destinoConfirmado: true`.
- Os **Termos de uso** (seção 4) e o rodapé trazem sempre o aviso geral de afiliado (Mercado Livre, Amazon e Shopee) e a regra do desempate.
- Mudar a config exige um novo deploy das funções `api/v1.mjs` e `api/pagina.mjs`. O `vercel.json` inclui o arquivo nas duas com `includeFiles`.

## O que as regras oficiais do Mercado Livre dizem

As páginas do Programa de Afiliados e Criadores responderam 403 para leitura automática. Os trechos abaixo vêm dos resumos que a busca mostrou dessas mesmas páginas oficiais. Vale reler no painel antes de ativar qualquer link.

- **O link é gerado por página/oferta.** No Portal do Afiliado, em "Gerador de links", você abre a oferta que quer divulgar, copia o endereço da página, cola em "Insira 1 ou mais URLs separados por 1 linha", escolhe a etiqueta e clica em "Gerar". Dá para escolher entre link curto e completo. Fontes: [Gere seus links](https://www.mercadolivre.com.br/l/afiliados-gere-seus-links), [Primeiros passos](https://www.mercadolivre.com.br/l/afiliados-primeiros-passos) e [Portal do afiliado](https://www.mercadolivre.com.br/l/afiliados-portal-do-afiliado).
- **Compra de outro produto:** "Se alguém entrar pelo seu link e comprar outro produto, você também ganha", dentro de uma janela após o clique. O resumo de uma página oficial fala em 24 horas, e sites de terceiros falam em 30 dias. **Confirme nos termos.** Fontes: [Perguntas frequentes](https://www.mercadolivre.com.br/l/primeiros-passos-perguntas-frequentes-para-afiliados) e [Programa de afiliados e criadores](https://www.mercadolivre.com.br/l/afiliados-home).
- **Proibições:** impulsionar em buscadores ou em anúncios de busca/shopping (Google Ads, Google Shopping, Bing Ads, YouTube Ads); comprar pelos próprios links; e **compartilhar links ou IDs em grupos privados ou em sites que você não declarou**. Fontes: [Política](https://www.mercadolivre.com.br/l/afiliados-politica), [Quebra de política](https://www.mercadolivre.com.br/l/afiliados-quebra-de-politica) e [Motivos de suspensão](https://www.mercadolivre.com.br/ajuda/suspensao-conta-afiliado-regras_40039).
- **Comissão e pagamento:** até 16% por venda aprovada, variando por categoria. O pagamento cai no Mercado Pago, com período de revisão de 60 dias e mínimo de R$ 30. Fontes: [Ganhos](https://www.mercadolivre.com.br/l/afiliados-ganhos) e [Conheça o programa](https://www.mercadolivre.com.br/ajuda/27921).
- **Não foi encontrado nenhum parâmetro oficial e público** que transforme qualquer URL de anúncio em link de afiliado. Por isso o código não monta parâmetro nenhum.

### O link `meli.la/1BzQ4PU`

- Foi feita uma única requisição `HEAD`, sem seguir redirecionamento e sem login. A resposta foi **403 (CloudFront)**, sem cabeçalho `Location`. **O destino não pôde ser confirmado.**
- Pelas regras acima, `meli.la` é o formato de link curto que o gerador cria para uma página específica: um produto, uma lista, o perfil social ou uma campanha. **Não é um link "coringa"** que dá comissão em qualquer anúncio que a pessoa abrir sem passar por ele.
- Trocar o link de cada oferta pelo link geral mandaria a pessoa para outra página, e não para a oferta escolhida. Isso viola a regra 2. Por isso **o link geral não é aplicado a anúncios**.

## O que está confirmado e o que o dono precisa fazer

**Confirmado no código:** a infraestrutura, a validação, o fallback para a URL original, os resultados idênticos com e sem afiliado, e o fato de que nenhum link está ativo por padrão.

**O dono precisa, no painel de Afiliados (sem automação):**

1. **Declarar o site** (domínio do TCG Price Hunter) no perfil de afiliado. A política proíbe usar links em sites não declarados.
2. **Conferir para onde `https://meli.la/1BzQ4PU` leva**, abrindo o link logado no navegador. Se for uma página geral (perfil social, lista ou campanha) e você quiser exibi-la, marque `ativo: true` e `destinoConfirmado: true` em `geral`. Ela aparece só no rodapé.
3. **Para cada anúncio que quiser comissionar:** copiar a URL do anúncio que o site mostra, gerar o link no "Gerador de links" a partir **dessa** URL e adicionar `"MLB…": "<link gerado>"` em `anuncios`. O link precisa levar ao **mesmo anúncio**: o código não tem como conferir o destino de um link curto. Os anúncios do ML coletados mudam com o tempo (o robô escolhe os vendedores mais baratos), e uma entrada de um anúncio que saiu do site simplesmente não é usada.
4. **Revisar a janela de atribuição e as regras de divulgação** nos Termos e Condições do programa, e decidir se quer um aviso visível além do aviso dos Termos de uso e do texto para leitor de tela.

## Limitações

- Não há garantia de comissão. Ela depende das regras do ML (anúncio elegível, janela, compra não cancelada) e de o link do mapa ter sido gerado pela conta do dono para aquele anúncio.
- O destino do link curto não é verificado em tempo real, porque o site não faz rede para o ML.
- As pistas (Telegram) e o arquivo `tools/page.template.html` (que diverge do `index.html`, issue #98) não usam o resolvedor. Os links deles continuam sendo a URL original.
- Se a config ainda não carregou (ou falhou), os botões usam a URL original. Quando ela chega com anúncios, a tela é redesenhada uma vez.

## Shopee

O site não coleta anúncios da Shopee, então não existe mapa por anúncio. Links gerados pelo dono no Portal de Afiliados em 17/10/2026 (ordem do pedido; o destino do link curto não pôde ser conferido daqui):

| Página | Link de afiliado | Onde é usado |
|---|---|---|
| `https://shopee.com.br` | `https://s.shopee.com.br/8fTCnyee7e` | "Link do canal" dos rascunhos de Social Media (`config/social-afiliados.json`) |
| `https://shopee.com.br/search?keyword=pokemon%20tcg` | `https://s.shopee.com.br/8pmd0He0mh` | Ainda não usado (candidato: botão da Shopee em /lojas) |
| `https://shopee.com.br/lvftcg` | `https://s.shopee.com.br/8KqMPMfunc` | Ainda não usado (candidato: LVF TCG em /lojas) |
| `https://shopee.com.br/asuamaneirafestas` | `https://s.shopee.com.br/8V9mbffHSf` | Ainda não usado (candidato: A Sua Maneira Festas em /lojas) |


## Emenda de 07/11/2026: site só com parceiros

Por decisão do proprietário em 07/11/2026, o site público passa a mostrar SÓ ofertas que levam o link de afiliado do dono: anúncios do Mercado Livre com link no mapa e as leituras manuais da Amazon e da Shopee (cada leitura sai sozinha em 48 h). As demais lojas continuam sendo lidas só como referência de mercado (ex.: "12% abaixo da média do mercado"); nome, link e oferta delas não são publicados. Isto emenda a regra "comissão nunca influencia ranking ou recomendação" em um ponto: a comissão passa a decidir QUEM entra no site. Entre os parceiros publicados a ordem continua por preço/nota e a comissão não reordena ninguém. A chave é a variável do repositório `SITE_SO_PARCEIROS` (padrão ligado, por decisão do dono; `0` em Settings → Actions → Variables e na env da Vercel volta ao antigo), lida só pelo workflow; ela não aparece em nenhum dado ou tela públicos.

Implementação (fase 1): `ofertaParceira` e `ofertasManuaisParceiras` em `api/_lib/affiliates.mjs` (único leitor da config); `src/parceiros.js` só as chama a partir de `src/run.js`. Filtro único e a montante: `state.json`, ranking, alertas, atividade, histórico do gráfico (`data/hist`), `history.jsonl` e o banco recebem só o conjunto publicado; `marketAverage` e `marketRef` vêm de todas as lojas lidas. Arquivos de operação (`offers.json`, `sources.json`, `review.json`) seguem completos para a rodada seguinte.

Implementação (fase 2, interface): `api/_lib/modo-parceiros.mjs` lê `SITE_SO_PARCEIROS` no servidor (padrão ligado; só `0` desliga; a Vercel não vê a variável do GitHub, então na dúvida o site fica restrito) e aplica `estadoParceiro` em `legacyState`, `catalogState` e `_seo.state`; as consultas de `read-db.mjs` recebem a lista de parceiras como parâmetro SQL. No SSR e no `index.html` saíram o diretório e a rota `/lojas` (301 para a Home), "Procurar em outras lojas" e os blocos "Também na Amazon/Shopee" (as leituras manuais entram no ranking como ofertas normais, com "lido em dd/mm às hh:mm" e frete desconhecido). Social/Telegram publicam só ofertas parceiras. Testes: `test/so-parceiros-ui-tests.js`; os testes antigos que cobrem o comportamento com todas as lojas fixam `SITE_SO_PARCEIROS=0`.

## 13/11/2026: lote de ofertas, ME06 no catálogo e cupom com preço final no grupo

Pedido do dono: pôr no site todas as ofertas levantadas na planilha "TCG Price Hunter — Ofertas afiliado (13/11/2026)", inclusive os unitários; no grupo, só blisters, unitários e outros produtos que valham a pena, com Black Friday de blister/unitário na frente; e todo post com cupom e o preço que sai com ele.

- **Mercado Livre:** 40 anúncios novos em `anuncios` (etiqueta `tcgpricehunter`, gerados da URL `MLB-<id>-_JM`) e 1 link trocado (MLB7640776150). Um anúncio pausado ficou de fora.
- **Reinado Delta (ME06)** entrou em `config/catalog.json` (já à venda nas três lojas); `FORA_DO_CATALOGO` ficou vazia. O alias "mega evolução 6" ficou de fora de propósito: "(6 Cartas)" virava ME06.
- **Shopee:** 8 anúncios relidos (preço e hora) e 18 links novos em `shopee.json`. Os 22 anúncios novos ainda **não** entram em `shopee-ofertas.json`: a regra pede o vendedor, que não foi lido nesse lote.
- **Amazon:** os ASINs novos dependem do link curto `link.amazon` da SiteStripe (regra das leituras manuais); ainda não gerados.
- **Grupo:** foco passou a incluir blister unitário e booster avulso (`TIPOS_FOCO` em `src/agents/social/economia.js`); dentro do bloco Black Friday e do resto, blister/unitário vêm antes dos outros produtos. `comCupom` (`tools/social-whatsapp.mjs`) põe em cada post o melhor cupom vigente da loja (`melhorCupom`/`linhaCupomComPreco` em `src/agents/social/cupons.js`, cupons com `loja` e `codigo` em `config/social-cupons.json`) e o preço final; sem cupom que sirva, nenhuma linha. `SOCIAL_CUPONS=0` desliga. Os cupons de código vieram de sites de cupom e não foram testados no carrinho: validade curta, somem sozinhos.
