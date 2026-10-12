// Lote E (SEO & Content): texto do guia "Como funciona", perguntas frequentes e glossário, como dados.
// É a fonte única: o site (index.html, const GUIA) carrega uma cópia literal deste objeto — test/guia-sync-tests.js
// confere que as duas são idênticas — e /api/pagina renderiza o mesmo conteúdo no HTML (FAQPage e DefinedTermSet).
// Os textos são fragmentos HTML confiáveis (escritos aqui, nunca vindos de dados externos): só <b>, <a> e <i>.
// Faixas do Opportunity Score = src/core/opportunity-engine.js BANDS (90/75/50). Afiliados: docs/afiliados.md.
export const GUIA = {
  title: 'Como o site avalia as ofertas',
  intro: 'O objetivo é um só: te ajudar a fazer bons negócios com produto lacrado em português, sem cair em preço inflado ou golpe.',
  sections: [
    { h: 'Opportunity Score (0 a 100)', blocks: [
      { p: 'A nota responde a uma pergunta: quão interessante é comprar esta oferta agora. Quem calcula é o Opportunity Engine, com os preços já coletados das lojas. Cada oferta tem uma nota só, e ela é a mesma no início, em Oportunidades, nas listas e na página do produto.' },
      { table: [
        ['Referência atual', 'Desconto em relação ao preço sugerido Copag atual e verificado. Sem ele, em relação a uma referência de mercado formada por várias lojas.', 'peso 30%'],
        ['Histórico', 'Onde o preço está entre o menor e a média já vistos. Só conta com 3 dias ou mais de dados.', 'peso 20%'],
        ['Mercado', 'Distância da mediana das lojas com estoque agora. Precisa de 2 lojas ou mais.', 'peso 20%'],
        ['Menor preço agora', 'Distância do menor preço com estoque neste momento.', 'peso 10%'],
        ['Frete', 'Frete informado e quanto ele pesa no total. Frete desconhecido não conta.', 'peso 10%'],
        ['Confiabilidade', 'Reputação pública da loja no Reclame Aqui e vendedor oficial.', 'peso 10%'] ] },
      { p: 'Um critério sem dado confiável fica de fora: nunca é inventado. Com pouca evidência, a nota fica perto de 50. Alguns limites seguram a nota, mesmo com bom desconto: estoque não confirmado, pré-venda, preço acima da referência atual, loja mal avaliada ou preço fora do esperado para o produto.' } ] },
    { h: 'O que cada faixa quer dizer', blocks: [
      { bands: [['excelente', 'Excelente oportunidade', '90 a 100'], ['boa', 'Boa oportunidade', '75 a 89'], ['normal', 'Oportunidade normal', '50 a 74'], ['baixa', 'Oportunidade baixa', '0 a 49']] } ] },
    { h: 'Confiança', blocks: [
      { p: 'Vem separada da nota e diz o quanto os dados por trás dela estão completos. Cai com histórico curto, frete desconhecido, poucas lojas com estoque, queda de preço ainda não confirmada ou referência de mercado formada só por marketplaces. Alta: 75% ou mais. Média: de 50% a 74%. Baixa: abaixo de 50%.' } ] },
    { h: 'Motivos e avisos', blocks: [
      { p: 'Cada nota traz os motivos que pesaram a favor ou contra (por exemplo, "28,7% abaixo do preço sugerido Copag") e os avisos para conferir antes de comprar (por exemplo, "Frete não confirmado"). Toque em <b>Por que esta nota?</b> para ver.' } ] },
    { h: 'Sem nota oficial', blocks: [
      { p: 'Quando o motor ainda não avaliou a oferta, ou quando as notas estão indisponíveis, o site mostra "Sem nota oficial". Nenhuma nota é estimada no lugar.' },
      { p: 'O Opportunity Score é uma avaliação automática feita por algoritmo, com dados públicos das lojas. Não é recomendação financeira nem de compra.' } ] },
    { h: 'Preço sugerido Copag', blocks: [
      { p: 'Só vale o preço publicado na loja oficial da Copag, com link e data. Preço divulgado por terceiros aparece como referência e não entra no desconto.' } ] },
    { h: 'O que nunca entra no ranking', blocks: [
      { ul: ['Preço mais de 45% abaixo da Copag ou da média das lojas (pode ser erro, usado ou golpe).', 'Estoque não confirmado pela loja.', 'Produto usado, aberto, importado ou em outro idioma.', 'Pistas do Telegram, que ninguém verificou.'] } ] },
    { h: 'Antes de comprar', blocks: [
      { ul: ['Simule o frete: ele muda a conta.', 'Confira CNPJ, avaliações e política de troca de lojas que você não conhece.', 'Prefira Pix ou cartão com proteção. Desconfie de pagamento por fora.', 'Veja o menor preço já visto na ficha do produto antes de decidir.'] } ] },
  ],
  faq: [
    { q: 'O que é o Opportunity Score e o que significam as faixas?',
      a: 'É uma nota de 0 a 100 que diz quão interessante é comprar uma oferta de Pokémon TCG lacrado agora, calculada pelo Opportunity Engine com o preço, o histórico, o mercado, o frete e a reputação da loja. Excelente: 90 a 100. Boa: 75 a 89. Normal: 50 a 74. Baixa: 0 a 49. A nota é a mesma em todas as páginas do site.' },
    { q: 'O que é a "confiança" de uma oferta?',
      a: 'É uma medida separada da nota: diz o quanto os dados por trás dela estão completos. Alta (75% ou mais) quando há histórico, frete informado e várias lojas com estoque; média (50% a 74%) ou baixa (abaixo de 50%) quando falta dado, como frete desconhecido, histórico curto ou mercado formado só por marketplaces.' },
    { q: 'O que é o preço sugerido Copag e de onde ele vem?',
      a: 'É o preço de venda sugerido publicado pela Copag, distribuidora oficial de Pokémon TCG no Brasil, na loja oficial dela. O site só usa como oficial o valor lido na loja da Copag, com link e data da leitura. Preço divulgado por outras lojas ou canais aparece como referência, sem entrar no cálculo do desconto.' },
    { q: 'Por que pré-venda e produto sem estoque não entram no ranking?',
      a: 'Porque não dá para comprar agora pelo preço mostrado. Oferta sem estoque confirmado pela loja fica fora da comparação, e pré-venda aparece numa página própria, com a nota limitada: o preço pode mudar até o lançamento e a loja pode não entregar. O ranking só compara oferta com estoque confirmado.' },
    { q: 'O que significa "preço no Pix" e "preço antes do frete"?',
      a: '"No Pix" é o preço com desconto para pagamento por Pix, quando a loja anuncia um valor menor nessa forma de pagamento; o site sinaliza quando o preço mostrado é esse. "Antes do frete" ou "frete a calcular" quer dizer que a loja não informou o frete para o CEP consultado, então o total pode subir. Quando o frete é conhecido, ele entra no total e na comparação.' },
    { q: 'Como o site ganha dinheiro? Isso muda a nota?',
      a: 'O site é gratuito e não tem anúncios. Alguns links para a Amazon e, quando ativados, para o Mercado Livre são de afiliado: o site pode receber uma comissão se você comprar por eles, sem custo extra para você. O afiliado nunca muda o ranking, a melhor oferta, o preço, o frete nem a nota: o cálculo não lê a configuração de afiliados, e isso é conferido por teste automático.' },
    { q: 'Como evitar golpe ao comprar Pokémon TCG lacrado?',
      a: 'Desconfie de preço muito abaixo do mercado (mais de 45% abaixo da Copag fica fora do ranking por isso), confira CNPJ, reputação no Reclame Aqui e política de troca de lojas que você não conhece, prefira Pix para CNPJ da loja ou cartão com proteção e nunca pague por fora do site da loja. Ao receber, confira o lacre e a embalagem em português antes de aceitar.' },
    { q: 'Como criar um alerta de preço?',
      a: 'Abra a página do produto, vá até "Me avise quando baixar", digite o preço que quer pagar e toque em "Criar alerta". É preciso ter uma conta gratuita (e-mail ou Google). Quando uma loja acompanhada tiver estoque por esse valor ou menos, o alerta aparece em Alertas e na própria página do produto. Dá para ter até 50 alertas.' },
  ],
  glossario: [
    { t: 'Booster', d: 'Pacote lacrado com cerca de 10 cartas aleatórias de uma coleção. É a menor unidade de venda e a base dos outros formatos.' },
    { t: 'Booster Box', d: 'Caixa lacrada com 36 boosters da mesma coleção, vendida pela Copag e pelas lojas. O preço por booster costuma ser o menor entre os formatos.' },
    { t: 'Blister', d: 'Cartela lacrada com 1, 2, 3 ou 4 boosters e, às vezes, uma carta promocional ou moeda. Vendida como blister unitário, duplo, triplo ou quádruplo.' },
    { t: 'ETB (Treinador Avançado)', d: 'Elite Trainer Box, a "Caixa de Treinador Avançado": kit com boosters, cartas de energia, dados, marcadores e caixa para guardar o baralho, de uma coleção específica.' },
    { t: 'Lata', d: 'Lata lacrada com boosters e uma ou mais cartas promocionais (geralmente um Pokémon ex ou V). Versões menores são vendidas como minilata.' },
    { t: 'Deck', d: 'Baralho pronto para jogar, com 60 cartas, vendido lacrado. Inclui os decks de batalha, kits de treinador e decks de desafio.' },
    { t: 'Coleção', d: 'Conjunto de cartas lançado de uma vez, com nome próprio (por exemplo, Escarlate e Violeta: Evoluções Prismáticas). Cada produto lacrado pertence a uma coleção.' },
    { t: 'Copag', d: 'Distribuidora oficial de Pokémon TCG no Brasil. Fabrica as cartas em português e publica o preço sugerido de cada produto na loja oficial.' },
    { t: 'Preço sugerido', d: 'Preço de venda recomendado pela Copag para um produto. No site, só vale o valor publicado na loja oficial da Copag, com link e data; o resto é referência.' },
    { t: 'Pix', d: 'Pagamento instantâneo do Banco Central. Muitas lojas dão desconto no Pix: quando a oferta é "no Pix", o preço mostrado vale só nessa forma de pagamento.' },
    { t: 'Opportunity Score', d: 'Nota de 0 a 100 que diz quão interessante é comprar uma oferta agora. Excelente de 90 a 100, boa de 75 a 89, normal de 50 a 74 e baixa de 0 a 49.' },
    { t: 'Confiança', d: 'Quanto os dados por trás de uma nota estão completos: alta (75% ou mais), média (50% a 74%) ou baixa (abaixo de 50%). Cai com frete desconhecido, histórico curto ou poucas lojas.' },
    { t: 'Pré-venda', d: 'Produto anunciado antes do lançamento, com entrega futura. Fica numa página própria e fora do ranking, porque o preço e a entrega podem mudar.' },
    { t: 'Frete comparável', d: 'Regra de comparação do site: oferta com frete conhecido (ou grátis) é comparada pelo total; oferta com frete desconhecido nunca vence uma com frete conhecido.' },
    { t: 'Reclame Aqui', d: 'Site público de reclamações de consumidores. A reputação da loja lá entra no critério de confiabilidade da nota, com a data da consulta e o link para a fonte.' },
    { t: 'Lacrado', d: 'Produto fechado de fábrica, com o selo intacto. O site só compara produto lacrado em português; usado, aberto, importado ou em outro idioma fica fora.' },
  ],
};

