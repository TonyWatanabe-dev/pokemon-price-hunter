# Alertas por usuário no Telegram

Decisão do proprietário (15/10/2026): cada conta pode receber os **próprios** alertas de preço no Telegram, pelo bot que já existe. **Desligado por padrão.**

## Fluxo

1. No site, em **Alertas de preço**, a pessoa logada toca **Ativar alertas no Telegram** (o bloco só aparece quando o robô publica o nome do bot em `state.json` → `telegramUsuario.bot`, ou seja, com o recurso ligado).
2. A página sorteia um segredo de 128 bits, grava em `users/{uid}.telegramPedido` **só** `{ hash: SHA-256 do segredo, criadoEm: ms }` e mostra o link `https://t.me/<bot>?start=<uid>_<segredo>`. O segredo fica só na aba (sessionStorage).
3. A pessoa abre o bot e toca **Iniciar**. Na rodada seguinte do robô (até ~15 min), o `/start <token>` é lido por `getUpdates`, o hash é conferido, a validade é medida pela hora da **mensagem** no Telegram (30 min desde `criadoEm`) e o robô grava `users/{uid}.telegram = { chatId, ligadoEm, hash, envios, dia, nDia }` e apaga o pedido **na mesma gravação**, com pré-condição de versão do documento (uso único). Esse `/start` é o consentimento explícito.
4. `/parar` desliga (apaga `telegram` de toda conta ligada àquele chat). `/status` mostra o estado. No site, **Desligar** grava `telegram: null`.
5. Se a pessoa bloquear o bot (HTTP 403 no envio), o vínculo é apagado.

Só conversas privadas são aceitas. Nenhum e-mail ou telefone é guardado; só o número da conversa (chat_id).

## Arquitetura

| Peça | Onde |
|---|---|
| Comandos `/start`, `/parar`, `/status` | `src/telegram-usuario.js` (`tratarComando`), chamado de `src/inbox.js` |
| Leitura de comandos | o `getUpdates` que a rodada **já faz** (`processInbox`), offset em `data/inbox.json` |
| Envio | `src/telegram-usuario.js` (`entregar`), chamado de `src/run.js` depois dos alertas do dono |
| Acesso ao Firestore | `src/firestore-rest.js` (REST + conta de serviço, JWT RS256 com `node:crypto`, sem dependência nova) |
| Regras | `firebase/firestore.rules` (campos `telegramPedido` e `telegram`) |
| UI | `index.html` (`tgBox`, página `/alertas`) |

- **Por que na rodada e não num workflow próprio:** o GitHub Actions não recebe webhook, e a Bot API só aceita **um** leitor de `getUpdates` por bot. O bot de alertas já é lido a cada rodada pelo `processInbox` (encaminhar promoção). Um segundo workflow lendo o mesmo bot roubaria as mensagens do primeiro. Os comandos de usuário passam pelo mesmo laço, com o mesmo offset; repetir um update (rodada que caiu antes de gravar o offset) é idempotente (`/start` repetido responde "já ligado" sem mudar nada).
- **Envio = o mesmo emissor:** os alertas do documento (`alerts: [{ p, v }]`) viram regras de preço-alvo e passam por `evaluate` → `dedupe` (cooldown e "preço melhor") → `capPerUser` (limite diário, agora em uso) → `compose`, de `src/alerts.js`. Cada usuário é avaliado só com as próprias regras e só o próprio `chatId` recebe: um usuário nunca recebe alerta de outro.
- **Retry sem duplicação:** antes de enviar, o robô reserva os envios em `telegram.envios` (estado `enviando`) com pré-condição de versão. Envio com falha desfaz a reserva (a condição persiste e a rodada seguinte tenta). Se a confirmação falhar depois de enviar, a reserva fica e conta como enviado: no pior caso um aviso se perde até o fim do cooldown, nunca sai em dobro. Telegram falhando 2 vezes seguidas para os envios da rodada (`CHANNEL_DOWN_AFTER`).
- **Registro privado:** o registro de envios fica dentro de `users/{uid}.telegram` (some ao desligar ou excluir a conta), nunca no ramo `data` (público). O log da Action só mostra contagens.

