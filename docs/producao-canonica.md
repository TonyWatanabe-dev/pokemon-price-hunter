# Fonte canônica de produção (Fase 8)

Conferido em 15/10/2026 (somente leitura: API do GitHub e MCP da Vercel; nenhuma configuração alterada).

## Resumo

| Superfície | Canônico | Como chega lá | Teste/smoke |
|---|---|---|---|
| Site público (HTML com SSR), `/api/v1/*`, `/sitemap.xml`, `/robots.txt`, `/assets/web/*` | **Vercel**, projeto `tcg-price-hunter` (região `gru1`, `vercel.json`) | Integração Git da Vercel: cada push na `main` gera um deployment de **produção** (ver "Pipeline") | `seo-public-smoke.yml` → `tools/seo-public-smoke.mjs` + `tools/post-deploy-smoke.mjs` |
| Dados do site/API | Banco PostgreSQL (Supabase, `API_DATABASE_URL`, só leitura) com fallback para o `state.json` do ramo `data` (raw.githubusercontent.com) | Robô `hunter.yml` grava o ramo `data` e sincroniza o banco | Burn-in #271; frescor em `X-Data-Freshness` |
| Conta/login | Firebase (`tcg-price-hunter.firebaseapp.com`, proxied em `/__/auth` e `/__/firebase`) | Console Firebase (fora do repositório) | `test/firestore-rules-shape-tests.js` |
| **GitHub Pages** | **Não canônico (legado)** | Build "pages build and deployment" a cada push na `main` (cópia estática do repositório, sem `/api`) | Nenhum — não é testado nem divulgado |

## Domínios

Domínios do projeto Vercel (15/10/2026):

- `tcgpricehunter.com.br` e `www.tcgpricehunter.com.br` — servem o site (sem redirecionamento).
- `tcg-price-hunter.vercel.app` — **307 → `tcgpricehunter.com.br`**.

O código ainda declara `https://tcg-price-hunter.vercel.app` como canônico (`SITE` em `api/_seo.mjs`, `robots.txt`, `<link rel="canonical">`, sitemap, JSON-LD). Ou seja: o canonical aponta para um host que redireciona temporariamente para outro. Os smokes usam o mesmo `SITE` e seguem o redirecionamento, então continuam válidos. **Decisão do proprietário:** adotar `tcgpricehunter.com.br` como canônico (trocar `SITE`, `robots.txt`, testes de SEO, e tornar o redirecionamento permanente 308 na Vercel) ou remover o redirecionamento. Não trocar sem essa decisão: mexe em SEO e indexação.

## Pipeline de deploy (estado real)

- Os deployments de produção da Vercel trazem `githubCommitRef: main` e o SHA de cada merge (ex.: `41fbe13` #724, `17b0b5c` #723, `2b62844` #728), criados pela integração Git. **Hoje o merge na `main` publica sozinho** — é o que `docs/checklist-release.md` já avisa ("Merge na `main` publica em produção").
- Nenhum workflow do repositório faz deploy na Vercel (`test/producao-canonica-tests.js` garante isso). O caminho com gates — `tools/release-run.mjs deploy` (Release Executor Bridge + Release Governor, smoke e rollback) — existe, mas não está operacional: falta `VERCEL_TOKEN` e o sink de auditoria (#231, #221).
- Critério da Fase 8 "não há deploy automático baseado só no fato de que o merge ocorreu": **não atendido**. O gate hoje é o próprio merge (CI + revisão). **Decisão do proprietário** (R3: política de deploy), entre:
  1. desligar o deploy automático da `main` (`"git": { "deploymentEnabled": { "main": false } }` no `vercel.json`, ou "Ignored Build Step" no painel) e publicar só pela Ponte (`release-run.mjs deploy`) depois do Preview validado — exige `VERCEL_TOKEN` configurado pelo proprietário;
  2. manter o deploy no merge e registrar formalmente o merge como gate de release (CI verde + checklist + smoke pós-deploy em seguida), ajustando o critério do plano.
- Rollback: deployments anteriores ficam como candidatos de rollback instantâneo na Vercel (painel → Deployments → Instant Rollback), ação do proprietário.

## GitHub Pages

Ainda ativo: cada push na `main` dispara "pages build and deployment" (checks `build`, `report-build-status`, `deploy`). Publica uma cópia estática do repositório (o `index.html` cru, sem as funções `/api`, sem SSR). Nada no código aponta para `github.io`; a cópia declara canonical da Vercel. É resto da instalação original (`README.md`, passo "Ative o GitHub Pages").

**Recomendação:** o proprietário desativa em Settings → Pages (a API de Pages não é acessível a esta sessão). Até lá, não usar o Pages como prova de deploy (ver `docs/ROADMAP-OPERACIONAL.md`, 13/10: o sucesso do Pages "não substitui smoke test do domínio público Vercel").
