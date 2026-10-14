# Dependências npm — política e inventário

O projeto roda em Node puro (`node:*`) e tem **uma** dependência direta: `pg`, o cliente PostgreSQL. Todo o resto
abaixo é árvore transitiva do `pg`, travada no `package-lock.json`.

## Regras

1. **Dependência nova só com registro aqui.** Todo pacote do `package-lock.json` (direto ou transitivo) precisa ter
   linha na tabela abaixo, com o motivo de existir. Linha de pacote que saiu do lock também precisa sair daqui.
   Dependência direta nova exige ainda atualizar `APROVADAS` em `test/deps-tests.js` na mesma PR.
2. **Nada sem lockfile.** Toda dependência declarada no `package.json` tem versão travada no `package-lock.json`
   (`lockfileVersion` ≥ 2). A CI instala com `npm ci`, que só usa o lock.
3. **Sem script de instalação.** O `package.json` não tem `preinstall`, `install`, `postinstall`, `prepare` (nem
   `prepublish`, `preprepare`, `postprepare`, `dependencies`), e nenhum pacote do lock tem `hasInstallScript`.
   Esses scripts rodam no `npm ci` da CI e do executor de tarefas com acesso ao checkout.
4. Versões não ficam neste documento: o Dependabot pode subir `pg` e as transitivas mexendo só no lock.

Verificado sem rede por `test/deps-policy-tests.js` (este inventário, lock e scripts de instalação) e
`test/deps-tests.js` (lista aprovada, coerência e integridade do lock).

## Inventário

| Pacote | Tipo | Por que existe |
| --- | --- | --- |
| `pg` | direta | Cliente PostgreSQL do banco oficial. Carregado sob demanda (`await import('pg')`) em `src/db/pg.js`, `api/_lib/db.mjs`, `src/db-health.js`, `src/opportunity-read.js` e `tools/db-diagnose.mjs`; sem `DATABASE_URL` nada é carregado. |
| `pg-connection-string` | transitiva (`pg`) | Interpreta a URL de conexão (`DATABASE_URL`). |
| `pg-pool` | transitiva (`pg`) | Pool de conexões (`pg.Pool`). |
| `pg-protocol` | transitiva (`pg`) | Codificação/decodificação do protocolo de rede do PostgreSQL. |
| `pg-types` | transitiva (`pg`) | Converte os tipos do PostgreSQL para valores JavaScript. |
| `pg-int8` | transitiva (`pg-types`) | Leitura de inteiros de 64 bits. |
| `postgres-array` | transitiva (`pg-types`) | Leitura de arrays do PostgreSQL. |
| `postgres-bytea` | transitiva (`pg-types`) | Leitura de `bytea`. |
| `postgres-date` | transitiva (`pg-types`) | Leitura de datas/timestamps. |
| `postgres-interval` | transitiva (`pg-types`) | Leitura de `interval`. |
| `xtend` | transitiva (`postgres-interval`) | Cópia/mescla de objetos usada pelo `postgres-interval`. |
| `pgpass` | transitiva (`pg`) | Lê senha do arquivo `~/.pgpass` quando a URL não traz senha. |
| `split2` | transitiva (`pgpass`) | Divide em linhas o stream do `.pgpass`. |
| `pg-cloudflare` | opcional (`pg`) | Socket para Cloudflare Workers; não usado aqui (rodamos em Node/Vercel), instalado como opcional do `pg`. |

`pg-native` é *peer* opcional do `pg` e **não** está instalado.
