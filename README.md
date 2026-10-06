# Pokémon TCG Price Hunter Brasil

Agente que roda sozinho, coleta preços de lojas brasileiras e responde uma pergunta: **quanto abaixo do preço sugerido Copag dá para comprar este produto agora?**

Node 20+, zero dependências, dados em JSON versionado. Painel em HTML único, sem CDN.

## Como funciona

A cada rodada o agente:

1. Lê `config/stores.json`, detecta a plataforma de cada loja (Shopify, VTEX ou JSON-LD genérico) e respeita o `robots.txt`.
2. Normaliza cada anúncio e casa com o catálogo pela combinação coleção + tipo + quantidade de boosters. Na dúvida, não casa.
3. Registra mudanças de preço, frete e estoque em `data/history.jsonl`.
4. Calcula desconto vs Copag, R$/booster, Deal Score, preço anormal e reputação da loja.
5. Avalia as regras de `config/watchlist.json` e envia alertas por Telegram e push (ntfy), com anti-spam.
6. Gera `data/state.json`, que alimenta o painel e a API.

## Preço sugerido Copag

Não encontrei tabela pública de MSRP da Copag. A venda oficial acontece por lojas oficiais no Mercado Livre e na Amazon, e marketplace não vale como fonte. Por isso **o MSRP é cadastrado por você** em `config/catalog.json`:

```json
"copag": { "msrp": 449.99, "source_url": "https://…", "confidence": "OFICIAL", "source_timestamp": "2026-10-06" }
```

Sem esses três campos válidos, o produto aparece como "Preço sugerido Copag não confirmado" e não recebe desconto, score, selo nem alerta de preço. `npm run copag-check` confere a fonte diariamente e marca divergências para revisão. O valor oficial nunca muda sozinho.

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

- **Lojas dos 10 nomes iniciais:** só Liga Pokémon e MYP Cards vieram com domínio. As outras ficam como "Domínio a confirmar" até você preencher `url` em `config/stores.json`. Não inventei endereço.
- **Marketplaces:** Mercado Livre só com token OAuth (a busca pública retorna 403 desde 2025). Amazon, Shopee e Magalu não têm API pública de busca e protegem as páginas contra robôs, então ficam como "Sem integração". O agente não contorna bloqueio.
- **Lojas com plataforma própria:** se não forem Shopify, VTEX nem tiverem JSON-LD, aparecem como erro. Para elas, liste URLs de produto em `productUrls` da loja.
- **Frete:** calculado por CEP só em VTEX. Nas demais aparece "não informado" e o total é só o produto.
- **Reputação:** sem evidência em `evidence` (CNPJ, nota, anos, política de troca), a loja fica sem validação e nenhuma oferta dela ganha o selo 🔥.
- **Não implementado ainda:** WhatsApp e e-mail, modos Investimento, Abertura e Colecionador, e cupom/cashback.
