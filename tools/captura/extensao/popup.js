// Popup da extensão: contagem por loja (lote de hoje), hora da última gravação, limpar lote e os links das buscas
// com ✓ (lida nas últimas 48 h: hora e ofertas) ou ○ pendente; o botão abre as pendentes só quando o dono clica.
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

  async function desenharBuscas() {
    const { buscas } = await chrome.storage.local.get('buscas');
    const agora = Date.now();
    const caixa = document.getElementById('buscas');
    caixa.textContent = '';
    const pendentes = [];
    let feitas = 0; let todas = 0;
    for (const loja of LOJAS) {
      const det = document.createElement('details');
      const sum = document.createElement('summary');
      const links = document.createElement('div');
      links.className = 'links';
      let ok = 0;
      for (const b of BUSCAS[loja]) {
        const e = estadoBusca(buscas, b.url, agora);
        const a = document.createElement('a');
        a.href = b.url;
        a.target = '_blank';
        a.rel = 'noopener';
        a.className = e.feita ? 'feita' : 'pendente';
        const nome = b.rotulo + (b.pagina > 1 ? ' (pág. ' + b.pagina + ')' : '');
        a.textContent = e.feita ? '✓ ' + nome + ' — ' + quandoFoi(e.em) + ', ' + e.n + ' ofertas' : '○ ' + nome;
        links.append(a);
        if (e.feita) ok++; else pendentes.push(b.url);
      }
      feitas += ok; todas += BUSCAS[loja].length;
      sum.textContent = NOMES[loja] + ': ' + ok + ' de ' + BUSCAS[loja].length + ' feitas';
      det.open = ok < BUSCAS[loja].length;
      det.append(sum, links);
      caixa.append(det);
    }
    document.getElementById('resumo').textContent = feitas + ' de ' + todas + ' buscas feitas nas últimas 48 h';
    const bt = document.getElementById('abrir');
    bt.textContent = pendentes.length ? 'Abrir as ' + pendentes.length + ' pendentes' : 'Tudo em dia ✓';
    bt.disabled = !pendentes.length;
    bt.onclick = async () => {
      // Só quando o dono clica: abre as pendentes em abas, uma a cada 1,5 s (como "Abrir tudo" dos favoritos do Chrome).
      bt.disabled = true;
      for (const [i, url] of pendentes.entries()) {
        await chrome.tabs.create({ url, active: false });
        if (i < pendentes.length - 1) await new Promise((r) => setTimeout(r, 1500));
      }
    };
  }
  const quandoFoi = (ms) => {
    const d = new Date(ms); const hoje = new Date();
    const h = d.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
    return d.toDateString() === hoje.toDateString() ? 'hoje ' + h : d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' }) + ' ' + h;
  };

  document.getElementById('limpar').addEventListener('click', async () => {
    await chrome.runtime.sendMessage({ tipo: 'limpar' });
    desenharContagens();
  });
  chrome.storage.onChanged.addListener(() => { desenharContagens(); desenharBuscas(); });
  desenharContagens();
  desenharBuscas();
})();
