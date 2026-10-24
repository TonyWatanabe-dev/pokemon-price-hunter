/* Monte seu kit (docs/monte-seu-kit.md, K3): questionário em etapas → /api/v1/site/kit. Protótipo, fora do menu e do índice.
   Respostas só na sessão (sessionStorage, com try/catch). Cada etapa vira um caminho (/monte-seu-kit/<etapa>) para o
   Vercel Analytics gratuito contar o funil por página vista, anônimo. Nenhum preço é calculado aqui: tudo vem da API. */
(function () {
  'use strict';
  window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };
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
  function rota(nome) { try { history.replaceState(null, '', '/monte-seu-kit/' + nome); } catch (e) { /* ok */ } }
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
    if (b.hasAttribute('data-refazer')) { R = {}; J = null; CESTA = []; salvar(); passo = 0; return etapa(); }
  });
  app.addEventListener('input', function (ev) {
    if (ev.target.id === 'outro') { var v = Number(ev.target.value); if (v >= 1) { R.orcamento = String(Math.round(v)); salvar(); } app.querySelectorAll('.opt').forEach(function (o) { o.setAttribute('aria-pressed', String(o.dataset.v === String(R.orcamento))); }); var a = app.querySelector('[data-avancar]'); if (a) a.disabled = !(R.orcamento >= 1); }
    if (ev.target.id === 'fav') { R.favorito = ev.target.value.slice(0, 40); salvar(); }
  });
  // Cesta (K4): itens do resultado, com quantidade e remoção; a comparação "uma loja × dividir" vem de /api/v1/site/kit/cesta.
  var CESTA = []; var J = null;
  function itemHTML(it, i) {
    var o = it.oferta; var img = /^https:\/\//.test(it.imagem || '') ? it.imagem : '';
    return '<div class="item">' + (img ? '<img src="' + esc(img) + '" alt="' + esc(it.nome) + '" loading="lazy" referrerpolicy="no-referrer">' : '<span class="noimg" aria-hidden="true"></span>') +
      '<div style="flex:1"><div class="n">' + esc(it.nome) + '</div><div class="w">' + esc(it.porque) + ' · em ' + esc(o.storeName || o.storeId) + '</div>' +
      '<div class="p">' + brl(o.price) + ' <small>cada</small></div>' +
      '<div class="qty"><button type="button" class="q" data-menos="' + i + '" aria-label="Menos uma unidade">−</button><span aria-live="polite">' + it.quantidade + '</span><button type="button" class="q" data-mais="' + i + '" aria-label="Mais uma unidade">+</button>' +
      '<button type="button" class="rm" data-remover="' + i + '">Remover</button></div>' +
      '<a href="' + esc(o.url) + '" target="_blank" rel="noopener nofollow">Ver na loja ↗</a></div></div>';
  }
  function linhaLoja(x, titulo) {
    var lojas = x.fretes.map(function (f) { return esc(f.nome) + ': ' + brl(f.subtotal) + (f.frete == null ? ' + frete a calcular' : f.frete === 0 ? ' · frete grátis' : ' + frete ' + brl(f.frete)); }).join('<br>');
    return '<div class="cmp"><b>' + titulo + '</b><div class="w">' + lojas + '</div><div>' + (x.total != null ? 'Total com frete: <b>' + brl(x.total) + '</b>' : 'Produtos: <b>' + brl(x.subtotal) + '</b> + frete a calcular') + ' · ' + x.pedidos + (x.pedidos === 1 ? ' pedido' : ' pedidos') + '</div></div>';
  }
  function renderCesta(c) {
    var h = '<div class="res"><h2>' + esc(J.nomeModelo || 'Seu kit') + '</h2>';
    if (CESTA.length) h += CESTA.map(itemHTML).join('');
    else h += '<p class="sub">Sua cesta está vazia.</p>';
    if (c && c.dividir) {
      var sub = c.dividir.subtotal;
      h += '<div class="sum">Produtos: <b>' + brl(sub) + '</b> de ' + brl(J.orcamento) + (sub > J.orcamento ? ' <span class="err">· passou do orçamento</span>' : '') + (c.dividir.total != null ? '<br>Com frete: <b>' + brl(c.dividir.total) + '</b>' : '<br>Frete: a calcular na loja') + '</div>';
      if (CESTA.length > 1) {
        h += '<h3 class="h3">Onde comprar</h3>';
        if (c.umaLoja && c.umaLoja[0]) h += linhaLoja(c.umaLoja[0], 'Tudo numa loja');
        h += linhaLoja(c.dividir, 'Dividindo entre lojas');
        if (c.comparacao) h += '<p class="w">' + (c.comparacao.economia > 0 ? 'Dividir economiza ' + brl(c.comparacao.economia) : c.comparacao.economia < 0 ? 'Comprar numa loja só economiza ' + brl(-c.comparacao.economia) : 'Mesmo valor') + (c.comparacao.base === 'produtos' ? ' nos produtos (sem contar fretes não informados).' : ' no total com frete.') + '</p>';
      }
    }
    var alt = (J.alternativas || []).filter(function (a) { return !CESTA.some(function (it) { return it.productId === a.productId; }); });
    if (alt.length) h += '<h3 class="h3">Outras opções para o kit</h3>' + alt.map(function (a) { return '<div class="cmp alt"><div style="flex:1"><div class="n">' + esc(a.nome) + '</div><div class="w">' + brl(a.oferta.price) + ' em ' + esc(a.oferta.storeName || a.oferta.storeId) + '</div></div><button type="button" class="q" data-add="' + esc(a.productId) + '" aria-label="Adicionar ao kit">+</button></div>'; }).join('');
    var lim = (J.limitacoes || []).concat(c && c.limitacoes || []);
    if (lim.length) h += '<ul class="lim">' + lim.map(function (l) { return '<li>' + esc(l) + '</li>'; }).join('') + '</ul>';
    h += '<div class="row"><button type="button" class="btn sec" data-refazer>Refazer</button><a class="btn pri" href="/oportunidades">Ver todas as ofertas</a></div></div>';
    app.innerHTML = h;
  }
  var pedido = 0;
  function atualizarCesta() {
    if (!CESTA.length) return renderCesta(null);
    var n = ++pedido;
    fetch('/api/v1/site/kit/cesta?itens=' + encodeURIComponent(CESTA.map(function (i) { return i.productId + ':' + i.quantidade; }).join(','))).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (c) { if (n === pedido) renderCesta(c); }).catch(function () { if (n === pedido) renderCesta(null); });
  }
  app.addEventListener('click', function (ev) {
    var b = ev.target.closest('button'); if (!b || !J) return;
    var i;
    if ((i = b.getAttribute('data-mais')) != null) { CESTA[i].quantidade = Math.min(20, CESTA[i].quantidade + 1); }
    else if ((i = b.getAttribute('data-menos')) != null) { if (CESTA[i].quantidade > 1) CESTA[i].quantidade--; else CESTA.splice(i, 1); }
    else if ((i = b.getAttribute('data-remover')) != null) { CESTA.splice(i, 1); }
    else if ((i = b.getAttribute('data-add')) != null) { var a = (J.alternativas || []).find(function (x) { return x.productId === i; }); if (a && CESTA.length < 15) CESTA.push({ productId: a.productId, quantidade: 1, nome: a.nome, porque: a.porque, imagem: a.imagem, oferta: a.oferta }); }
    else return;
    renderCesta(null); atualizarCesta();
  });
  function resultado() {
    rota('resultado'); J = null; app.innerHTML = barra() + '<p class="sub">Montando seu kit com os preços de agora…</p>';
    var q = 'objetivo=' + encodeURIComponent(R.objetivo || '') + '&orcamento=' + encodeURIComponent(R.orcamento || '') + '&idioma=' + encodeURIComponent(R.idioma || 'pt') + (R.favorito ? '&favorito=' + encodeURIComponent(R.favorito) : '');
    fetch('/api/v1/site/kit?' + q).then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); }).then(function (x) {
      if (!x.ok) throw new Error(x.j && x.j.error || 'erro');
      J = x.j; if (J.modelo) rota('resultado/' + J.modelo);
      CESTA = (J.itens || []).map(function (it) { return { productId: it.productId, quantidade: it.quantidade, nome: it.nome, porque: it.porque, imagem: it.imagem, oferta: it.oferta }; });
      renderCesta(CESTA.length ? { dividir: { subtotal: J.subtotal, total: J.total, fretes: J.fretes || [], pedidos: (J.fretes || []).length }, limitacoes: [] } : null);
    }).catch(function () { app.innerHTML = '<p class="err">Não deu para montar o kit agora. Tente de novo em instantes.</p><div class="row"><button type="button" class="btn sec" data-refazer>Recomeçar</button></div>'; });
  }
  etapa();
})();
