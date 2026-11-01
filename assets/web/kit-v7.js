/* Monte seu kit (docs/monte-seu-kit.md, K3): questionário em etapas → /api/v1/site/kit. Fora do índice.
   Respostas só na sessão (sessionStorage, com try/catch). Cada etapa vira um caminho (/monte-seu-kit/<etapa>) para o
   Vercel Analytics gratuito contar o funil por página vista, anônimo. Nenhum preço é calculado aqui: tudo vem da API.
   v2 (medição, §7): o script do Vercel só conta pushState/popstate, e a etapa troca o caminho com replaceState (sem
   entrada no "Voltar"). Por isso cada etapa nova manda uma página vista própria (va('pageview')); a primeira já é a
   página vista automática. Clique em "Ver na loja" vira /monte-seu-kit/saida/<loja> (página vista, sem redirecionar).
   utm_* do link de entrada ficam no caminho. Eventos va('event') (plano Pro) para funil, itens e saídas. Sem dado pessoal:
   nada do Pokémon favorito (só se respondeu), nenhum identificador.
   v3: mesmo código da v2 com a D2 ("no Pix"); nome novo porque /assets/web/* vai com cache immutable de 1 ano e quem
   já tinha a kit-v2.js não receberia a mudança. A kit-v2.js fica no repositório (como a v1) para páginas antigas em cache.
   v4: kit completo com acessórios. A API devolve quais acessórios o modelo pede (acessorios: ['sleeve', ...]) e a página
   escolhe o MAIS BARATO de cada um na lista curada /data/afiliados-acessorios.json (#991; comissão nunca escolhe). O
   orçamento é do kit inteiro: a página pede os lacrados com o orçamento menos os acessórios; se não couber nenhum lacrado,
   tira o último acessório e tenta de novo. Acessório mostra a data da leitura e frete a calcular (nunca zero), então o total
   com frete só aparece sem acessório. "Proteger minhas cartas" vira um kit só de acessórios.
   v5: com orçamento a partir de R$ 300 (ou em "proteger"), o acessório vem das marcas de TCG (Dragon Shield, Ultra Pro,
   Gamegenic, Vault X), o mais barato entre elas; sem item dessas marcas, o mais barato de todos. A API (kit.mjs) passou a
   usar o orçamento todo (extras do modelo).
   v6: visual no padrão do kit do Melhor Enxoval (pedido do dono, 01/11): "Pergunta N de 4" com barra em segmentos e opções
   com marcador; no resultado, um cartão com fotos, total do kit, barra do orçamento e "Sobram", divisão lacrados ×
   acessórios, lista compacta que abre o detalhe de cada item, "Ficou de fora", "Próximos passos", resumo das respostas,
   como escolhemos e compartilhar (WhatsApp, copiar link, imprimir). Link compartilhado (?objetivo=&orcamento=&idioma=)
   abre direto no resultado; o Pokémon favorito não vai no link. Regras de preço, orçamento e frete iguais à v5.
   v7: acessório com a foto do anúncio (campo image da lista curada); sem foto, a inicial do tipo como antes. */
