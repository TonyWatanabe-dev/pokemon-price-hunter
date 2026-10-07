# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Stack

Static single-file HTML page (no framework, no CDN), served by GitHub Pages from the repository root (`index.html`). It reads `data/state.json`, written every 15 minutes by a Node agent in GitHub Actions. Self-hosted assets only, embedded or beside the page.

## Users

One person: Tony, a Brazilian Pokémon TCG collector (and the tool's owner). He opens the panel mostly on his phone, between other things, to decide whether to buy sealed Pokémon TCG product right now. He buys for two separate reasons, which the panel must keep separate: to open (value per booster) and to keep sealed (discount vs the Copag suggested price, the official Brazilian distributor).

## Product Purpose

Answer one question per product: how far below the Copag suggested price can it be bought right now, in stock, at a trustworthy Brazilian store. Success: he spots a real deal in seconds and trusts it enough to tap through and buy.

## Positioning

The price reference is the Copag suggested price (MSRP), not the market average. Every offer is checked for confirmed stock, a positively identified sealed PT-BR product, and an official price source before it can rank or alert. Unconfirmed data is shown as unconfirmed, never guessed.

## Operating Context

- Agent runs every 15 minutes (cron-job.org triggers GitHub Actions); panel is a static page refreshed after each run.
- Alerts also go to Telegram and ntfy push; the panel is where he compares and decides.
- Stores are added from the panel ("Adicionar loja") which opens GitHub with the file prefilled.
- Data per offer: product (collection + type + booster count + variant), store, price (Pix preferred), shipping, total, R$/booster, stock state, discount vs Copag, Deal Score 0-100, classification, anomaly flag, source URL and timestamp.

## Capabilities and Constraints

- Product types: booster box, combo, booster pack, ETB (Treinador Avançado), blisters 1/2/3/4, minilata, lata, baralho de batalha, desafio estratégico, and collection boxes (premium, especial, ex, pôster, fichário, miniatura, porta-retrato, ilustração).
- Collections: Escarlate e Violeta (all), Megaevolução (ME01-ME05), Celebração de 30 Anos. Filters must be generated from the data.
- Stock states: em estoque, sem estoque, pré-venda, não confirmado, fonte bloqueada.
- Two decision views: "Para abrir" (R$ por booster) and "Para guardar" (desconto vs Copag), separated.
- Legal: no Pokémon characters, Poké Ball, official logos or trade dress may be drawn or generated. The theme is the sealed-TCG collector's world in original artwork.

## Brand Commitments

- Name: Price Hunter (Pokémon TCG Brasil).
- Portuguese (pt-BR) copy, lean and direct.
- Owner's tooling discipline: single-file HTML, no backend, no CDN.

## Evidence on Hand

- Real data from the agent (`data/state.json`). No testimonials, no customers, no invented prices. Copag prices come only from Copag's store or Copag's published retail catalog, labeled as such.

## Product Principles

1. Truth over excitement: unconfirmed data looks unconfirmed.
2. One question per product: how much below Copag, right now.
3. Opening and keeping are different decisions; never mix their rankings.
4. Phone first: the best deal is readable and tappable in the first screen.
