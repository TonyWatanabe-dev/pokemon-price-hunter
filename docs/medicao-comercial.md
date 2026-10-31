# Medição comercial (fora do Monte seu kit)

O que medir para saber se o site gera clique, comissão e confiança. O funil do kit está na #914 e em
`docs/monte-seu-kit.md` §7; este documento cobre o resto. Ele é **especificação**: nenhuma instrumentação nova é aplicada
aqui (decisão do dono). Referências de linha valem para a `main` em `c0b6bf44` (25/10/2026).

Marcadores: **[existe]** está no código hoje · **[proposta]** não existe · **[#914]** chega com a PR do kit.
Evidência: (a) leitura/teste local · (c) execução real · (d) confirmado em produção · **hipótese** = a conferir.

## 1. Estado de hoje (resumo)

- Ferramenta única: Vercel Web Analytics, carregado uma vez por página (`index.html:3781`, `entrar.html:118`,
  `ir.html:35`, `kit.html:76`). Ligado em produção (d). Sem cookie, sem identificador; descrito em `/privacidade`
  (`index.html:2251`).
- Plano: compatível com Hobby (conta pessoal). No Hobby só **páginas vistas** aparecem; os `va('event')` são Pro/Enterprise
  (`index.html:3039`). Os ~20 `track()` abaixo estão **só instrumentados** (a).
- API de leitura (`aggregate_pageviews`, `count_events`) responde `404 Web Analytics not found` (c). Os números só existem no
  painel, lidos pelo dono.
- Clique de saída para loja e clique de afiliado: **nenhuma contagem** que funcione no plano atual (a).
- `hunter.affiliate_click` existe (`db/migrations/001_core.sql:311`) e ninguém grava nela; só é lida em
  `src/core/integrity-report.js:12` (a).
- Posts sociais sem UTM: o Top 3/10 cita `www.tcgpricehunter.com.br` puro (`src/agents/social/top.js:7`); o WhatsApp não envia
  referrer, então esse tráfego cai em "direto" (a). Links de afiliado nos grupos vão direto à loja, sem passar pelo site
  (`tools/social-whatsapp.mjs:99-101`) (a).
- Único funil medido de ponta a ponta no Hobby: `/entrar/<origem>` → `/ir/<canal>/<origem>` (página vista por clique,
  `assets/web/entrar-v4.js:7-13`, `assets/web/ir-v2.js`) (d).

## 2. Catálogo de eventos

Regras para todo evento, existente ou novo:
- nome em `snake_case`; propriedades curtas, enumeradas ou numéricas;
- **sem dado pessoal**: nada de texto livre digitado, e-mail, nome, CEP, IP, user-agent, uid ou id de conta;
- id de produto/oferta/loja é catálogo, não pessoa: permitido;
- um clique gera um evento; página vista e evento do mesmo clique não se somam (são o mesmo sinal).

O teste `test/medicao-catalogo-eventos-tests.js` compara a tabela abaixo com os `track()`/`va('event')` das páginas servidas
(`index.html`, `entrar.html`, `ir.html`, `kit.html` e os scripts que elas carregam). Mudou o código? Atualize esta tabela.

<!-- catalogo:inicio -->
| evento | estado | arquivo | quando dispara | propriedades |
|---|---|---|---|---|
| `view_deal` | existe | index.html | abre o detalhe de uma oportunidade (`:2304`) | `id`, `score` |
| `view_product` | existe | index.html | abre a página de um produto (`:2415`) | `id` |
| `view_price_history` | existe | index.html | troca período ou modo do histórico (`:3723-3724`) | `id`, `period` ou `mode` |
| `shipping_calc` | existe | index.html | calcula frete (`:2620`) | `n` (quantidade de lojas) |
| `search` | existe | index.html | envia uma busca (`:3127`) | `q` (**texto livre, até 60 caracteres: ver §7**), `results` |
| `filter_used` | existe | index.html | usa filtro/ordem (`:3719`, `:3728`, `:3733`, `:3765`, `:3768-3769`) | `f`, `v` |
| `collection_card` | existe | index.html | toca cartão de coleção (`:3735`) | `col` |
| `click_store` | existe | index.html | toca "Ver oferta" (`:3716`) ou uma pista (`:3715`) | `store`, `id`, `price`, `src` (`opp`) ou `tip` |
| `group_click` | existe | index.html | toca botão de grupo no site (`:3697`) | `canal`, `origem` |
| `social_click` | existe | index.html | toca link de rede social (`:3698`) | `rede` |
| `kit_click` | existe | index.html | toca chamada do Monte seu kit (`:3696`) | `origem` (menu/mais/home) |
| `share_click` | existe | index.html | compartilha (`:2859`) | `via` |
| `favorite` | existe | index.html | salva favorito (`:2817`) | `id` |
| `create_alert` | existe | index.html | cria alerta de preço (`:2842`) | `id` |
| `login_started` | existe | index.html | abre o login (`:2680`) | `reason` |
| `signup_completed` | existe | index.html | conclui cadastro (`:2667`, `:2793`) | `method` |
| `telegram_link_started` | existe | index.html | inicia vínculo com o Telegram (`:2936`) | — |
| `entrar_view` | existe | assets/web/entrar-v4.js | abre `/entrar` (`:15`) | `origem` |
| `group_click` | existe | assets/web/entrar-v4.js | toca botão de grupo no `/entrar` (`:19`) | `canal`, `origem`, `pos` |
| `kit_step` | pr914 | assets/web/kit-v3.js | nova etapa do questionário | `etapa` |
| `kit_result` | pr914 | assets/web/kit-v3.js | resultado montado | `modelo`, `itens`, `objetivo`, `idioma`, `faixa`, `favorito` |
| `kit_item` | pr914 | assets/web/kit-v3.js | adiciona/remove/troca item | `acao`, `modelo`, `itens` |
| `kit_click_store` | pr914 | assets/web/kit-v3.js | "Ver na loja" no kit | `loja`, `produto`, `preco`, `modelo` |
| `kit_restart` | pr914 | assets/web/kit-v3.js | refaz o questionário | — |
| `click_affiliate` | proposta | index.html | toca link patrocinado sem `data-store`: "Ver na Amazon" (`:2514`), "Ver na Shopee" (`:2529`), rodapé `data-afil` (`:3672`) | `programa` (amazon/shopee/ml), `sup`, `lugar` (produto/rodape) |
| `freshness_seen` | proposta | index.html | 1ª renderização de uma tela com preço, uma vez por tela | `status` (atual/atrasado/desatualizado/indisponivel), `sup` |
| `search_empty` | proposta | index.html | busca sem resultado | `n` (tamanho do texto), `tipo` |
<!-- catalogo:fim -->

Mudanças propostas em eventos existentes (mesmo nome, sem quebrar o painel):
- **`click_store`** [proposta]: somar `sup` (superfície, §3.1) e `af` (1 se o destino é link de afiliado, isto é,
  `outUrl(u)!==u`, `index.html:1554` e `:1562`). Sem isso não há CTR por superfície nem fatia de afiliado.
- **`search`** [proposta]: trocar `q` por `n` (tamanho) e `results`; texto livre pode conter dado pessoal (§7).
- **`group_click` do site** [proposta]: o link do botão (`index.html:2969`, `:2999-3000`) passaria por `/ir/<canal>/site-<sup>`
  como no `/entrar`, para contar no Hobby por página vista.

## 3. KPIs

Período padrão: semana fechada (segunda a domingo, horário de Brasília). Número sem fonte é "sem fonte", nunca 0.

### 3.1 Superfícies

| `sup` | caminhos (página vista no Vercel) |
|---|---|
| `home` | `/` |
| `oportunidades` | `/oportunidades`, `/produtos`, `/pistas` |
| `produto` | `/produto/*` |
| `colecao` | `/colecao/*`, `/tipo/*` |
| `busca` | `/busca` |
| `grupos` | `/comunidade` |
| `kit` | `/monte-seu-kit/*` (#914) |

Mapa de rotas: `index.html:1568-1569` (`ROUTES`/`PATHS`).

### 3.2 Fórmulas

| KPI | fórmula | fonte hoje | fonte proposta |
|---|---|---|---|
| Visitas | visitantes únicos e páginas vistas por semana, total e por origem/UTM | Vercel, painel [existe] | idem |
| CTR de saída por superfície | cliques de saída com `sup=S` ÷ páginas vistas de `S` | sem fonte | contador (§5) ou `click_store.sup` (Pro) |
| CTR do grupo | entradas no grupo ÷ páginas vistas de `/comunidade` (site) ou `/entrar/*` (anúncio) | `/ir/*` ÷ `/entrar/*` [existe, só /entrar] | `/ir/<canal>/site-<sup>` |
| Cliques por loja | cliques de saída agrupados por `loja` | sem fonte (kit: `/monte-seu-kit/saida/<loja>`, #914) | contador ou `click_store.store` |
| Cliques de afiliado | cliques com `af=1`, por programa (ML, Amazon, Shopee); e fatia `af=1` ÷ total | sem fonte | contador ou `click_store.af` + `click_affiliate` |
| Conversão | pedidos atribuídos pelo programa ÷ cliques de afiliado do mesmo programa e período | sem fonte (só nos painéis ML/Amazon/Shopee) | relatório do programa, ingestão manual semanal |
| Receita por 1.000 visitas | comissão do período (R$) ÷ visitas do período × 1.000; separar "aprovada" de "pendente" | sem fonte | relatório do programa + Vercel |
| Frescor percebido | páginas vistas com `status=atual` ÷ páginas vistas com preço | sem fonte | `freshness_seen` (Pro) ou contador |
| Frescor dos dados (proxy sem instrumentação) | % das horas da semana em que `dataAt` do `state.json` tinha ≤ 30 min (`api/_lib/freshness.mjs:16`) | ramo `data` [existe, calcular offline] | idem |

Cuidados:
- Janela de atribuição e regra de "pedido aprovado" diferem por programa; comparar só dentro do mesmo programa.
- Conversão de clique de grupo direto para a loja (sem passar pelo site) só entra se o link curto passar pelo contador (§5).
- Taxa sobre amostra pequena (< 100 páginas vistas na superfície) sai com o número absoluto ao lado.

## 4. UTM padrão (WhatsApp, Telegram, redes)

[proposta] Regras: minúsculas, `[a-z0-9-]`, até 40 caracteres, sem nome ou telefone de pessoa.

| parâmetro | valores |
|---|---|
| `utm_source` | `whatsapp`, `telegram`, `instagram`, `tiktok`, `youtube`, `x`, `facebook` |
| `utm_medium` | `grupo` (WhatsApp/Telegram em grupo), `canal` (canal do Telegram/WhatsApp), `social` (post orgânico), `bio`, `story`, `anuncio` |
| `utm_campaign` | `top3`, `top10`, `oferta`, `alerta`, `kit`, `pre-venda`, ou `aaaamm-<tema>` |
| `utm_content` | formato ou posição: `link-site`, `link-produto`, `pos1`…; nunca id de pessoa |

Exemplos:
- Top 3 no grupo do WhatsApp: `https://tcgpricehunter.com.br/?utm_source=whatsapp&utm_medium=grupo&utm_campaign=top3`
- Oferta no canal do Telegram, link para o produto:
  `https://tcgpricehunter.com.br/produto/<slug>?utm_source=telegram&utm_medium=canal&utm_campaign=oferta&utm_content=link-produto`
- Bio do Instagram: `https://tcgpricehunter.com.br/?utm_source=instagram&utm_medium=bio`

Notas:
- Aplicar exige mudar a automação social (`src/agents/social/top.js` e afins): fica para o dono, depois do burn-in.
- **Hipótese**: a visualização de UTM no painel pode depender do plano. Se a aba UTM não aparecer, campanhas de grupo e
  anúncio usam o caminho `/entrar/<origem>`, que já conta por página vista no Hobby (`entrar-v4.js:7-9`).
- O link curto de afiliado nos grupos (`tools/social-whatsapp.mjs:99-101`) não leva UTM do site: só é medido pelo programa
  ou pelo contador (§5).

## 5. Fonte de verdade para cliques de saída e afiliado

### Opção A: Vercel Pro (eventos)
- Prós: liga de uma vez os ~20 eventos já instrumentados; API de consulta para agentes
  (`/v1/query/web-analytics/events/aggregate`, agrupando por `eventData/<prop>`); sem código de servidor nem banco.
- Contras: só conta clique feito **no site** com JS; links de afiliado postados nos grupos seguem invisíveis; bloqueador de
  anúncio derruba parte dos eventos; retenção e franquia de eventos dependem do plano; dado fica fora do nosso banco.
- Custo: assinatura Pro (~US$ 20/mês por membro; **hipótese**, conferir em vercel.com/pricing) e eventuais eventos acima da
  franquia.
- **Hipótese a conferir pelo dono**: a política de uso justo da Vercel restringe o Hobby a uso pessoal não comercial; site
  com links de afiliado pode ser enquadrado como comercial. Se for o caso, o Pro vem por esse motivo, não pela medição.

### Opção B: contador próprio (302, sem dado pessoal)
- Fluxo: `GET /api/v1/saida?o=<offerId>&s=<sup>` procura a oferta no estado, grava +1 no agregado e responde **302 para a
  URL da própria oferta** (com o `outUrl` de afiliado quando houver). URL de destino nunca vem do pedido: sem open redirect.
  Variante para grupos: link curto `/s/<offerId>?s=whatsapp`.
- Prós: funciona no Hobby; conta também cliques vindos dos grupos e sem JS; dado no nosso banco, legível por agentes e
  pelo painel operacional; independente de bloqueador.
- Contras e riscos:
  - toca código e banco: a API usa usuário **só leitura** (`api/_lib/db.mjs:2`), então precisa de papel novo com `INSERT`/`UPDATE`
    numa única tabela;
  - `affiliate_click` não serve como está: `offer_id` é `bigint` (`001_core.sql:314`) e o id de oferta do site é texto
    (ex.: `09fe269d31c6` no `state.json`); faltam `loja`, `sup` e `af`; é uma linha por clique;
  - pré-visualização de link (WhatsApp, Telegram) e robôs fazem GET: filtrar sem gravar o user-agent (decidir na hora e
    descartar) e não contar `HEAD`/`Purpose: prefetch`;
  - função fora do ar ou lenta atrasa a saída: tempo-limite curto e, em erro, 302 mesmo sem gravar;
  - política dos programas sobre redirecionamento de link de afiliado: **hipótese**, conferir termos Amazon/ML/Shopee antes;
  - links continuam `rel="nofollow sponsored"`.
- Custo: sem licença; invocações de função e gravações no Postgres existente, irrisórias no volume atual (~1.000 páginas
  vistas/semana); esforço: 1 migração + 1 rota + troca dos `href` de "Ver oferta" e dos links dos posts.
- Modelo de dado recomendado: migração nova com agregado diário, em vez de linha por clique.

```sql
-- [proposta] não aplicar sem aprovação
CREATE TABLE hunter.click_daily (
  dia      date    NOT NULL,
  loja     text    NOT NULL,
  sup      text    NOT NULL,   -- §3.1 ou canal social (whatsapp, telegram)
  af       boolean NOT NULL,
  programa text,               -- ml, amazon, shopee ou null
  n        integer NOT NULL DEFAULT 0,
  PRIMARY KEY (dia, loja, sup, af)
);
-- gravação: INSERT … ON CONFLICT (dia, loja, sup, af) DO UPDATE SET n = click_daily.n + 1
```
  Se o dono preferir manter `affiliate_click`, o mínimo é: `offer_ref text`, `store_id text`, `surface text`,
  `affiliate boolean`, e `clicked_at` truncado para o dia.

### Recomendação
**B como fonte de verdade de cliques de saída e afiliado** (é a única que cobre os grupos e não depende de plano), com o
Vercel seguindo como fonte de visitas. A decide-se pela questão de uso comercial e pelo desejo de ver os eventos de
engajamento (favorito, alerta, filtro); não é pré-requisito para os KPIs comerciais. Com A e B ligados, B manda nos cliques e
os eventos `click_store` viram conferência (diferença > 20 % numa semana é investigada).
Implementar só depois do burn-in #271 e com aprovação: mexe em API, banco e links de saída.

## 6. Retenção

| dado | onde | retenção |
|---|---|---|
| Visitas/eventos | Vercel | a do plano (**hipótese**: janela curta no Hobby). Por isso o painel semanal (§8) copia os números |
| Agregado de cliques (B) | `hunter.click_daily` | 25 meses (dois anos para comparar sazonalidade), depois apagar por `dia` |
| Relatórios dos programas | painel de cada programa; cópia semanal só dos totais | 25 meses |
| Painel semanal | planilha ou arquivo do dono | sem prazo (só agregados) |

## 7. LGPD

- Tudo agregado e anônimo; sem cookie, sem identificador, sem IP/UA gravado. Dado anonimizado sem possibilidade razoável de
  reidentificação fica fora da LGPD (art. 12), e mesmo assim vale a minimização.
- Pendência confirmada (a): `search` manda o texto digitado (`index.html:3127`), que pode conter nome, e-mail ou telefone.
  Proposta: só `n` e `results`. **Hipótese**: a URL `/busca?q=…` (`index.html:3100`) pode chegar ao Vercel com o texto; conferir no
  painel e, se aparecer, remover `q` antes do envio.
- Opção B: ao ligar, atualizar `/privacidade` (`index.html:2251`) com uma frase: "contamos, por dia, os cliques que levam a
  cada loja, sem identificar quem clicou".
- Nada de banner de consentimento enquanto não houver cookie nem identificador; qualquer ferramenta com identificador exige
  banner e nova política.

## 8. Painel mínimo (semanal)

Uma linha por semana; cada célula com a fonte. Ausente = "sem fonte".

| bloco | métricas | fonte |
|---|---|---|
| Tráfego | visitantes, páginas vistas, top 5 origens/UTM, top 5 páginas | Vercel (painel) |
| Grupos | `/entrar/*`, `/ir/*`, CTR do grupo por origem (meta do roadmap ≥ 15 %) | Vercel (painel) |
| Saída | cliques de saída por superfície e CTR (§3.2); top 5 lojas | B (SQL) ou A (eventos) |
| Afiliado | cliques `af` por programa e fatia; pedidos, conversão, comissão aprovada/pendente, receita por 1.000 visitas | B + relatório de cada programa |
| Kit | funil `/monte-seu-kit/*` e saídas por loja | Vercel (#914) |
| Confiança | frescor dos dados (proxy) e, se houver, frescor percebido | ramo `data` / A |

Consulta da opção B para o bloco "Saída":

```sql
SELECT sup, sum(n) AS cliques, sum(n) FILTER (WHERE af) AS cliques_afiliado
FROM hunter.click_daily
WHERE dia >= date_trunc('week', now() AT TIME ZONE 'America/Sao_Paulo')::date - 7
  AND dia <  date_trunc('week', now() AT TIME ZONE 'America/Sao_Paulo')::date
GROUP BY sup ORDER BY cliques DESC;
```

## 9. Decisões do dono

1. Fonte de cliques: B, A ou ambas (§5).
2. Conferir no painel: plano atual, retenção, se a aba UTM aparece e se `/busca?q=` aparece com texto.
3. Conferir enquadramento do Hobby (uso comercial) e termos de redirecionamento dos programas de afiliado.
4. Aprovar UTM padrão (§4) para a automação social, depois do burn-in.
5. Aprovar a troca de `q` no evento `search` (§7).
