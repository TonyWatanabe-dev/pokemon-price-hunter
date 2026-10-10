# Links de afiliado (Mercado Livre)

O site tem suporte a links de afiliado do Mercado Livre, mas **hoje nenhum anúncio usa link de afiliado**. O mapa de anúncios está vazio e o link geral do dono (`https://meli.la/1BzQ4PU`) está guardado, mas desligado. Assim, todo "Ver oferta" continua abrindo a URL original da oferta, como antes.

## Regras que o código garante

1. **O afiliado nunca muda o resultado.** Ranking, melhor oferta, preço, frete, estoque e nota (Opportunity Engine, `api/_lib/offer-rank.mjs`, `src/core/*`) não leem a configuração de afiliados. O teste `test/affiliate-links-tests.js` compara os resultados com e sem afiliado configurado e confere que são idênticos. Ele também confere que esses arquivos não citam o módulo.
2. **A URL original continua sendo o dado.** `o.url` não é alterada em lugar nenhum: nem no robô, nem no banco, nem na API. Só o `href` do botão "Ver oferta" passa por `outUrl()` (em `index.html`), que devolve:
   - o link de afiliado **daquele anúncio**, quando ele está no mapa e passa na validação;
   - a própria URL original, intacta, em qualquer outro caso: outra loja, anúncio do ML fora do mapa, página de catálogo sem vendedor, destino inválido ou config ausente.
3. **Link de outra loja nunca vira link do ML.** A troca só acontece quando a URL da oferta é um anúncio do Mercado Livre (`MLB…` no caminho, ou `pdp_filters=item_id:MLB…`).
4. **O link geral nunca vai para um anúncio.** Ele só pode aparecer no rodapé, com o rótulo "Ver mais no Mercado Livre" e o aviso "link de afiliado" para leitor de tela. Isso exige duas marcações na config: `ativo: true` e `destinoConfirmado: true`.
5. **Nada é anexado à URL.** O link é usado inteiro, exatamente como o painel do ML gerou. Não montamos parâmetro de tracking e não inventamos parâmetro de afiliado. Isso mantém válido o teste `test/outbound-links-tests.js` (#116: "links de saída sem tracking"). A única forma de `href` nova que ele aceita é `${esc(safeUrl(outUrl(<url>)))}`, sempre dentro de `safeUrl`.
6. **Destino validado duas vezes**, no servidor e no navegador. Só é aceito link `https://` em `meli.la`, `mercadolivre.com.br`, `www.mercadolivre.com.br` ou `produto.mercadolivre.com.br`, sem credenciais, sem porta, sem espaço e sem aspas. Se o link for inválido, vale a URL original. Não existe redirecionador interno, então não há risco de open redirect.
7. **Layout igual.** Os botões mantêm `target="_blank"`, `rel="noopener"` e o texto `.sr` "(abre em nova aba)" da #181. Quando o destino é de afiliado, o `rel` ganha `nofollow sponsored` (`outRel` em `index.html`), igual aos links "Ver na Amazon" da #194. O link geral do rodapé sai sempre com `rel="noopener nofollow sponsored"`.
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
- Os **Termos de uso** (seção 4) mostram automaticamente um aviso de afiliado quando existe pelo menos um link ativo.
- Mudar a config exige um novo deploy da função `api/v1.mjs`. O `vercel.json` inclui o arquivo nela com `includeFiles`.

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
