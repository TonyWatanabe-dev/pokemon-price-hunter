# PWA e estados de conectividade — avaliação técnica (issue #97)

Avaliação documental. Nenhum código, deploy ou arquitetura nova foi criado.

## O que existe hoje

- **Manifest:** não há (`manifest.json`/`.webmanifest` ausente; nenhuma `<link rel="manifest">` em `index.html` nem em `tools/page.template.html`).
- **Service worker:** não há arquivo nem registro (`serviceWorker` não é usado no front).
- **Cache do navegador (Cache API):** não é usada.
- **Metadados parciais:** `viewport` com `viewport-fit=cover`, `theme-color` (claro/escuro), `icon` e `apple-touch-icon`. Isso não torna o site instalável.
- **Estado local:** `localStorage` com prefixo `ph:` (preferências, última visita) e `sessionStorage` (`ph:gate`, `ph:since` etc.), em `tools/page.template.html`.
- **Conectividade:** não há tratamento de `navigator.onLine` nem eventos `online`/`offline`.

## Cache HTTP e preço stale (já coberto no servidor)

- `api/v1.mjs` responde `Cache-Control: no-store` quando o dado está desatualizado, em fallback ou com erro 5xx. Só dado em dia usa cache de CDN. Isso é coberto por `test/freshness-tests.js`.
- A resposta carrega metadados de frescor (`meta.freshness`) e cabeçalhos `X-Data-Source`/`X-Fallback`.
- A UI mostra "Atualizado há…", o chip "Leitura antiga" (`o.stale`) e o aviso "Robô pausado" quando a leitura passa de 90 min. `api/ml-callback.mjs` usa `no-store`.

## Riscos de um service worker ingênuo

1. **Preço stale sem aviso:** um SW com cache-first ou stale-while-revalidate serviria `/api/v1/*` antigo, anulando o `no-store` e o selo de frescor. O preço exibido seria o de horas ou dias atrás, sem aviso.
2. **Dados de conta:** a conta usa `account.js`, `api/ml-callback.mjs` e fluxos autenticados. Eles nunca podem entrar em cache offline (tokens, perfil, alertas, watchlist).
3. **Shell desatualizado:** `/` e as páginas geradas (`api/pagina.mjs`) mudam a cada ciclo. Um shell em cache pode ficar preso em versão velha.
4. **Background no celular:** Background Sync e Periodic Background Sync não têm suporte confiável (iOS/Safari não suporta; Chrome exige instalação e engajamento). **Não prometer** atualização ou alerta em segundo plano por PWA; os alertas seguem pelos canais atuais (servidor).

## Recomendação

Não há base para PWA completo, e criar uma seria arquitetura paralela. Se for implementado depois, em PR próprio:

1. Manifest mínimo (nome, ícones, `display`, `theme-color`) — baixo risco, sem SW.
2. SW só para o shell estático (versionado). `/api/*`, conta, `ml-callback` e qualquer resposta com `Authorization`, cookie ou `no-store`: **network-only**, nunca cacheados.
3. Offline: mostrar banner "Sem conexão — preços podem estar desatualizados" e, se houver dado local, exibi-lo com data da leitura. Nunca apresentar como atual. Reutilizar `meta.freshness`.
4. Reconexão: ao evento `online`, refazer a busca e remover o aviso.
5. Testes de offline/reconexão somente com harness (fetch simulado e `online`/`offline` disparados no teste), sem rede ou produção reais.
6. Sem deploy sem autorização explícita.
