# Social Media — contrato e fluxo do MVP (rascunho, prévia e aprovação humana)

Issue #637; escopo das #560/#631 (decisão de 13/10/2026 em `docs/ROADMAP-OPERACIONAL.md`). Operação e incidentes ficam em
`docs/social-runbook.md`; regras da comunidade em `docs/social-comunidade.md`; links de afiliado em `docs/afiliados.md`.

O MVP é **somente rascunho, prévia, aprovação humana e auditoria**. Nada aqui publica, chama API de Telegram/Instagram/WhatsApp,
acessa rede, banco de produção ou secrets. Afiliado nunca altera ranking, preço, melhor oferta nem nota.

## Fluxo

```
state.json local ─► selecionarElegiveis ─► gerarRascunho (por canal) ─► enfileirar (estado: rascunho)
                    (elegiveis.js)          (rascunho.js)                 (fila.js)
                                                                              │
             preview.md + preview.json ◄─ horário sugerido "se aprovado" ◄─ agendar (cópia aprovada, fila.js)
                    │
                    ▼
       decisão humana: decidir (aprovacao.js) → trilha de auditoria encadeada → aprovar/rejeitar na fila
```

| Etapa | Módulo | O que garante |
|---|---|---|
| Elegibilidade | `src/agents/social/elegiveis.js` | estoque `IN_STOCK`, ativa (não stale/pending), não anômala, confirmada, preço > 0, URL https, frescor **atual** (`offerFreshness`); dedupe por produto + loja + preço em centavos; ordem pelo menor total comparável (`byComparableTotal`), sem comissão |
| Rascunho | `src/agents/social/rascunho.js` | texto determinístico em pt-BR; frete desconhecido explícito ("frete a calcular"); link = página do produto no site; frase de afiliado quando o destino é afiliado; texto da loja limpo; limites de 1.024 (Telegram) e 2.200 (Instagram, link "na bio") |
| Fila e calendário | `src/agents/social/fila.js` | idempotência por canal + chave em 24 h; até 3 por dia, 120 min de intervalo, janela de 24 h; nunca no passado; `publicado` recusado |
| Aprovação | `src/agents/social/aprovacao.js` | só operador autorizado; rejeição exige motivo; decisão única; trilha append-only com sha256; editar o texto invalida a aprovação |
| Prévia | `tools/social-preview.mjs` | junta as etapas acima sobre um `state.json` local e grava a prévia para revisão |

## Prévia local (`tools/social-preview.mjs`)

```
node tools/social-preview.mjs [--state caminho] [--canal telegram|instagram] [--saida dir] [--dry-run] [--limite N] [--now ISO]
```

- `--state`: `state.json` local (padrão: `data/state.json` do repositório, que pode estar velho; ver `docs/social-runbook.md`).
- `--canal`: um canal só; sem a opção, gera para Telegram e Instagram.
- `--saida`: pasta da prévia (padrão: `<tmp>/tcg-social-preview`). Grava **somente** `preview.md` e `preview.json` ali.
- `--limite`: máximo de ofertas elegíveis (padrão 10). `--now`/`PREVIA_NOW`: horário de referência para frescor e calendário,
  útil para reproduzir uma prévia; nunca para "fazer passar" uma oferta velha.
- **Gate:** sem `SOCIAL_ENABLED=1` ou `SOCIAL_ENABLED=true` a ferramenta sai com **código 2** e não grava nada, exceto com
  `--dry-run` explícito. Erro de argumento, `state.json` ausente ou corrompido = código 1. Sucesso = 0.
- Do ambiente, lê só `SOCIAL_ENABLED`, `SOCIAL_PAUSA` e `PREVIA_NOW`. Fora o `state.json`, lê só `config/affiliates.json`
  (via `api/_lib/affiliates.mjs`) para saber se o destino exige a frase de afiliado.

### Contrato de `preview.json` (versão 1)

