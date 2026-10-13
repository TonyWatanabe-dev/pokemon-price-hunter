# Auditoria: cabeçalhos HTTP, CSP e configuração da Vercel

Escopo: `vercel.json` (só leitura), cabeçalhos em `api/`, `robots.txt` e testes que os conferem. Não repete `seguranca.md` (SSRF, redirect com `authorization`) nem `paginas-servidor.md` (cache de 404/casca em `api/pagina.mjs` l.275, falta de `maxDuration`). Só lacunas atuais; nada foi alterado fora deste arquivo.

## 1. Mapa

| Onde | Trecho | Efeito |
|---|---|---|
| `vercel.json` `headers[0]` (`/((?!__/).*)`) | `X-Content-Type-Options: nosniff`, `Referrer-Policy: strict-origin-when-cross-origin`, `X-Frame-Options: DENY`, `Permissions-Policy: camera=(), microphone=(), …` | Cabeçalhos de segurança em tudo, exceto `/__/` |
| mesmo bloco | `Content-Security-Policy: default-src 'self'; script-src 'self' 'unsafe-inline' https://apis.google.com; style-src 'self' 'unsafe-inline'; img-src 'self' data: https:; … frame-ancestors 'none'; base-uri 'none'; form-action 'none'; object-src 'none'` | CSP única, com `'unsafe-inline'` em script e estilo |
| `vercel.json` `headers[1..2]` | `X-Robots-Tag: noindex` em `/app.html` e `/(busca\|pistas\|conta\|favoritos\|alertas\|configuracoes)` | Rotas privadas fora do índice |
| `vercel.json` `rewrites` | `/__/auth/:path*` e `/__/firebase/:path*` → `https://tcg-price-hunter.firebaseapp.com/...` | Proxy do login; fica fora do bloco de cabeçalhos pelo `(?!__/)` |
| `api/v1.mjs` l.182-184, `CDN` l.39 | `Content-Type: application/json`, `Cache-Control` (`CDN.default`, `no-store`), `X-Payload-Bytes`, `X-Cache`, `X-Data-Source`, `Allow: GET, HEAD` no 405 | API JSON; sem `Access-Control-*` em `api/` |
| `api/pagina.mjs` l.274-275 | `cache-control: public, max-age=0, s-maxage=600, stale-while-revalidate=3600` | Páginas SSR |
| `api/sitemap.mjs` l.28-29 | `application/xml`, `s-maxage=3600` | Sitemap |
| `api/ml-callback.mjs` l.10-13 | `no-store`, `X-Robots-Tag: noindex`, `Referrer-Policy: no-referrer` | Retorno OAuth |
| `robots.txt` | `Disallow: /conta /favoritos /alertas /configuracoes /api/`; `Sitemap:` | Copiado para `public/` pelo `build` |
| `package.json` `build` | `cp index.html public/app.html`, `robots.txt`, `account.js`… | O que a Vercel serve de estático |

## 2. Já coberto

- `X-Robots-Tag` nas rotas privadas, `trailingSlash` desligado e rotas `/termos`/`/privacidade`: `test/seo-lote-c-tests.js` (caso 7, l.134).
- `connect-src` só com as APIs do Firebase necessárias: `test/firebase-key-tests.js` ("CSP", l.51).
- Cabeçalhos de frescor/`no-store` da API (`X-Data-Source`, fallback): `test/freshness-tests.js` (citado em `paginas-servidor.md`).
- Callback do ML (`api/ml-callback.mjs`): `test/partitions-mlcallback-tests.js`.
- `test/http-security-tests.js` cobre o cliente `src/http.js` (URL inválida, timeout, redação), **não** cabeçalhos de resposta.

## 3. Lacunas priorizadas

