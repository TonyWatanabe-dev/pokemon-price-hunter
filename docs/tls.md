# TLS verificado com o PostgreSQL (Supabase)

## Situação

Até aqui, todas as conexões com o banco usavam TLS **sem verificar o certificado do servidor** (`rejectUnauthorized: false`). O tráfego vai cifrado, mas quem se colocasse no meio do caminho (DNS, rede) poderia se passar pelo Supabase e receber a senha do banco.

O código agora sabe verificar o certificado, em **modo compatível**:

- **Sem `PG_CA_CERT` e sem `PG_TLS_STRICT`**: o comportamento é **idêntico ao anterior**. A URL vai intacta para o driver (um `sslmode=` na `DATABASE_URL` ou na `API_DATABASE_URL` continua valendo como antes) e o `ssl` é o mesmo de antes. A única diferença é um aviso no log, uma vez por processo: `[tls] PG_CA_CERT não definido ...`.
- **Com `PG_CA_CERT`** válida: o certificado do servidor é verificado.
- **`PG_TLS_STRICT=1` sem CA**: a conexão é recusada.

**Nada muda em produção até o dono cadastrar a CA.**

## Como funciona

Existe um helper por ambiente, com conteúdo idêntico. `test/tls-tests.js` confere que os dois arquivos são iguais:

- `src/db/ssl.js`: robô, leitor oficial, saúde do banco e ferramentas (`tools/*`, via `src/db/pg.js`).
- `api/_lib/ssl.mjs`: funções da Vercel. Elas não podem importar de `src/`, que fica fora do deploy pelo `.vercelignore`. O arquivo entra no bundle pelo `import` em `api/_lib/db.mjs`, sem mudar o `vercel.json`.

`pgConnectionConfig(url, { env })` devolve `{ connectionString, ssl, tlsMode, caCount }`:

| Situação | URL | `ssl` | `tlsMode` |
|---|---|---|---|
| sem CA e sem estrito, host `@localhost` ou `@127.0.0.1` (regra de antes) | intacta | `false` (sem TLS) | `local` |
| sem CA e sem estrito, outro host | intacta | `{ rejectUnauthorized: false }` + aviso `[tls]` uma vez | `no-verify` |
| `PG_CA_CERT` ou `PG_CA_CERT_B64` definido | sem os parâmetros `ssl*` | `{ ca: [...], rejectUnauthorized: true, servername: <host> }` | `verify` |
| `PG_TLS_STRICT=1` sem CA | — | conexão recusada (erro `PG_TLS_STRICT`) | `refused` |
| CA preenchida mas ilegível | — | conexão recusada (erro `PG_CA_INVALID`, sem mostrar o conteúdo) | `invalid` |
| CA ou estrito com host local (`localhost`, `127.0.0.1`, `::1`) | intacta | `false` (sem TLS) | `local` |

Variável vazia (Secret que não existe chega vazio no workflow) conta como ausente. `PG_TLS_STRICT=0` também.

Detalhes:

- **Parâmetros `ssl*` da URL**: `sslmode`, `ssl`, `sslrootcert`, `sslcert`, `sslkey`, `sslpassword` e `uselibpqcompat`.
  - No modo compatível eles **ficam** na URL. Assim, uma URL com `sslmode=require` (que no `pg` 8.x verifica contra as CAs do sistema) ou `sslmode=disable` se comporta exatamente como antes.
  - Só com a CA configurada eles **saem** da URL. No node-postgres 8.x, qualquer um deles sobrescreve o objeto `ssl` e descartaria a CA, porque `pg/lib/connection-parameters.js` faz `Object.assign({}, config, parse(connectionString))`. Com a CA, uma URL com `?sslmode=require` (ou até `sslmode=disable`) passa a usar TLS verificado.
- **Formatos aceitos para a CA**:
  - `PG_CA_CERT`: texto PEM. Aceita vários certificados no mesmo valor e aceita `\n` literal quando colado numa linha só.
  - `PG_CA_CERT_B64`: o arquivo em base64, seja PEM ou DER (`.cer`).
  - Se os dois existirem, vale `PG_CA_CERT`.