(function () {
  'use strict';
  window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };
  var vaFila = window.va;   // fila provisória: o script do Vercel troca window.va pela função real quando carrega
  function track(name, data) { try { window.va('event', { name: name, data: data || {} }); } catch (e) { /* sem analytics */ } }
  // Página vista manual só com o script já carregado; antes disso a página vista automática conta o caminho atual.
  function vista(caminho) { try { if (window.va !== vaFila) window.va('pageview', { path: caminho }); } catch (e) { /* sem analytics */ } }
  var UTM = (function () {
    try {
      var q = new URLSearchParams(location.search), o = new URLSearchParams();
      q.forEach(function (v, k) { if (/^utm_(source|medium|campaign|content|term)$/.test(k) && v) o.set(k, v.slice(0, 100)); });
      var s = o.toString(); return s ? '?' + s : '';
    } catch (e) { return ''; }
  })();
  var app = document.getElementById('app');
  var K = 'kit-respostas-v1';
  var R = {}; try { R = JSON.parse(sessionStorage.getItem(K) || '{}') || {}; } catch (e) { R = {}; }
  var salvar = function () { try { sessionStorage.setItem(K, JSON.stringify(R)); } catch (e) { /* sem armazenamento */ } };
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var brl = function (v) { return 'R$ ' + Number(v).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.'); };
  var ETAPAS = [
    { id: 'objetivo', t: 'O que você quer fazer?', s: 'Escolha o que mais combina com você agora.', o: [
      ['colecionar', 'Começar a colecionar', 'Abrir pacotes e montar a coleção'], ['jogar', 'Aprender a jogar', 'Baralho pronto para as primeiras partidas'],
      ['presentear', 'Dar de presente', 'Um produto bonito e completo'], ['abrir', 'Abrir boosters', 'Mais pacotes pelo orçamento'],
      ['especiais', 'Ter cartas especiais', 'Coleções com carta promocional'], ['proteger', 'Proteger minhas cartas', 'Sleeves, fichário, deck box'] ] },
    { id: 'orcamento', t: 'Quanto quer gastar?', s: 'O valor é só dos produtos; o frete aparece à parte.', o: [['50', 'Até R$ 50'], ['100', 'Até R$ 100'], ['200', 'Até R$ 200'], ['400', 'Até R$ 400']], outro: true },
    { id: 'idioma', t: 'Em que idioma?', s: 'Cartas em português são as mais fáceis de achar no Brasil.', o: [['pt', 'Português'], ['en', 'Inglês'], ['ja', 'Japonês'], ['qualquer', 'Tanto faz']] },
    { id: 'favorito', t: 'Tem um Pokémon favorito?', s: 'Opcional. Usamos só para escolher entre produtos com o nome dele.', texto: true },
  ];
  var passo = 0; var focar = false; // foco no título só depois da primeira etapa (leitor de tela acompanha a troca)
  var atual = null;   // caminho da etapa mostrada; repetir a mesma etapa (marcar opção) não conta de novo
  function rota(nome, contar) {
    var c = '/monte-seu-kit/' + nome;
    try { history.replaceState(null, '', c + UTM); } catch (e) { /* ok */ }
    if (c === atual) return;
    track('kit_step', { etapa: nome });
    if (atual !== null && contar !== false) vista(c);
    atual = c;
  }
  var FAIXAS = ['50', '100', '200', '400'];
  var slug = function (s) { return String(s == null ? '' : s).toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) || 'loja'; };
  function barra() { return '<div class="prog"><span>Pergunta ' + (passo + 1) + ' de ' + ETAPAS.length + '</span><div class="steps" aria-hidden="true">' + ETAPAS.map(function (_, i) { return '<i' + (i <= passo ? ' class="on"' : '') + '></i>'; }).join('') + '</div></div>'; }
  function etapa() {
    var E = ETAPAS[passo]; rota(E.id);
    if (R.objetivo === 'proteger' && E.id !== 'objetivo') return resultado();
    var h = barra() + '<h2>' + esc(E.t) + '</h2><p class="sub">' + esc(E.s) + '</p>';
    if (E.o) h += '<div class="opts" role="radiogroup">' + E.o.map(function (o) { var on = String(R[E.id]) === o[0]; return '<button type="button" class="opt" role="radio" data-v="' + esc(o[0]) + '" aria-pressed="' + on + '" aria-checked="' + on + '"><span class="rd" aria-hidden="true"></span><span class="ot">' + esc(o[1]) + (o[2] ? '<small>' + esc(o[2]) + '</small>' : '') + '</span></button>'; }).join('') + '</div>';
    if (E.outro) h += '<label class="f" for="outro">Outro valor (R$)</label><input id="outro" type="number" inputmode="decimal" min="1" max="100000" placeholder="Ex.: 150" value="' + (R.orcamento && ['50', '100', '200', '400'].indexOf(String(R.orcamento)) < 0 ? esc(R.orcamento) : '') + '">';
    if (E.texto) h += '<label class="f" for="fav">Pokémon favorito</label><input id="fav" type="text" maxlength="40" placeholder="Ex.: Pikachu" value="' + esc(R.favorito || '') + '">';
    h += '<div class="row nav"><button type="button" class="btn pri" data-avancar' + (pronto(E) ? '' : ' disabled') + '>' + (passo === ETAPAS.length - 1 ? 'Ver meu kit' : 'Continuar') + ' →</button>' + (passo ? '<button type="button" class="lnk" data-voltar>Voltar</button>' : '') + '</div>';
    app.innerHTML = h;
    if (focar) { var f = app.querySelector('h2'); if (f) { f.setAttribute('tabindex', '-1'); f.focus({ preventScroll: true }); } }
    focar = true;
  }
  function pronto(E) { return E.texto || (R[E.id] != null && R[E.id] !== ''); }
  app.addEventListener('click', function (ev) {
    var b = ev.target.closest('button'); if (!b) return;
    var E = ETAPAS[passo];
    if (b.dataset.v != null) { R[E.id] = b.dataset.v; salvar(); if (E.id === 'objetivo' && R.objetivo === 'proteger') return resultado(); return etapa(); }
    if (b.hasAttribute('data-voltar')) { passo = Math.max(0, passo - 1); return etapa(); }
    if (b.hasAttribute('data-avancar')) { if (passo < ETAPAS.length - 1) { passo++; return etapa(); } return resultado(); }
    if (b.hasAttribute('data-refazer')) { track('kit_restart', {}); R = {}; J = null; CESTA = []; salvar(); passo = 0; return etapa(); }
  });
  app.addEventListener('input', function (ev) {
    if (ev.target.id === 'outro') { var v = Number(ev.target.value); if (v >= 1) { R.orcamento = String(Math.round(v)); salvar(); } app.querySelectorAll('.opt').forEach(function (o) { o.setAttribute('aria-pressed', String(o.dataset.v === String(R.orcamento))); }); var a = app.querySelector('[data-avancar]'); if (a) a.disabled = !(R.orcamento >= 1); }
    if (ev.target.id === 'fav') { R.favorito = ev.target.value.slice(0, 40); salvar(); }
  });
  // Cesta (K4): itens do resultado, com quantidade e remoção; a comparação "uma loja × dividir" vem de /api/v1/site/kit/cesta.
  var CESTA = []; var J = null; var ACC = []; var ACC_FORA = [];
  var ACC_PORQUE = { sleeve: 'para proteger as cartas', fichario: 'para guardar a coleção', deck_box: 'para levar o baralho', playmat: 'para jogar sobre a mesa', toploader: 'para as cartas mais especiais' };
  var ACC_NOME = { sleeve: 'sleeves', fichario: 'fichário', deck_box: 'deck box', playmat: 'playmat', toploader: 'toploader' };
  var LOJA_ACC = { mercadolivre: 'Mercado Livre', amazon: 'Amazon', shopee: 'Shopee' };
  var accP = null;
  // Lista curada: só item com categoria do kit, preço, link https e data da leitura. Falha = kit sem acessórios.
  function listaAcc() {
    return accP || (accP = fetch('/data/afiliados-acessorios.json').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }).then(function (j) {
      return (j && Array.isArray(j.itens) ? j.itens : []).filter(function (i) { return i && ACC_PORQUE[i.kit] && typeof i.price === 'number' && i.price > 0 && /^https:\/\//.test(i.url || '') && i.capturedAt; });
    }));
  }
  // O mais barato de cada acessório pedido, na ordem do modelo; empate: o id (nunca a loja ou a comissão).
  var MARCAS_TCG = /^(dragon shield|ultra pro|gamegenic|vault x)$/i;
  function escolherAcc(lista, tipos, premium) {
    return (tipos || []).map(function (k) { var dk = lista.filter(function (i) { return i.kit === k; }); var pm = dk.filter(function (i) { return MARCAS_TCG.test(String(i.marca || '').trim()); });
      return (premium && pm.length ? pm : dk).sort(function (a, b) { return a.price - b.price || String(a.id).localeCompare(String(b.id)); })[0]; }).filter(Boolean);
  }
  var somaAcc = function (l) { return Math.round(l.reduce(function (s, a) { return s + a.price; }, 0) * 100) / 100; };
  function lido(iso) { var d = new Date(iso); if (isNaN(d)) return ''; try { return 'preço lido em ' + d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' }); } catch (e) { return ''; } }
  // D2: preço no Pix diz "no Pix" (como a página do produto); a API do kit manda priceKind.
  function pixK(o) { return o && o.priceKind === 'pix' ? ' <small>no Pix</small>' : ''; }
  var MOSTRAR_TODOS = false; var ABERTO = {};
  var OBJ_NOME = { colecionar: 'Começar a colecionar', jogar: 'Aprender a jogar', presentear: 'Dar de presente', abrir: 'Abrir boosters', especiais: 'Ter cartas especiais', proteger: 'Proteger minhas cartas' };
  var IDI_NOME = { pt: 'Português', en: 'Inglês', ja: 'Japonês', qualquer: 'Qualquer idioma' };
  function thumb(img, alt) { return /^https:\/\//.test(img || '') ? '<img src="' + esc(img) + '" alt="' + esc(alt) + '" loading="lazy" referrerpolicy="no-referrer">' : '<span class="noimg" aria-hidden="true"></span>'; }
  // Linha compacta (foto, nome, quantidade e loja, preço) que abre o detalhe com quantidade, remover e "Ver na loja".
  function itemHTML(it, i) {
    var o = it.oferta; var k = 'p:' + it.productId;
    return '<details class="li"' + (ABERTO[k] ? ' open' : '') + '><summary data-abrir="' + esc(k) + '">' + thumb(it.imagem, it.nome) +
      '<span class="lt"><span class="n">' + esc(it.nome) + '</span><span class="lr"><span class="w">' + it.quantidade + ' × · ' + esc(o.storeName || o.storeId) + '</span><span class="lp">' + brl(o.price * it.quantidade) + '</span></span></span><span class="chev" aria-hidden="true"></span></summary>' +
      '<div class="item"><div class="w">' + esc(it.porque) + ' · em ' + esc(o.storeName || o.storeId) + '</div>' +
      '<div class="p">' + brl(o.price) + pixK(o) + ' <small>cada</small></div>' +
      '<div class="qty"><button type="button" class="q" data-menos="' + i + '" aria-label="Menos uma unidade">−</button><span aria-live="polite">' + it.quantidade + '</span><button type="button" class="q" data-mais="' + i + '" aria-label="Mais uma unidade">+</button>' +
      '<button type="button" class="rm" data-remover="' + i + '">Remover</button></div>' +
      '<a class="ver" href="' + esc(o.url) + '" target="_blank" rel="noopener nofollow" data-saida="' + esc(o.storeId) + '" data-pid="' + esc(it.productId) + '" data-preco="' + esc(o.price) + '">Ver na loja ↗</a></div></details>';
  }
  function accHTML(a, i) {
    var loja = LOJA_ACC[a.loja] || a.loja; var k = 'a:' + a.kit;
    return '<details class="li"' + (ABERTO[k] ? ' open' : '') + '><summary data-abrir="' + esc(k) + '">' + (/^https:\/\//.test(a.image || '') ? thumb(a.image, a.title) : '<span class="noimg acc" aria-hidden="true">' + esc((ACC_NOME[a.kit] || '').slice(0, 1).toUpperCase()) + '</span>') +
      '<span class="lt"><span class="n">' + esc(a.title) + '</span><span class="lr"><span class="w">' + esc(ACC_NOME[a.kit]) + ' · ' + esc(loja) + '</span><span class="lp">' + (a.aPartirDe ? '<small>a partir de </small>' : '') + brl(a.price) + '</span></span></span><span class="chev" aria-hidden="true"></span></summary>' +
      '<div class="item"><div class="w">Acessório ' + esc(ACC_PORQUE[a.kit]) + ' · em ' + esc(loja) + ' · ' + esc(lido(a.capturedAt)) + '</div>' +
      '<div class="qty"><a href="/acessorios.html#' + esc(a.kit) + '">Ver outras opções</a><button type="button" class="rm" data-rmacc="' + i + '">Remover</button></div>' +
      '<a class="ver" href="' + esc(a.url) + '" target="_blank" rel="sponsored nofollow noopener" data-saida="' + esc(loja) + '" data-pid="acessorio:' + esc(a.kit) + '" data-preco="' + esc(a.price) + '">Ver na loja ↗</a></div></details>';
  }
  function linhaLoja(x, titulo) {
    var lojas = x.fretes.map(function (f) { return esc(f.nome) + ': ' + brl(f.subtotal) + (f.frete == null ? ' + frete a calcular' : f.frete === 0 ? ' · frete grátis' : ' + frete ' + brl(f.frete)); }).join('<br>');
    return '<div class="cmp"><b>' + titulo + '</b><div class="w">' + lojas + '</div><div>' + (x.total != null ? 'Total com frete: <b>' + brl(x.total) + '</b>' : 'Produtos: <b>' + brl(x.subtotal) + '</b> + frete a calcular') + ' · ' + x.pedidos + (x.pedidos === 1 ? ' pedido' : ' pedidos') + '</div></div>';
  }
  function linkKit() {
    var q = 'objetivo=' + encodeURIComponent(R.objetivo || '') + (R.orcamento ? '&orcamento=' + encodeURIComponent(R.orcamento) : '') + (R.idioma ? '&idioma=' + encodeURIComponent(R.idioma) : '');
    return ((location && location.origin) || 'https://tcgpricehunter.com.br') + '/monte-seu-kit?' + q;
  }
  function passos() {
    var l = [];
    if (CESTA.length) l.push(['Compre primeiro os lacrados', 'Preço e estoque mudam rápido: confira o valor e o frete na loja antes de fechar.', '/oportunidades', 'Ver as ofertas de hoje']);
    if (ACC.some(function (a) { return a.kit === 'sleeve'; })) l.push(['Coloque os sleeves antes de jogar ou guardar', 'A carta fica protegida desde a primeira vez que sai do pacote.', '/acessorios.html#sleeve', 'Ver sleeves']);
    if (R.objetivo === 'jogar') l.push(['Jogue as primeiras partidas com o baralho pronto', 'O baralho já vem montado; depois troque cartas aos poucos, com os boosters do kit.', '', '']);
    else if (R.objetivo === 'especiais' || ACC.some(function (a) { return a.kit === 'toploader'; })) l.push(['Guarde as cartas especiais no toploader', 'As cartas promocionais e as mais bonitas ficam rígidas e sem dobra.', '/acessorios.html#toploader', 'Ver toploaders']);
    else l.push(['Organize a coleção no fichário', 'Separe por coleção ou por tipo: fica fácil ver o que falta.', '/acessorios.html#fichario', 'Ver fichários']);
    l.push(['Acompanhe os preços', 'O site lê as lojas várias vezes por dia; volte antes de comprar o que ficou para depois.', '/oportunidades', 'Ver as oportunidades']);
    return '<h3 class="h3 ser">Próximos passos</h3><ol class="passos">' + l.map(function (x) { return '<li><b>' + esc(x[0]) + '</b><span>' + esc(x[1]) + '</span>' + (x[2] ? '<a href="' + esc(x[2]) + '">' + esc(x[3]) + ' →</a>' : '') + '</li>'; }).join('') + '</ol>';
  }
  function renderCesta(c) {
    var orc = Number(R.orcamento) || J.orcamento || 0; var accSub = somaAcc(ACC);
    var sub = c && c.dividir ? c.dividir.subtotal : Math.round(CESTA.reduce(function (s, it) { return s + it.oferta.price * it.quantidade; }, 0) * 100) / 100;
    var tot = Math.round((sub + accSub) * 100) / 100;
    var nItens = CESTA.reduce(function (s, it) { return s + it.quantidade; }, 0) + ACC.length;
    var lojas = {}; CESTA.forEach(function (it) { lojas[it.oferta.storeId] = 1; }); ACC.forEach(function (a) { lojas['acc:' + a.loja] = 1; }); var nLojas = Object.keys(lojas).length;
    var h = '<div class="res">';
    if (!CESTA.length && !ACC.length) h += '<h2>' + esc(J.nomeModelo || 'Seu kit') + '</h2><p class="sub">Sua cesta está vazia.</p>';
    else {
      var fotos = CESTA.map(function (it) { return it.imagem; }).concat(ACC.map(function (a) { return a.image; })).filter(function (u) { return /^https:\/\//.test(u || ''); });
      var resto = CESTA.length + ACC.length - Math.min(3, fotos.length);
      h += '<section class="kc"><div class="kc-top"><span class="eb">Seleção TCG Price Hunter</span><span class="badge">' + nItens + (nItens === 1 ? ' item' : ' itens') + '</span></div>' +
        '<h2>' + esc(J.nomeModelo || 'Seu kit') + '</h2>' +
        (fotos.length ? '<div class="th">' + fotos.slice(0, 3).map(function (u) { return '<span>' + thumb(u, '') + '</span>'; }).join('') + (resto > 0 ? '<span class="mais">+' + resto + '</span>' : '') + '</div>' : '') +
        '<div class="lbl">Total do kit</div><div class="big">' + brl(tot) + '</div>' +
        '<div class="w">' + (orc > 0 ? 'de ' + brl(orc) + ' · ' : '') + nLojas + (nLojas === 1 ? ' loja' : ' lojas') + '</div>' +
        (orc > 0 ? '<div class="bar2" aria-hidden="true"><i style="width:' + Math.min(100, Math.round(tot / orc * 100)) + '%"></i></div><div class="sobra' + (tot > orc ? ' err' : '') + '">' + (tot > orc ? 'Passou ' + brl(tot - orc) + ' do orçamento' : 'Sobram ' + brl(orc - tot)) + '</div>' : '') +
        '<div class="div">' + (CESTA.length ? '<div class="dl"><span><i class="dot y"></i>Lacrados · ' + (nItens - ACC.length) + (nItens - ACC.length === 1 ? ' item' : ' itens') + '</span><b>' + brl(sub) + '</b></div>' : '') +
        (ACC.length ? '<div class="dl"><span><i class="dot g"></i>Acessórios · ' + ACC.length + (ACC.length === 1 ? ' item' : ' itens') + '</span><b>' + brl(accSub) + '</b></div>' : '') + '</div>';
      var lista = CESTA.map(function (it, i) { return itemHTML(it, i); }); var listaA = ACC.map(accHTML);
      var limite = MOSTRAR_TODOS ? 999 : 3;
      if (CESTA.length) h += '<div class="gr"><span><i class="dot y"></i>Lacrados · ' + Math.min(limite, CESTA.length) + ' de ' + CESTA.length + '</span><b>' + brl(sub) + '</b></div>' + lista.slice(0, limite).join('');
      if (ACC.length && (MOSTRAR_TODOS || CESTA.length < 3)) h += '<div class="gr"><span><i class="dot g"></i>Acessórios para completar</span><b>' + brl(accSub) + '</b></div>' + listaA.join('');
      if (!MOSTRAR_TODOS && (CESTA.length > 3 || (ACC.length && CESTA.length >= 3))) h += '<button type="button" class="btn sec todos" data-todos>Ver os ' + (CESTA.length + ACC.length) + ' produtos do kit</button>';
      h += '<p class="nota">' + (!ACC.length && c && c.dividir && c.dividir.total != null ? 'Com frete: <b>' + brl(c.dividir.total) + '</b>.' : 'Frete: a calcular na loja.') + ' Soma do preço anunciado de cada item (no Pix, quando a loja só dá esse preço no Pix). Cada item é comprado na loja dele, com frete e prazo próprios.' +
        (ACC.length ? ' Acessórios: preço lido pelo site na data indicada, sem frete; confira na loja antes de comprar.' : '') + '</p><p class="nota">Links de loja: alguns geram comissão para o site, sem custo extra para você, e isso nunca muda a escolha.</p></section>';
    }
    if (CESTA.length > 1 && c && c.dividir) {
      h += '<details class="sec"><summary>Onde comprar os produtos</summary>';
      if (c.umaLoja && c.umaLoja[0]) h += linhaLoja(c.umaLoja[0], 'Tudo numa loja');
      h += linhaLoja(c.dividir, 'Dividindo entre lojas');
      if (c.comparacao) h += '<p class="w">' + (c.comparacao.economia > 0 ? 'Dividir economiza ' + brl(c.comparacao.economia) : c.comparacao.economia < 0 ? 'Comprar numa loja só economiza ' + brl(-c.comparacao.economia) : 'Mesmo valor') + (c.comparacao.base === 'produtos' ? ' nos produtos (sem contar fretes não informados).' : ' no total com frete.') + '</p>';
      h += '</details>';
    }
    var alt = (J.alternativas || []).filter(function (a) { return !CESTA.some(function (it) { return it.productId === a.productId; }); });
    var fora = ACC_FORA.length ? ['Não couberam no orçamento: ' + ACC_FORA.map(function (a) { return ACC_NOME[a.kit] + ' (a partir de ' + brl(a.price) + ')'; }).join(', ') + '. Veja opções na página de acessórios.'] : [];
    var lim = (J.limitacoes || []).concat(c && c.limitacoes || []).concat(fora);
    if (lim.length) h += '<details class="sec"' + (fora.length || !CESTA.length ? ' open' : '') + '><summary>Ficou de fora (' + lim.length + ')</summary><ul class="lim">' + lim.map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('') + '</ul></details>';
    if (alt.length) h += '<details class="sec"><summary>Outras opções para o kit (' + alt.length + ')</summary>' + alt.map(function (a) { return '<div class="cmp alt"><div style="flex:1"><div class="n">' + esc(a.nome) + '</div><div class="w">' + brl(a.oferta.price) + pixK(a.oferta) + ' em ' + esc(a.oferta.storeName || a.oferta.storeId) + '</div></div><button type="button" class="q" data-add="' + esc(a.productId) + '" aria-label="Adicionar ao kit">+</button></div>'; }).join('') + '</details>';
    if (CESTA.length || ACC.length) h += passos();
    var chips = [OBJ_NOME[R.objetivo], R.objetivo !== 'proteger' ? IDI_NOME[R.idioma || 'pt'] : '', R.favorito ? 'Favorito: ' + R.favorito : ''].filter(Boolean);
    h += '<h3 class="h3 ser">Seu kit' + (orc > 0 ? ' para ' + brl(orc) : '') + '</h3><div class="chips">' + chips.map(function (x) { return '<span>' + esc(x) + '</span>'; }).join('') + '</div>' +
      '<ul class="como"><li>Para cada produto, a oferta mais barata com estoque agora' + (R.objetivo !== 'proteger' ? ', no idioma escolhido' : '') + '.</li>' +
      (R.objetivo !== 'proteger' ? '<li>Com orçamento sobrando, o kit ganha outros produtos e mais pacotes, sem passar do valor.</li>' : '') +
      '<li>Acessórios: o mais barato de cada tipo' + (orc >= 300 || R.objetivo === 'proteger' ? ', entre as marcas de TCG' : '') + '. A comissão nunca escolhe.</li>' +
      (orc > 0 && tot <= orc && (CESTA.length || ACC.length) ? '<li>Sobram ' + brl(orc - tot) + ': dá para trocar algum item ou guardar para o frete.</li>' : '') + '</ul>' +
      '<div class="share"><a class="btn sec" href="https://wa.me/?text=' + encodeURIComponent('Meu kit Pokémon TCG no TCG Price Hunter: ' + linkKit()) + '" target="_blank" rel="noopener" data-share="whatsapp">WhatsApp</a>' +
      '<button type="button" class="btn sec" data-copiar>Copiar link</button><button type="button" class="btn sec" data-imprimir>Imprimir</button></div>' +
      '<div class="row nav"><button type="button" class="lnk" data-refazer>Refazer com outras respostas</button><a class="lnk" href="/oportunidades">Ver todas as ofertas</a></div></div>';
    app.innerHTML = h;
  }
  var pedido = 0; var CUR = null;
  function atualizarCesta() {
    if (!CESTA.length) return renderCesta(null);
    var n = ++pedido;
    fetch('/api/v1/site/kit/cesta?itens=' + encodeURIComponent(CESTA.map(function (i) { return i.productId + ':' + i.quantidade; }).join(','))).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (c) { if (n === pedido) { CUR = c; renderCesta(c); } }).catch(function () { if (n === pedido) renderCesta(null); });
  }
  app.addEventListener('click', function (ev) {
    var b = ev.target.closest('button'); if (!b || !J) return;
    var i, acao;
    if ((i = b.getAttribute('data-mais')) != null) { acao = 'mais'; CESTA[i].quantidade = Math.min(20, CESTA[i].quantidade + 1); }
    else if ((i = b.getAttribute('data-menos')) != null) { acao = 'menos'; if (CESTA[i].quantidade > 1) CESTA[i].quantidade--; else CESTA.splice(i, 1); }
    else if ((i = b.getAttribute('data-remover')) != null) { acao = 'remover'; CESTA.splice(i, 1); }
    else if (b.hasAttribute('data-todos')) { MOSTRAR_TODOS = true; return renderCesta(CESTA.length ? CUR : null); }
    else if (b.hasAttribute('data-copiar')) { track('kit_share', { canal: 'copiar', modelo: J.modelo || '' }); try { navigator.clipboard.writeText(linkKit()).then(function () { b.textContent = 'Link copiado'; }, function () { b.textContent = linkKit(); }); } catch (e) { b.textContent = linkKit(); } return; }
    else if (b.hasAttribute('data-imprimir')) { track('kit_share', { canal: 'imprimir', modelo: J.modelo || '' }); try { window.print(); } catch (e) { /* ok */ } return; }
    else if ((i = b.getAttribute('data-rmacc')) != null) { track('kit_item', { acao: 'remover_acessorio', modelo: J.modelo || '', itens: CESTA.length }); ACC.splice(i, 1); return renderCesta(CESTA.length ? CUR : null); }
    else if ((i = b.getAttribute('data-add')) != null) { acao = 'adicionar'; var a = (J.alternativas || []).find(function (x) { return x.productId === i; }); if (a && CESTA.length < 15) CESTA.push({ productId: a.productId, quantidade: 1, nome: a.nome, porque: a.porque, imagem: a.imagem, oferta: a.oferta }); }
    else return;
    track('kit_item', { acao: acao, modelo: J.modelo || '', itens: CESTA.length });
    renderCesta(null); atualizarCesta();
  });
  // Clique de saída (botão esquerdo ou do meio): evento + página vista /monte-seu-kit/saida/<loja>; o link segue normal.
  function saida(ev) {
    var a = ev.target.closest && ev.target.closest('a[data-saida]'); if (!a || (ev.type === 'auxclick' && ev.button !== 1)) return;
    var loja = slug(a.getAttribute('data-saida'));
    track('kit_click_store', { loja: loja, produto: a.getAttribute('data-pid') || '', preco: Number(a.getAttribute('data-preco')) || null, modelo: (J && J.modelo) || '' });
    vista('/monte-seu-kit/saida/' + loja);
  }
  app.addEventListener('click', function (ev) {
    var sm = ev.target.closest && ev.target.closest('summary[data-abrir]'); if (sm) { var k = sm.getAttribute('data-abrir'); ABERTO[k] = !ABERTO[k]; }
    var w = ev.target.closest && ev.target.closest('a[data-share]'); if (w && J) track('kit_share', { canal: 'whatsapp', modelo: J.modelo || '' });
  });
  app.addEventListener('click', saida);
  app.addEventListener('auxclick', saida);
  function resultado() {
    rota('resultado', false); J = null; ACC = []; ACC_FORA = []; CUR = null; MOSTRAR_TODOS = false; ABERTO = {}; app.innerHTML = barra() + '<p class="sub">Montando seu kit com os preços de agora…</p>';
    var pedir = function (orc) {
      var q = 'objetivo=' + encodeURIComponent(R.objetivo || '') + '&orcamento=' + encodeURIComponent(orc) + '&idioma=' + encodeURIComponent(R.idioma || 'pt') + (R.favorito ? '&favorito=' + encodeURIComponent(R.favorito) : '');
      return fetch('/api/v1/site/kit?' + q).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); }).then(function (x) { if (!x.ok) throw new Error(x.j && x.j.error || 'erro'); return x.j; });
    };
    var orcTotal = Number(R.orcamento) || 0;
    // 1ª chamada com o orçamento todo (diz quais acessórios o modelo pede); com acessórios, pede de novo descontando-os.
    pedir(R.orcamento || '').then(function (j0) {
      if (!Array.isArray(j0.acessorios) || !j0.acessorios.length) return { j: j0, acc: [], fora: [] };
      return listaAcc().then(function (lista) {
        var picks = escolherAcc(lista, j0.acessorios, j0.modelo === 'proteger' || orcTotal >= 300);
        if (!picks.length) return { j: j0, acc: [], fora: [] };
        if (j0.modelo === 'proteger') return { j: j0, acc: picks, fora: [] };   // proteger: kit só de acessórios
        var tentar = function (n) {
          if (n === 0) return { j: j0, acc: [], fora: picks };
          var resto = Math.round((orcTotal - somaAcc(picks.slice(0, n))) * 100) / 100;
          if (!(resto >= 1)) return tentar(n - 1);
          return pedir(String(resto)).then(function (j) { return (j.itens || []).length ? { j: j, acc: picks.slice(0, n), fora: picks.slice(n) } : tentar(n - 1); });
        };
        return (j0.itens || []).length ? tentar(picks.length) : { j: j0, acc: [], fora: [] };
      });
    }).then(function (x) {
      J = x.j; ACC = x.acc; ACC_FORA = x.fora; rota('resultado/' + (J.modelo ? slug(J.modelo) : 'vazio'));
      CESTA = (J.itens || []).map(function (it) { return { productId: it.productId, quantidade: it.quantidade, nome: it.nome, porque: it.porque, imagem: it.imagem, oferta: it.oferta }; });
      var orc = String(R.orcamento || '');
      track('kit_result', { modelo: J.modelo || '', itens: CESTA.length, acessorios: ACC.length, objetivo: R.objetivo || '', idioma: R.idioma || 'pt', faixa: FAIXAS.indexOf(orc) >= 0 ? orc : (orc ? 'outro' : ''), favorito: !!R.favorito });
      CUR = CESTA.length ? { dividir: { subtotal: J.subtotal, total: J.total, fretes: J.fretes || [], pedidos: (J.fretes || []).length }, limitacoes: [] } : null;
      renderCesta(CUR);
    }).catch(function () { rota('resultado/erro'); app.innerHTML = '<p class="err">Não deu para montar o kit agora. Tente de novo em instantes.</p><div class="row"><button type="button" class="btn sec" data-refazer>Recomeçar</button></div>'; });
  }
  // Link compartilhado: ?objetivo=&orcamento=&idioma= abre direto no resultado (sem o Pokémon favorito).
  (function () {
    try {
      var q = new URLSearchParams(location.search); var ob = q.get('objetivo');
      if (!ob || !ETAPAS[0].o.some(function (o) { return o[0] === ob; })) return etapa();
      var orc = Number(q.get('orcamento')); var idi = q.get('idioma');
      if (ob !== 'proteger' && !(orc >= 1 && orc <= 100000)) return etapa();
      R = { objetivo: ob }; if (ob !== 'proteger') { R.orcamento = String(Math.round(orc)); R.idioma = ['pt', 'en', 'ja', 'qualquer'].indexOf(idi) >= 0 ? idi : 'pt'; }
      salvar(); passo = ETAPAS.length - 1; resultado();
    } catch (e) { etapa(); }
  })();

})();
