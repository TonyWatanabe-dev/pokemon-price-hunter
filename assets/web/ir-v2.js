/* /ir/<canal>/<origem>: a página vista é a contagem (Vercel Analytics, sem cookies); depois segue para o convite oficial.
   No navegador interno do Instagram/Facebook/TikTok o redirecionamento automático costuma não abrir o WhatsApp
   (o app só deixa abrir outro app com um toque). Lá mostramos um botão que abre o WhatsApp direto, e o plano B. */
(function () {
  'use strict';
  var a = document.getElementById('ir');
  var canal = (location.pathname.split('/')[2] || '').toLowerCase();
  var destino = canal === 'telegram' ? a.dataset.tg : a.dataset.wa;
  var ua = navigator.userAgent || '';
  var appInterno = /Instagram|FBAN|FBAV|FB_IAB|TikTok|musical_ly|Bytedance/i.test(ua);
  var android = /Android/i.test(ua);
  var codigo = (destino.match(/^https:\/\/chat\.whatsapp\.com\/([A-Za-z0-9]{10,40})$/) || [])[1];
  var app = destino;
  if (canal !== 'telegram' && codigo) {
    app = android
      ? 'intent://chat/?code=' + codigo + '#Intent;scheme=whatsapp;package=com.whatsapp;S.browser_fallback_url=' + encodeURIComponent(destino) + ';end'
      : 'whatsapp://chat?code=' + codigo;
  }
  a.href = destino;
  if (!appInterno) {
    setTimeout(function () { location.replace(destino); }, 700);
    return;
  }
  var botao = document.getElementById('abrir');
  botao.href = app;
  botao.textContent = canal === 'telegram' ? 'Abrir o Telegram' : 'Abrir o WhatsApp';
  document.getElementById('interno').hidden = false;
  document.getElementById('auto').hidden = true;
  var link = document.getElementById('link');
  link.textContent = destino.replace(/^https:\/\//, '');
  var copiar = document.getElementById('copiar');
  copiar.addEventListener('click', function () {
    var ok = function () { copiar.textContent = 'Link copiado! Cole no WhatsApp ou no navegador'; };
    var seleciona = function () {
      var r = document.createRange(); r.selectNodeContents(link);
      var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
      copiar.textContent = 'Segure no link abaixo e toque em Copiar';
    };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(destino).then(ok, seleciona);
    else seleciona();
  });
})();
