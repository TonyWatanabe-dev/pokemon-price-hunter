# Reparo de dados contaminados por casamento errado

Ferramenta: `tools/reparo-dados.mjs` (só dry-run). Testes: `test/reparo-dados-tests.js`.
Status: **ferramenta + passo de publicação** (31/10/2026). O banco não é tocado por este fluxo (§8). Itens em revisão continuam fora até a decisão do dono (§0.6). O matcher corrigido já está integrado (main a39e82f9). Aplicar ainda exige o fim do burn-in (#271), o passo de publicação (workflow novo) e autorização do dono.

## 0. Plano pós-integração (25/10, tarde), pronto para aprovação

> **Duas decisões do dono antes de qualquer aplicação** (detalhes em §0.6):
> 1. **sv9-colecao_ex-zacian**: o menor preço publicado, R$ 113,89, é da caixa Lendas Implacáveis (35239), não da Zacian do Lupo (35263).
> 2. **me01-etb**: o menor preço do robô, R$ 379,91, é do ETB **ME06** (Reinado Delta), não do ME01. A única série legítima que sobra é ML a R$ 1.249.
>
> Até a decisão, esses produtos, e o alakazam (veja §0.2), ficam **inteiros fora** da aplicação (regra tudo ou nada).

### 0.1 Método: base = main antiga c0b6bf44 + `--anterior`

- O matcher v3 já está na main (#922 + #938, main a39e82f9; `src/match.js` sha256 4ed718ad… = 70f8d695). A ferramenta usa este checkout como base padrão. Rodar "main × candidato" agora compara o matcher novo com ele mesmo e não acha nada.
- **Base** = `git archive c0b6bf44 src config` (matcher que gravou a contaminação). **Candidato** = main.
- Depois da integração, as ofertas que foram para "sem produto" somem do `offers.json` e levam o título junto. No retrato de 17:10, 31 das 62 já tinham sumido. Sem título, a comparação base × candidato não as enxerga, e as linhas delas no `history.jsonl` passam a proteger os pontos contaminados. Sem `--anterior`, o retrato atual mostra só 3 dos 7 menores preços contaminados.
- Por isso a rodada sobre o retrato atual recebe **`--anterior`** = `relatorio.json` do dry-run sobre o retrato pré-integração bfaf3cde. As reassociações de lá valem como evidência para as ofertas ausentes (`origem: "anterior"`). A evidência de cada uma (linhas no produto antigo) é recalculada no `history.jsonl` atual. Se a oferta aparece em outro produto, ela vai para revisão.
- `--anterior` sozinho não basta: as ofertas que continuam no `offers.json` precisam da comparação pelo título com a base antiga. Os dois métodos se completam.

Comandos (determinísticos, com `--agora` fixo):

```bash
S=<scratchpad>/reparo
git archive c0b6bf44 src config | tar -x -C $S/matcher-c0b6bf44
# (a) retrato pré-integração: reproduz a simulação final byte a byte
node tools/reparo-dados.mjs --dados $S/data-bfaf3cde --base $S/matcher-c0b6bf44 --candidato . --agora 2026-10-25T11:34:00Z --saida $S/e6b-a
# (b) retrato atual (ramo data 8f28f68c, lido com git show/git archive)
node tools/reparo-dados.mjs --dados $S/data-8f28f68c --base $S/matcher-c0b6bf44 --candidato . --agora 2026-10-25T17:10:00Z --anterior $S/e6b-a/relatorio.json --saida $S/e6b-b
```

- (a) dá `proposto/` idêntico a `saida-final` (`diff -r` vazio), com as mesmas reassociações, pontos e menores preços.
- (b) é o plano vigente.

### 0.2 Retrato pré-integração (a) × retrato atual (b)

| item | (a) bfaf3cde 11:34Z | (b) 8f28f68c 17:10Z |
|---|---|---|
| ofertas no `offers.json` | 3.893 | 3.909 |
| reassociações | 62 (pelo título) | 63: 32 pelo título + 31 via `--anterior`. A nova é mpbrinquedos 361c0a4ff327 "Coleção Ex Lendas Implacáveis - Zacian", em revisão porque já esteve em `avulsos-colecao_ex-lendas`; nunca teve estoque |
| pontos removidos / em revisão | 66 / 24 | 65 / 25 |
| `lowest` contaminado | 7 (1 recalc., 4 rem., 2 rev.) | 7 (1 recalc., 3 rem., 3 rev.) |
| bloqueados | sv9, me01-etb | sv9, me01-etb, **sv3_5-alakazam** |
| remoção proposta / adiada | 0 / 5 | 2 (paradoxais, wigglytuff) / 3 (destinos, golem, venusaur) |

Diferenças explicadas:
- **31 ofertas saíram do `offers.json`.** Foram para "sem produto" com o matcher novo, ou a loja tirou o anúncio. 16 já estão no produto novo.
- **15 ainda estão no produto antigo.** Oito foram lidas pela última vez às 15:15, antes do merge às 15:56; essas lojas não foram relidas até 17:10. As outras sete são anúncios **stale** da pontotcg, sem leitura desde 17/10. O `run.js` carrega oferta de loja não lida sem reaplicar o matcher. Elas só mudam quando a loja for relida, e por isso as remoções de destinos, golem e venusaur continuam adiadas.
- **Pontos novos:** nenhum. As chaves (produto, loja, dia) são as mesmas nos dois retratos, e o dia 25 já existia em (a).
- **Contaminação parada:**
  - a última linha de cada anúncio contaminante no `history.jsonl` é o evento `removed` (geekstore ME06 às 16:37; kingdra e wigglytuff às 16:00; rihappy 35880 às 15:45);
  - facilshopping e coffeecat (Implacáveis) já estão em `avulsos-colecao_ex-zacian` desde a leitura das 16:00 (troca de produto sem mudança de preço não grava linha no log);
  - nenhum anúncio reassociado em estoque continua no produto antigo.
- **Novo item em revisão: sv3_5-alakazam.** O ponto contaminado (carta 065/165 a 47,41, 17/10) é o mesmo. Em 25/10 entrou um ponto legítimo da pokebola a R$ 899 ("Box Coleção Alakazam ex - Pokémon 151"), e esse vira o único candidato a menor preço. 899 é mais que 1,5× 47,41, então o produto fica bloqueado. O 899 é **apenas incomum** (anúncio real, caro), não inválido.

### 0.3 Lista exata dos registros (retrato b)

A classificação usa uma de quatro categorias: duplicado, inválido/contaminado, obsoleto ou apenas incomum. Origem: `titulo` = base × candidato pelo título atual; `anterior` = evidência do dry-run pré-integração.

#### Menores preços salvos (lowest.json)

| produto | loja | anúncio / título | origem | registrado em | regra | valor antes → proposta | classe | classificação | impacto |
|---|---|---|---|---|---|---|---|---|---|
| me01-etb | geekstorebrasilcombr | f6ee2e6ffbeb “Elite Trainer Box (ETB) Megaevolução - Reinado Delta (ME06) — PT” | anterior | 2026-10-23T23:15:20.797Z | recorde veio de anúncio reassociado; bloqueado | R$ 379,91 → R$ 1249,00 (mercadolivre 2026-10-08) | revisao | inválido/contaminado | menor já visto do robô (state/legado); na fonte db vale o Price Engine |
| sv10-colecao_ex-mewtwo | rihappycombr | 5da09bdacdc5 “Box Pokémon Coleção Equipe Rocket Mewtwo Ex” | anterior | 2026-10-17T11:30:29.693Z | recorde veio de anúncio reassociado | R$ 139,99 → R$ 169,90 (lojaarenagamescombr 2026-10-17) | auto | inválido/contaminado | menor já visto do robô (state/legado); na fonte db vale o Price Engine |
| sv9-colecao_ex-zacian | facilshoppingcombr | df91b2a4d618 “Pokemon Box - Lendas Implac?veis - Zacian Ex” | titulo | 2026-10-20T17:30:27.997Z | recorde veio de anúncio reassociado; bloqueado | R$ 113,89 → R$ 149,90 (lojaarenagamescombr 2026-10-17) | revisao | inválido/contaminado | menor já visto do robô (state/legado); na fonte db vale o Price Engine |
| avulsos-colecao_ex-wigglytuff | pontotcgstorecombr | 3bbfcd905952 “Carta Pokémon TCG Wigglytuff EX (040/165) Coleção 151” | anterior | 2026-10-17T12:15:25.246Z | recorde veio de anúncio reassociado | R$ 27,46 → sem lowest | auto | inválido/contaminado | menor já visto do robô (state/legado); na fonte db vale o Price Engine |
| sv3_5-colecao_ex-alakazam | pontotcgstorecombr | bf8513c84056 “Carta Pokémon TCG Alakazam ex (065/165) Coleção 151” | titulo | 2026-10-17T20:47:33.823Z | recorde veio de anúncio reassociado; bloqueado | R$ 47,41 → R$ 899,00 (pokebolacombr 2026-10-25) | revisao | inválido/contaminado (carta avulsa); proposta 899 é apenas incomum | menor já visto do robô (state/legado); na fonte db vale o Price Engine |
| avulsos-colecao_ex-golem | pontotcgstorecombr | 9ebe5d8fb84f “Carta Pokémon TCG Golem ex (076/165) Coleção 151” | titulo | 2026-10-17T20:47:33.823Z | recorde veio de anúncio reassociado | R$ 47,41 → sem lowest | auto | inválido/contaminado | menor já visto do robô (state/legado); na fonte db vale o Price Engine |
| sv6_5-colecao_ex-kingdra | rihappycombr | a38bf35ac0ba “Jogo de Cartas - Pokemon - Box Greninja & Kingdra Ex - Copag” | anterior | 2026-10-19T11:15:23.150Z | recorde veio de anúncio reassociado | R$ 229,99 → sem lowest | auto | inválido/contaminado | menor já visto do robô (state/legado); na fonte db vale o Price Engine |

#### Pontos de histórico removidos e em revisão

| produto | loja | dia | valor | ação | anúncio(s) / título | origem | timestamps no history.jsonl (1ª–última no produto antigo) | regra | classificação | impacto |
|---|---|---|---|---|---|---|---|---|---|---|
| sv10-colecao_ex-mewtwo | rihappycombr | 2026-10-17 a 2026-10-25 (9) | R$ 139,99 | remover | 5da09bdacdc5 “Box Pokémon Coleção Equipe Rocket Mewtwo Ex” | anterior | 2026-10-17T11:15–2026-10-25T15:45 | no dia, só anúncios reassociados em estoque nesta loja | inválido/contaminado | gráfico/drop7d do produto; some do histórico publicado |
| sv10-colecao_ex-mewtwo | mercadolivre | 2026-10-17 a 2026-10-25 (7) | R$ 244,46 | remover | 71714d45c160 “Box Pokémon Coleção Equipe Rocket Mewtwo Ex”; 72230267de00 “Box Pokémon Coleção Equipe Rocket Mewtwo Ex”; a9fc4234da10 “Box Pokémon Coleção Equipe Rocket Mewtwo Ex”; 5293be459adf “Box Pokémon Coleção Equipe Rocket Mewtwo Ex” | titulo | 2026-10-17T17:15–2026-10-17T17:15; 2026-10-17T17:15–2026-10-24T13:27; 2026-10-17T17:15–2026-10-17T17:15; 2026-10-17T17:15–2026-10-17T17:15 | a loja só teve anúncios reassociados neste produto | inválido/contaminado | gráfico/drop7d do produto; some do histórico publicado |
| sv10-colecao_ex-mewtwo | mercadolivre | 2026-10-22 a 2026-10-23 (2) | R$ 244,46 | remover | 71714d45c160 “Box Pokémon Coleção Equipe Rocket Mewtwo Ex”; a9fc4234da10 “Box Pokémon Coleção Equipe Rocket Mewtwo Ex”; 5293be459adf “Box Pokémon Coleção Equipe Rocket Mewtwo Ex” | titulo | 2026-10-17T17:15–2026-10-17T17:15; 2026-10-17T17:15–2026-10-17T17:15; 2026-10-17T17:15–2026-10-17T17:15 | a loja só teve anúncios reassociados neste produto | inválido/contaminado | gráfico/drop7d do produto; some do histórico publicado |
| sv9-colecao_ex-zacian | facilshoppingcombr | 2026-10-17 a 2026-10-25 (9) | R$ 119,97 / R$ 113,89 | revisao | df91b2a4d618 “Pokemon Box - Lendas Implac?veis - Zacian Ex” | titulo | 2026-10-17T11:30–2026-10-20T17:15 | no dia, só anúncios reassociados em estoque nesta loja [bloqueado: produto com item em revisão] | inválido/contaminado | nenhum até decisão; se removido, gráfico/drop7d |
| sv9-colecao_ex-zacian | rihappycombr | 2026-10-24 a 2026-10-25 (2) | R$ 139,99 | revisao | 2c3948cc7931 “Box Pokémon Lendas Implacáveis Zacian” | anterior | 2026-10-24T19:45–2026-10-25T15:15 | ponto veio de anúncio reassociado [bloqueado: produto com item em revisão] | inválido/contaminado | nenhum até decisão; se removido, gráfico/drop7d |
| sv9-colecao_ex-zacian | coffeecatstorelojavirtualnuvemcombr | 2026-10-17 a 2026-10-25 (9) | R$ 117,59 | revisao | 0a86dff3a876 “Pokémon TCG – Box Coleção Lendas Implacáveis: Zacian EX (PT-” | titulo | 2026-10-17T14:30–2026-10-17T14:30 | a loja só teve anúncios reassociados neste produto [bloqueado: produto com item em revisão] | inválido/contaminado | nenhum até decisão; se removido, gráfico/drop7d |
| me05-blister4 | pontotcgstorecombr | 2026-10-17 | R$ 106,38 | remover | e989d8fd3eac “Kit com 2 Blister Quadruplo Escuridão Absoluta Binacle Pokém” | titulo | 2026-10-17T18:45–2026-10-17T18:45 | a loja só teve anúncios reassociados neste produto | inválido/contaminado; anúncio obsoleto (stale desde 2026-10-17) | gráfico/drop7d do produto; some do histórico publicado |
| me05-blister3 | pontotcgstorecombr | 2026-10-17 | R$ 81,68 | remover | 8552065c1ef6 “Kit com 2 Blister Triplo Escuridão Absoluta Slowpoke Pokémon” | titulo | 2026-10-17T18:45–2026-10-17T18:45 | a loja só teve anúncios reassociados neste produto | inválido/contaminado; anúncio obsoleto (stale desde 2026-10-17) | gráfico/drop7d do produto; some do histórico publicado |
| avulsos-colecao_ex-golem | pontotcgstorecombr | 2026-10-17 | R$ 47,41 | remover | 9ebe5d8fb84f “Carta Pokémon TCG Golem ex (076/165) Coleção 151” | titulo | 2026-10-17T20:30–2026-10-17T20:30 | a loja só teve anúncios reassociados neste produto | inválido/contaminado; anúncio obsoleto (stale desde 2026-10-17) | gráfico/drop7d do produto; some do histórico publicado |
| sv3_5-colecao_ex-alakazam | pontotcgstorecombr | 2026-10-17 | R$ 47,41 | revisao | bf8513c84056 “Carta Pokémon TCG Alakazam ex (065/165) Coleção 151” | titulo | 2026-10-17T20:30–2026-10-17T20:30 | a loja só teve anúncios reassociados neste produto [bloqueado: produto com item em revisão] | inválido/contaminado; anúncio obsoleto (stale desde 2026-10-17) | nenhum até decisão; se removido, gráfico/drop7d |
| sv6_5-colecao_ex-kingdra | rihappycombr | 2026-10-19 a 2026-10-25 (7) | R$ 229,99 | remover | a38bf35ac0ba “Jogo de Cartas - Pokemon - Box Greninja & Kingdra Ex - Copag” | anterior | 2026-10-19T11:00–2026-10-25T16:00 | a loja só teve anúncios reassociados neste produto | inválido/contaminado | gráfico/drop7d do produto; some do histórico publicado |
| sv6_5-colecao_ex-kingdra | pbkidscombr | 2026-10-19 a 2026-10-25 (7) | R$ 229,99 | remover | f403033e614c “Jogo de Cartas - Pokemon - Box Greninja & Kingdra Ex - Copag” | anterior | 2026-10-19T11:30–2026-10-25T16:00 | a loja só teve anúncios reassociados neste produto | inválido/contaminado | gráfico/drop7d do produto; some do histórico publicado |
| me01-box36 | geekstorebrasilcombr | 2026-10-22 a 2026-10-25 (4) | R$ 449,90 / R$ 427,41 / R$ 449,88 | remover | 34f47cdac54b “Booster Box Megaevolução - Reinado Delta (ME06) — PT — 36 Bo” | anterior | 2026-10-15T00:45–2026-10-25T16:37 | a loja só teve anúncios reassociados neste produto | inválido/contaminado | gráfico/drop7d do produto; some do histórico publicado |
| me01-blister1 | geekstorebrasilcombr | 2026-10-22 a 2026-10-25 (4) | R$ 14,90 / R$ 14,16 | remover | a2711ff8752b “Blister Unitário Megaevolução - Reinado Delta (ME06) — PT — ” | anterior | 2026-10-15T00:45–2026-10-25T16:37 | a loja só teve anúncios reassociados neste produto | inválido/contaminado | gráfico/drop7d do produto; some do histórico publicado |
| me01-blister3 | geekstorebrasilcombr | 2026-10-22 a 2026-10-25 (4) | R$ 44,90 / R$ 42,66 | remover | 3364ebc9f409 “Blister Triplo Megaevolução - Reinado Delta (ME06) — PT — 3 ” | anterior | 2026-10-15T00:45–2026-10-25T16:37 | a loja só teve anúncios reassociados neste produto | inválido/contaminado | gráfico/drop7d do produto; some do histórico publicado |
| me01-etb | geekstorebrasilcombr | 2026-10-22 a 2026-10-25 (4) | R$ 399,90 / R$ 379,91 / R$ 399,88 | revisao | f6ee2e6ffbeb “Elite Trainer Box (ETB) Megaevolução - Reinado Delta (ME06) ” | anterior | 2026-10-15T00:45–2026-10-25T16:37 | a loja só teve anúncios reassociados neste produto [bloqueado: produto com item em revisão] | inválido/contaminado | nenhum até decisão; se removido, gráfico/drop7d |
| avulsos-colecao_ex-wigglytuff | pontotcgstorecombr | 2026-10-17 a 2026-10-25 (9) | R$ 27,46 | remover | 3bbfcd905952 “Carta Pokémon TCG Wigglytuff EX (040/165) Coleção 151” | anterior | 2026-10-17T12:00–2026-10-25T16:00 | a loja só teve anúncios reassociados neste produto | inválido/contaminado | gráfico/drop7d do produto; some do histórico publicado |
| me03-blister4 | pontotcgstorecombr | 2026-10-17 a 2026-10-25 (9) | R$ 106,38 | remover | f546d2c510b5 “Kit com 2 Blister Quadruplo Equilíbrio Perfeito Chikorita Po” | anterior | 2026-10-17T13:45–2026-10-25T16:15 | a loja só teve anúncios reassociados neste produto | inválido/contaminado | gráfico/drop7d do produto; some do histórico publicado |

Justificativa comum: em todos os registros, o anúncio de origem é de outro produto. O título diz a caixa ou a coleção (Implacáveis 35239, Equipe Rocket 35880, ME06, carta avulsa "NNN/165", "Greninja & Kingdra", kit de 2 blisters), o matcher novo o tira do produto e as linhas do `history.jsonl` mostram que o valor veio dele. Nenhum ponto legítimo é removido: lojas mistas mantêm o ponto quando o valor também vem de um anúncio legítimo (lojaarena 149,90 em sv9; pontotcg unitário em me03 e me04).

**Aplicados automaticamente** (se aprovado):
- 65 pontos em 10 arquivos de `hist/`;
- `lowest.json` (sv10-mewtwo de 139,99 para 169,90; wigglytuff, golem e kingdra sem `lowest`).

**Não aplicados:** os itens de sv9, me01-etb e alakazam, e as remoções de produto.

### 0.4 Snapshot verificável

- **Etiqueta:** `data-backup/antes-do-reparo-AAAA-MM-DD`, sobre o commit do ramo `data` lido no passo de publicação. No teste local foi `8f28f68cab5680ad07fd8ecb22c1d6110c4d8ab5`, árvore `ca88ae5067d54ce3fdcd954943f6336b2218ffd1`. Ela não casa com o padrão de poda de `tools/data-backup.mjs` e nunca é apagada.
- **MANIFEST** do dry-run de teste (`scratchpad/e6b/saida-clone/proposto/MANIFEST.json`, sha256 `cfae1127ccafa254857d2d16bd5f58f237ed6200e05c5d5d1210c791e6816a39`). `relatorio.json` sha256 `67848e66…`. O dry-run (a) tem `relatorio.json` sha256 `98bede1a…`, usado como `--anterior`.

| arquivo | sha256 antes | sha256 depois |
|---|---|---|
| `data/lowest.json` | `169d28336f2680b8…` | `fa9bedb48fe8f1f4…` |
| `data/hist/sv10-colecao_ex-mewtwo.json` | `741bae9e08a2a86b…` | `11f9f33abdabc1ad…` |
| `data/hist/me05-blister4.json` | `727854652cd5be02…` | `a64599fdf6673277…` |
| `data/hist/me05-blister3.json` | `2139919564b46dbf…` | `a6c0aa4c7a9f4e46…` |
| `data/hist/avulsos-colecao_ex-golem.json` | `649cb553865b5096…` | `b4ce822cc43eaab8…` |
| `data/hist/sv6_5-colecao_ex-kingdra.json` | `6e645d5a437bfc5a…` | `aa37516c0328ce40…` |
| `data/hist/me01-box36.json` | `fe589f9ed599cae5…` | `a881477f547a0dc5…` |
| `data/hist/me01-blister1.json` | `28cf0c2345562dcc…` | `0bde5ea7a2a31c18…` |
| `data/hist/me01-blister3.json` | `a18541182f055de8…` | `f8e00d230ac9de5d…` |
| `data/hist/avulsos-colecao_ex-wigglytuff.json` | `550baded4efd0e1b…` | `62becdec2854a758…` |
| `data/hist/me03-blister4.json` | `51fee22357af02c9…` | `2b2ace1a850d7f3d…` |
| `data/state.json` (**nunca publicado**; só espelho) | `ebdda2b7a248591e…` | `1d9f651916f81018…` |

Na publicação real, o dry-run é refeito sobre o retrato daquele momento, e os sha256 serão outros. O que vale é a conferência `sha256Antes` = arquivo vigente.

### 0.5 Procedimento testado num clone local do ramo `data`

Clone: `git init` + `git fetch <repo> refs/remotes/origin/data:refs/heads/data`, em `scratchpad/e6b/data-clone`, com a etiqueta local `data-backup/antes-do-reparo-2026-10-25`. Nada foi enviado. Resultado real:

1. **Recusa de escrita no clone.** `--saida <clone>/saida` → "recusado: … é um checkout do ramo data", exit 1.
2. **Guarda do MANIFEST.** Com um byte a mais em `lowest.json`, `aplicar-local.sh` → "ABORTA: data/lowest.json mudou desde o dry-run", exit 2, nada aplicado.
3. **Aplicar.** 11 arquivos (lowest e 10 hist; `state.json` fora), commit local `12fc9fc`, "11 files changed, 14 insertions(+), 32 deletions(-)".
4. **Idempotência.** O dry-run de novo sobre o clone aplicado dá 0 pontos e 0 `lowest` a mudar e nenhum arquivo de `hist` proposto. O `lowest.json` proposto é idêntico ao aplicado (`cmp`). Ficam só os itens em revisão.
5. **Restaurar** (seletivo, só os arquivos do MANIFEST, a partir da etiqueta). Commit `c732e32`, `git diff --quiet <etiqueta> HEAD -- data` → idêntico. sha256 = `sha256Antes` nos 11 arquivos. A árvore do HEAD é igual à da etiqueta (`ca88ae50…`).

Scripts usados (em `scratchpad/e6b/`; uso só local, não são ferramenta de produção):

```bash
# aplicar-local.sh <clone> <saida>: confere TODOS os sha256Antes antes de copiar; nunca copia state.json
LIST=$(node -e 'const m=require(process.argv[1]);for(const a of m.arquivos) if(a.arquivo!=="data/state.json") console.log(a.arquivo+" "+a.sha256Antes)' "$O/proposto/MANIFEST.json")
while read -r f h; do [ "$(sha256sum "$C/$f" | cut -d" " -f1)" = "$h" ] || { echo "ABORTA: $f mudou"; exit 2; }; done <<< "$LIST"
while read -r f h; do cp "$O/proposto/$f" "$C/$f"; done <<< "$LIST"
git -C "$C" add $(echo "$LIST" | cut -d" " -f1) && git -C "$C" commit -qm "reparo de dados"
# restaurar-local.sh <clone> <etiqueta> <saida>: volta só os arquivos do MANIFEST e prova igualdade
git -C "$C" checkout "$T" -- $FILES && git -C "$C" commit -qm "reverte reparo de dados"
git -C "$C" diff --quiet "$T" HEAD -- data   # + sha256 de cada arquivo = sha256Antes
```

Em produção, a restauração por arquivo inteiro perde os recordes gravados depois do reparo (§6). A reversão seletiva por produto e ponto continua sendo a recomendada. O teste acima prova o caminho "voltar exatamente ao retrato etiquetado", usado logo depois de aplicar, antes de uma nova rodada.

### 0.6 Decisões pendentes (evidência, sem decisão)

**sv9-colecao_ex-zacian: menor preço R$ 113,89 (facilshopping, 20/10)**

- **Contra** o valor ser da caixa do Lupo:
  - o título é "Pokemon Box - Lendas Implac?veis - Zacian Ex" (anúncio df91b2a4d618), da linha Lendas Implacáveis (35239, 38 cartas). sv9 é a Zacian ex do Lupo (35263, 40 cartas);
  - o matcher novo já moveu o anúncio para `avulsos-colecao_ex-zacian`;
  - a facilshopping só tem esse anúncio de Zacian em estoque (o "Ludo" a 101,28 está sem estoque). Ela é "NÃO RECOMENDADA" no Reclame Aqui (3,5), mas isso não pesa no reparo;
  - coffeecat (117,59) e rihappy 2c3948cc7931 (139,99, 24 e 25/10) também são Implacáveis.
- **A favor** de manter: nenhuma evidência de que algum Lupo tenha estado em estoque abaixo de R$ 149,90 na janela (06 a 25/10):
  - lojaarena Lupo a 149,90;
  - rihappy Lupo a 156,99;
  - ML a 149,95, 169,90 e mais;
  - dalaran a 99,90 e facilshopping "Ludo" a 101,28, sempre sem estoque.
- **Em produção** (fonte db, `/api/v1/site/produto/sv9-colecao_ex-zacian`, 17:16Z): `lowestHistorical` 113,89 vindo do **Price Engine** (`history.min` 113,89, `max` 117,59). A série do banco também está contaminada.
- **Opções:**
  - (A) remover os 20 pontos Implacáveis e recalcular para **R$ 149,90** (lojaarena, 17/10). Os pontos da rihappy em 24 e 25/10 (139,99) são removidos ou trocados por 156,99 (Lupo, mesma loja). Consequência: o menor preço sobe 32%; o `drop7d` muda; a "maior queda" deixa de listar o sv9 com base falsa; um Lupo abaixo de 149,90 vira "novo menor preço" e pode gerar post.
  - (B) manter 113,89. Consequência: o site continua dizendo que o Lupo já custou 113,89, e todo preço atual parece "31% acima do mínimo".
  - (C) apagar o `lowest` do sv9 sem recalcular. O robô recria o recorde com o primeiro campeão da próxima rodada (hoje 149,90). Consequência: perde a data histórica (17/10) e gera um evento "novo menor preço" artificial.
  - Qualquer opção diferente de (B) exige também o passo do banco (§8), senão a página com fonte db continua mostrando 113,89.

**me01-etb: menor preço R$ 379,91 (geekstore, 23/10)**

- **Contra:**
  - o título é "Elite Trainer Box (ETB) Megaevolução - Reinado Delta (**ME06**) — PT" (f6ee2e6ffbeb). ME06 não está no catálogo, e a #922 impede que caia em ME01;
  - os outros anúncios ME06 da geekstore (box36, blister1, blister3) também estavam em me01-*;
  - o anúncio saiu do produto às 16:37 (evento `removed`).
- **A favor** de um valor nessa faixa: o ETB ME01 custa de R$ 359 a 450 nas lojas especializadas (odisseia 359, 4bestplay 379, pittas 390,51, lojanerdz, lojashardt e paladins 399,90, helpkids 399,99, rihappy e pbkids 449,99), **todas sem estoque** na janela. O único ponto legítimo barato (paladins 399,90, 06/10) está em `distrust` (janela até 07/10), e por isso não entra.
- **Série legítima restante:** só o Mercado Livre a 1.249 e 1.490 (08 a 12/10, ofertas que já saíram), revenda de produto esgotado.
- **Em produção** (fonte db, 17:16Z): `lowestHistorical` **1.249** vindo do Price Engine (`history.min` 1.249, 7 dias desde 08/10). O banco **não** usa o 379,91, que só aparece no caminho do robô (`state.lowestHistorical`, cards e fonte legado). Hipótese: o Price Engine descarta os pontos da geekstore pelo filtro de plausibilidade. Não verifiquei no banco.
- **Opções:**
  - (A) aceitar 1.249 (fica igual ao que o site já mostra com fonte db). Consequência: o "menor já visto" de um ETB de cerca de R$ 400 fica em R$ 1.249, e uma volta ao estoque a 399,90 dispara "novo menor preço" (−68%), provavelmente com post.
  - (B) apagar o `lowest` do me01-etb e deixar o próximo campeão recriar. Hoje não há estoque, então fica sem menor preço até alguém repor. Consequência: a página mostra "sem histórico de menor preço". É coerente, mas o banco continua com 1.249.
  - (C) manter 379,91 (status quo). Consequência: o valor é de outro produto (ME06), mas está numericamente perto do preço real do ME01.
  - (D) usar o ponto da paladins (399,90, 06/10), que exige abrir exceção ao `distrust` desse dia. Mexe numa regra de confiabilidade e por isso não é recomendado sem uma análise própria.

**Também bloqueado: sv3_5-alakazam.** O 47,41 (carta avulsa) é inválido sem dúvida. A dúvida é o substituto: o único ponto legítimo é a pokebola a R$ 899 (25/10). Opções: (A) aceitar 899; (B) apagar o `lowest`, recomendado porque a próxima oferta legítima recria; (C) manter 47,41, que é inválido.

### 0.7 Banco e aplicação (comparação com o ramo `data`)

Páginas públicas: `GET /api/v1/site/produto/<id>` via fetch, às 17:16Z, `source: "db"`, dados de 17:00:30Z (tipo d):

| produto | ramo data (`lowest.json`) | site (Price Engine) | observação |
|---|---|---|---|
| sv9-colecao_ex-zacian | 113,89 | 113,89 (`history.min`, `max` 117,59) | banco contaminado; a série diária do banco é só Implacáveis |
| sv10-colecao_ex-mewtwo | 139,99 | 139,99 (`min` = `max` = 139,99) | banco contaminado pelo rihappy 35880, que ficou `removed` com o produto antigo, como o §8 previa |
| me01-etb | 379,91 | **1.249** | o banco já mostra o valor que o reparo proporia; o 379,91 só existe no caminho do robô |

Os outros 4 produtos não foram consultados. Pelo código (§8), o banco estaria diferente assim:
- ofertas para "sem produto" (37) ficam `removed` com o `product_id` antigo, e o Price Engine continua contando os eventos delas (mewtwo, kingdra, cartas, ME06);
- ofertas para produto existente ou novo (25) trocam `offer.product_id` no próximo sync, e o histórico vai junto (sv9 deveria se corrigir quando as Implacáveis forem sincronizadas no produto novo; em 17:16Z ainda não, com stats `computed_at` 16:37);
- `historyProductMismatch` sobe;
- o reparo do ramo `data` não mexe no banco. O passo do §8 é obrigatório para a página com fonte db.

O Postgres não foi acessado (sem credencial; não tentei obter).

### 0.8 Efeitos colaterais esperados

- **Histórico:** 10 gráficos perdem pontos (mewtwo, kingdra, me01 box36/blister1/blister3, me03-blister4, me05-blister3/4, golem, wigglytuff). O `drop7d` e a "maior queda" mudam nesses produtos.
- **Ofertas:** nenhuma muda. O reparo não toca `offers.json` nem `state.offers`.
- **Ranking e oportunidades:** o Opportunity Engine usa `product_stats.historical_min` do banco (`opportunity-engine.js`). Sem o passo do banco, nada muda. Com ele, o sinal histórico do mewtwo e do sv9 sobe.
- **Cache:** o site só reflete o reparo depois da próxima rodada do robô e de mais 6 a 7 minutos (§5, passo 6).
- **Páginas de produto:** com fonte db, só mudam com o passo do banco. Com fonte legado e nos cards (`state.lowestHistorical`), mudam na rodada seguinte.
- **Posts e Top 10:** produto com `lowest` removido não gera "novo menor preço" na rodada seguinte (`run.js:530` exige recorde prévio). O mewtwo (recorde 169,90) gera o evento se aparecer preço menor, o que é legítimo. Os posts do Top 10 usam ofertas e oportunidades, não o `lowest`.
- **Relatórios:** `golden-eval` não muda; `historyProductMismatch` sobe só com o passo do banco; `qualidade-dados` passa a ver menos divergência entre `lowest` e oferta.

### 0.9 Validação e critérios de sucesso (pós-aplicação)

1. Dry-run sobre o retrato publicado: 0 pontos e 0 `lowest` automáticos a mudar (idempotência).
2. Os 11 arquivos publicados têm `sha256` = `sha256Depois` do MANIFEST.
3. Os demais arquivos do ramo `data` não mudam (`git diff --stat <etiqueta> <commit do reparo>` lista só os do MANIFEST).
4. `npm run golden:eval` e `npm test` verdes. A rodada seguinte do robô verde, sem alerta do Vigia.
5. Depois do atraso de cache, a página de cada produto aplicado mostra o `lowest` proposto no caminho do robô. Com fonte db, só depois do passo do banco.
6. Nenhum produto sem item em revisão ficou de fora, e nenhum item bloqueado foi aplicado.

**Impacto visível ao usuário:**
- menor preço do mewtwo de 139,99 para 169,90;
- wigglytuff, golem e kingdra sem "menor já visto";
- gráficos de 10 produtos sem os pontos falsos;
- nada muda em sv9, me01-etb e alakazam até a decisão;
- na fonte db, nada muda sem o passo do banco.


### 0.10 Adendo: ME06 "Reinado Delta" sem código no título (candidata `proposta/me06-sem-codigo` cce87e84, não integrada)

A frente de matching (E6-M) achou anúncios "Reinado Delta" sem "ME06" no título que caem em ME01 pelo fallback "megaevolucao". A correção está em cce87e84 (`FORA_DO_CATALOGO`), em revisão. Registros no retrato 8f28f68c:

| registro | produto | anúncio / título | `history.jsonl` | situação no reparo |
|---|---|---|---|---|
| moxland | me01-combo | `e6551daa8516` "Combo de Boosters - Megaevolução Reinado Delta" | 14/10 17:30 em estoque a R$ 249; 20/10 03:30 sem estoque (2 linhas) | **só com a candidata cce87e84**: 7 pontos (14 a 20/10, R$ 249) removidos, automático; `lowest` de me01-combo vai de R$ 249 (moxland, 14/10) para **R$ 250,99** (arenacwg, 07/10; paladins 249,90 em 07/10 está em `distrust`); classe inválido/contaminado |
| gorupa | me01-combo18 | `a2904e988b24` "Combo Booster Box Pokémon Reinado Delta Megaevolução ME06 - 18 Pacotes" | 16/10 12:00 sem estoque (1 linha) | já detectado com a main (#922 cobre "ME06"): reassociação automática para "sem produto", **0 pontos e 0 `lowest`** (nunca esteve em estoque). O `lowest` de me01-combo18 (canal40 232,79) e a série gorupa 236,55 vêm de outra oferta e ficam |

Simulação com a candidata (`--candidato` = `git archive cce87e84 src config`, mesma base c0b6bf44, mesmo `--anterior`, `--agora 2026-10-25T17:10:00Z`, saída `scratchpad/reparo/e6b-c`), comparada com a main (`e6b-b`):
- reassociações: 63 → 64 (+ moxland, automática);
- pontos removidos: 65 → 72;
- arquivos de hist: 10 → 11 (+ `me01-combo.json`, sha256 antes `3802a8b2…`, depois `cb2291fc…`);
- `lowest`: só muda me01-combo;
- o resto do `proposto/` é idêntico.

**Regra de inclusão:** o registro da moxland só entra no plano aplicável depois que cce87e84 (ou equivalente) for integrado e o robô reler a moxland. Antes disso, a main ainda casa o anúncio em me01-combo, e o reparo seria desfeito na rodada seguinte. Até lá, ele fica no inventário como **condicional**. O dry-run final roda com o candidato = main do momento: se a correção já estiver integrada, o registro entra sozinho; se não, fica de fora.


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
6. **Produto falso**: todas as ofertas já vistas nele (em `offers.json` e no `history.jsonl`) foram reassociadas. **Só vira proposta de remoção (`remocoes-propostas.json`) quando nenhuma oferta de `offers.json` aponta para o id**, ou seja, depois que o matcher corrigido rodou e tirou as ofertas de lá. Se ainda há oferta apontando, entra em `remocoesAdiadas`, com as ofertas e quantas estão em estoque. `products.json` nunca é reescrito.
   - Depois da integração, a oferta que foi para "sem produto" some do `offers.json`, junto com o título, e deixa de servir de evidência. Por isso a rodada pós-integração recebe `--anterior <relatorio.json>` do dry-run feito antes da integração. As reassociações daquele relatório contam como evidência para a remoção. Sem `--anterior`, nada é proposto.

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
- `proposto/remocoes-propostas.json` e `proposto/MANIFEST.json` (sha256 antes e depois de cada arquivo);
- `relatorio.json` também traz `remocoesAdiadas` e `anterior` (data e quantidade de reassociações do relatório passado em `--anterior`).

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

Rodada 1, antes da regra tudo ou nada. O resultado vigente é a **simulação final**, no fim desta seção.

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

### Simulação final (vigente): matcher 70f8d695, ferramenta da rodada 3

Ramo data bfaf3cde; base `src/` igual à main (match.js sha256 e64de86e…); candidato `/home/claude/wt-t5-match` @ 70f8d695 (match.js sha256 4ed718ad…); `--agora 2026-10-25T11:34:00Z`; saída `scratchpad/reparo/saida-final`.

| item | total | automático | revisão / bloqueado |
|---|---|---|---|
| reassociações | 62 em 35 produtos (17 em estoque; 37 → sem produto; 25 → produto, sendo 14 de id novo) | 50 | 12 (doremi + 11 de sv9/me01-etb) |
| pontos de `hist` | 10.126 → 10.060 | 66 removidos (11 arquivos) | 24 (2 mistos da rihappy + 22 bloqueados) |
| `lowest.json` | 262 → 258 entradas; 7 contaminados | 1 recalculado (sv10-mewtwo 139,99 → 169,90) + 4 removidos (alakazam, golem, wigglytuff, kingdra) | 2 (sv9-zacian → 149,90; me01-etb → 1.249) |
| produtos bloqueados | me01-etb, sv9-colecao_ex-zacian | — | — |
| remoção de produto | 0 propostas | — | 5 adiadas (destinos 3 ofertas, golem 1, paradoxais 1, venusaur 1, wigglytuff 1 em estoque = 7 ofertas apontando) |

Comparação com `saida-v3c` (mesma ferramenta da rodada 2, mesmo matcher): reassociações, pontos, `lowest` e bloqueios são iguais. `proposto/data/lowest.json`, `state.json` e os 11 arquivos de `hist/` saem idênticos byte a byte. A única diferença é a regra F1: as 5 remoções propostas passam a adiadas, porque ainda há 7 ofertas no `offers.json` apontando para elas (uma em estoque).

## 5. Sequência para aplicar (não executar sem autorização)

0. Antes da integração: rodar o dry-run e guardar o `relatorio.json`. Ele vai servir de `--anterior` no passo 3.
1. Integrar o matcher corrigido (#922 → matching v2/v3), depois do burn-in e com autorização.
2. Esperar pelo menos uma rodada do robô com o matcher novo. Conferir que as ofertas reassociadas já estão no produto novo ou em `unmatched`.
3. Rodar o dry-run sobre o retrato atual do ramo `data`, com base = commit da `main` anterior à integração e candidato = `main` atual. Passar `--anterior <relatório do passo 0>`. Revisar o relatório e decidir os itens de revisão humana e as remoções. Uma remoção só aparece como proposta quando nenhuma oferta aponta mais para o produto.
4. **Backup**: etiquetar o commit atual do ramo `data` com `data-backup/antes-do-reparo-AAAA-MM-DD`. Essa etiqueta não é apagada pela retenção (`tools/data-backup.mjs`). Anotar o SHA.
5. **Publicação.** Implementada em 31/10/2026 (autorização do dono, depois do burn-in 7/7): `.github/workflows/reparo-dados.yml` (só disparo manual; `aplicar` + `confirmar=APLICAR` para publicar) e `tools/reparo-publicar.mjs` (conferência do MANIFEST e cópia). Requisitos atendidos:
   - **mesmo grupo de concorrência do robô** (`hunter`). O passo lê o ramo `data`, roda o dry-run **sobre esse mesmo retrato**, que é o que vai ser publicado, e publica antes de liberar o grupo. O ramo é reescrito com push -f a cada rodada (bfaf3cde → bb8accd8 em 17 min no dia 25/10), então um `proposto/` calculado sobre um retrato antigo nunca pode ser publicado;
   - **conferir o MANIFEST antes de sobrescrever**: o `sha256Antes` de cada arquivo tem de ser igual ao sha256 do arquivo vigente no retrato. Se um só divergir, aborta sem publicar nada;
   - **publicar só `lowest.json` e os `hist/<id>.json` do MANIFEST. Nunca publicar `state.json`.** O `proposto/data/state.json` é um espelho para conferência: publicá-lo apagaria ofertas e preços da rodada vigente. A rodada seguinte regenera `lowestHistorical` e `hist` a partir de `lowest.json` e `hist/`;
   - itens bloqueados e remoções de produto só entram depois da decisão do dono, numa nova rodada de dry-run com as decisões refletidas (matcher, ou um override de revisão).
6. Validação pós-aplicação:
   - `npm run golden:eval`;
   - `tools/qualidade-dados.mjs` (quando integrado);
   - rodar o reparo de novo sobre o novo retrato: tem de dar 0 mudanças automáticas;
   - conferir no site os produtos da tabela do relatório (menor preço, gráfico, `drop7d`). **Só depois do atraso de propagação**:
     - o `state.json` que a API lê (`lowestHistorical`, `hist`, cards) só é regenerado na **próxima rodada do robô**;
     - depois disso, o site ainda pode mostrar o valor antigo por cerca de 6 a 7 minutos: cache de memória da função de 60 s (`api/v1.mjs` TTL, `api/_lib/legacy.mjs` TTL_MS), CDN `s-maxage=60, stale-while-revalidate=300`, e o cache do `raw.githubusercontent.com`, de onde a API lê o `state.json` (alguns minutos; valor não medido aqui).
     Validar antes disso dá falso negativo.

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
- Reassociação para um produto que existe ou é novo (25 das 62 na simulação final): a próxima sincronização troca `offer.product_id` e todo o histórico da oferta muda de produto. O produto antigo se corrige sozinho no próximo `runPriceEngine`.
- Reassociação para "sem produto" (37 das 62, por exemplo ME06 em `me01-*`, kingdra, as cartas): a oferta sai de `offers.json`, a sincronização a marca `status = 'removed'` (`sync.js`, `UPDATE offer SET status = 'removed'`) e o `product_id` antigo fica. O Price Engine continua usando os eventos anteriores à remoção na série do produto antigo. `offer.product_id` é `NOT NULL` (`db/migrations/001_core.sql`), então não dá para simplesmente desassociar.

**O que precisaria ser feito (exige autorização própria, porque é escrita em produção).**
1. Medir (só leitura): para os 35 produtos afetados, `product_stats.historical_min` e `price_daily` (`store_id = ''` e por loja), comparados com o relatório do reparo. Listar as `offer` (por `legacy_id` = `offerId` do relatório) com `status = 'removed'` e `product_id` antigo.
2. Escolher o mecanismo. Opções, da mais segura para a mais destrutiva:
   - (a) migration nova com uma marca na oferta (ex.: `offer.excluded_from_stats boolean` ou `status = 'mismatched'`), filtrada em `computeProductStats`/`loadInputs`. É reversível e não apaga histórico;
   - (b) mover essas ofertas para um produto de quarentena. Funciona por causa do `NOT NULL`, mas polui o catálogo;
   - (c) apagar as linhas de `price_history` dessas ofertas. É irreversível sem backup e não é recomendado.
3. Rodar `runPriceEngine` (`tools/db-stats.mjs`). `price_daily` remove sozinho os dias que deixam de existir (`DELETE … NOT EXISTS`), e `product_stats` é recalculado de forma idempotente.
4. Validar com `tools/db-validate.mjs` e conferir a página dos produtos (fonte `db`).
   - **Alta esperada no indicador `historyProductMismatch`** (`src/core/integrity-report.js`, `price_history.product_id` ≠ `offer.product_id`). Cada uma das 25 ofertas reassociadas para produto existente ou novo deixa as linhas antigas de `price_history` com o produto antigo, enquanto `offer.product_id` passa a ser o novo. O indicador é `REVIEW_ONLY` (`docs/integridade-referencial.md`, item 3) e não falha a validação. A alta é esperada e proporcional às linhas dessas ofertas, não é regressão. Antes da integração, registrar o valor de referência para comparar depois.
5. Fazer na mesma janela do reparo do ramo `data`, depois da integração do matcher. Antes: backup do banco (`docs/backup.md`).

## 9. Limitações

- O `history.jsonl` só tem 45 dias. Ponto mais antigo de loja mista fica em revisão (sem evidência).
- Oferta que sumiu de `offers.json` não tem título e conta como "desconhecida": não é reassociada e protege o ponto (mantém).
- Se o título de uma oferta mudou sem trocar de produto, o reparo usa o título atual. A guarda é a regra "linhas em outro produto → revisão".
- O reparo não migra pontos para os produtos novos (`avulsos-colecao_ex-zacian` etc.). Eles começam o histórico na integração.
