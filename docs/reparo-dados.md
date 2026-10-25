# Reparo de dados contaminados por casamento errado

Ferramenta: `tools/reparo-dados.mjs` (só dry-run). Testes: `test/reparo-dados-tests.js`.
Status: **proposta**. Nada foi aplicado ao ramo `data`. Aplicar exige o matcher corrigido integrado, o fim do burn-in (#271) e autorização do dono.

## 1. Problema e origem

Quando o matcher junta produtos diferentes, corrigir o matcher tira o anúncio do produto errado na rodada seguinte. Três coisas gravadas antes continuam erradas:

| dado | como é gravado (src/) | por que não se corrige sozinho |
|---|---|---|
| `lowest.json` | `run.js`: a oferta campeã do produto substitui o recorde só quando é **mais barata** | o recorde só desce. O rebuild a partir de `hist/` (`__fromHist`) roda uma vez só |
| `hist/<id>.json` | `history.js recordDay`: guarda o **menor preço do dia de cada loja**, por 180 dias | o ponto de uma loja mistura todas as ofertas dela no produto e não guarda qual oferta gerou o ponto |
| `products.json` / `state.products` | `run.js`: todo produto já visto fica no registro, mesmo com `offerCount` 0 | um produto criado por um anúncio errado (carta "076/165" virando "Box Golem ex") continua publicado |

`history.jsonl` guarda as mudanças de cada oferta (`offerId`, `productId`, `storeId`, `total`, `stock`) dos últimos 45 dias. É a evidência usada pelo reparo para saber qual oferta gerou cada ponto.

Casos conhecidos (rev-match A1, T4-C, PR #922):
- Zacian Implacáveis (35239) dentro de `sv9-colecao_ex-zacian` (Lupo, 35263). O `lowest` é R$ 113,89 (facilshopping, Implacáveis).
- Carta avulsa "Alakazam ex (065/165)" dentro de `sv3_5-colecao_ex-alakazam`. O `lowest` é R$ 47,41.
- Produtos de caixa falsos `avulsos-colecao_ex-golem/-venusaur/-wigglytuff` (cartas) e `avulsos-colecao_ex-destinos`.
- Box "Greninja & Kingdra" dentro de `sv6_5-colecao_ex-kingdra`. Mewtwo 35880 dentro de `sv10-colecao_ex-mewtwo`.
- ME06 (Reinado Delta) dentro de `me01-*` (PR #922).

## 2. Como a ferramenta decide

1. **Reassociação.** Para cada oferta conhecida (`offers.json`), compara o matcher **base** (o que gravou os dados, normalmente a `main`) com o **candidato** (a correção). Isso inclui a trava `linkAgrees` e o catálogo montado como `loadCatalog()`. Quando o produto muda, a oferta foi reassociada e o produto antigo foi contaminado. A detecção não depende do `productId` gravado, por isso funciona antes e depois da integração.
2. **Reconstrução diária.** Para cada produto afetado, o `history.jsonl` refaz o estado de cada oferta em cada dia, carregando o último estado para os dias seguintes. Por (produto, loja, dia), separa o menor valor das ofertas reassociadas, o das legítimas e o das desconhecidas (sem título em `offers.json`).
3. **Pontos do `hist`**, só nas lojas que tiveram oferta reassociada no produto:
   - não há linha no `history.jsonl` para o dia → **revisão humana**. Vale também quando a série da loja só teve ofertas reassociadas: o log guarda 45 dias e o `hist` 180, então um ponto antigo pode ser de um anúncio legítimo que já saiu do log;
   - a loja só teve ofertas reassociadas nesse produto e há evidência no dia → **remover** o ponto;
   - o valor não bate com o de uma oferta reassociada, ou bate também com o de uma legítima → **manter**;
   - no dia, só havia oferta reassociada em estoque → **remover**;
   - havia uma legítima mais cara → **revisão humana**, com a substituição proposta. É uma aproximação, porque o `history.jsonl` não guarda stale nem confirmado.
4. **`lowest.json`**: só mexe no produto cujo recorde veio de uma oferta reassociada ou de um ponto removido ou em revisão. O novo valor é o menor ponto confiável (`distrust` do state) do `hist` reparado, igual ao `__fromHist` do `run.js` (`offerId: null`). `__fromHist` é preservado. Sem pontos restantes, a entrada sai.
5. **Tudo ou nada por produto.** Um produto com **qualquer** item em revisão (ponto, menor preço ou reassociação) fica inteiro fora do estado proposto até a decisão do dono: nem `hist`, nem `lowest`, nem reassociações desse produto são aplicados parcialmente. No relatório, esses itens aparecem com `bloqueado: true`, e a contagem `produtosBloqueados` lista os produtos. Aplicar só o `hist` sem o `lowest` deixaria o produto incoerente: na revisão independente, o gráfico do sv9 ganhava uma queda falsa de 6,6%.
6. **Produto falso**: todas as ofertas já vistas nele (em `offers.json` e no `history.jsonl`) foram reassociadas. Vira **proposta** de remoção em `remocoes-propostas.json`. `products.json` nunca é reescrito.

### Automático × revisão humana

**Automático e seguro**: entra no estado proposto. Exige tudo isto:
- a oferta tem título, e o produto gravado é o da base ou o do candidato;
- todas as linhas da oferta no `history.jsonl` estão no produto antigo ou no novo;
- o ponto tem linha no `history.jsonl` para o dia e é removido porque não havia oferta legítima da loja naquele dia, ou porque a série da loja é 100% reassociada;
- o produto não tem nenhum item em revisão (tudo ou nada);
- o novo `lowest` não depende de ponto em revisão (nenhum ponto em revisão ≤ proposta);
- o novo `lowest` não passa de `SALTO_MAX` = 1,5× o antigo.

**Revisão humana**: fica só no relatório. Inclui:
- oferta que já esteve em outro produto (o título pode ter mudado);
- substituição de ponto misto;
- ponto sem evidência (sem linha no `history.jsonl` para o dia);
- todos os itens de um produto que tenha pelo menos um item em revisão;
- `lowest` com ponto pendente ou salto grande;
- **toda** remoção de produto.

## 3. Saída e rastreabilidade

`--saida <pasta>` recebe:
- `relatorio.json`: matchers (commit e sha256 do `match.js`), contagens antes e depois, e as seções abaixo;
  - `reassociacoes`: título, loja, preço, data, produto antigo → novo, produto gravado e linhas do `history.jsonl`;
  - `pontos`: cada ponto removido ou em revisão, com motivo e ofertas;
  - `menores`: antes, depois, classe e motivo;
  - `porProduto`: preço atual × menor salvo × histórico;
- `relatorio.md`: o mesmo em tabelas;
- `proposto/data/{lowest.json, state.json, hist/<id>.json}`: só as correções automáticas. Em `hist/` vão só os arquivos alterados;
- `proposto/remocoes-propostas.json` e `proposto/MANIFEST.json` (sha256 antes e depois de cada arquivo).

Recusas (falha fechada):
- `--aplicar` e `--apply`, inclusive na forma `--aplicar=valor`;
- saída dentro da pasta de dados lida, ou contendo essa pasta;
- saída dentro de um checkout do ramo `data`: ramo `data`, upstream `*/data`, commit "dados AAAA-MM-DD…" de `push-data.sh`, ou HEAD = `origin/data`;
- pasta não vazia que não seja uma saída anterior.

Uso:

```bash
git fetch origin "+refs/heads/data:refs/remotes/origin/data"
mkdir -p $S/dados/data/hist $S/cand
for f in state.json lowest.json products.json offers.json history.jsonl; do git show origin/data:data/$f > $S/dados/data/$f; done
git archive origin/data data/hist | tar -x -C $S/dados
git archive <sha-do-candidato> src config | tar -x -C $S/cand
node tools/reparo-dados.mjs --dados $S/dados --candidato $S/cand --saida $S/saida [--base <checkout>] [--agora ISO]
```

## 4. Resultado do dry-run (ramo data bfaf3cde, 25/10 11:34Z; base main c0b6bf44; candidato proposta/matching-paldea-v2 63fb80c4, que inclui #922)

Rodada 1, antes da regra tudo ou nada. O resultado vigente é o v3 da rodada 2, logo abaixo.

- 42 reassociações (41 automáticas, 1 em revisão: doremi, que já esteve em `avulsos-colecao_ex-lendas`) em 19 produtos.
- `hist`: 77 de 10.126 pontos removidos e 2 em revisão (rihappy 24 e 25/10 em sv9, onde a Lupo de R$ 156,99 coexiste com a Implacáveis de R$ 139,99). 10 arquivos alterados.
- `lowest`: 7 contaminados.
  - 1 recalculado: sv10-mewtwo, de R$ 139,99 para R$ 169,90.
  - 4 removidos: alakazam, golem, wigglytuff e kingdra, porque só tinham ponto contaminado.
  - 2 em revisão:
    - sv9-zacian, de R$ 113,89 para a proposta de R$ 149,90, pendente dos pontos da rihappy;
    - me01-etb, de R$ 379,91 (ME06) para R$ 1.249,00 (ML), salto de 3×. A série legítima restante é pequena porque a paladins está em `distrust`.
- 4 remoções propostas: destinos, golem, venusaur e wigglytuff.
- Só a #922 (f005c18) como candidato: 6 reassociações ME06 → ME01, 16 pontos e o `me01-etb` em revisão.
- Idempotência: reaplicar o proposto e rodar de novo dá 0 pontos e 0 `lowest` a mudar. O `lowest.json` sai idêntico byte a byte.

### Dry-run v3 (rodada 2: tudo ou nada e evidência obrigatória)

Ramo data bfaf3cde; base 75f881ea (`src/` igual à main); candidato `/home/claude/wt-t5-match` @ 9c56a407; `--agora 2026-10-25T11:34:00Z`. Comparação com a rodada 1 (`saida-v3` × `saida-v3b`):
- 59 reassociações em 34 produtos nas duas rodadas. As automáticas caem de 58 para 47: as 11 de sv9 e me01-etb ficam bloqueadas, além da doremi, que já estava em revisão.
- Pontos de `hist` removidos: de 88 para 66. Pontos em revisão: de 2 para 24 (18 de sv9 e 4 de me01-etb passam a bloqueados). Arquivos alterados: de 13 para 11, porque sv9 e me01-etb saem do proposto.
- `lowest.json` proposto idêntico byte a byte: os dois menores preços desses produtos já estavam em revisão. Os outros 11 arquivos de `hist` também são idênticos.
- 0 pontos "sem evidência": hoje o `hist` e o log começam em 06/10. A regra nova só passa a fazer diferença quando o log começar a cortar (~20/11).

## 5. Sequência para aplicar (não executar sem autorização)

1. Integrar o matcher corrigido (#922 → matching v2/v3), depois do burn-in e com autorização.
2. Esperar pelo menos uma rodada do robô com o matcher novo. Conferir que as ofertas reassociadas já estão no produto novo ou em `unmatched`.
3. Rodar o dry-run sobre o retrato atual do ramo `data`, com base = commit da `main` anterior à integração e candidato = `main` atual. Revisar o relatório e decidir os itens de revisão humana e as remoções.
4. **Backup**: etiquetar o commit atual do ramo `data` com `data-backup/antes-do-reparo-AAAA-MM-DD`. Essa etiqueta não é apagada pela retenção (`tools/data-backup.mjs`). Anotar o SHA.
5. **Publicação.** O passo ainda não existe. Exige um workflow novo (arquivo protegido), autorização do dono e o fim do burn-in. Requisitos:
   - **mesmo grupo de concorrência do robô** (`hunter`). O passo lê o ramo `data`, roda o dry-run **sobre esse mesmo retrato**, que é o que vai ser publicado, e publica antes de liberar o grupo. O ramo é reescrito com push -f a cada rodada (bfaf3cde → bb8accd8 em 17 min no dia 25/10), então um `proposto/` calculado sobre um retrato antigo nunca pode ser publicado;
   - **conferir o MANIFEST antes de sobrescrever**: o `sha256Antes` de cada arquivo tem de ser igual ao sha256 do arquivo vigente no retrato. Se um só divergir, aborta sem publicar nada;
   - **publicar só `lowest.json` e os `hist/<id>.json` do MANIFEST. Nunca publicar `state.json`.** O `proposto/data/state.json` é um espelho para conferência: publicá-lo apagaria ofertas e preços da rodada vigente. A rodada seguinte regenera `lowestHistorical` e `hist` a partir de `lowest.json` e `hist/`;
   - itens bloqueados e remoções de produto só entram depois da decisão do dono, numa nova rodada de dry-run com as decisões refletidas (matcher, ou um override de revisão).
6. Validação pós-aplicação:
   - `npm run golden:eval`;
   - `tools/qualidade-dados.mjs` (quando integrado);
   - rodar o reparo de novo sobre o novo retrato: tem de dar 0 mudanças automáticas;
   - conferir no site os produtos da tabela do relatório (menor preço, gráfico, `drop7d`).

## 6. Reversão

O ramo `data` é um commit órfão reescrito a cada rodada, então um `git revert` simples não sobrevive à rodada seguinte. A reversão parte da etiqueta do passo 4 (`tools/data-restore.mjs --to <pasta> <etiqueta> --apply`) e é publicada entre rodadas, no grupo `hunter`, como no passo 5.

**Cópia inteira × seletiva.** Copiar o `lowest.json` inteiro da etiqueta **perde os recordes legítimos registrados depois do reparo**: o `lowest` só desce, e um preço novo mais baixo de qualquer produto sumiria. O mesmo vale para os pontos novos de `hist/<id>.json`. Proposta de reversão seletiva:
- `lowest.json`: só nos produtos listados em `menores` do relatório, restaurar a entrada da etiqueta, a menos que o valor vigente seja menor que ela e não venha de anúncio reassociado. Nesse caso, fica o vigente. As outras entradas não são tocadas;
- `hist/<id>.json`: só nos arquivos do MANIFEST, devolver os pontos (loja, dia) removidos pelo reparo (lista `pontos` com ação `remover`), mantendo os pontos gravados depois;
- a reversão é feita por um script que lê o `relatorio.json` da aplicação. Não está implementado e entra junto com o passo de publicação.

Uma rodada normal não "desfaz" o reparo: o `lowest` só desce, e o `hist` só ganha pontos novos.

## 7. Efeitos colaterais a observar

- **`newLowest` e atividade**: depois do reparo, um preço que fique abaixo do recorde novo (mais alto) gera o evento "novo menor preço" e pode gerar post. Isso é esperado, mas deve ser conferido nas primeiras rodadas.
- **`drop7d` e "maior queda"**: muda nos produtos com `hist` alterado. Por causa da regra tudo ou nada, o sv9 só muda depois da decisão sobre os pontos da rihappy. Aplicado pela metade, ele ganharia uma queda falsa de 3,1% para 6,6%.
- **Alertas de usuário (Firestore, não lido)**: `src/alerts.js` não usa `lowest`, `hist` nem `drop7d`: as regras são de preço atual e de queda por evento de oferta. Subir o recorde não dispara nem cancela alerta.
- **Alertas órfãos ao remover produto**: se o dono aprovar remover um produto falso, os alertas do Firestore que apontam para esse id ficam órfãos (nunca disparam e aparecem na conta da pessoa sem produto). Antes de remover, é preciso conferir os alertas desses ids e decidir: migrar para o produto certo, avisar ou apagar. O Firestore não foi lido.
- **Produto falso mantido** até a decisão humana: continua no registro com `lowest` vazio e `hist` sem lojas.
- **`distrust`**: pontos de lojas em `distrust` não entram no recálculo (mesma regra do `run.js`). É por isso que `me01-etb` fica com R$ 1.249.

## 8. Banco (Postgres): o reparo do ramo data NÃO limpa o banco

Só plano. O banco não foi consultado nem tocado.

**Por que importa.** Com a fonte `db`, que é a de produção, a página do produto (`api/v1.mjs` caso `site-produto` → `api/_lib/site.mjs siteProduct`) troca o `lowestHistorical` do robô por `product_stats.historical_min` (Price Engine) sempre que `history.status === 'ok'` (≥ 3 dias). O dia vem de `price_daily` (`productMinDay` em `api/_lib/read-db.mjs`). O "menor já visto" visível no site, portanto, vem do banco, não do `lowest.json`.

**Como o banco fica contaminado.**
- `src/core/sync.js` grava `offer.product_id` a partir do produto do robô (`ON CONFLICT … SET product_id = EXCLUDED.product_id`) e o histórico em `price_history`.
- `src/core/price-stats.js loadInputs` agrupa os eventos de `price_history` pelo `offer.product_id` **atual**.
- `computeProductStats` (`src/core/price-engine.js`) usa todas as ofertas do produto na série histórica (`seriesOffers = sameCond`), **inclusive as `removed`**.
- Reassociação para um produto que existe ou é novo (25 das 59 no v3): a próxima sincronização troca `offer.product_id` e todo o histórico da oferta muda de produto. O produto antigo se corrige sozinho no próximo `runPriceEngine`.
- Reassociação para "sem produto" (34 das 59, por exemplo ME06 em `me01-*`, kingdra, as cartas): a oferta sai de `offers.json`, a sincronização a marca `status = 'removed'` (`sync.js`, `UPDATE offer SET status = 'removed'`) e o `product_id` antigo fica. O Price Engine continua usando os eventos anteriores à remoção na série do produto antigo. `offer.product_id` é `NOT NULL` (`db/migrations/001_core.sql`), então não dá para simplesmente desassociar.

**O que precisaria ser feito (exige autorização própria, porque é escrita em produção).**
1. Medir (só leitura): para os 34 produtos afetados, `product_stats.historical_min` e `price_daily` (`store_id = ''` e por loja), comparados com o relatório do reparo. Listar as `offer` (por `legacy_id` = `offerId` do relatório) com `status = 'removed'` e `product_id` antigo.
2. Escolher o mecanismo. Opções, da mais segura para a mais destrutiva:
   - (a) migration nova com uma marca na oferta (ex.: `offer.excluded_from_stats boolean` ou `status = 'mismatched'`), filtrada em `computeProductStats`/`loadInputs`. É reversível e não apaga histórico;
   - (b) mover essas ofertas para um produto de quarentena. Funciona por causa do `NOT NULL`, mas polui o catálogo;
   - (c) apagar as linhas de `price_history` dessas ofertas. É irreversível sem backup e não é recomendado.
3. Rodar `runPriceEngine` (`tools/db-stats.mjs`). `price_daily` remove sozinho os dias que deixam de existir (`DELETE … NOT EXISTS`), e `product_stats` é recalculado de forma idempotente.
4. Validar com `tools/db-validate.mjs` e conferir a página dos produtos (fonte `db`).
5. Fazer na mesma janela do reparo do ramo `data`, depois da integração do matcher. Antes: backup do banco (`docs/backup.md`).

## 9. Limitações

- O `history.jsonl` só tem 45 dias. Ponto mais antigo de loja mista fica em revisão (sem evidência).
- Oferta que sumiu de `offers.json` não tem título e conta como "desconhecida": não é reassociada e protege o ponto (mantém).
- Se o título de uma oferta mudou sem trocar de produto, o reparo usa o título atual. A guarda é a regra "linhas em outro produto → revisão".
- O reparo não migra pontos para os produtos novos (`avulsos-colecao_ex-zacian` etc.). Eles começam o histórico na integração.
