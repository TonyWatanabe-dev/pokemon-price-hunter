/* Acessórios (acessorios.html): lista curada de config/afiliados/acessorios.json, publicada em /data/afiliados-acessorios.json.
   Camada à parte do catálogo de lacrados: não vira oferta, ranking, Score, alerta nem entra no total do kit. Ordem = menor
   preço primeiro (comissão nunca muda a ordem). Cada item mostra a data e a hora da leitura do dono; leitura com mais de
   7 dias ganha aviso. A URL de afiliado chega pronta do arquivo; nada é anexado a ela. Filtro por categoria no hash
   (#sleeve, #fichario, #toploader, #playmat, #deck_box), para o kit linkar direto. Clique de saída: evento anônimo. */
(function () {
  'use strict';
  var app = document.getElementById('app');
  var esc = function (s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  var brl = function (v) { return 'R$ ' + Number(v).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.'); };
  var LOJA = { mercadolivre: 'Mercado Livre', amazon: 'Amazon', shopee: 'Shopee' };
  var CAT = [['', 'Todos'], ['sleeve', 'Sleeves'], ['fichario', 'Fichários'], ['toploader', 'Toploaders'], ['playmat', 'Playmats'], ['deck_box', 'Deck boxes']];
  var itens = []; var cat = ''; var loja = '';
  function track(name, data) { try { window.va && window.va('event', { name: name, data: data || {} }); } catch (e) { /* sem analytics */ } }
  function quando(iso) {
    var d = new Date(iso); if (isNaN(d)) return '';
    var dd = d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit', timeZone: 'America/Sao_Paulo' });
    var hh = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit', timeZone: 'America/Sao_Paulo' });
    var velho = Date.now() - d.getTime() > 7 * 864e5;
    return 'Lido em ' + dd + ' às ' + hh + (velho ? ' · pode ter mudado' : '');
  }
  function chips(lista, atual, tipo) {
    return '<div class="chips" role="group" aria-label="' + (tipo === 'cat' ? 'Categoria' : 'Loja') + '">' + lista.map(function (c) {
      return '<button type="button" class="chip" data-' + tipo + '="' + c[0] + '" aria-pressed="' + (c[0] === atual) + '">' + esc(c[1]) + '</button>';
    }).join('') + '</div>';
  }
  function card(i) {
    var preco = (i.aPartirDe ? '<small>a partir de </small>' : '') + brl(i.price) +
      (i.priceCupom ? ' <small>(' + brl(i.priceCupom) + ' com cupom da loja)</small>' : '');
    var info = [i.marca, i.qtd].filter(Boolean).map(esc).join(' · ');
    var vend = 'Vendido por ' + esc(i.seller) + (i.estoque ? ' · ' + esc(/^\d+$/.test(i.estoque) ? i.estoque + ' disponíveis' : i.estoque) : '');
    return '<div class="acc"><div class="t"><div class="n">' + esc(i.title) + '</div><span class="loja">' + esc(LOJA[i.loja] || i.loja) + '</span></div>' +
      '<div class="w">' + info + '</div><div class="p">' + preco + '</div><div class="w">' + vend + '</div><div class="w">' + esc(quando(i.capturedAt)) + '</div>' +
      '<a class="ver" href="' + esc(i.url) + '" target="_blank" rel="sponsored nofollow noopener" data-loja="' + esc(i.loja) + '" data-kit="' + esc(i.kit) + '">Ver na loja</a></div>';
  }
  function render() {
    var vis = itens.filter(function (i) { return (!cat || i.kit === cat) && (!loja || i.loja === loja); })
      .sort(function (a, b) { return a.price - b.price; });
    var lojas = [['', 'Todas as lojas']].concat(Object.keys(LOJA).map(function (k) { return [k, LOJA[k]]; }));
    app.innerHTML = chips(CAT, cat, 'cat') + chips(lojas, loja, 'loja') +
      '<p class="cnt">' + vis.length + (vis.length === 1 ? ' item' : ' itens') + ', do menor preço ao maior. Preço sem frete.</p>' +
      (vis.length ? vis.map(card).join('') : '<p class="cnt">Nada nesta combinação.</p>');
  }
  app.addEventListener('click', function (e) {
    var b = e.target.closest('button.chip'); var a = e.target.closest('a.ver');
    if (b) {
      if (b.hasAttribute('data-cat')) { cat = b.getAttribute('data-cat'); try { history.replaceState(null, '', cat ? '#' + cat : location.pathname); } catch (x) { /* ok */ } }
      else loja = b.getAttribute('data-loja');
      render();
    } else if (a) track('acessorio_saida', { loja: a.getAttribute('data-loja'), categoria: a.getAttribute('data-kit') });
  });
  var h = location.hash.slice(1); if (CAT.some(function (c) { return c[0] === h; })) cat = h;
  fetch('/data/afiliados-acessorios.json').then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; }).then(function (j) {
    itens = (j && Array.isArray(j.itens) ? j.itens : []).filter(function (i) { return i && typeof i.price === 'number' && i.price > 0 && /^https:\/\//.test(i.url || ''); });
    if (!itens.length) { app.innerHTML = '<p class="err">Não foi possível carregar a lista agora. Tente de novo em instantes.</p>'; return; }
    render();
  });
})();
