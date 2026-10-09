# Preço sugerido Copag — política única (Lote 5)

## Regra

Um produto só tem **Copag confirmado** (`copagConfirmed: true`, `msrp`) quando as três condições valem:

1. **Valor > 0.**
2. **Fonte oficial da Copag**: URL `http(s)` em `copagloja.com.br` ou `copag.com.br` (e subdomínios), marcada como oficial na origem.
   - Robô: `confidence: 'OFICIAL'`. Vale para a captura da loja oficial (`data/copag-msrp.json`) e para o cadastro manual no `config/catalog.json`.
   - Banco: linha `verified` com `source` `copag_loja` ou `manual`.
3. **Última verificação há no máximo 30 dias** em relação ao momento da rodada (robô) ou da consulta (API). A data usada é a mais recente entre `verified_at`, `source_timestamp`, `msrp_updated_at` e `last_check.at`, esta só quando a conferência diária (`copag-check`) bateu. Exatamente 30 dias ainda vale; 30 dias + 1 ms já está vencido.

Se uma das condições falha, o valor aparece só como referência (`copagReference`, `copagReferenceUrl`), e o motivo vai em `copagReason`. Nesse caso o produto não tem desconto Copag, não entra na regra `copag-25` e não dispara pista.

Estados possíveis em `copagReferenceStatus`:

| Estado | Quando |
|---|---|
| `confirmado` | As três condições valem. |
| `expirado` | A fonte é oficial, mas a verificação tem mais de 30 dias. |
| `pendente` | Sem fonte, fonte fora do domínio da Copag, sem marcação oficial, sem data ou com data no futuro (mais de 1 dia). Também cobre os produtos pendentes por decisão do responsável. |
| `null` | Não existe valor nenhum, ou a fonte é um marketplace (marketplace nunca vira referência). |

**Pendentes por decisão do responsável** (`PENDENTES` em `api/_lib/copag-policy.mjs`): hoje só `me04-box36`. Nenhuma fonte automática confirma o preço desse produto, seja a captura da loja, o catálogo público ou o cadastro com URL da loja (no banco os três viram `copag_loja`). Há duas formas de liberar: um cadastro manual no `catalog.json` com URL da Copag fora da loja (`copag.com.br`), que o banco grava como `manual`, ou tirar o produto da lista.

## Onde está

- **Implementação:** `api/_lib/copag-policy.mjs`. Fica em `api/_lib` porque a Vercel não publica `src/`.
- **Robô:** `src/copag-policy.js` só reexporta o módulo (mesmo padrão de `src/core/references.js`). Ele é usado por:
  - `src/run.js`, em `resolveCopag`, que monta os candidatos na ordem cadastro OFICIAL › captura da loja › demais cadastros e fica com o primeiro confirmado. Sem confirmado, usa o primeiro expirado e, sem expirado, o primeiro pendente;
  - `src/score.js` (`copagStatus`);
  - `src/copag-check.js`, que agora confere toda fonte oficial da Copag, mesmo vencida, porque a conferência que bate é o que renova a validade.
- **API:** `api/_lib/read-db.mjs` (home e página de produto pelo banco). O SQL só traz as linhas candidatas, das fontes que o robô publica (`copag_loja`, `manual`, `internet`). Quem decide é `decideCopagFromRows`, com a ordem `manual` › `copag_loja` › `internet` e, dentro dela, a verificação mais recente.
- **Sincronização:** `src/core/mappers.js` grava `verified_at` com a data de verificação decidida pela política (`copagVerifiedAt`), para que a API calcule a mesma validade.
- **Paridade:** `test/data-quality-tests.js`, grupo 7, roda 8 cenários × 6 momentos. Primeiro a rodada grava as linhas com o mapeamento real da sincronização; depois a API lê essas linhas e o robô decide com as mesmas fontes. O resultado precisa ser igual em estado, valor, referência e motivo. O grupo 11 faz a mesma conferência no PostgreSQL.

**Limitação conhecida.** Se uma fonte oficial já está vencida na primeira sincronização, o banco só recebe a linha pendente (`internet`). Nesse caso a API mostra `pendente` e o robô mostra `expirado`. O valor e a ausência de confirmação são os mesmos nos dois.

## Impacto nos dados reais

Base: branch `data`, `state.json` de 2026-10-09T19:30:29Z (243 produtos), `copag-msrp.json` (13 capturas) e `config/catalog.json` de `main` (12 cadastros OFICIAL, todos do Instagram, e 1 CATALOGO_COPAG). Cálculo feito com o momento da própria rodada.

| | Antes | Depois |
|---|---|---|
| Produtos com Copag confirmado | **24** | **13** |
| Ofertas elegíveis a alerta com Copag (de 497) | 198 | 140 |
| Ofertas na regra `copag-25` (≥ 25%) | 6 | 6 (as mesmas: blisters quádruplos me03/me04/me05) |

**Perdem a confirmação (11), por fonte fora do domínio oficial.** Os 11 vinham da tabela "Preços de 30 anos" divulgada no Instagram, cadastrada como OFICIAL à mão em 07/10/2026. O valor continua visível como referência pendente:
`c30-colecao_fichario` 230,99 · `c30-etb` 399,99 · `c30-blister3` 99,99 · `c30-combo` 199,99 · `c30-combo6` 199,99 · `c30-minilata` 77,99 · `c30-colecao` 599,99 · `c30-colecao_miniatura` 245,99 · `c30-colecao_ex-greninja` / `-estampas` / `-sylveon` 160,99.

**Continuam confirmados, mas com outra fonte (2).** `c30-blister2` (69,99) e `c30-colecao_poster` (115,99) deixam a fonte do Instagram e passam à captura da loja oficial, com o mesmo valor. Essas capturas foram vistas pela última vez em 08/10 e vencem em **07/11/2026** se a loja não as mostrar de novo.

