# Auditoria de lacunas: agentes de produto (orquestrador, revisão, evidências) — issue #532

Escopo: `src/agents/` exceto Dispatcher, worker e Governor (já em `agentes-fabrica.md`), `tools/agents-run.mjs`, `tools/review.mjs` e testes de agentes. Só leitura; nada foi alterado fora deste arquivo.

## 1. Mapa

| Peça | Arquivo e trecho |
|---|---|
| Fila de jobs | `src/agents/orchestrator.js`: `createOrchestrator` (`enqueue`, `runOnce`, `runJob`), `DEFAULTS`, `backoffMs`, `withTimeout`, `checkResult` |
| Limite de IA | `orchestrator.js`: `PROTECTED_NAMESPACES` e `register` (recusa handler `ai` em price/score/ranking/…); `runJob` bloqueia `h.ai && !aiEnabled` |
| Evidência | `src/agents/evidence.js`: `buildEvidence`, `validateEvidence`, `FUTURE_TOLERANCE_MS` |
| Seleção de candidatos | `src/agents/matching-review.js`: `reviewCandidates` (`state.unmatched` depois `state.offers`, `out.slice(0, limit)`) |
| Handler de revisão | `src/agents/handlers/review-propose.js`: `validateReviewProposal`, `reviewProposeHandler`, `pgReviewSink` (`ON CONFLICT (dedupe_key) DO NOTHING`) |
| Ciclo da rodada | `src/agents/cycle.js`: `runAgentCycle`, `CYCLE`, `summarize` |
| Aviso | `src/agents/notify.js`: `pendingAgentEvents` (`LIMIT $3`, `MAX_EVENTS = 50`), `composeAgentAlert`, `notifyAgentEvents` (cursor `AGENT_ALERT_CURSOR`) |
| CLI do ciclo | `tools/agents-run.mjs`: termina sempre com `process.exit(0)`, erro vira `::warning::` |
| CLI de revisão | `tools/review.mjs`: `list`, `triage`, `approve`, `reject`, `dismiss`, `export` (`fs.writeFileSync(OUT, …)`) |

## 2. O que já está coberto

- `test/agents-orchestrator-tests.js`: idempotência de `enqueue`, retry com backoff, tentativas esgotadas, erro permanente, timeout (inclusive gravação tardia), lease expirada, `blocked` sem handler/IA desligada, IA em namespace protegido, resultado grande/não serializável, prioridade e limite, evidência ausente em matching.
- `test/agent-evidence-tests.js`: evidência completa, recusa sem source/url/reason/basis, `observedAt` ausente/ilegível/futuro, `validateEvidence` recalcula `status`, toda proposta de matching leva evidência.
- `test/agents-cycle-tests.js`: prazo (`deadlineMs`), lote (`claimed < batch`), erro em candidatos não impede o aviso.
- `test/agents-integration-tests.js`: seleção com evidência e chave estável, aviso agregado, ciclo nunca lança, ferramenta sai com 0, posição do passo no workflow, fluxo ponta a ponta, rodadas repetidas sem duplicar, cursor/reenvio, prazo entre lotes.
- `test/review-tests.js`: `tools/review.mjs` sem banco (status 2) e fluxo da CLI com operador autorizado; regras de decisão do núcleo (`src/core/review.js`).
- `test/golden-eval-tests.js`: avaliação offline `golden-eval.js` (matching, preço, frete, estoque).

## 3. Lacunas priorizadas

1. **Evidência só vale para `matching`.** `review-propose.js` (`if (p.category === 'matching')`) é o único ponto que chama `validateEvidence`; as outras categorias de `REVIEW_CATEGORIES` (`price_anomaly`, `reference_conflict`, …) entram na fila sem fonte, URL ou motivo. Hoje só matching é produzido (`matching-review.js`), então é risco latente, mas o contrato do `evidence.js` ("toda proposta") não está imposto. Nenhum teste cobre proposta não-matching sem evidência.
2. **Evidência velha vira "completa".** `isoTime` (`evidence.js`) rejeita só horário futuro; um `observedAt` de meses atrás sai `completa`. O revisor não distingue dado fresco de estagnado. Sem teste de idade.
3. **Candidatos de baixa confiança podem ser preteridos.** `reviewCandidates` percorre todo `state.unmatched` antes de `state.offers` e corta com `out.slice(0, limit)` (25 em `CYCLE.maxNew`). Com 25 ou mais recusas elegíveis, nenhuma oferta `baixa_confianca` é enfileirada na rodada. Os testes de seleção não exercitam o corte.
4. **Aviso trunca em silêncio.** `pendingAgentEvents` usa `LIMIT 50` e o cursor avança até o último id lido; a mensagem de `composeAgentAlert` não diz se havia mais eventos pendentes. Sem teste com mais de 50 eventos.
5. **`review.mjs export` grava direto no destino.** `fs.writeFileSync(OUT, …)` sobrescreve `config/matching-overrides.json`; queda no meio deixa JSON truncado, que o resto do sistema lê. Não há teste de escrita atômica.
6. **Cursor após envio.** `notifyAgentEvents` envia e só depois insere `AGENT_ALERT_CURSOR`; se o `INSERT` falhar, o aviso se repete na rodada seguinte (`cycle.js` captura como `avisar`). Comportamento aceitável (prefere duplicar a perder), mas não documentado nem testado.

## 4. Tarefas pequenas e independentes (sem `index.html`)

1. **Exigir evidência em toda categoria** — R1. Arquivos: `src/agents/handlers/review-propose.js`, `test/agents-orchestrator-tests.js`. Aceite: proposta `price_anomaly` sem `proposal.evidence` é recusada por `validateReviewProposal` e falha sem retry; com evidência válida passa; matching segue igual.
2. **Rotular evidência velha** — R0. Arquivos: `src/agents/evidence.js`, `test/agent-evidence-tests.js`. Aceite: `observedAt` mais antigo que um limite exportado (ex.: 72 h) vira `status: 'incompleta'` com `missing` contendo `observedAt`, ou `stale`, sem inventar horário; `validateEvidence` coerente com o cálculo.
3. **Reservar cota para baixa confiança** — R0. Arquivos: `src/agents/matching-review.js`, `test/agents-integration-tests.js`. Aceite: com 30 recusas elegíveis e 3 ofertas de baixa confiança, `reviewCandidates(state, { limit: 25 })` inclui as 3 ofertas; ordem e chaves de idempotência estáveis.
4. **Avisar truncamento** — R0. Arquivos: `src/agents/notify.js`, `test/agents-cycle-tests.js`. Aceite: com mais de `MAX_EVENTS` eventos pendentes o texto traz "há mais eventos"; com até 50 o texto não muda.
5. **Gravação atômica do export** — R1. Arquivos: `tools/review.mjs`, `test/review-tests.js`. Aceite: `export` escreve em arquivo temporário e renomeia; teste da CLI confirma conteúdo final válido e ausência de `.tmp` restante.
6. **Documentar e testar falha do cursor** — R0. Arquivos: `src/agents/notify.js`, `test/agents-integration-tests.js`. Aceite: com `INSERT` do cursor falhando, `notifyAgentEvents` rejeita, `runAgentCycle` registra erro `avisar` e a rodada seguinte reenvia os mesmos eventos.
