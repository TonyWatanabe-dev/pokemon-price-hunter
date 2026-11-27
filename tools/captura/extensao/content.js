// GERADO por tools/captura/build-extensao.mjs — não edite aqui; edite a fonte e rode o build.
// Cola do content script da extensão (vira extensao/content.js pelo build-extensao.mjs; depende do leitor.js carregado antes).
// Lê a página de busca que o dono abriu: ao carregar e de novo quando o DOM muda (debounce de 2 s), para pegar o que aparece quando
// ele rola. Só observa e lê: não navega, não rola, não clica e não faz requisição. Manda ao service worker só itens válidos
// (id, título, preço > 0) e só os que são novos ou mudaram de preço desde o último envio desta página.
(() => {
  const enviados = new Map();
  const ler = () => {
    const { loja, itens } = lerPagina(document, location, new Date().toISOString());
    if (!loja) return;
    const validos = itensValidos(itens);
    const novos = validos.filter((i) => enviados.get(i.id) !== i.preco);
    if (!novos.length) return;
    for (const i of novos) enviados.set(i.id, i.preco);
    // url + total lido na página: o popup marca esta busca como feita (✓ hora, n ofertas).
    try { chrome.runtime.sendMessage({ tipo: 'itens', loja, itens: novos, url: location.href, naPagina: validos.length }).catch(() => {}); } catch { /* extensão recarregada */ }
  };
  let t = null;
  const aoMudar = () => { clearTimeout(t); t = setTimeout(ler, 2000); };
  ler();
  new MutationObserver(aoMudar).observe(document.documentElement, { childList: true, subtree: true });
})();