- **Verificação**: o Node confere a cadeia com a CA dada e o nome do host contra o certificado. Equivale ao `sslmode=verify-full` que a documentação do Supabase recomenda.
- **Diagnóstico**: `tools/db-diagnose.mjs` mostra em `tls` o modo, se o estrito está ligado, a validade de cada certificado da CA e, se a verificação falhar, uma dica (`tls.hint`). Como antes, ele sempre conecta com TLS (no modo compatível, sem verificar), mesmo com host local.
- **Pontos de conexão que usam o helper**:
  - `src/db/pg.js`, que cobre migrations, sincronização, referências, estatísticas, motor, agentes e validação;
  - `src/opportunity-read.js`;
  - `src/db-health.js`;
  - `api/_lib/db.mjs`;
  - `tools/db-diagnose.mjs`.

  O teste 9 de `test/tls-tests.js` falha se aparecer `rejectUnauthorized` ou `new pg.Client/Pool` fora do helper.
- **Workflows**: `hunter.yml` (caça, sincronização e agentes), `db-validate.yml` e `review.yml` repassam `PG_CA_CERT` (Secret) e `PG_TLS_STRICT` (variável) como opcionais. O teste 11 confere que todo bloco com o Secret `DATABASE_URL` repassa os dois e que nenhum passo os exige.

## Riscos

- **CA errada derruba a conexão.** Com a CA configurada, o código **não** volta para "sem verificar" se ela não conferir. As consequências:
  - robô: o leitor oficial fica `unavailable`, a sincronização falha (o passo tem `continue-on-error`) e o vigia avisa depois de 2 rodadas;
  - API na Vercel: cai no fallback do `state.json` (`X-Fallback: db-indisponivel`). O site continua no ar, mas sem os dados do banco.
- **`PG_TLS_STRICT=1` sem CA recusa todas as conexões.** Só ligue depois do teste.

Por isso a ordem dos passos abaixo importa: primeiro o teste manual, depois a Vercel, e só no fim o modo estrito.

## Passos do dono (produção)

Faça na ordem. Cada passo é reversível (ver *Reverter*).

### 1. Baixar a CA do Supabase

1. Supabase Dashboard → projeto → **Database** → **Settings** → **SSL Configuration** → **Download certificate**.
2. O arquivo baixado se chama algo como `prod-ca-2021.crt` (ou `prod-supabase.cer`). O download é sempre pelo painel.
3. Confira o arquivo localmente (opcional):
   ```bash
   openssl x509 -in prod-ca-2021.crt -noout -subject -enddate
   ```
   Se o comando reclamar do formato, o arquivo é DER. Nesse caso, converta para PEM:
   ```bash
   openssl x509 -inform der -in prod-supabase.cer -out prod-ca.pem
   ```

A CA não é segredo, porque é um certificado público. Mesmo assim, guarde-a como Secret: assim fica junto das outras configurações de conexão e só o dono troca.

### 2. GitHub: criar o Secret

1. Repositório → **Settings** → **Secrets and variables** → **Actions** → **Secrets** → **New repository secret**.
2. Nome `PG_CA_CERT`. Valor: o conteúdo inteiro do `.crt`, de `-----BEGIN CERTIFICATE-----` até `-----END CERTIFICATE-----`.
   Alternativa: Secret `PG_CA_CERT_B64` com a saída de `base64 -w0 prod-ca-2021.crt` (no macOS, `base64 -i prod-ca-2021.crt`). Neste caso, repasse também `PG_CA_CERT_B64` nos workflows, que hoje só repassam `PG_CA_CERT`.
3. **Ainda não** crie a variável `PG_TLS_STRICT`.

A partir da próxima rodada, o robô já conecta com verificação (`tlsMode` `verify`).

### 3. Testar no GitHub

1. **Actions** → **Banco: testar TLS** → **Run workflow**. Deixe "Exigir CA" marcado. O workflow é manual e só lê: conecta, lê a versão e sai.
2. Sucesso: no log, `"tls": { "mode": "verify", ... "ca": [{ "validTo": ... }] }`, `"connected": true` e a versão do Postgres na última linha.
3. Falha com `tls.hint` ("o certificado do servidor não confere..."): o arquivo está errado (outro projeto ou CA antiga) ou a `DATABASE_URL` aponta para outro host. Corrija o Secret e rode de novo. Se precisar de tempo, apague o Secret: o robô volta ao modo compatível na rodada seguinte.
4. Depois do teste, acompanhe uma rodada normal do **Price Hunter**:
   - o log não deve mostrar o aviso `[tls] PG_CA_CERT não definido`;
   - o passo "Sincronizar com o banco" deve terminar sem erro.

