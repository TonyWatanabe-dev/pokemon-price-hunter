# Social Media — runbook de operação e incidentes (MVP rascunho)

Issue #660; escopo das #560/#631 (decisão de 13/10/2026 em `docs/ROADMAP-OPERACIONAL.md`). Complementa as regras e a moderação da comunidade em `docs/social-comunidade.md`.
Este runbook descreve **só o que existe no código** em `src/agents/social/`. O que ainda não existe aparece como lacuna, nunca como passo.

## O que existe e o que não existe

| Etapa | Módulo | Função principal | Confere `SOCIAL_ENABLED`? |
|---|---|---|---|
| Ofertas elegíveis, dedupe e aviso de afiliado | `src/agents/social/elegiveis.js` | `selecionarElegiveis`, `ofertaElegivel`, `chaveDedupe`, `exigeDisclosure` | não (exporta `socialHabilitado`; quem chama confere) |
| Texto do rascunho | `src/agents/social/rascunho.js` | `gerarRascunho` | não (exporta `socialEnabled`; quem chama confere) |
| Modelos editoriais (oferta do dia, queda de preço, reposição, comparação) | `src/agents/social/modelos.js` | `verificarModelo`, `modelosElegiveis`, `gerarPost` (texto final via `gerarRascunho`) | não (reexporta `socialEnabled`; quem chama confere) |
| Fila, calendário e kill switch | `src/agents/social/fila.js` | `enfileirar`, `aprovar`, `rejeitar`, `agendar`, `pausado`, `paraJson`, `deJson` | só `agendar` (devolve `desligado`) |
| Aprovação humana e auditoria | `src/agents/social/aprovacao.js` | `decidir`, `aprovacaoValida`, `verificarTrilha`, `ultimoHash` | sim (`decidir` falha fechado) |
| Link geral de afiliado do canal | `src/agents/social/afiliados.js` + `config/social-afiliados.json` | `linkParaPost`, `loadConfig` | não |
| Classificador de mensagens da comunidade | `src/agents/social/moderacao.js` | `classificarMensagem`, `hostsDeLojas` | não (exporta `socialHabilitado`) |

**Não existe:** publicador, chamada a API de Telegram/Instagram/WhatsApp, comando de CLI, serviço ou cron que rode esses módulos, nem persistência da fila ou da trilha. Os módulos são funções puras: o estado (fila, trilha, `env`) é passado por quem chama. Na fila, a transição para `publicado` é sempre recusada (`TRANSICOES` em `fila.js`).

### Ligar e desligar
- **Desligado por padrão.** `SOCIAL_ENABLED` ausente = desligado em todos os módulos.
- Para ligar, use **`SOCIAL_ENABLED=1`**. Os módulos divergem no valor `true`: `fila.js`, `aprovacao.js`, `afiliados.js` e `moderacao.js` aceitam `1` ou `true`; `elegiveis.js` e `rascunho.js` aceitam **só** `1`. Com `true`, parte do fluxo ficaria desligada.
- Desligar = remover `SOCIAL_ENABLED` (ou qualquer valor diferente de `1`) do ambiente do processo que chama os módulos.

## Gerar prévia

A prévia é local e só lê um `state.json` (o mesmo formato publicado na branch `data`). Não acessa banco, não publica e não lê secrets.

1. Na raiz de um clone atualizado da `main`, obtenha um `state.json` recente. O de `data/state.json` no clone pode estar velho; o publicado fica na branch `data`: `git fetch origin data && git show origin/data:data/state.json > /tmp/state.json`.
2. Salve o script abaixo fora do repositório (por exemplo `/tmp/previa-social.mjs`) e rode na raiz do clone: `node --input-type=module - /tmp/state.json < /tmp/previa-social.mjs`.
3. O script mostra quantas ofertas foram recusadas (com os motivos de `MOTIVOS` em `elegiveis.js`) e até 3 rascunhos de Telegram, com a chave de dedupe e os avisos de cada um.

