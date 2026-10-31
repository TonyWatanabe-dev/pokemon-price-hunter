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
   com frete só aparece sem acessório. "Proteger minhas cartas" vira um kit só de acessórios. */
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
  function barra() { return '<div class="steps" aria-hidden="true">' + ETAPAS.map(function (_, i) { return '<i' + (i <= passo ? ' class="on"' : '') + '></i>'; }).join('') + '</div>'; }
  function etapa() {
    var E = ETAPAS[passo]; rota(E.id);
    if (R.objetivo === 'proteger' && E.id !== 'objetivo') return resultado();
    var h = barra() + '<h2>' + esc(E.t) + '</h2><p class="sub">' + esc(E.s) + '</p>';
    if (E.o) h += '<div class="opts">' + E.o.map(function (o) { return '<button type="button" class="opt" data-v="' + esc(o[0]) + '" aria-pressed="' + (String(R[E.id]) === o[0]) + '">' + esc(o[1]) + (o[2] ? '<small>' + esc(o[2]) + '</small>' : '') + '</button>'; }).join('') + '</div>';
    if (E.outro) h += '<label class="f" for="outro">Outro valor (R$)</label><input id="outro" type="number" inputmode="decimal" min="1" max="100000" placeholder="Ex.: 150" value="' + (R.orcamento && ['50', '100', '200', '400'].indexOf(String(R.orcamento)) < 0 ? esc(R.orcamento) : '') + '">';
    if (E.texto) h += '<label class="f" for="fav">Pokémon favorito</label><input id="fav" type="text" maxlength="40" placeholder="Ex.: Pikachu" value="' + esc(R.favorito || '') + '">';
    h += '<div class="row">' + (passo ? '<button type="button" class="btn sec" data-voltar>Voltar</button>' : '') + '<button type="button" class="btn pri" data-avancar' + (pronto(E) ? '' : ' disabled') + '>' + (passo === ETAPAS.length - 1 ? 'Ver meu kit' : 'Continuar') + '</button></div>';
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
  function escolherAcc(lista, tipos) {
    return (tipos || []).map(function (k) { return lista.filter(function (i) { return i.kit === k; }).sort(function (a, b) { return a.price - b.price || String(a.id).localeCompare(String(b.id)); })[0]; }).filter(Boolean);
  }
  var somaAcc = function (l) { return Math.round(l.reduce(function (s, a) { return s + a.price; }, 0) * 100) / 100; };
  function lido(iso) { var d = new Date(iso); if (isNaN(d)) return ''; try { return 'preço lido em ' + d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' }); } catch (e) { return ''; } }
  function accHTML(a, i) {
    var loja = LOJA_ACC[a.loja] || a.loja;
    return '<div class="item"><span class="noimg" aria-hidden="true"></span><div style="flex:1"><div class="n">' + esc(a.title) + '</div>' +
      '<div class="w">Acessório ' + esc(ACC_PORQUE[a.kit]) + ' · em ' + esc(loja) + ' · ' + esc(lido(a.capturedAt)) + '</div>' +
      '<div class="p">' + (a.aPartirDe ? '<small>a partir de </small>' : '') + brl(a.price) + '</div>' +
      '<div class="qty"><a href="/acessorios.html#' + esc(a.kit) + '">Ver outras opções</a><button type="button" class="rm" data-rmacc="' + i + '">Remover</button></div>' +
      '<a href="' + esc(a.url) + '" target="_blank" rel="sponsored nofollow noopener" data-saida="' + esc(loja) + '" data-pid="acessorio:' + esc(a.kit) + '" data-preco="' + esc(a.price) + '">Ver na loja ↗</a></div></div>';
  }
  // D2: preço no Pix diz "no Pix" (como a página do produto); a API do kit manda priceKind.
  function pixK(o) { return o && o.priceKind === 'pix' ? ' <small>no Pix</small>' : ''; }
  function itemHTML(it, i) {
    var o = it.oferta; var img = /^https:\/\//.test(it.imagem || '') ? it.imagem : '';
    return '<div class="item">' + (img ? '<img src="' + esc(img) + '" alt="' + esc(it.nome) + '" loading="lazy" referrerpolicy="no-referrer">' : '<span class="noimg" aria-hidden="true"></span>') +
      '<div style="flex:1"><div class="n">' + esc(it.nome) + '</div><div class="w">' + esc(it.porque) + ' · em ' + esc(o.storeName || o.storeId) + '</div>' +
      '<div class="p">' + brl(o.price) + pixK(o) + ' <small>cada</small></div>' +
      '<div class="qty"><button type="button" class="q" data-menos="' + i + '" aria-label="Menos uma unidade">−</button><span aria-live="polite">' + it.quantidade + '</span><button type="button" class="q" data-mais="' + i + '" aria-label="Mais uma unidade">+</button>' +
      '<button type="button" class="rm" data-remover="' + i + '">Remover</button></div>' +
      '<a href="' + esc(o.url) + '" target="_blank" rel="noopener nofollow" data-saida="' + esc(o.storeId) + '" data-pid="' + esc(it.productId) + '" data-preco="' + esc(o.price) + '">Ver na loja ↗</a></div></div>';
  }
  function linhaLoja(x, titulo) {
    var lojas = x.fretes.map(function (f) { return esc(f.nome) + ': ' + brl(f.subtotal) + (f.frete == null ? ' + frete a calcular' : f.frete === 0 ? ' · frete grátis' : ' + frete ' + brl(f.frete)); }).join('<br>');
    return '<div class="cmp"><b>' + titulo + '</b><div class="w">' + lojas + '</div><div>' + (x.total != null ? 'Total com frete: <b>' + brl(x.total) + '</b>' : 'Produtos: <b>' + brl(x.subtotal) + '</b> + frete a calcular') + ' · ' + x.pedidos + (x.pedidos === 1 ? ' pedido' : ' pedidos') + '</div></div>';
  }
  function renderCesta(c) {
    var h = '<div class="res"><h2>' + esc(J.nomeModelo || 'Seu kit') + '</h2>';
    if (CESTA.length) h += CESTA.map(itemHTML).join('');
    if (ACC.length) h += '<h3 class="h3">Acessórios para completar</h3>' + ACC.map(accHTML).join('');
    if (!CESTA.length && !ACC.length) h += '<p class="sub">Sua cesta está vazia.</p>';
    var orc = Number(R.orcamento) || J.orcamento || 0; var accSub = somaAcc(ACC);
    if ((c && c.dividir) || ACC.length) {
      var sub = c && c.dividir ? c.dividir.subtotal : 0; var tot = Math.round((sub + accSub) * 100) / 100;
      h += '<div class="sum">' + (ACC.length && CESTA.length ? 'Produtos ' + brl(sub) + ' + acessórios ' + brl(accSub) + '<br>' : '') + 'Kit completo: <b>' + brl(tot) + '</b>' +
        (orc > 0 ? ' de ' + brl(orc) + (tot > orc ? ' <span class="err">· passou do orçamento</span>' : '') : '') +
        (!ACC.length && c && c.dividir && c.dividir.total != null ? '<br>Com frete: <b>' + brl(c.dividir.total) + '</b>' : '<br>Frete: a calcular na loja') + '</div>';
      if (CESTA.length > 1 && c && c.dividir) {
        h += '<h3 class="h3">' + (ACC.length ? 'Onde comprar os produtos' : 'Onde comprar') + '</h3>';
        if (c.umaLoja && c.umaLoja[0]) h += linhaLoja(c.umaLoja[0], 'Tudo numa loja');
        h += linhaLoja(c.dividir, 'Dividindo entre lojas');
        if (c.comparacao) h += '<p class="w">' + (c.comparacao.economia > 0 ? 'Dividir economiza ' + brl(c.comparacao.economia) : c.comparacao.economia < 0 ? 'Comprar numa loja só economiza ' + brl(-c.comparacao.economia) : 'Mesmo valor') + (c.comparacao.base === 'produtos' ? ' nos produtos (sem contar fretes não informados).' : ' no total com frete.') + '</p>';
      }
    }
    var alt = (J.alternativas || []).filter(function (a) { return !CESTA.some(function (it) { return it.productId === a.productId; }); });
    if (alt.length) h += '<h3 class="h3">Outras opções para o kit</h3>' + alt.map(function (a) { return '<div class="cmp alt"><div style="flex:1"><div class="n">' + esc(a.nome) + '</div><div class="w">' + brl(a.oferta.price) + pixK(a.oferta) + ' em ' + esc(a.oferta.storeName || a.oferta.storeId) + '</div></div><button type="button" class="q" data-add="' + esc(a.productId) + '" aria-label="Adicionar ao kit">+</button></div>'; }).join('');
    var lim = (J.limitacoes || []).concat(c && c.limitacoes || []);
    if (ACC_FORA.length) lim.push('Não couberam no orçamento: ' + ACC_FORA.map(function (a) { return ACC_NOME[a.kit] + ' (a partir de ' + brl(a.price) + ')'; }).join(', ') + '. Veja opções na página de acessórios.');
    if (ACC.length) lim.push('Acessórios: preço lido pelo site na data indicada, sem frete; confira na loja antes de comprar.');
    if (lim.length) h += '<ul class="lim">' + lim.map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('') + '</ul>';
    h += '<div class="row"><button type="button" class="btn sec" data-refazer>Refazer</button><a class="btn pri" href="/oportunidades">Ver todas as ofertas</a></div></div>';
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
  app.addEventListener('click', saida);
  app.addEventListener('auxclick', saida);
  function resultado() {
    rota('resultado', false); J = null; ACC = []; ACC_FORA = []; CUR = null; app.innerHTML = barra() + '<p class="sub">Montando seu kit com os preços de agora…</p>';
    var pedir = function (orc) {
      var q = 'objetivo=' + encodeURIComponent(R.objetivo || '') + '&orcamento=' + encodeURIComponent(orc) + '&idioma=' + encodeURIComponent(R.idioma || 'pt') + (R.favorito ? '&favorito=' + encodeURIComponent(R.favorito) : '');
      return fetch('/api/v1/site/kit?' + q).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); }).then(function (x) { if (!x.ok) throw new Error(x.j && x.j.error || 'erro'); return x.j; });
    };
    var orcTotal = Number(R.orcamento) || 0;
    // 1ª chamada com o orçamento todo (diz quais acessórios o modelo pede); com acessórios, pede de novo descontando-os.
    pedir(R.orcamento || '').then(function (j0) {
      if (!Array.isArray(j0.acessorios) || !j0.acessorios.length) return { j: j0, acc: [], fora: [] };
      return listaAcc().then(function (lista) {
        var picks = escolherAcc(lista, j0.acessorios);
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
  etapa();
})();
