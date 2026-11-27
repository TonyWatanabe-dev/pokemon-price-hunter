// GERADO por tools/captura/build-extensao.mjs — não edite aqui; edite a fonte e rode o build.
// Leitor compartilhado da captura de ofertas (favorito e extensão do Chrome). Lê SÓ o DOM da página de busca que o dono já abriu
// (ML, Shopee ou Amazon): id do anúncio, título, preço, preço "de", vendedor, frete grátis. Não navega, não rola, não clica e
// não faz requisição. Script clássico, sem imports: o favorito (build.mjs) e a extensão (build-extensao.mjs) concatenam este arquivo.
function lojaDoHost(host) {
  return /mercadoli[bv]re\./.test(host) ? 'mercadolivre' : /shopee\./.test(host) ? 'shopee' : /amazon\./.test(host) ? 'amazon' : null;
}
function lerPagina(document, location, agora) {
  const loja = lojaDoHost(location.hostname);
  if (!loja) return { loja: null, itens: [] };
  const txt = (el) => (el ? el.textContent.replace(/\s+/g, ' ').trim() : '');
  const brl = (s) => { const m = /R\$\s*([\d.]+(?:,\d{1,2})?)/.exec(s || ''); return m ? Number(m[1].replace(/\./g, '').replace(',', '.')) : null; };
  const andes = (el) => {
    if (!el) return null;
    const f = el.querySelector('.andes-money-amount__fraction'); const c = el.querySelector('.andes-money-amount__cents');
    if (f) return Number(txt(f).replace(/\./g, '') + '.' + (c ? txt(c).padEnd(2, '0') : '00'));
    return brl(el.getAttribute('aria-label') || txt(el));
  };
  const itens = [];
  if (loja === 'mercadolivre') {
    const cards = new Set([...document.querySelectorAll('.poly-card, li.ui-search-layout__item, .ui-search-result__wrapper')].map((c) => c.closest('li') || c));
    for (const c of cards) {
      const links = [...c.querySelectorAll('a[href]')].map((a) => { try { return decodeURIComponent(a.href); } catch { return a.href; } });
      let id = null;
      for (const h of links) { const m = /[?&#]wid=MLB-?(\d+)/i.exec(h) || /item_id[:=]MLB-?(\d+)/i.exec(h) || /\/MLB-(\d{6,})/.exec(h); if (m) { id = 'MLB' + m[1]; break; } }
      const titulo = txt(c.querySelector('.poly-component__title, .ui-search-item__title, h2, h3'));
      const preco = andes(c.querySelector('.poly-price__current .andes-money-amount, .ui-search-price__second-line .andes-money-amount, .andes-money-amount:not(.andes-money-amount--previous)'));
      const precoDe = andes(c.querySelector('.andes-money-amount--previous'));
      const vendedor = txt(c.querySelector('.poly-component__seller, .ui-search-official-store-label')).replace(/^por\s+/i, '') || null;
      itens.push({ loja, id, titulo, preco, precoDe, vendedor, freteGratis: /frete gr[áa]tis/i.test(c.textContent), url: links[0] || null, capturadoEm: agora });
    }
  } else if (loja === 'amazon') {
    for (const c of document.querySelectorAll('[data-component-type="s-search-result"][data-asin]')) {
      const id = c.getAttribute('data-asin');
      if (!id) continue;
      const titulo = txt(c.querySelector('h2 span, h2'));
      const preco = brl(txt(c.querySelector('.a-price:not(.a-text-price) .a-offscreen')));
      const precoDe = brl(txt(c.querySelector('.a-price.a-text-price .a-offscreen')));
      itens.push({ loja, id, titulo, preco, precoDe, vendedor: null, freteGratis: /frete gr[áa]tis/i.test(c.textContent), url: location.origin + '/dp/' + id, capturadoEm: agora });
    }
  } else {
    const vistos = new Set();
    for (const a of document.querySelectorAll('a[href]')) {
      const m = /-i\.(\d+)\.(\d+)/.exec(a.href) || /\/product\/(\d+)\/(\d+)/.exec(a.href);
      if (!m) continue;
      const id = m[1] + '/' + m[2];
      if (vistos.has(id)) continue; vistos.add(id);
      const t = a.innerText || '';
      const linhas = t.split('\n').map((s) => s.trim()).filter(Boolean);
      const titulo = linhas.filter((l) => !/R\$|vendid|%|^\d/.test(l)).sort((x, y) => y.length - x.length)[0] || '';
      const precos = [...t.matchAll(/R\$\s*([\d.]+(?:,\d{1,2})?)/g)].map((x) => Number(x[1].replace(/\./g, '').replace(',', '.')));
      const faixa = /R\$\s*[\d.,]+\s*-\s*R\$/.test(t);
      itens.push({ loja, id, titulo: faixa ? titulo + ' / várias opções' : titulo, preco: precos.length ? Math.min(...precos) : null, precoDe: precos.length > 1 ? Math.max(...precos) : null,
        vendedor: null, freteGratis: /frete gr[áa]tis/i.test(t), url: a.href.split('?')[0], capturadoEm: agora });
    }
  }
  return { loja, itens };
}
function itensValidos(itens) {
  return itens.filter((i) => i.id && i.titulo && i.preco > 0);
}
