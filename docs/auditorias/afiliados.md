# Auditoria de lacunas: links de afiliado e saída

Escopo: lacunas **atuais** em links de afiliado (Mercado Livre e Amazon) e links de saída. Não repete `docs/auditorias/seguranca.md` (`safeUrl`, `outUrl`, `outRel`) nem `docs/auditorias/api.md` (rota `/afiliados` sem teste pelo handler, tarefa 3). Regra de base: afiliado nunca influencia ranking nem nota.

## 1. Mapa

| Peça | Arquivo · trecho |
|---|---|
| Resolvedor ML (servidor) | `api/_lib/affiliates.mjs` · `mlListingId`, `validDestination`, `parseAffiliates`, `loadAffiliates`, `resolveOutbound`, `publicAffiliates` |
| Config ML | `config/affiliates.json` · `mercadolivre.anuncios` (hoje `{}`) e `geral` com `ativo:false`, `destinoConfirmado:false` |
| Rota pública | `api/v1.mjs` · `path[0] === 'afiliados'` → `publicAffiliates()` |
| Troca de destino (front) | `index.html` · `AFIL_OK`, `mlItem`, `outUrl`, `outRel` (~l.1468-1473) |
| Carga da config (front) | `index.html` · `loadAfil()` e `footAfil()` (~l.3253-3261) |
| Amazon | `config/afiliados/amazon.json` (`tag`, `links[]`), publicado em `/data/afiliados-amazon.json`; bloco "Também na Amazon" em `index.html` (~l.2367-2380), `rel="noopener nofollow sponsored"` |
| Amazon, lojas | `api/_lib/lojas.mjs` l.15-18: busca da Amazon é link comum, sem tag |
| Aviso | `api/_lib/guia.mjs` l.48 (FAQ), Termos (`index.html` ~l.2124), rodapé |
| Pistas (Telegram) | `src/tips.js` l.56: `href` externos extraídos do texto, fora do resolvedor |

## 2. O que já está coberto

| Regra | Teste |
|---|---|
| Id do anúncio, destino válido, config inválida/ausente, fallback para `o.url`, link geral nunca em anúncio | `test/affiliate-links-tests.js` (grupo 1) |
| Rota `/afiliados` sem banco | `test/affiliate-links-tests.js` (grupo 2) |
| `outUrl` real do `index.html` igual a `resolveOutbound` | `test/affiliate-links-tests.js` l.132 |
| Ranking, melhor oferta e score idênticos com/sem afiliado; `src/core/*` e `offer-rank.mjs` não citam o módulo | `test/affiliate-links-tests.js` (grupo 4, l.206) |
| Amazon: ASIN, URL exata `https://www.amazon.com.br/dp/<asin>?tag=<tag>`, data/hora do preço, `rel` sponsored, aviso | `test/amazon-links-tests.js` l.20-72 |
| `href` de saída só em forma aceita, `rel` com `noopener`, sem tracking | `test/outbound-links-tests.js` |

## 3. Lacunas priorizadas

1. **Servidor e navegador validam o destino em código duplicado.** `validDestination` (`affiliates.mjs` l.24-30) e `AFIL_OK` (`index.html` l.1469) são regras separadas. O teste de l.132 só cobre as entradas escolhidas. Sem teste de paridade com entradas hostis (porta, `@`, `//`, espaço, `http:`, host parecido), uma regra pode divergir da outra. Efeito: a URL do anúncio pode ser trocada por destino que o servidor recusaria.
2. **`resolveOutbound` só é chamado por testes.** `grep resolveOutbound` acha apenas `affiliates.mjs` e `test/affiliate-links-tests.js`. A produção usa a cópia `outUrl` do front. A referência testada não é o código que roda.
3. **Cliente aceita o que o servidor já filtrou, mas não reaplica `ativo`/`destinoConfirmado`.** `loadAfil` (l.3256) mostra `geral` se a URL passar em `AFIL_OK`. Hoje a garantia vem só do servidor (`parseAffiliates` l.42). Não há teste que prove que `footAfil` não renderiza com `geral:null`, nem que o rótulo é escapado.
4. **Amazon sem prazo de validade.** `amazon.json` tem `updatedAt` e `capturedAt`, mas a doc diz "Não é atualizado automaticamente". Nenhum teste falha se os preços ficarem muito velhos nem se `tag` mudar sem aviso. Efeito: preço antigo ao lado do botão de compra.
5. **`tag` Amazon fora de qualquer lista de checagem do cálculo.** `amazon-links-tests.js` prova que o front só usa o arquivo no bloco próprio, mas não varre `src/`, `api/` e `tools/` por `amazon.json`/`tag=`. `src/core/offer-key.js` remove `tag` de URLs de oferta, o que é correto, mas não há teste de que uma URL de oferta nunca chega com tag nossa.
6. **Pistas do Telegram ficam fora do resolvedor e sem `rel`.** `src/tips.js` l.56 só exclui `t.me`. Não há teste do `rel`/`safeUrl` desses links nem aviso de que não são afiliado. Já listado em `docs/afiliados.md` (Limitações), mas sem teste que trave o comportamento.
7. **Aviso de afiliado depende de texto livre.** O FAQ (`guia.mjs` l.48) afirma "quando ativados" para o ML. Nenhum teste liga o aviso ao estado de `anuncios` não vazio.

## 4. Tarefas pequenas e independentes (sem `index.html`)

| # | Tarefa | Arquivos | Risco | Aceite testável |
|---|---|---|---|---|
| 1 | Teste de paridade servidor × `AFIL_OK`: extrair a regex do `index.html` na leitura do teste e comparar com `validDestination` em ~30 entradas hostis e válidas | `test/affiliate-destination-parity-tests.js` (novo) | R0 | `npm test` passa; alterar um lado da regra em experimento local faz o teste falhar |
| 2 | Teste de `loadAfil`/`footAfil` do `index.html` em sandbox: `geral:null` não renderiza; rótulo com `<` sai escapado; `anuncios` inválidos ignorados | mesmo padrão de `test/affiliate-links-tests.js`, arquivo novo `test/affiliate-front-tests.js` | R0 | 3 asserts verdes; sem rede |
| 3 | Teste de frescor da Amazon: `updatedAt`/`capturedAt` com data válida, não futura, e aviso se passar de N dias (N fixo no teste) | `test/amazon-freshness-tests.js` (novo) | R0 | falha com data futura ou formato inválido; passa com o arquivo atual |
| 4 | Varredura de uso: nenhum arquivo de `src/`, `api/_lib/` (exceto `affiliates.mjs`) nem `tools/` lê `config/affiliates*`/`amazon.json` ou monta `tag=` | `test/affiliate-isolation-tests.js` (novo) | R0 | passa hoje; falha ao acrescentar leitura em `offer-rank.mjs` |
| 5 | Teste do FAQ/Termos: o texto de afiliado existe sempre que `amazon.json` tem links, e cita ML só como "quando ativados" | `test/affiliate-notice-tests.js` (novo) | R0 | passa hoje; falha se o aviso for removido |
| 6 | Teste de `src/tips.js`: links extraídos nunca contêm `tag=` nosso nem host de afiliado; documentar o comportamento | `test/tips-links-tests.js` (novo) | R1 | passa com HTML de exemplo; falha se a extração de links (`src/tips.js` l.56) anexar parâmetro |

Cada tarefa cria um arquivo `test/<nome>-tests.js` (descoberto por `test/run-all.mjs`). Nenhuma altera `package.json`, workflows, `config/` ou `data/`.
