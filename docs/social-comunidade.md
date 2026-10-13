# Comunidade TCG Price Hunter — regras, FAQ e moderação

Base do Community Manager do MVP Social Media (issue #643; planejamento em #560; decisão de escopo de 13/10/2026 em #631 e em `docs/ROADMAP-OPERACIONAL.md`).
Escopo deste corte: texto das regras, mensagem de boas-vindas, FAQ e um **classificador determinístico** de mensagens suspeitas (`src/agents/social/moderacao.js`).
Nada aqui publica, chama API de Telegram/Instagram/WhatsApp, acessa rede, banco ou secrets. O módulo vem **desativado por padrão** (`SOCIAL_ENABLED` ausente = desligado).

## Regras da comunidade

1. **Respeito.** Sem ofensa, discriminação, assédio ou exposição de dados pessoais de ninguém.
2. **Só Pokémon TCG.** Ofertas, dúvidas de produto, coleções e preços. Sem correntes, apostas, criptomoeda ou assunto fora do tema.
3. **Ofertas com fonte.** Compartilhe o link da loja ou o link do próprio TCG Price Hunter. "Pré-venda" ou preço sem fonte não é oferta.
4. **Nada de negociação no grupo.** Não peça nem ofereça Pix, depósito, "sinal" ou pagamento antecipado a pessoas. Compre na loja, pelo checkout da loja.
5. **Nunca peça nem passe senha ou código.** Ninguém da equipe pede senha, código de verificação (SMS, WhatsApp, e-mail), token ou dado de cartão.
6. **Sem links encurtados ou desconhecidos.** Use o link completo da loja. Links que escondem o destino podem ser removidos após revisão.
7. **Sem divulgação de telefone/WhatsApp de terceiros** nem convites para "chamar no privado" para vender.
8. **Transparência de afiliados.** Quando um link do TCG Price Hunter for de afiliado, isso é dito na mensagem. A comissão nunca muda preço, ranking, melhor oferta ou nota.

Quem descumprir pode ter a mensagem ocultada ou ser removido, **sempre por decisão de um moderador humano** (ver "Quando escalonar").

## Mensagem de boas-vindas

> Bem-vindo(a) à comunidade **TCG Price Hunter**! Aqui compartilhamos ofertas de Pokémon TCG em lojas brasileiras, comparadas com o preço sugerido Copag.
> Antes de participar, leia as regras fixadas. Três lembretes importantes:
> • Nunca pague Pix ou "sinal" para pessoas: compre sempre pelo site da loja.
> • Ninguém da equipe pede senha ou código de verificação.
> • Viu algo estranho? Avise um moderador (no privado ou marcando-o na resposta).
> Alguns links do TCG Price Hunter são de afiliado e isso é sempre indicado; a comissão não muda preço nem ordem das ofertas.

## FAQ

**O que é o TCG Price Hunter?**
Um site que coleta preços de produtos Pokémon TCG em lojas brasileiras e mostra quanto abaixo (ou acima) do preço sugerido Copag dá para comprar agora, com frete, estoque e reputação da loja.

**Como os preços são verificados?**
Um robô lê as páginas das lojas em rodadas periódicas, respeitando o `robots.txt`, e casa cada anúncio com o catálogo (coleção + tipo + quantidade de boosters; na dúvida, não casa). Cada preço mostra a hora da última leitura real. Leitura antiga ou que falhou aparece marcada como "Leitura antiga"/desconhecida, nunca como recente (regras em `docs/frescor.md`). Mesmo assim, o preço final é sempre o da loja no momento da compra.

**O site ganha comissão?**
Alguns links podem ser de afiliado (por exemplo, Mercado Livre e Amazon). Isso é sempre sinalizado. A comissão **não** entra em ranking, melhor oferta, preço, frete, estoque nem nota: os links vêm só da configuração validada de afiliados (`config/affiliates.json`, lida por `api/_lib/affiliates.mjs`; detalhes em `docs/afiliados.md`).

**Vocês vendem produtos?**
Não. O TCG Price Hunter não vende, não recebe pagamento e não faz pré-venda. Quem oferecer isso em nome do site é golpe.

**Como reportar um golpe?**
Avise um moderador, no privado ou marcando-o em resposta à mensagem suspeita (ainda não há comando de denúncia automatizado). Não clique no link, não pague e não passe nenhum código. Se já pagou, registre boletim de ocorrência e fale com o seu banco (Pix tem o Mecanismo Especial de Devolução, MED).

## Classificador de mensagens (`src/agents/social/moderacao.js`)

`classificarMensagem(texto, opts?)` → `{ nivel: 'ok' | 'suspeito' | 'golpe', motivos: [{ regra, nivel, descricao, trecho }] }`.
Só classifica e devolve motivos: **não bane, não apaga, não responde**. Texto vazio, só espaços ou que não é string → `ok` sem motivos. O nível é o da regra mais grave que casou.

| Regra | Nível | Quando casa |
|---|---|---|
| `pix-antecipado` | golpe | Pedido de Pix a uma pessoa ("me manda um Pix", "minha chave Pix", "faz o Pix pra…") ou pagamento/Pix antecipado, adiantado, "na frente", "pra reservar". "Aceita Pix?" não casa. |
| `pedido-senha-codigo` | golpe | Verbo de pedido ("passa", "manda", "informa", "qual sua"…) seguido de senha, código de verificação/SMS/WhatsApp, token, 2FA, OTP ou CVV. |
| `link-encurtado` | suspeito | Host de encurtador público (bit.ly, tinyurl, cutt.ly, amzn.to…) fora da lista de hosts conhecidos. |
| `link-desconhecido` | suspeito | Link (com ou sem `https://`) cujo host não está na lista de conhecidos. Homógrafos (`mercadolívre.com.br`, letras cirílicas) e `usuário@host` caem aqui. |
| `pre-venda-sem-fonte` | suspeito | "Pré-venda", "encomenda/reserva antecipada" sem nenhum link de host conhecido na mesma mensagem. |
| `contato-terceiro` | suspeito | Telefone brasileiro com DDD, link `wa.me`/`whatsapp.com` ou "chama no zap/whats". Telefones em `opts.telefonesConhecidos` não contam. |

Detalhes:
- **Hosts conhecidos:** o próprio site, os destinos de afiliado já aceitos por `api/_lib/affiliates.mjs` e pela Amazon (`config/afiliados/amazon.json`) e a loja oficial Copag. As lojas de `config/stores.json` entram por `opts.hostsConhecidos`, usando `hostsDeLojas(conteúdoDoStoresJson)` (o módulo não lê arquivo). Subdomínio de host conhecido também é conhecido; `mercadolivre.com.br.golpe.xyz` não é.
- **Unicode:** o texto é normalizado (NFKC, sem caracteres invisíveis) antes das regras; as regras de palavras ignoram acento e caixa. Os links são extraídos antes de remover acentos, para que homógrafos não virem hosts conhecidos.
- **Avisos não são pedidos:** "nunca passe sua senha" ou "não mande Pix para chave de ninguém" não casam.
- **Limites:** regras fixas e explícitas, sem IA e sem rede. Haverá falso positivo e falso negativo; por isso nenhuma ação é automática.

## Quando escalonar para humano

O resultado do classificador é só uma sugestão para a fila de revisão. Toda ação (ocultar, apagar, advertir, remover membro, responder) exige aprovação de um moderador humano e registro na trilha de auditoria do MVP.

Escalonar **imediatamente** ao moderador/proprietário quando:
- `nivel = 'golpe'` (pedido de Pix/pagamento antecipado ou de senha/código);
- alguém se passar pelo TCG Price Hunter, pela equipe ou por uma loja;
- um membro relatar que já pagou, perdeu acesso a conta ou passou código;
- houver ameaça, assédio, conteúdo ilegal ou exposição de dados pessoais;
- surgir dúvida sobre afiliados, preço exibido errado ou reclamação contra loja.

Mensagens `suspeito` entram na fila normal de revisão. Mensagens `ok` não geram ação.