1. **Nenhum teste fixa os cabeçalhos de segurança nem a CSP.** Só `connect-src` e `X-Robots-Tag` são conferidos (seção 2). Remover `X-Frame-Options`, `nosniff`, `frame-ancestors 'none'`, `object-src 'none'` ou `base-uri 'none'` não quebra nada. Evidência: `grep` por `frame-ancestors`, `Permissions-Policy` e `nosniff` em `test/` não acha asserção.
2. **CSP com `'unsafe-inline'` em `script-src`.** `index.html` tem scripts inline (l.6, l.1437, l.3346) e `onclick=` (1 ocorrência). Sem nonce/hash, qualquer XSS refletido executa. Corrigir exige mexer no `index.html` (fora desta leva); o que cabe agora é um teste que impeça piorar (sem `'unsafe-eval'`, sem `*` em `script-src`).
3. **Sem `Strict-Transport-Security` no `vercel.json`.** A Vercel manda HSTS no domínio `*.vercel.app`, mas a configuração não o declara; um domínio próprio futuro ficaria sem. Não verificado em produção (sem acesso); baseado só no arquivo.
4. **`img-src ... https:` aceita imagem de qualquer host.** Permite exfiltração por pixel e rastreamento. Os hosts reais das fotos estão em `config/stores.json`/dados; não foi levantada a lista, então a restrição precisa de inventário antes.
5. **Respostas do `api/` sem `X-Content-Type-Options` explícito e sem CORS declarado.** O `vercel.json` cobre via regra global, mas `/api/v1/*` é reescrito para `/api/v1` e não há teste de que o bloco global alcança esses caminhos. `Access-Control-Allow-Origin` ausente é o comportamento desejado (só `'self'`), sem teste que o registre.
6. **`Permissions-Policy` incompleta e `/__/` sem cabeçalhos.** Faltam `interest-cohort`/`browsing-topics`; o `(?!__/)` deixa o proxy de login sem `nosniff` e sem CSP (necessário para o fluxo, mas sem teste que registre a exceção).
7. **`robots.txt` e `X-Robots-Tag` divergem.** `robots.txt` bloqueia `/conta`, `/favoritos`, `/alertas`, `/configuracoes`; `/busca` e `/pistas` têm `noindex` mas não `Disallow`, e `/app.html` só tem `noindex`. Intencional (o `noindex` precisa de rastreio), mas nenhum teste lê `robots.txt`; mudança acidental passa.

## 4. Tarefas pequenas e independentes

| # | Tarefa | Arquivos | Risco | Aceite testável |
|---|---|---|---|---|
| T1 | Teste dos cabeçalhos globais do `vercel.json` | `test/vercel-headers-tests.js` | R0 | Falha se faltar `nosniff`, `X-Frame-Options: DENY`, `Referrer-Policy` ou `Permissions-Policy`; passa no estado atual |
| T2 | Teste de diretivas da CSP | `test/vercel-csp-tests.js` | R0 | Exige `frame-ancestors 'none'`, `object-src 'none'`, `base-uri 'none'`, `form-action 'none'`; proíbe `'unsafe-eval'` e `*` em `script-src`/`default-src` |
| T3 | Teste de `robots.txt` x `X-Robots-Tag` | `test/robots-consistency-tests.js` | R0 | `Sitemap:` aponta para a URL do `canonical`; toda rota `Disallow` (exceto `/api/`) também tem `noindex` no `vercel.json` |
| T4 | Teste de cabeçalhos das funções (`sitemap`, `ml-callback`, `v1` 405) | `test/api-headers-tests.js` | R0 | `res` sintético: `content-type`, `cache-control`, `Allow: GET, HEAD` no 405, `no-store` no callback |
| T5 | Adicionar HSTS ao bloco global | `vercel.json`, `test/vercel-headers-tests.js` | R1 | `Strict-Transport-Security` com `max-age>=31536000` presente; JSON válido; `npm test` verde |
| T6 | Ampliar `Permissions-Policy` | `vercel.json`, `test/vercel-headers-tests.js` | R1 | Inclui `browsing-topics=()`; sem recurso usado pelo `index.html` bloqueado (teste busca `getUserMedia`/`geolocation` ausentes) |
