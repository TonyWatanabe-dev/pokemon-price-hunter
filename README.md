# Pokémon TCG Price Hunter Brasil

Agente que roda sozinho, coleta preços de lojas brasileiras e responde uma pergunta: **quanto abaixo do preço sugerido Copag dá para comprar este produto agora?**

Node 20+, zero dependências, dados em JSON versionado. Painel em HTML único, sem CDN.

## Como funciona

A cada rodada o agente:

1. Lê `config/stores.json`, detecta a plataforma de cada loja (Shopify, VTEX ou JSON-LD genérico) e respeita o `robots.txt`.
2. Normaliza cada anúncio e casa com o catálogo pela combinação coleção + tipo + quantidade de boosters. Na dúvida, não casa.
3. Registra mudanças de preço, frete e estoque em `data/history.jsonl`.
4. Calcula desconto vs Copag, R$/booster, preço anormal e reputação da loja. A nota de oportunidade é só a oficial do Opportunity Engine (calculada no banco); os alertas leem essa nota antes do envio e, sem nota válida, saem sem ela.
5. Avalia as regras de `config/watchlist.json` e envia alertas por Telegram e push (ntfy), com anti-spam.
6. Gera `data/state.json`, que alimenta o painel e a API.

## Preço sugerido Copag

A fonte principal é a loja oficial da Copag (copagloja.com.br). Quando um produto está à venda lá, o agente captura o preço sozinho, com a URL e a data, e registra o valor anterior se ele mudar (`data/copag-msrp.json`). Produto esgotado na Copag não mostra preço, então ele fica "não confirmado" até voltar ao estoque ou até você cadastrar à mão em `config/catalog.json`:

```json
"copag": { "msrp": 449.99, "source_url": "https://www.copagloja.com.br/…", "confidence": "OFICIAL" }
```

O cadastro manual vence o capturado. Marketplace nunca vale como fonte. Sem preço confirmado, o produto não recebe desconto, score, selo nem alerta de preço.

## Instalação (GitHub, custo zero)

1. Crie um repositório **público** com esta pasta (Actions ilimitado e Pages grátis; em repositório privado, 15 em 15 minutos estoura a cota mensal).
2. Em *Settings → Secrets and variables → Actions*, cadastre os segredos que for usar:
   - `TELEGRAM_BOT_TOKEN` e `TELEGRAM_CHAT_ID` (crie o bot com o @BotFather)
   - `NTFY_TOPIC` (push no celular pelo app ntfy, sem conta; use um nome difícil de adivinhar)
   - `BRAVE_API_KEY` (opcional, liga a descoberta de lojas)
   - `ML_ACCESS_TOKEN` (opcional, token OAuth de app do Mercado Livre)
   - Variável `HUNTER_CEP` (frete calculado em lojas VTEX)
3. Ative o GitHub Pages na branch principal. O painel fica em `/dashboard/`.
4. Rode o workflow manualmente uma vez em *Actions → Price Hunter → Run workflow*.

## Rodar no seu computador

```bash
npm test            # testes offline com lojas simuladas
npm run hunt        # uma rodada
npm run loop        # 24/7, a cada HUNTER_INTERVAL_MIN minutos (padrão 10)
npm run serve       # painel e API em http://localhost:8787
```

Rodar em casa usa IP residencial brasileiro, que muitas lojas bloqueiam menos que servidores nos EUA.

## API (`npm run serve`)

`GET /collections` `/products` `/products/:id` `/copag-prices` `/offers?product=` `/best-deals` `/price-history?product=&days=` `/stores` `/alerts`, e `POST /watchlist` ou `POST /alerts` (mesmo efeito: cria ou atualiza uma regra).

## Limites reais

- **Lojas sem domínio:** Nerb Store, GRB Cards, Cardora, MatosTCG, Gorupa e Culture TCG ficam como "Domínio a confirmar" até você preencher `url` em `config/stores.json`. Liga Pokémon e MYP Cards bloqueiam robôs e estão pausadas (`enabled: false`).
- **Marketplaces:** Mercado Livre só com token OAuth (a busca pública retorna 403 desde 2025). Amazon, Shopee e Magalu não têm API pública de busca e protegem as páginas contra robôs, então ficam como "Sem integração". O agente não contorna bloqueio.
- **Lojas com plataforma própria:** se não forem Shopify, VTEX nem tiverem JSON-LD, aparecem como erro. Para elas, liste URLs de produto em `productUrls` da loja.
- **Frete:** calculado por CEP só em VTEX. Nas demais aparece "não informado" e o total é só o produto.
- **Reputação:** sem evidência em `evidence` (CNPJ, nota, anos, política de troca), a loja fica sem validação.
- **Não implementado ainda:** WhatsApp e e-mail, modos Investimento, Abertura e Colecionador, e cupom/cashback.