<!-- previa:inicio -->
```js
import fs from 'node:fs';
import { selecionarElegiveis, chaveDedupe, exigeDisclosure } from './src/agents/social/elegiveis.js';
import { gerarRascunho } from './src/agents/social/rascunho.js';
import { slugs } from './api/_seo.mjs';

const s = JSON.parse(fs.readFileSync(process.argv[2] || 'data/state.json', 'utf8'));
const now = process.env.PREVIA_NOW ? Date.parse(process.env.PREVIA_NOW) : Date.now();
const P = Object.fromEntries(s.products.map((p) => [p.id, p]));
const { of: slug } = slugs(s.products);
const { elegiveis, recusadas } = selecionarElegiveis(s.offers, { now, limite: 3 });
console.log('recusadas:', recusadas.length, [...new Set(recusadas.map((r) => r.motivo))].join(' | '));
for (const o of elegiveis) {
  const r = gerarRascunho({
    produto: { nome: P[o.productId]?.name, slug: slug[o.productId] }, loja: { nome: o.storeName },
    preco: o.price, precoTotal: o.shippingKnown ? o.total : null, url: o.url, disclosure: exigeDisclosure(o.url),
    lidaEm: o.source_timestamp,
  }, { canal: 'telegram', siteUrl: 'https://tcg-price-hunter.vercel.app' });
  console.log(`\n--- ${chaveDedupe(o)} · avisos: ${r.avisos.join('; ') || 'nenhum'}\n${r.texto}`);
}
```
<!-- previa:fim -->

Como ler o resultado:
- **Nenhum rascunho** com `frescor não atual` nas recusas = o `state.json` está velho. Só a leitura "atual" (até 30 min, `LIMITS` de `api/_lib/freshness.mjs`) vira rascunho. Não troque o `now` para "fazer passar".
- `gerarRascunho` lança erro em vez de gerar texto duvidoso (preço inválido, URL sem https, slug inválido, canal desconhecido). Erro = não há rascunho daquela oferta.
- Avisos (`frete desconhecido`, `texto da loja limpo`, `nome truncado`, `sem data de leitura`) exigem leitura atenta antes de aprovar.
- O link do post é a página do produto no site; a frase de afiliado (`DISCLOSURE`) só entra quando `exigeDisclosure` reconhece o destino como link de afiliado (`api/_lib/affiliates.mjs`). Afiliado nunca muda a seleção nem a ordem (`byComparableTotal`, a mesma da API).
- Instagram: troque `canal: 'instagram'` (limite de 2.200 caracteres; o link vira "na bio").

## Aprovar ou rejeitar

1. Coloque o rascunho na fila com `enfileirar(fila, { canal, chaveDedupe, texto }, { now })`. Mesmo `canal` + `chaveDedupe` em menos de 24 h (`PADROES.janelaRepeticaoHoras`), em qualquer estado, volta `status: 'duplicado'` e a fila não muda.
2. A decisão humana passa por `decidir(item, { decisao: 'aprovar' | 'rejeitar', operador, motivo, now, trilha, env })` de `aprovacao.js`. Ela exige `SOCIAL_ENABLED=1`, operador autorizado (`TAREFAS_OPERADORES` ou, na falta, o dono do repositório) e **motivo para rejeitar**; item já decidido não muda. Toda falha devolve `ok: false` sem gerar evento.
3. Guarde o `evento` devolvido no fim da trilha (append-only, encadeada por sha256) e o `ultimoHash(trilha)` **em lugar separado**: só a âncora detecta evento removido no fim (`verificarTrilha(trilha, { ultimoHash })`).
4. Reflita a decisão na fila com `aprovar` / `rejeitar` usando o mesmo `id`. Atenção: `aprovar`/`rejeitar` da fila **não** conferem operador nem geram auditoria; sozinhos não valem como aprovação.
5. A aprovação fixa o texto pelo hash: editar o texto depois faz `aprovacaoValida(item, { trilha })` devolver `false`. Texto editado = novo rascunho e nova decisão.
6. Calendário: `agendar(fila, { canal, now, env })` sugere horários só para itens aprovados, com no máximo 3 por dia, 120 min de intervalo e janela de 24 h (`PADROES`, dia contado em UTC−3). Desligado devolve `desligado`; pausado devolve `pausado`; item sem vaga vai para `semVaga`. Persistir a fila (`paraJson` / `deJson`) é decisão de quem chama; JSON corrompido lança erro e nunca é aceito parcialmente.

