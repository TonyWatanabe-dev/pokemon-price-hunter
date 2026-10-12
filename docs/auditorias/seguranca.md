# Auditoria de lacunas — segurança: dependências, SSRF e links externos

Issue #294 (origem: #94, #105, #116, #50). Somente leitura do código na `main`; nada aqui altera comportamento.

## 1. Mapa

| Área | Arquivo / trecho | Função |
|---|---|---|
| Guarda SSRF | `src/urlguard.js` · `isPrivateHost`, `assertSafeUrl`, `UnsafeUrlError` | só http/https, sem credenciais, bloqueia localhost/.local/.internal, IPv4 privado/loopback/link-local/CGNAT/multicast, IPv6 `::1`, `fc/fd`, `fe8-b`, IPv4-mapeado, NAT64 |
| Cliente HTTP | `src/http.js` · `requestOnce` | chama `assertSafeUrl(url)` antes de conectar; `redirect: 'manual'`, até `MAX_REDIRECTS = 5`, cada `Location` passa por `assertSafeUrl` |
| Log seguro | `src/http.js` · `safeUrl`, `redact` | erros mostram só `origin + pathname` |
| Host do deploy | `api/pagina.mjs` · `pickFetchHost` | só busca `app.html` no host do SITE ou do deploy próprio |
| Link de compra (servidor) | `api/_lib/stores.mjs` · `safeUrl` | só http/https; http vira https só com evidência |
| Link de saída (front) | `index.html` · `safeUrl` (~l.1387), `outUrl`, `outRel` | `^https?://` ou `#`; afiliado só para ML com `AFIL_OK` |
| Dependências | `package.json` (única: `pg ^8.23.1`), `package-lock.json`, `.github/dependabot.yml` | Dependabot semanal (actions e npm); CI usa `npm ci --no-audit` |

## 2. O que já está coberto

- IPs privados, loopback, link-local, NAT64, IPv4 compatível, IPv6 público permitido: `test/urlguard-tests.js`.
- Redirect para `169.254.169.254` não é buscado; URL proibida não chega ao `fetch`; redirect relativo; loop de redirects: `test/urlguard-tests.js`.
- Host forjado em `pickFetchHost`: `test/urlguard-tests.js`.
- URL inválida, timeout, JSON malformado, resposta grande, query/token fora das mensagens de erro, `redact`: `test/http-security-tests.js`.
- `safeUrl` real das páginas, `rel` com `noopener` em todo `target="_blank"`, ausência de parâmetros de tracking montados: `test/outbound-links-tests.js`.
- Links de afiliado e Amazon: `test/affiliate-links-tests.js`, `test/amazon-links-tests.js`; `safeUrl` do servidor: `test/stores-tests.js`.
- Actions fixadas por SHA: `test/workflow-security-tests.js`.

## 3. Lacunas atuais

**Alta**
1. `src/http.js` reaplica o mesmo `headers` em todos os saltos de redirect (loop em `requestOnce`). `src/inbox.js:21` envia `authorization: Bearer <token>` ao ML via `getJson`; um redirect cross-origin repassaria o token. Sem teste.
2. Fetches fora de `src/http.js` não usam a guarda: `api/_lib/legacy.mjs` (`fetchJson`, `fetch(url)` com redirect automático), `api/_seo.mjs:20`, `api/pagina.mjs:135`. Hoje as URLs parecem fixas/derivadas de config, mas não há teste que impeça uso de URL externa.

**Média**
3. `isPrivateHost` é só sintático (comentário em `src/urlguard.js`): DNS rebinding e hostnames públicos que resolvem para IP privado não são cobertos, e não há teste que documente esse limite.
4. Sem teste explícito de formas alternativas de IP (`http://2130706433/`, `0x7f.1`, `127.1`, `[::ffff:7f00:1]`), nem de credenciais na URL (`http://user:pw@host/`) em `assertSafeUrl` (o código trata, a bateria não cobre todos).
5. Segurança de dependências: sem `npm audit` no CI (`--no-audit`), sem teste que garanta lockfile consistente/`engines`. Só há Dependabot.
6. Front: `safeUrl` aceita qualquer `http(s)://`, inclusive IP privado/localhost vindos de `state.json` (só afeta o clique do usuário, mas é link para destino interno do próprio usuário); ninguém valida URLs na coleta de dicas (`tipRow`, Telegram).

**Baixa**
7. `index.html` e `tools/page.template.html` têm cópias separadas de `safeUrl` (issue #98); o teste cobre as duas, mas divergência é possível.
8. `<img src="https://icons.duckduckgo.com/...">` em `index.html` (raBadge) usa terceiro externo; tem `referrerpolicy="no-referrer"`, sem teste que garanta isso.

## 4. Proposta de tarefas (pequenas e independentes)

| # | Tarefa | Arquivos prováveis | Risco | Critério de aceite |
|---|---|---|---|---|
| T1 | Remover `authorization`/`cookie` dos headers em redirect para outra origem | `src/http.js`, `test/urlguard-tests.js` | R1 | teste com fetch sintético: redirect `a.example`→`b.example` não leva `authorization`; mesma origem leva |
| T2 | Ampliar bateria de `assertSafeUrl` (IP decimal/hex/curto, IPv4-mapeado hex, credenciais, esquemas `file:`/`ftp:`/`data:`) | `test/urlguard-tests.js` | R0 | todos os casos listados lançam `unsafe === true`; `npm test` verde |
| T3 | Teste estático: todo `fetch(` em `src/` e `api/` fora de `http.js` está numa lista permitida com URL fixa | novo `test/fetch-allowlist-tests.js`, `package.json` (script test) | R1 | teste falha ao adicionar `fetch(` novo fora da lista |
| T4 | Documentar e testar o limite de DNS rebinding (sem alterar comportamento) | `docs/` pequeno, `test/urlguard-tests.js` | R0 | teste afirma que hostname público não é resolvido; doc cita o limite |
| T5 | Verificação de dependências: teste que lê `package.json`/`package-lock.json` e exige lock coerente e uma única dependência de produção aprovada | novo `test/deps-tests.js` | R0 | teste falha se dependência nova entrar sem atualizar a lista |
| T6 | Teste de `referrerpolicy="no-referrer"` em `<img>` externos nas duas páginas | `test/outbound-links-tests.js` | R0 | todo `<img src="https://...">` tem `referrerpolicy="no-referrer"` |
