# Painel operacional read-only: avaliação técnica (issue #92)

## Conclusão

Não existe painel nem API administrativa. Existe a **fonte de dados** para um painel (o estado operacional do robô), mas não existe a **camada de autorização** que o pedido exige. Por isso esta entrega é só a avaliação: nenhum painel paralelo foi criado e nada foi publicado.

## O que existe

- **Estado por rodada** (`src/opstate.js`, gravado em `data/meta.json → ops`): última rodada e último saudável, duração, resultado (`ok`/`parcial`), lojas (ativas, com anúncios, vazias, bloqueadas, com erro, adiadas), fontes vigiadas, leitor oficial, sincronização com o banco, `issues` e `health`. Guarda as últimas 96 rodadas. São só números, status e horários; textos livres passam por `clean()`, que remove URL de conexão e token.
- **Vigia** (`src/ops-watch.js`, `tools/watchdog.mjs`, `.github/workflows/watchdog.yml`): calcula `saudavel`/`degradado`/`parado`/`desconhecido` e avisa por canal externo (ver `docs/vigia.md`).
- **Frescor** (`api/_lib/freshness.mjs`): a API pública já informa `atual`/`atrasado`/`desatualizado`/`indisponivel` por resposta.

## O que não existe

- Rota administrativa em `api/` (o `api/v1.mjs` só tem leitura pública e com cache de CDN).
- Qualquer mecanismo de autenticação ou autorização na API (sem login, sem token, sem perfis).
- Leitura de `meta.json` pela API (ela lê o banco e o `state.json`).

## Por que não foi implementado agora

1. Um endpoint novo teria de decidir quem é "usuário comum" e quem é operador. Sem identidade no projeto, isso exigiria criar um segredo de acesso (variável de ambiente na Vercel), o que depende do dono da conta e de deploy. Ambos estão fora do escopo.
2. O `api/v1.mjs` responde com `Cache-Control: public` e cache em memória por URL. Uma rota restrita nele correria o risco de ser servida a todos pela CDN.
3. A Vercel no plano gratuito limita o número de funções. Uma função separada não é desejável e, se for na `v1.mjs`, exige o cuidado do item 2.

## Proposta para a implementação (próxima etapa, depende de decisão do dono)

1. Rota `GET /api/v1/admin/saude` dentro de `api/v1.mjs`, sempre com `Cache-Control: no-store` e fora do cache de memória.
2. Autorização por segredo no cabeçalho `Authorization: Bearer`, comparado em tempo constante com uma variável de ambiente. Variável ausente: a rota responde 404 (desligada). Credencial ausente ou errada: 401, sem detalhes.
3. Fonte: `ops` de `meta.json` do ramo `data`, com leitura por lista de campos permitidos (nunca repassar o objeto inteiro). Expor: horário da última execução, `result`, `health`, `durationSec`, contagens de lojas e ofertas, status do leitor e da sincronização e `issues`. Não expor: `runId`, `sha`, `reason` livre, `lastInvalid`, cabeçalhos, logs.
4. Dados ausentes ou ilegíveis: resposta 200 com `estado: "desconhecido"` e campos nulos. Dados publicados há mais de 45 min: `estado: "parado"`, calculado pelas mesmas regras de `RULES` em `src/ops-watch.js` (reaproveitar, não duplicar).
5. Somente leitura: apenas GET, sem ação de reexecução ou retry.
6. Testes: sem credencial (401), credencial errada (401), rota desligada (404), `meta.json` ausente/ilegível, motor parado, e sanitização (nenhum campo fora da lista, nenhuma URL de conexão ou token na resposta). Seguir o padrão de `test/api-tests.js` e `test/ops-detection-tests.js`.
7. Interface: só depois da API, e como página estática simples que consome a rota. Sem painel separado.

## Decisões necessárias do dono

- Aprovar o modelo de segredo único em variável de ambiente (ou indicar outro).
- Criar a variável na Vercel e fazer o deploy (fora do alcance do executor).