## Pausar um canal (`SOCIAL_PAUSA`)

- `SOCIAL_PAUSA=telegram` pausa o Telegram; vários canais separados por vírgula, ponto e vírgula ou espaço (`telegram,instagram`); `SOCIAL_PAUSA=todos` pausa tudo. Não diferencia maiúsculas.
- Efeito no código atual: `pausado(canal, env)` fica `true` e `agendar` não sugere horário (`status: 'pausado'`).
- O que a pausa **não** faz: não remove o `agendadoPara` já gravado, não impede `enfileirar` nem `decidir`, e não apaga nada. Para tirar um item agendado do ar enquanto não houver publicador, basta não publicá-lo; quando houver, o publicador precisa conferir `habilitado(env)` e `pausado(canal, env)` imediatamente antes de cada envio (ver checklist).
- Despausar: remover o canal da lista (ou a variável inteira).
- Desligar tudo: remover `SOCIAL_ENABLED`. É o rollback mais amplo e não perde dados.

## Incidentes

Em todos os casos: registre o que aconteceu, quando e quem decidiu na issue do incidente (sem dados pessoais, sem secrets). Decisões de rascunho entram na trilha via `decidir`.

### Post errado (texto, preço, loja ou produto incorretos)
1. **Pause o canal** (`SOCIAL_PAUSA=<canal>`).
2. Ainda é `rascunho`: rejeite com motivo (`decidir` com `decisao: 'rejeitar'`).
3. Já foi `aprovado`: a decisão não volta atrás (`TRANSICOES.aprovado` é vazio e `decidir` responde "item já decidido"). Não publique e não edite o texto para "consertar": a edição invalida a aprovação (`aprovacaoValida` = `false`). Registre o motivo na issue.
4. Um rascunho corrigido da **mesma oferta** volta como `duplicado` por até 24 h (a chave é produto + loja + preço em centavos). Não altere a chave nem a janela para forçar; se o preço mudou, a chave nova já passa.
5. Se a causa for dado de produto, loja ou casamento errado, abra issue para o agente responsável (catálogo, coletor, preço); o Social não corrige dado.
6. Publicação manual no piloto (quando existir) é removida manualmente por quem tem acesso à conta, e o fato é registrado na issue.

### Golpe na comunidade
1. Siga `docs/social-comunidade.md`: `classificarMensagem` só sugere (`ok` / `suspeito` / `golpe`); **nenhuma ação é automática**.
2. `nivel = 'golpe'` ou qualquer item da lista "Escalonar imediatamente" daquele documento: avise o moderador/proprietário na hora. Ocultar, apagar, advertir ou remover membro é sempre decisão de um moderador humano.
3. Não clique no link nem interaja com o golpista. Se alguém relatar que já pagou, oriente boletim de ocorrência e contato com o banco (MED do Pix), como no FAQ.
4. Lojas de `config/stores.json` só contam como hosts conhecidos se forem passadas por `hostsDeLojas(...)` em `opts.hostsConhecidos`; sem isso, links de loja legítima aparecem como `link-desconhecido`.

