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
   - a loja só teve ofertas reassociadas nesse produto → **remover** o ponto;
   - o valor não bate com o de uma oferta reassociada, ou bate também com o de uma legítima → **manter**;
   - no dia, só havia oferta reassociada em estoque → **remover**;
   - havia uma legítima mais cara → **revisão humana**, com a substituição proposta. É uma aproximação, porque o `history.jsonl` não guarda stale nem confirmado;
   - não há linha no `history.jsonl` para o dia → **revisão humana**.
4. **`lowest.json`**: só mexe no produto cujo recorde veio de uma oferta reassociada ou de um ponto removido ou em revisão. O novo valor é o menor ponto confiável (`distrust` do state) do `hist` reparado, igual ao `__fromHist` do `run.js` (`offerId: null`). `__fromHist` é preservado. Sem pontos restantes, a entrada sai.
5. **Produto falso**: todas as ofertas já vistas nele (em `offers.json` e no `history.jsonl`) foram reassociadas. Vira **proposta** de remoção em `remocoes-propostas.json`. `products.json` nunca é reescrito.

### Automático × revisão humana

**Automático e seguro**: entra no estado proposto. Exige tudo isto:
- a oferta tem título, e o produto gravado é o da base ou o do candidato;
- todas as linhas da oferta no `history.jsonl` estão no produto antigo ou no novo;
- o ponto é removido porque não havia oferta legítima da loja naquele dia, ou porque a série da loja é 100% reassociada;
- o novo `lowest` não depende de ponto em revisão (nenhum ponto em revisão ≤ proposta);
- o novo `lowest` não passa de `SALTO_MAX` = 1,5× o antigo.

**Revisão humana**: fica só no relatório. Inclui:
- oferta que já esteve em outro produto (o título pode ter mudado);
- substituição de ponto misto;
- ponto sem evidência;
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
- `--aplicar`;
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

## 5. Sequência para aplicar (não executar sem autorização)

1. Integrar o matcher corrigido (#922 → matching v2/v3), depois do burn-in e com autorização.
2. Esperar pelo menos uma rodada do robô com o matcher novo. Conferir que as ofertas reassociadas já estão no produto novo ou em `unmatched`.
3. Rodar o dry-run sobre o retrato atual do ramo `data`, com base = commit da `main` anterior à integração e candidato = `main` atual. Revisar o relatório e decidir os itens de revisão humana e as remoções.
4. **Backup**: etiquetar o commit atual do ramo `data` com `data-backup/antes-do-reparo-AAAA-MM-DD`. Essa etiqueta não é apagada pela retenção (`tools/data-backup.mjs`). Anotar o SHA.
5. Aplicar os arquivos de `proposto/data/` numa cópia do retrato e publicar como uma rodada normal. Isso exige um passo novo e autorizado, porque hoje só o robô publica (`tools/push-data.sh`, push -f). A publicação tem de acontecer **entre rodadas**, no mesmo grupo de concorrência do hunter, senão a rodada seguinte sobrescreve com o retrato lido antes do reparo. O passo não está implementado nesta proposta.
6. Validação pós-aplicação:
   - `npm run golden:eval`;
   - `tools/qualidade-dados.mjs` (quando integrado);
   - rodar o reparo de novo sobre o novo retrato: tem de dar 0 mudanças automáticas;
   - conferir no site os produtos da tabela do relatório (menor preço, gráfico, `drop7d`).

## 6. Reversão

O ramo `data` é um commit órfão reescrito a cada rodada, então um `git revert` simples não sobrevive à rodada seguinte. A reversão é restaurar os arquivos tocados (`lowest.json`, `hist/<id>.json` listados no `MANIFEST.json`) a partir da etiqueta do passo 4:
- `tools/data-restore.mjs --to <pasta> <etiqueta> --apply`;
- copiar só esses arquivos para o retrato vigente;
- publicar entre rodadas, como no passo 5.

Uma rodada normal não "desfaz" o reparo: o `lowest` só desce, e o `hist` só ganha pontos novos.

## 7. Efeitos colaterais a observar

- **`newLowest` e atividade**: depois do reparo, um preço que fique abaixo do recorde novo (mais alto) gera o evento "novo menor preço" e pode gerar post. Isso é esperado, mas deve ser conferido nas primeiras rodadas.
- **`drop7d` e "maior queda"**: muda nos produtos com `hist` alterado (sv9: de 3,1% para 6,6% no dry-run).
- **Alertas de usuário (Firestore, não lido)**: alerta com teto abaixo do recorde novo continua valendo, porque o alerta usa o preço atual e não o `lowest`.
- **Produto falso mantido** até a decisão humana: continua no registro com `lowest` vazio e `hist` sem lojas.
- **`distrust`**: pontos de lojas em `distrust` não entram no recálculo (mesma regra do `run.js`). É por isso que `me01-etb` fica com R$ 1.249.

## 8. Limitações

- O `history.jsonl` só tem 45 dias. Ponto mais antigo de loja mista fica em revisão (sem evidência).
- Oferta que sumiu de `offers.json` não tem título e conta como "desconhecida": não é reassociada e protege o ponto (mantém).
- Se o título de uma oferta mudou sem trocar de produto, o reparo usa o título atual. A guarda é a regra "linhas em outro produto → revisão".
- O reparo não migra pontos para os produtos novos (`avulsos-colecao_ex-zacian` etc.). Eles começam o histórico na integração.
