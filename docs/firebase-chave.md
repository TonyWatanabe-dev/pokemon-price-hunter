# Chave de API do Firebase (alerta de secret scanning #1)

## O que é

A chave apontada pelo GitHub é a `apiKey` da **configuração web do Firebase** (projeto `tcg-price-hunter`). Ela aparece em:

| Arquivo | Papel |
|---|---|
| `tools/account.src.js` | fonte da configuração (`initializeApp`) |
| `account.js` | pacote gerado por `tools/build-account.mjs` e servido em `/account.js` |

Ela é **pública por natureza**: todo navegador que abre a conta baixa `account.js` com a chave. Tirar do repositório, ou passar para uma variável de ambiente do front, **não** a torna secreta, porque ela continua no pacote enviado ao navegador. A chave só identifica o projeto. Quem protege são:

1. as **restrições da chave** no Google Cloud (quais sites podem usá-la e quais APIs ela chama);
2. as **regras do Firestore** (`firebase/firestore.rules`);
3. as configurações do **Authentication** (domínios autorizados, provedores, proteção contra enumeração de e-mail).

O risco real de uma chave sem restrição é outra API ativada no mesmo projeto (por exemplo Gemini/Generative Language, Maps) ser usada por terceiros com cobrança no projeto.

`test/firebase-key-tests.js` garante que só existe essa chave, só nesses dois arquivos, igual nos dois, e que nenhum código de servidor, workflow ou dado carrega chave do Google.

## Restringir a chave atual (sem derrubar o login)

Google Cloud Console → projeto **tcg-price-hunter** → **APIs e serviços → Credenciais** → **Chaves de API** → a chave chamada "Browser key (auto created by Firebase)" (confira os 4 primeiros e os últimos caracteres com o valor de `tools/account.src.js`).

1. **Restrições de aplicativo → Sites (referenciadores HTTP)**:
   - `https://tcg-price-hunter.vercel.app/*`
   - `https://tcg-price-hunter-*-tonywatanabeart-1457s-projects.vercel.app/*` (Previews; só se forem usados para login)
   - `https://tcg-price-hunter.firebaseapp.com/*` e `https://tcg-price-hunter.web.app/*` (página de login do Firebase)
   - `http://localhost/*` e `http://127.0.0.1/*` apenas se você testa login localmente
2. **Restrições de API → Restringir chave** e marcar só:
   - Identity Toolkit API
   - Token Service API
   - Cloud Firestore API
3. Salvar. A mudança leva alguns minutos. Logo depois, testar no site: entrar com Google, entrar com e-mail, salvar um favorito, sair.

Se o login quebrar: voltar a restrição de aplicativo para "Nenhuma" (mantendo a restrição de API) e conferir o erro no console do navegador. Um erro `API_KEY_HTTP_REFERRER_BLOCKED` indica um endereço que faltou na lista.

## Substituir a chave (se houver sinal de abuso)

Ordem para não interromper o serviço:

1. Credenciais → **Criar credenciais → Chave de API**, já com as mesmas restrições acima.
2. Trocar só a linha `apiKey` em `tools/account.src.js`.
3. Regerar o pacote com as mesmas versões do pacote atual, que reproduzem `account.js` byte a byte:
   ```bash
   mkdir -p /tmp/fbnm && cd /tmp/fbnm && npm init -y && npm i firebase@12.19.0 esbuild@0.28.2
   cd <repositório> && node tools/build-account.mjs /tmp/fbnm/node_modules
   npm test
   ```
4. PR → merge → deploy (com autorização). Testar o login em produção.
5. Só então **excluir a chave antiga** em Credenciais. Ela continua no histórico do Git para sempre, por isso precisa ser excluída, não só substituída.

## Onde procurar sinais de uso indevido

- **APIs e serviços → Painel**: tráfego por API. Qualquer API diferente das três acima com chamadas é sinal de abuso.
- **APIs e serviços → Credenciais → (a chave) → Métricas**: chamadas por API e por dia.
- **Faturamento → Relatórios**: custos por serviço; criar um **Orçamento e alerta** (ex.: R$ 10) se ainda não existir.
- **Firebase → Authentication → Usuários**: contas criadas em massa ou com e-mails estranhos.
- **Firebase → Firestore → Uso**: leituras e gravações fora do normal.

## Authentication e regras

- Firebase → Authentication → **Configurações → Domínios autorizados**: só o domínio de produção, `tcg-price-hunter.firebaseapp.com` e os Previews realmente usados.
- Authentication → Configurações → **Proteção contra enumeração de e-mail**: ativada.
- Firestore → **Regras**: publicar `firebase/firestore.rules` seguindo `docs/firestore-regras.md` (o console ainda pode estar com regras antigas ou em modo de teste).
- Storage: o site não usa. Se o bucket existir, as regras devem negar tudo (`allow read, write: if false;`).

## Encerrar o alerta

Depois de restringir a chave (ou substituí-la e excluir a antiga): GitHub → **Security → Secret scanning → alerta #1 → Close as**:
- **Revoked**, se a chave foi substituída e a antiga excluída;
- **Won't fix**, se a chave atual ficou, já restrita (motivo: "chave web do Firebase, pública por natureza, restrita a sites e APIs").
