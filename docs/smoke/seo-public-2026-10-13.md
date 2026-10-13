# Smoke SEO do domínio público — 13/10/2026

Issue: #612 (sucede #606 / PR #609). Host canônico: `https://tcg-price-hunter.vercel.app`.
Commit da `main` conferido: `60217921c12e6592b5a2c2b624ce38fdac7d477d`.

## Resultado

**Runtime não validado.** Nenhuma consulta chegou ao domínio público; não há evidência de sucesso nem de falha do site. Os erros abaixo são do ambiente do executor, não do site.

## Tentativas (17:52–17:54 UTC, job do executor `tarefas.yml`)

| Caminho | Comando | Resultado |
|---|---|---|
| Runs existentes | `gh workflow view seo-public-smoke.yml` | `ID: 383474063`, `Total runs 0` — cron (10:23 UTC) ainda não disparou desde o merge da #602 |
| Disparo manual | `gh workflow run seo-public-smoke.yml --ref main` | `HTTP 403: Resource not accessible by integration` (token do executor sem `actions: write`) |
| Script direto | `node tools/seo-public-smoke.mjs` | `getaddrinfo ENOTFOUND tcg-price-hunter.vercel.app` |
| HTTP direto | `curl -I https://tcg-price-hunter.vercel.app/` | `Could not resolve host` |
| Fetch da ferramenta | WebFetch de `/robots.txt` | `getaddrinfo ENOTFOUND` |

O DNS do runner resolve `github.com`; o bloqueio é do `.github/egress-firewall.yaml` (`mode: enforce`), que não lista o domínio Vercel. A allowlist não foi alterada (fora do escopo do executor).

Os deployments do GitHub (`/deployments`) só registram `github-pages`; não há registro de deploy Vercel por onde conferir o SHA publicado.

## Contrato offline (mesmas asserções do smoke real)

`node test/seo-public-smoke-tests.js` → `contrato offline ok (dados em dia e desatualizados) + 8 quebras detectadas`.
Nenhuma falha reproduzível nos handlers locais (Home/canonical, `robots.txt`, `sitemap.xml`, `X-Robots-Tag: noindex` em `/conta`, `/favoritos`, `/alertas`, `/configuracoes`). Isso não comprova o runtime de produção.

## Como obter a evidência real

Um operador com permissão de Actions dispara `SEO public smoke` (`workflow_dispatch` na `main`) ou aguarda o cron das 10:23 UTC, e anexa o link do run à #612. Run verde termina com `SEO public smoke OK: https://tcg-price-hunter.vercel.app | Home, robots.txt, sitemap.xml, private-route noindex`.
