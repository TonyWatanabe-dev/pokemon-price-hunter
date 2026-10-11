# Ações do GitHub fixadas por SHA

Desde a #201 (extraída do Lote 6, PR #17), toda ação nos workflows fica fixada pelo commit (SHA de 40 caracteres), com a versão num comentário:

```yaml
- uses: actions/checkout@3d3c42e5aac5ba805825da76410c181273ba90b1 # v7.0.1
```

Uma tag (`@v7`) pode ser movida pelo dono da ação. O SHA não muda. `test/workflow-security-tests.js` recusa qualquer `uses:` sem SHA fixo e exige que cada ação use um único SHA e uma única versão em todos os workflows (#207). O `.github/dependabot.yml` abre PRs semanais agrupados com as atualizações (SHA e comentário juntos), no máximo 5 por ecossistema (`github-actions` e `npm`). Nenhum é integrado sozinho: cada um exige revisão e CI verde.

## SHAs atuais (Node 24, desde a #203)

| Ação | Versão | SHA |
|---|---|---|
| `actions/checkout` | v7.0.1 | `3d3c42e5aac5ba805825da76410c181273ba90b1` |
| `actions/setup-node` | v7.1.0 | `949feb2413d6458794dcd2491c4babbbce0c15c1` |
| `actions/upload-artifact` | v7.0.2 | `cf430e030ddbb5b0abf93d22962f4752f3646cd9` |
| `actions/download-artifact` | v8.0.2 | `9000827ccba6bdab643e8b6fd33ac0654aef8333` |
| `actions/cache/restore` e `actions/cache/save` | v6.1.0 | `55cc8345863c7cc4c66a329aec7e433d2d1c52a9` |

Os SHAs v4 anteriores (checkout `11d5960…`, setup-node `49933ea…`, upload-artifact `ea165f8…`, download-artifact `d3f86a1…`, cache `0057852…`) continuam conferidos pelo teste 3 se algum workflow voltar a `# v4`.

## Ao aceitar um PR do Dependabot

1. Ler as notas de versão de cada major pulado, em busca de entradas e saídas removidas. Os pontos de atenção:
   - `upload-artifact` e `download-artifact`: o formato do `path` e os nomes de artefato em `db-validate.yml`;
   - `cache`: as chaves e `restore-keys` em `watchdog.yml`;
   - `checkout`: o `fetch-depth` padrão e as credenciais persistidas, que `hunter.yml` usa para dar `git push` no passo de configuração.
2. Conferir que o PR troca SHA e comentário em todos os workflows de uma vez (o teste 3b recusa versões misturadas).
3. Depois de integrar, rodar manualmente, nesta ordem:
   1. **Banco: testar TLS**
   2. **Diagnóstico de páginas**
   3. **Banco: validar Marketplace Core**, que usa os artefatos
   4. **Vigia do robô**, que usa o cache
   5. uma rodada do **Price Hunter**, que faz checkout e push
4. Reverter = voltar o commit (os SHAs anteriores continuam válidos).
