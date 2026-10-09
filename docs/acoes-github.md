# Ações do GitHub fixadas por SHA

Desde o Lote 6, toda ação nos workflows fica fixada pelo commit (SHA de 40 caracteres), com a versão num comentário:

```yaml
- uses: actions/checkout@11d5960a326750d5838078e36cf38b85af677262 # v4
```

Uma tag (`@v4`) pode ser movida pelo dono da ação. O SHA não muda. `test/workflow-security-tests.js` recusa qualquer `uses:` sem SHA fixo, e `.github/dependabot.yml` abre um PR por semana com as atualizações (SHA e comentário juntos).

## SHAs atuais (v4, sem troca de major neste lote)

| Ação | SHA | Versão |
|---|---|---|
| `actions/checkout` | `11d5960a326750d5838078e36cf38b85af677262` | v4 |
| `actions/setup-node` | `49933ea5288caeca8642d1e84afbd3f7d6820020` | v4 |
| `actions/upload-artifact` | `ea165f8d65b6e75b540449e92b4886f43607fa02` | v4 |
| `actions/download-artifact` | `d3f86a106a0bac45b974a628896c90dbdf5c8093` | v4 |
| `actions/cache/restore` e `actions/cache/save` | `0057852bfaa89a56745cba8c7296529d2fc39830` | v4 |

## Próximo passo: majors com Node 24

O Node 20 saiu dos runners em 23/09/2026. As ações v4 (feitas para Node 20) rodam hoje forçadas em Node 24 e geram um aviso em cada execução. As versões novas já usam Node 24:

| Ação | Versão | SHA |
|---|---|---|
| `actions/checkout` | v7.0.1 | `3d3c42e5aac5ba805825da76410c181273ba90b1` |
| `actions/setup-node` | v7.1.0 | `949feb2413d6458794dcd2491c4babbbce0c15c1` |
| `actions/upload-artifact` | v7.0.2 | `cf430e030ddbb5b0abf93d22962f4752f3646cd9` |
| `actions/download-artifact` | v8.0.2 | `9000827ccba6bdab643e8b6fd33ac0654aef8333` |
| `actions/cache` (`restore`/`save`) | v6.1.0 | `55cc8345863c7cc4c66a329aec7e433d2d1c52a9` |

Como fazer, num lote próprio:

1. Ler as notas de versão de cada major pulado, em busca de entradas e saídas removidas. Os pontos de atenção:
   - `upload-artifact` e `download-artifact`: o formato do `path` e os nomes de artefato em `db-validate.yml`;
   - `cache`: as chaves e `restore-keys` em `watchdog.yml`;
   - `checkout`: o `fetch-depth` padrão e as credenciais persistidas, que `hunter.yml` usa para dar `git push` no passo de configuração.
2. Trocar SHA e comentário (`# v7.0.1` etc.) em todos os workflows de uma vez. Atualizar o teste 3 de `test/workflow-security-tests.js`, que confere os SHAs v4 conhecidos só quando o comentário é `# v4`.
3. Rodar manualmente, nesta ordem:
   1. **Banco: testar TLS**
   2. **Diagnóstico de páginas**
   3. **Banco: validar Marketplace Core**, que usa os artefatos
   4. **Vigia do robô**, que usa o cache
   5. uma rodada do **Price Hunter**, que faz checkout e push
4. Reverter = voltar o commit (os SHAs v4 continuam válidos).

Os PRs do Dependabot também vão propor esses majors. Dá para aceitá-los, desde que os passos 1 e 3 sejam seguidos.