| Campo | Conteúdo |
|---|---|
| `versao`, `modo`, `geradoEm`, `naoPublicado` | `1`; `dry-run` ou `habilitado`; horário de referência (ISO); sempre `true` |
| `fonte` | `stateGeradoEm` (o `generatedAt` do state) e `ofertas` (total lido) |
| `canais`, `limite`, `agenda` | canais pedidos; limite; por canal o `status` do calendário (`ok` ou `pausado`) e contagens |
| `resumo` | `elegiveis`, `rascunhos`, `erros`, `recusadas` e `porMotivo` (contagem pelos `MOTIVOS` de `elegiveis.js`) |
| `itens[]` | `id` (item da fila), `canal`, `ofertaId`, `produtoId`, `chaveDedupe`, `elegibilidade` (motivo, com frescor e idade da leitura), `lidaEm`, `disclosure` (bool), `horarioSugerido` (ISO ou `null`), `agenda`, `texto`, `link`, `avisos` |
| `erros[]` | oferta elegível sem rascunho (`gerarRascunho` recusou, ou frase de afiliado ausente): `ofertaId`, `canal`, `chaveDedupe`, `erro` |
| `recusadas[]` | `{ id, motivo }` de cada oferta fora da seleção (inclui `duplicada`) |
| `fila` | a fila editorial validada (`validarFila`), com todos os itens em `rascunho` e sem `agendadoPara` |

`preview.md` é a mesma informação para leitura humana: resumo, recusadas por motivo e, por canal, a fila sugerida com texto,
motivo, horário sugerido, disclosure, link, avisos e chave de dedupe.

## Estados

| Estado | Como chega | Pode ir para |
|---|---|---|
| `rascunho` | `enfileirar` (a prévia para aqui) | `aprovado`, `rejeitado` |
| `aprovado` | `decidir` com `aprovar` + `aprovar` na fila | nada no MVP (`TRANSICOES.aprovado` vazio) |
| `rejeitado` | `decidir` com `rejeitar` e motivo + `rejeitar` na fila | nada |
| `publicado` | reservado para o futuro; `transicionar` recusa sempre | — |

O horário da prévia é uma **sugestão**: `agendar` roda numa cópia com os itens aprovados, para mostrar onde cada rascunho
cairia se fosse aprovado agora. A fila gravada em `preview.json` não é aprovada nem agendada.

## Kill switch e limites

- **Desligado por padrão.** `SOCIAL_ENABLED` ausente = desligado. A prévia aceita `1` ou `true`; para o fluxo inteiro, use `1`
  (ver "Ligar e desligar" em `docs/social-runbook.md`: `elegiveis.js` e `rascunho.js` só aceitam `1`).
- **Pausa por canal:** `SOCIAL_PAUSA=telegram`, `SOCIAL_PAUSA=telegram,instagram` ou `SOCIAL_PAUSA=todos`. Na prévia, o canal
  pausado ainda mostra os rascunhos, mas sem horário (`agenda: canal pausado (SOCIAL_PAUSA)`).
- **Limites da fila** (`PADROES` em `fila.js`): 3 por canal por dia (UTC−3), 120 min entre posts, janela de 24 h para sugerir
  horário e 24 h para não repetir a mesma chave no mesmo canal.
- **Frescor:** só leitura "atual" vira rascunho; prévia sem rascunho e com `frescor não atual` nas recusadas = `state.json` velho.

## Fora do MVP

- Autopublicação, publicador, cron ou serviço que rode o fluxo sozinho.
- Integração real com Telegram, Instagram ou WhatsApp (bot, token, API), inclusive envio de teste.
- Persistência da fila e da trilha em banco; aprovação por interface web.
- Qualquer uso de comissão de afiliado em seleção, ordem, preço, melhor oferta ou nota; montagem ou encurtamento de link.

Cada item acima exige issue própria, autorização do proprietário e o Release Governor (`docs/agentes.md`).

## Checklist de ativação (#560)

Marque só com evidência (link de PR, CI ou issue). Item sem evidência = ativação bloqueada.

- [ ] `npm test` verde na `main`, incluindo `test/social-*-tests.js`.
- [ ] Prévia gerada com `state.json` atual (`--dry-run`), revisada por humano: textos, links, frase de afiliado e horários.
- [ ] Operadores aprovadores definidos em `TAREFAS_OPERADORES`; ensaio de `decidir` com trilha verificada (`verificarTrilha` com `ultimoHash`).
- [ ] Kill switch ensaiado: `SOCIAL_PAUSA=todos` deixa a prévia sem horários; remover `SOCIAL_ENABLED` faz a ferramenta sair com código 2.
- [ ] Links de afiliado de `config/social-afiliados.json` conferidos e `validado` marcado por PR.
- [ ] Publicador (fora do MVP) só em PR própria, conferindo `aprovacaoValida`, `habilitado`, `pausado` e `ofertaElegivel` antes de cada envio.
- [ ] Gates de operação (#612, #231, #271) e o checklist do piloto em `docs/social-runbook.md` conferidos.