### Qual bot

Escolhido: **o bot de alertas (`TELEGRAM_BOT_TOKEN`)**, não o social (`SOCIAL_TELEGRAM_BOT_TOKEN`).

- É o bot que já entrega alertas de preço e já é lido por `getUpdates` na rodada; usar o social exigiria um segundo leitor de `getUpdates` e misturaria o canal público da marca com conversas privadas.
- O secret do bot social só existe nos workflows sociais; não foi preciso levá-lo para a caça.
- Consequência: o bot de alertas passa a conversar com o público. Ajuste nome, foto e descrição no @BotFather antes de ligar. Os alertas do dono (`TELEGRAM_CHAT_ID`) e o "encaminhar promoção" continuam iguais, só no chat do dono.
- Alternativa (não implementada): um bot dedicado com secret próprio, trocando `TELEGRAM_BOT_TOKEN` por outro nome em `contexto()` e no `processInbox` — exigiria um segundo leitor de `getUpdates`, então só faz sentido com um bot novo.

### Postgres

`price_alert`/`alert_delivery` (db/migrations/001_core.sql) **não** são usados: o site grava os alertas no Firestore (`users/{uid}.alerts`) e nada alimenta essas tabelas. Nenhuma migration foi criada.

## O que o proprietário precisa configurar

1. **Firebase → conta de serviço**: Google Cloud Console do projeto `tcg-price-hunter` → IAM → Contas de serviço → criar uma conta só para isso, com o papel **Cloud Datastore User** (`roles/datastore.user`), e gerar uma chave JSON.
2. **GitHub → Settings → Secrets and variables → Actions → Secrets**: `FIREBASE_SERVICE_ACCOUNT` = conteúdo do JSON. Só a etapa "Caçar preços" do `hunter.yml` recebe.
3. **Publicar as regras** de `firebase/firestore.rules` (passo a passo em `docs/firestore-regras.md`) **antes** de ligar: sem elas, o site não consegue gravar `telegramPedido`.
4. **@BotFather**: nome, descrição e comandos do bot de alertas (`/status`, `/parar`).
5. **Ligar**: Variables → `ALERTAS_TELEGRAM_USUARIO` = `1`. Opcional: `ALERTAS_TELEGRAM_USUARIO_MAX_DIA` (padrão 10, teto 50).
6. **Desligar (kill switch)**: apagar a variável ou pôr outro valor. Na rodada seguinte o robô para de ler comandos de terceiros, para de enviar e o botão some do site.

## Limitações

- Latência: confirmação e alertas saem na rodada (~15 min). Se a rodada for pulada pelo intervalo mínimo, espera a próxima.
- Até `MAX_USUARIOS` (500) usuários ligados e `MAX_COMANDOS` (50) comandos por rodada; acima disso precisa de paginação.
- Só alertas de preço-alvo (o que o site grava). Queda de preço e reposição continuam só no canal do dono.
- Cada envio faz duas gravações no Firestore (reserva e confirmação) por usuário com alerta na rodada.
- A conta de serviço ignora as regras do Firestore e alcança o banco inteiro; o código só toca `users/{uid}`. Restringir mais exige IAM Conditions.
- Regras novas exigem relógio do aparelho a até 2 min do servidor para gerar o link (a página avisa).
- Quem receber um link de ativação de outra pessoa e tocar Iniciar recebe os alertas da conta dela; `/parar` resolve.
- A elegibilidade é a do emissor (estoque confirmado, produto identificado), um pouco mais estrita que o "no seu preço" da página.
- O teste das regras no emulador (`firestore-regras.yml`) só roda no CI depois do push; aqui os casos foram atualizados em `firebase/test/casos.mjs`.
