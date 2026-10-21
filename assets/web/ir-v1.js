/* /ir/<canal>/<origem>: a página vista é a contagem (Vercel Analytics, sem cookies); depois segue para o convite oficial. */
(function () {
  'use strict';
  var a = document.getElementById('ir');
  var canal = (location.pathname.split('/')[2] || '').toLowerCase();
  var destino = canal === 'telegram' ? a.dataset.tg : a.dataset.wa;
  a.href = destino;
  setTimeout(function () { location.replace(destino); }, 700);
})();