// Texto sem HTML (para JSON-LD e descrições).
export const plain = (h) => String(h ?? '').replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();

// Renderização do guia em HTML (usada no SSR e, com `dot`, no site para colorir as faixas).
export function guiaHTML(g = GUIA, { hTag = 'h2', dot = () => '' } = {}) {
  const block = (b) => b.p ? `<p>${b.p}</p>`
    : b.ul ? `<ul>${b.ul.map((x) => `<li>${x}</li>`).join('')}</ul>`
    : b.table ? `<table>${b.table.map(([n, h, w]) => `<tr><td><b>${n}</b><br>${h}</td><td>${w}</td></tr>`).join('')}</table>`
    : b.bands ? `<table>${b.bands.map(([k, n, r]) => `<tr><td>${dot(k)}${n}</td><td>${r}</td></tr>`).join('')}</table>` : '';
  return g.sections.map((s) => `<${hTag}>${s.h}</${hTag}>${s.blocks.map(block).join('')}`).join('');
}
export function faqHTML(g = GUIA, { hTag = 'h2', qTag = 'h3' } = {}) {
  return `<${hTag}>Perguntas frequentes</${hTag}>${g.faq.map((f) => `<${qTag}>${f.q}</${qTag}><p>${f.a}</p>`).join('')}`;
}
export function glossarioHTML(g = GUIA) {
  return `<dl class="glossario">${g.glossario.map((x) => `<dt id="${slugT(x.t)}">${x.t}</dt><dd>${x.d}</dd>`).join('')}</dl>`;
}
export const slugT = (t) => plain(t).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
export const faqLD = (g = GUIA) => ({ '@context': 'https://schema.org', '@type': 'FAQPage', mainEntity: g.faq.map((f) => ({ '@type': 'Question', name: plain(f.q), acceptedAnswer: { '@type': 'Answer', text: plain(f.a) } })) });
export const glossarioLD = (g = GUIA, site = '') => ({ '@context': 'https://schema.org', '@type': 'DefinedTermSet', '@id': `${site}/guia/glossario`, name: 'Glossário de Pokémon TCG lacrado', inLanguage: 'pt-BR',
  hasDefinedTerm: g.glossario.map((x) => ({ '@type': 'DefinedTerm', name: plain(x.t), description: plain(x.d), inDefinedTermSet: `${site}/guia/glossario`, url: `${site}/guia/glossario#${slugT(x.t)}` })) });