### Link quebrado
- **Link do post** (página do produto): é `siteUrl` + `/produto/` + slug. O slug amigável vem de `slugs()` em `api/_seo.mjs`, o mesmo algoritmo do site; `api/pagina.mjs` também aceita o `productId`. Slugs repetidos ganham sufixo (`-2`) pela ordem de `offerCount`, então o sufixo pode mudar entre rodadas. Rascunho com link que não abre: rejeite com motivo e gere de novo a partir de um `state.json` atual.
- **Link da oferta** (loja): `ofertaElegivel` só confere que é `https` e não tem credencial; não testa se a página existe. Loja fora do ar ou anúncio removido: rejeite e deixe o coletor reavaliar na próxima rodada.
- **Link geral de afiliado do canal** (`config/social-afiliados.json`): `loadConfig` lança erro com config inválida, falha fechado. Link geral quebrado: corrija ou remova a entrada por PR. Nunca encurte, monte ou reescreva o link (`validarLink` exige o host exato do marketplace); o link geral nunca substitui o link de um anúncio (`linkParaPost`).

### Dado desatualizado
1. A seleção só aceita frescor "atual" no momento em que roda, mas **nada reconfere o frescor depois**: um rascunho aprovado horas antes já pode estar velho. O texto mostra "Preço visto em …" (`lidaEm`).
2. Antes de aprovar, rode de novo `ofertaElegivel(oferta, { now })` com a oferta atual do `state.json`; se não estiver `ok`, rejeite com o motivo devolvido (`frescor não atual`, `estoque não confirmado`, `oferta pendente/stale`…).
3. Robô parado ou dados todos velhos (prévia sem nenhum rascunho por frescor): pause os canais e siga `docs/runbook.md` e `docs/frescor.md`. Não publique com dado velho nem mude o `now` da seleção.

## Checklist antes do piloto Telegram

Marque só com evidência (link de PR, CI ou issue). Item sem evidência = piloto bloqueado.

**Código e testes**
- [ ] `npm test` verde na `main`, incluindo `test/social-*-tests.js`.
- [ ] Publicador implementado em PR própria, com `publicado` liberado em `fila.js` só para item com `aprovacaoValida(item, { trilha })` = `true`, e conferindo `habilitado(env)`, `pausado(canal, env)` e `ofertaElegivel` imediatamente antes de cada envio. Hoje nada disso existe; publicação externa passa pelo Release Governor (`docs/agentes.md`) e pela autorização do proprietário.
- [ ] Persistência definida para a fila e para a trilha, com o `ultimoHash` guardado à parte, fora do banco de produção.
- [ ] Ambiente com `SOCIAL_ENABLED=1` (não `true`, ver "Ligar e desligar") e `TAREFAS_OPERADORES` com os aprovadores.

**Kill switch e rollback**
- [ ] Testado em ensaio: `SOCIAL_PAUSA=telegram` e `SOCIAL_PAUSA=todos` fazem `agendar` devolver `pausado` e o publicador não envia.
- [ ] Rollback documentado na issue do piloto: `SOCIAL_PAUSA=todos` imediato, depois remover `SOCIAL_ENABLED`.

**Links e afiliados**
- [ ] Links gerais de `config/social-afiliados.json` conferidos manualmente e `validado` marcado `true` por PR (hoje Mercado Livre e Amazon estão `false`; Shopee pendente, sem entrada).
- [ ] Decidir o host `link.amazon`: o link geral da Amazon usa esse host, que não está em `HOSTS_CONHECIDOS_PADRAO` de `moderacao.js`. Hoje uma mensagem da equipe com esse link é classificada como `link-desconhecido` (`suspeito`).
- [ ] Amostra de rascunhos gerada pela prévia, com links abrindo e frase de afiliado presente quando o destino é afiliado.

**Conta e comunidade**
- [ ] Bot/canal oficial do Telegram criado pelo proprietário; credenciais só no mecanismo oficial de secrets da plataforma (nenhum agente lê ou copia).
- [ ] Moderadores humanos nomeados; regras e boas-vindas de `docs/social-comunidade.md` fixadas no canal.
- [ ] Limites de frequência revisados (`PADROES`: 3 por dia, 120 min, 24 h de janela e de repetição).
- [ ] Gates de operação (#612, #231, #271) conferidos: dado incerto bloqueia publicação promocional (`docs/ROADMAP-OPERACIONAL.md`).
