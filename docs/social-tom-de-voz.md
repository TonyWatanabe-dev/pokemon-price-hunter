# Social Media — guia de tom de voz e hashtags (pt-BR)

Issue #655; escopo das #560/#631 (MVP **somente rascunho, prévia, aprovação humana e auditoria**). Vale para todo texto
de post, legenda e resposta da comunidade gerado ou revisado no fluxo de `docs/social-media.md`. Nada aqui publica, chama API
externa, lê secrets ou acessa banco. Desligado por padrão: `SOCIAL_ENABLED` ausente = desligado.

## Princípios

1. **Direto.** Produto, preço, loja e quando o preço foi visto, nessa ordem. Uma ideia por linha, sem enrolação.
2. **Verificável.** Só afirmar o que o dado mostra: preço lido, hora da leitura, estoque confirmado agora. Sem dado, não
   escreve (os modelos de `src/agents/social/modelos.js` recusam com motivo explícito).
3. **Sem clickbait.** Sem pressa artificial, sem exagero, sem CAIXA ALTA, sem fileira de emojis ou de pontos de exclamação.
4. **Sem futuro.** Nunca prometer estoque, reposição, preço ou queda futura. O post fala do que foi visto, não do que vai
   acontecer.
5. **Transparente.** Frase de afiliado quando o destino é afiliado (`DISCLOSURE` em `src/agents/social/rascunho.js`);
   comissão nunca muda ranking, preço, melhor oferta nem nota.
6. **Respeitoso com a comunidade.** Tratar por "você", português do Brasil correto, sem gíria ofensiva nem ironia com quem
   pergunta. Golpe e moderação seguem `docs/social-comunidade.md`.

## Frases fixas do gerador

O texto do rascunho já segue este guia; não reescreva estas frases à mão:

- `Confira preço, frete e estoque na loja antes de comprar.` (`AVISO_COMPRA`)
- `Preço visto em DD/MM/AAAA, HH:MM.` — sempre com a hora da leitura real.
- `(frete a calcular)` quando o frete é desconhecido; nunca "frete grátis" sem dado.
- Chamadas dos modelos: `Oferta do dia`, `Queda de preço: de R$ X em DD/MM/AAAA para R$ Y (N% menos)` (percentual arredondado
  para baixo), `De volta ao estoque: estava indisponível em DD/MM/AAAA`, `Comparação: menor total com frete entre N lojas comparadas`.

## Pode / não pode

| Use | Não use |
|---|---|
| "R$ 299,90 na Loja X · total com frete R$ 319,90" | "PREÇO IMPERDÍVEL!!!", "menor preço do Brasil" |
| "Preço visto em 14/10/2026, 09:30." | "agora", "neste momento" sem a hora da leitura |
| "De volta ao estoque: estava indisponível em 12/10/2026" | "vai esgotar", "últimas unidades", "corre que acaba" |
| "Queda de preço: de R$ 350,00 para R$ 299,90 (14% menos)" | "vai baixar mais", "vai subir amanhã", "aproveite antes que suba" |
| "Confira preço, frete e estoque na loja antes de comprar." | "garanta já", "só hoje", "última chance", "estoque garantido" |
| "Comparação: menor total com frete entre 3 lojas comparadas" | "a melhor loja", "a mais confiável" sem critério publicado |
| Nome do produto como está no catálogo | Insinuar parceria: "oficial", "em parceria com", "patrocinado por" |

Palavras e expressões proibidas em texto e hashtag: imperdível, corre, última chance, últimas unidades, só hoje, garanta já,
vai acabar, vai esgotar, vai baixar, vai subir, vai voltar, menor preço do Brasil, preço baixo garantido, queima, promoção
(quando a loja não declarou promoção). Em hashtag, a lista aplicada pelo código é `TERMOS_PROIBIDOS` em
`src/agents/social/hashtags.js`.

## Marcas de terceiros

- "Pokémon TCG" e os nomes de coleção do catálogo só **identificam o produto** (uso descritivo). Nunca sugerir afiliação,
  autorização ou patrocínio de Pokémon, Nintendo, The Pokémon Company, Copag ou de qualquer loja (`docs/MAPA-DE-AGENTES.md`).
- Nome de loja aparece só na linha de preço da oferta, nunca em hashtag ou chamada.
- Sem logotipo ou imagem de terceiros sem direito de uso.

## Hashtags (`src/agents/social/hashtags.js`)

`gerarHashtags(produto, { canal, marcas })` é determinístico: a mesma entrada gera sempre as mesmas hashtags, na mesma ordem.
A entrada é o produto do catálogo (`data/products.json`); texto livre de loja nunca vira hashtag.

- **Ordem de prioridade:** coleção (`collectionName`, ex.: `#EquilibrioPerfeito`), tipo (`TIPOS`, ex.: `#ETB`,
  `#BoosterBox`), `#PokemonTCG`, série (`series`, ex.: `#Megaevolucao`), `#TCGBrasil`, `#CartasPokemon`.
- **Formato:** CamelCase sem acento, só letras e dígitos; precisa ter letra; até 30 caracteres depois do `#` (`HASHTAG_MAX`).
  Maior que isso é descartada, nunca cortada.
- **Limite por canal** (`LIMITES_HASHTAGS`): Telegram 3, Instagram 8. Sobra entra em `descartadas` com motivo.
- **Marcas bloqueadas:** `MARCAS_BLOQUEADAS` (fabricante, distribuidora, detentoras de direitos, lojas e marketplaces, e
  "oficial") mais `marcas` passadas pelo chamador (ex.: nomes de `config/stores.json`). Hashtag que contém um desses termos
  é descartada com o motivo `marca de terceiro`.
- **Descartes auditáveis:** cada hashtag fora da lista sai em `descartadas` com `{ hashtag, origem, motivo }` (`MOTIVOS`).
- `anexarHashtags(rascunho, hashtags)` acrescenta a linha de hashtags ao rascunho de `gerarRascunho` sem passar de `LIMITES`
  do canal: tira hashtags do fim, nunca corta o texto do post, e avisa em `avisos`.

## Revisão humana

Antes de aprovar (`decidir` em `src/agents/social/aprovacao.js`), o revisor confere: dado verificável, nenhuma promessa de
futuro, nenhuma expressão proibida, frase de afiliado quando aplicável e hashtags dentro do limite do canal. Texto fora do
guia = rejeitar com motivo, não editar depois da aprovação (editar invalida a aprovação).
