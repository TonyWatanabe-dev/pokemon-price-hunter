/* Página /entrar (anúncios → grupo): conta cliques por origem (Vercel Analytics) e mostra comparações reais de preço.
   Sem dados inventados: se a API não responder, a seção de prova fica oculta. Arquivo versionado (cache imutável em /assets/web). */
(function () {
  'use strict';
  window.va = window.va || function () { (window.vaq = window.vaq || []).push(arguments); };
  var q = new URLSearchParams(location.search);
  // Origem do anúncio: /entrar/<origem> (aparece em "Páginas" do Vercel Analytics no plano gratuito) ou utm_* do link.
  var m = location.pathname.match(/^\/entrar\/([a-z0-9-]{1,40})\/?$/i);
  var origem = (m && m[1].toLowerCase()) || [q.get('utm_source'), q.get('utm_medium'), q.get('utm_content')].filter(Boolean).join('-').toLowerCase().replace(/[^a-z0-9-]/g, '').slice(0, 40) || 'direto';
  // Clique no grupo passa por /ir/<canal>/<origem>: uma página vista por clique, contada no plano gratuito, que segue para o convite.
  Array.prototype.forEach.call(document.querySelectorAll('a[data-canal]'), function (a) {
    a.href = '/ir/' + a.dataset.canal + '/' + origem; a.target = '_self'; a.removeAttribute('rel');
  });
  function track(name, data) { try { window.va('event', { name: name, data: data }); } catch (e) { /* sem analytics */ } }
  track('entrar_view', { origem: origem });

  document.addEventListener('click', function (ev) {
    var a = ev.target.closest && ev.target.closest('[data-canal]');
    if (a) track('group_click', { canal: a.dataset.canal, origem: 'entrar:' + origem, pos: a.dataset.pos || '' });
  });

  // Barra fixa do botão aparece quando o botão do topo sai da tela.
  var cta = document.getElementById('cta1'), fixa = document.getElementById('fixa');
  if ('IntersectionObserver' in window && cta && fixa) {
    new IntersectionObserver(function (e) { fixa.classList.toggle('on', !e[0].isIntersecting); }).observe(cta);
  }

  // Prova: maior preço que o site encontrou numa loja × menor preço já registrado.
  var IDS = ['c30-etb', 'me03-desafio', 'c30-colecao_poster', 'me04-etb'];
  var brl = function (v) { return 'R$ ' + Number(v).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.'); };
  var esc = function (s) { return String(s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); };
  function um(id) {
    return Promise.all([
      fetch('/api/v1/produtos/' + id + '/estatisticas').then(function (r) { return r.ok ? r.json() : null; }),
      fetch('/api/v1/site/produto/' + id).then(function (r) { return r.ok ? r.json() : null; }).catch(function () { return null; })
    ]).then(function (res) {
      var d = res[0] && res[0].data, s = d && d.stats;
      var alto = s && s.market && s.market.highest, baixo = s && s.history && s.history.min;
      if (!alto || !baixo || alto < baixo * 1.15) return null;
      var img = res[1] && res[1].product && res[1].product.image;
      return { nome: d.product && d.product.name || id, alto: alto, baixo: baixo, img: /^https:\/\//.test(img || '') ? img : '' };
    }).catch(function () { return null; });
  }
  // Ofertas de hoje: as duas melhores oportunidades atuais da API, abaixo do preço sugerido Copag. Sem dado, a seção fica oculta.
  fetch('/api/v1/oportunidades?limite=6&ordem=score').then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
    var l = (j && j.data || []).filter(function (o) {
      var rc = o.reference_comparison; return o.price > 0 && rc && rc.available && rc.percentage_below >= 5 && o.stock === 'in_stock';
    }).slice(0, 2);
    if (!l.length) return;
    document.getElementById('hoje-itens').innerHTML = l.map(function (o) {
      var img = o.product && o.product.image, rc = o.reference_comparison;
      return '<div class="item">' + (/^https:\/\//.test(img || '') ? '<img src="' + esc(img) + '" alt="" loading="lazy" referrerpolicy="no-referrer">' : '') +
        '<div><div class="n">' + esc(o.product.name) + '</div><div class="p"><s>Copag ' + brl(rc.reference_value) + '</s><strong>' + brl(o.price) + '</strong><em>' +
        String(Math.round(rc.percentage_below)) + '% abaixo</em></div>' + (o.store && o.store.name ? '<div class="loja">em ' + esc(o.store.name) + '</div>' : '') + '</div></div>';
    }).join('');
    document.getElementById('hoje').hidden = false;
  }).catch(function () { /* sem dado, sem seção */ });

  Promise.all(IDS.map(um)).then(function (lista) {
    var ok = lista.filter(Boolean).slice(0, 3);
    if (!ok.length) return;
    document.getElementById('itens').innerHTML = ok.map(function (p) {
      return '<div class="item">' + (p.img ? '<img src="' + esc(p.img) + '" alt="" loading="lazy" referrerpolicy="no-referrer">' : '') +
        '<div><div class="n">' + esc(p.nome) + '</div><div class="p"><s>Já visto por ' + brl(p.alto) + '</s>' +
        '<span class="mv">menor já visto</span><strong>' + brl(p.baixo) + '</strong><em>' + brl(p.alto - p.baixo) + ' a menos</em></div></div></div>';
    }).join('');
    document.getElementById('prova').hidden = false;
  });
})();
