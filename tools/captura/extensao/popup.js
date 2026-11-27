// Popup da extensão: contagem por loja (lote de hoje), hora da última gravação, limpar lote e os links das buscas
// (links normais: o dono clica em cada um; nada é aberto sozinho).
(() => {
  const hora = (ms) => (ms ? new Date(ms).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : '—');

  async function desenharContagens() {
    const lote = (await chrome.storage.local.get('lote')).lote;
    const hoje = dia(new Date());
    const caixa = document.getElementById('contagens');
    caixa.textContent = '';
    for (const loja of LOJAS) {
      const valido = lote && lote.dia === hoje ? lote : null;
      const l = valido && valido.lojas[loja];
      const linha = document.createElement('div');
      linha.className = 'linha';
      const nome = document.createElement('span');
      nome.textContent = NOMES[loja] + ': ' + total(valido, loja);
      const quando = document.createElement('small');
      quando.textContent = 'gravado ' + hora(l && l.gravadoEm) + (l && l.sujo ? ' (pendente)' : '');
      linha.append(nome, quando);
      caixa.append(linha);
    }
  }

  function desenharBuscas() {
    const caixa = document.getElementById('buscas');
    for (const loja of LOJAS) {
      const det = document.createElement('details');
      const sum = document.createElement('summary');
      sum.textContent = NOMES[loja] + ' (' + BUSCAS[loja].length + ')';
      const links = document.createElement('div');
      links.className = 'links';
      for (const b of BUSCAS[loja]) {
        const a = document.createElement('a');
        a.href = b.url;
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = b.rotulo + (b.pagina > 1 ? ' (pág. ' + b.pagina + ')' : '');
        links.append(a);
      }
      det.append(sum, links);
      caixa.append(det);
    }
  }

  document.getElementById('limpar').addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ tipo: 'limpar' });
    desenharContagens();
  });
  chrome.storage.onChanged.addListener(desenharContagens);
  desenharContagens();
  desenharBuscas();
})();