**Sem mudança (11).** Capturas da loja oficial vistas na rodada (`me03-blister4`, `me04-blister1/3/4`, `me04-etb`, `me04-combo`, `me05-blister1/4`, `me05-etb`, `me05-combo`, `sv10-box36`). Vencem em 08/11/2026 se não forem vistas de novo.

**Por motivo:** expirado = 0 hoje; fonte não oficial = 11; pendente por decisão = 0. `me04-box36` não tem valor no robô (fica sem referência) e continua não confirmado.

## View do motor `reference_price_current`: análise e proposta (NÃO aplicada)

Hoje a view (migration 006, linhas 42–47) aceita qualquer linha `reference_scope = 'current'` com `verification_status = 'verified'`, sem prazo e sem a lista de pendentes. Ela é a entrada Copag do Price Engine (`src/core/price-stats.js`) e, por consequência, do Opportunity Engine.

Pelos dados, a estimativa de linhas Copag na view de produção hoje é de **13 produtos**: as 11 capturas do robô mais 2 linhas verificadas da auditoria (`copag_loja_catalog`), que são **`me04-box36`** (449,99) e `me05-blister3` (42,99). Isso bate com os 13 da reconstrução local. Daí saem três divergências:

1. **`me04-box36` está confirmado no motor**, contra a decisão do responsável. O site e a API não mostram o preço porque não leem `copag_loja_catalog`.
2. **`me05-blister3`** tem Copag no motor, mas não no site nem nos alertas do robô.
3. **Sem prazo**, uma linha verificada continua valendo para sempre. A auditoria (verificada em 08/10) e qualquer captura que a loja deixe de mostrar nunca vencem no motor.

**Efeito indireto deste lote, já sem mudar a view.** Depois do deploy, o robô passa a gravar linhas `copag_loja` verificadas para `c30-blister2` e `c30-colecao_poster`, porque antes o cadastro do Instagram tinha prioridade. A view passa então a ter **15 produtos**, e esses 2 ganham referência Copag no motor, com o mesmo valor que o site já mostrava. **Isso muda notas do Opportunity Engine em produção.**

Proposta (arquivo sugerido `db/migrations/009_reference_validity.sql`, **não criado**). Ela muda os resultados do motor em produção e **exige autorização explícita**:

```sql
-- 009 — validade de 30 dias e pendentes por decisão na referência ATUAL do motor (mesma regra de api/_lib/copag-policy.mjs)
SET search_path = hunter;
CREATE OR REPLACE VIEW reference_price_current AS
SELECT DISTINCT ON (r.product_id) r.*,
       CASE r.reference_kind WHEN 'COPAG_OFFICIAL_CURRENT' THEN 1 WHEN 'MARKET_CURRENT' THEN 2 END AS priority
  FROM reference_price r
  JOIN product p ON p.id = r.product_id
 WHERE r.reference_scope = 'current' AND r.verification_status = 'verified'
   AND (r.reference_kind <> 'COPAG_OFFICIAL_CURRENT' OR (
         r.verified_at IS NOT NULL
     AND r.verified_at >= now() - interval '30 days'
     AND r.verified_at <= now() + interval '1 day'
     AND NOT (p.legacy_id IN ('me04-box36') AND r.source <> 'manual')))
 ORDER BY r.product_id, priority, r.confidence DESC, r.verified_at DESC NULLS LAST, r.id DESC;
```

O efeito estimado, sobre a view do jeito que ficaria depois do deploy deste lote:

- Logo de cara, **15 → 14** produtos (sai `me04-box36`).
- Em **07/11/2026** sai `me05-blister3`, porque a auditoria não é renovada. Saem também `c30-blister2` e `c30-colecao_poster`, se a loja não os mostrar até lá.
- As demais capturas ficam enquanto a loja as mostrar.

Também é preciso decidir se a auditoria (`copag_loja_catalog`) deve continuar alimentando o motor sem aparecer no site. A política única hoje diz que não, para manter a paridade com o robô. A view proposta mantém essa fonte, só com prazo; excluí-la é decisão do responsável.

Conferências no mesmo dia da aplicação: `tools/db-validate.mjs` (as regras "Copag atual ⇔ linha em reference_price_current" continuam valendo) e `npm run opportunity:compare` antes e depois.

## Outros itens do Lote 5 (mesma base de dados)

- **Lojas.** Para cada loja passa a existir o campo derivado `yield` em `sources`, mais o contador `emptyStreak`. O `status` não mudou. Totais novos em `state.coverage.yield` e em `meta.json → ops.last.stores.yield`.
  - Distribuição das 128 lojas: 56 `nunca_funcionou` (54 BLOCKED + 2 ERROR, ok = 0, entre 63 e 196 tentativas cada), 4 `sem_match` (bynx.gg, tcgculture.com, kantonerd.com.br, shisuistore.com.br), 50 `ok` e 18 fora da coleta.
  - As 22 ativas sem anúncio passam a `sem_resultado` depois de 3 leituras vazias seguidas (o contador começa no deploy).
  - Espera máxima das lojas `nunca_funcionou`: 24 h em vez de 6 h, o que dá cerca de 56 tentativas por dia em vez de ~224. Nenhuma loja ou contador é apagado.
- **Mercado Livre.** O `/items` está fechado para o app, então as **282 ofertas** do ML (252 elegíveis a alerta) passam a ter `stockVerified: false`. O alerta mostra "Estoque: não conferido (anúncio do Mercado Livre)" em vez de "confirmado". A elegibilidade não muda. O campo fica só no `state.json`/`offers.json`: a tabela `offer` não tem coluna para ele e nenhuma migration foi criada.
