# Burn-in da fábrica 24/7

O critério final da fábrica é ter **sete dias consecutivos verdes** de estabilidade real (ver `docs/PLANO-ENTREGA-TURBO.md`). A medição é automática:

- **Gatilho:** `.github/workflows/burnin.yml` roda depois de cada "Vigia do robô" na `main` (a cada ~15 min). Também pode ser disparado manualmente.
- **Avaliação:** `tools/burnin.mjs` avalia **ontem e hoje** no horário de Brasília. A lógica fica em `src/agents/burnin.js`.
- **Publicação:** um comentário por dia na issue aberta pelo operador com o label **`burnin:diario`**.
  - O comentário de hoje é atualizado a cada rodada.
  - O de ontem é finalizado na primeira rodada do dia seguinte.
  - Dia encerrado não muda mais.
  - Sem essa issue, o resultado só aparece no resumo do job.
- **Leitura local:** `node tools/burnin.mjs` sem `--publicar` é somente leitura e imprime o mesmo relatório.

## Critérios do dia verde

| Critério | Limite | Fonte |
|---|---|---|
| Hunter e Vigia: rodadas concluídas no dia | ≥ 80 (esperado 96, uma a cada 15 min) | API do Actions |
| Hunter e Vigia: maior intervalo sem rodada, incluindo o início e o fim do dia | ≤ 45 min (mesmo limite do "parado" do Vigia) | API do Actions |
| Taxa de sucesso | Hunter ≥ 90%, Vigia ≥ 95% (cancelado não conta como falha) | API do Actions |
| Dispatcher: execuções com falha | 0 | API do Actions |
| Rodadas com estado operacional | ≥ 60 | `data/meta.json` → `ops.runs` |
| Sincronização com o banco ok | ≥ 90% das rodadas | `ops.runs[].dbSync` |
| Leitor oficial ok | ≥ 90% das rodadas | `ops.runs[].reader` |
| Motor parado | ≤ 10% das rodadas | `ops.runs[].engine` |

A contagem mínima de rodadas e a amostra operacional só são exigidas no dia encerrado. Os demais critérios valem desde o início do dia.

Quanto ao veredito:
- Dia sem nenhum dado é `sem_dados`, nunca verde.
- Dia em curso sem falha é `parcial`.
- Qualquer critério reprovado deixa o dia `vermelho`, com o motivo na tabela.

A **sequência verde** conta só dias encerrados e consecutivos. Um dia vermelho ou sem registro zera a contagem.

**Apenas informativos** (não decidem o veredito):
- execuções de fallback (cron do GitHub) de cada workflow;
- execuções e falhas do worker;
- resumo da telemetria do dia.

## Limites conhecidos

- `ops.runs` guarda as últimas 96 rodadas (cerca de 24 h). O dia de ontem é finalizado logo depois da meia-noite, quando quase todas as rodadas ainda estão disponíveis. Se a finalização atrasar, a amostra pode cair abaixo de 60, e o dia fica vermelho por falta de evidência, nunca verde.
- O aviso de teste do Vigia (`watchdog.yml` com `teste=true`) e a recuperação de incidentes continuam sendo evidências manuais (#238).