### 4. Vercel (API v1)

1. Vercel → projeto → **Settings** → **Environment Variables** → **Add**.
2. Nome `PG_CA_CERT`, valor PEM (ou `PG_CA_CERT_B64`, se colar texto em várias linhas der problema), marcando **Production** e **Preview**.
3. Variável nova só vale em deploy novo. Faça um **Redeploy** do último deploy de produção.
4. Teste com um parâmetro qualquer para escapar do cache:
   ```bash
   curl -sI "https://<site>/api/v1/home?tls=$(date +%s)" | grep -i -E 'x-data-source|x-fallback'
   ```
   Esperado: `X-Data-Source: db` e nenhum `X-Fallback`.
5. `X-Fallback: db-indisponivel` com um `X-Fallback-Reason` que começa por `SELF_SIGNED_CERT`, `UNABLE_TO_VERIFY` ou `ERR_TLS_CERT_ALTNAME` quer dizer que a CA não confere. Com `PG_TLS_STRICT` ligado e sem CA, o motivo é `PG_TLS_STRICT`; com CA ilegível, `PG_CA_INVALID`. O site continua no ar pelo `state.json`. Remova a variável e faça o redeploy (ver *Reverter*).
6. Nos logs da função, o aviso `[tls] PG_CA_CERT não definido` deixa de aparecer.

Os deploys de **Preview** usam o mesmo banco (`API_DATABASE_URL`). Confira que `PG_CA_CERT` está marcado também em Preview antes do passo 5.

### 5. Ligar o modo estrito

Só depois dos passos 3 e 4 com sucesso. A partir daqui, faltar a CA vira erro, em vez de conectar sem verificar.

1. **GitHub**: **Settings** → **Secrets and variables** → **Actions** → aba **Variables** → **New repository variable** → `PG_TLS_STRICT` = `1`.
2. **Vercel**: variável `PG_TLS_STRICT` = `1` em **Production** e **Preview**, depois **Redeploy**.
3. Repita o teste do passo 3 (workflow e rodada do robô) e o `curl` do passo 4.

## Reverter

Nenhuma reversão exige mudar código.

- **Voltar ao modo compatível (como antes)**:
  1. apague `PG_TLS_STRICT`, no GitHub (Variables) e na Vercel;
  2. apague `PG_CA_CERT` / `PG_CA_CERT_B64`, no GitHub (Secrets) e na Vercel;
  3. faça o redeploy na Vercel.

  A próxima rodada do robô já conecta como antes, com o aviso `[tls]` no log.
- **Problema só com o modo estrito**: apague apenas `PG_TLS_STRICT`. Com a CA certa, a verificação continua ativa.
- **API fora do banco por causa da CA**: o site continua no ar pelo `state.json` (`X-Fallback: db-indisponivel`). Remova a variável na Vercel e faça o redeploy.

## Rotação da CA

O Supabase não documenta a rotação da CA. A estratégia é sempre usar um **pacote**:

1. Ao receber o aviso da nova CA, ou ao ver no painel um arquivo novo, baixe o certificado novo.
2. Monte um pacote com o antigo e o novo, um depois do outro, no mesmo valor:
   ```bash
   cat prod-ca-2021.crt prod-ca-NOVA.crt > pacote.pem
   ```
3. Troque `PG_CA_CERT` pelo conteúdo de `pacote.pem`, no GitHub e na Vercel, e faça o redeploy.
4. Rode **Banco: testar TLS**. O relatório deve listar os 2 certificados em `tls.ca`, cada um com o seu `validTo`. A conexão é aceita se o servidor apresentar qualquer um dos dois.
5. Quando o Supabase já estiver servindo só a cadeia nova, ou quando a antiga vencer, tire o certificado antigo do pacote e repita os passos 3 e 4.

Para acompanhar o vencimento, veja `tls.ca[].validTo` no relatório do **Banco: testar TLS** ou do **Banco: validar Marketplace Core** (`connect.json`).
