# Logs: minimização e retenção (estado atual)

Este documento descreve o que o código e os workflows fazem hoje. **Não é política legal**: prazos externos (logs do GitHub Actions, artefatos, Vercel, banco) são definidos pela configuração de cada plataforma e não são alterados aqui.

## O que é registrado

| Onde | O quê | Retenção no código |
|---|---|---|
| Saída dos workflows (`console.log` / `log`) | Progresso da rodada, erro por loja/fonte | Definida pelo GitHub Actions (configuração externa) |
| `data/history.jsonl` | Histórico de preços | `trimJsonl`, 45 dias (`src/history.js`) |
| Atividade (`src/activity.js`) | Eventos do painel | 7 dias, até 600 eventos |
| Estado operacional (`src/opstate.js`) | Resumo das rodadas | Últimas 96 rodadas (`KEEP_RUNS`) |
| `data/alerts.jsonl` | Alertas enviados | API devolve os 200 mais recentes |
| Fila de agentes (`automation_job`) | Mensagem de erro do job | Definida pelo banco (sem expurgo no código) |
| Estado por fonte (`reason`) e frete (`shippingError`) | Último motivo de falha | Sobrescrito a cada rodada |

## Minimização

- `src/redact.js` (`redact(texto, { env, max })`) mascara, antes de gravar ou imprimir: valores de variáveis sensíveis do ambiente (nomes com TOKEN, SECRET, PASSWORD, API_KEY, DATABASE_URL, TOPIC, CHAT_ID, CEP), URLs com usuário e senha, URLs de banco, token de bot do Telegram, `Bearer`/`Basic`, tokens do Mercado Livre, JWT, parâmetros como `access_token`/`secret`/`key`/`code`, e-mails, CPF e CEP. Também limita o tamanho.
- Aplicado nos erros de fonte (`reason` e log da rodada), no erro de frete, no log de estado operacional, na falha geral da rodada e na mensagem de erro dos jobs de agentes.
- `src/ops-notify.js` e `src/db-health.js` já tinham máscara própria e foram mantidos.
- Regra para código novo: não registrar corpo de resposta, cabeçalhos, URLs com credenciais, CEP do usuário nem dados pessoais; passe mensagens de erro por `redact`.

## Limites

- Não foram apagados logs nem alterada a retenção de nenhum ambiente (produção, GitHub, Vercel, banco).
- Logs já gravados antes desta mudança não são reescritos.
- Os `log(...)` de adaptadores (por exemplo Mercado Livre) e de `tips`/`inbox` ainda imprimem `e.message` direto; a saída do vigia e da rodada passa por `redact` apenas nos pontos listados acima.
- Definir prazos formais de retenção depende de decisão do responsável pelo projeto.

Testes: `test/redact-tests.js` (segredos sintéticos).
