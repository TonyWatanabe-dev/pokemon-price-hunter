// Botão "Capturar ofertas" (favorito do Chrome). O DONO abre a página de busca do Mercado Livre, da Shopee ou da Amazon e
// clica no favorito: o script lê só o que já está na tela dele (id do anúncio, título, preço, preço "de", vendedor, frete
// grátis), soma ao que foi capturado antes naquela loja (localStorage do próprio site) e mostra um painel com "Baixar".
// Não navega, não abre páginas, não pagina e não faz requisição nenhuma: é a leitura de uma página aberta por uma pessoa.
// O arquivo baixado vai para tools/captura-importar.mjs. Gerar a versão de favorito: node tools/captura/build.mjs
(() => {
  const KEY = 'tph_captura_v1';
  const host = location.hostname;
  const loja = /mercadoli[bv]re\./.test(host) ? 'mercadolivre' : /shopee\./.test(host) ? 'shopee' : /amazon\./.test(host) ? 'amazon' : null;
  if (!loja) { alert('Capturar ofertas: abra uma busca do Mercado Livre, da Shopee ou da Amazon.'); return; }
  const agora = new Date().toISOString();
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
  const validos = itens.filter((i) => i.id && i.titulo && i.preco > 0);
  let base = { versao: 1, loja, itens: [] };
  try { const b = JSON.parse(localStorage.getItem(KEY) || 'null'); if (b && b.loja === loja && Array.isArray(b.itens)) base = b; } catch {}
  const mapa = new Map(base.itens.map((i) => [i.id, i]));
  for (const i of validos) mapa.set(i.id, i);
  base.itens = [...mapa.values()];
  if (!validos.length) base.diagnostico = { url: location.href.split('?')[0], cartoes: itens.length, amostra: (document.querySelector('.poly-card, [data-component-type="s-search-result"], a[href*="-i."]') || document.body).outerHTML.slice(0, 3000) };
  try { localStorage.setItem(KEY, JSON.stringify(base)); } catch {}

  document.getElementById('tph-captura')?.remove();
  const p = document.createElement('div');
  p.id = 'tph-captura';
  p.style.cssText = 'position:fixed;z-index:2147483647;right:16px;bottom:16px;background:#111;color:#fff;font:14px/1.4 system-ui,sans-serif;padding:14px 16px;border-radius:12px;box-shadow:0 8px 30px rgba(0,0,0,.4);max-width:300px';
  const nome = { mercadolivre: 'Mercado Livre', shopee: 'Shopee', amazon: 'Amazon' }[loja];
  p.innerHTML = '<b style="color:#FFCB05">TCG Price Hunter</b><br>' + nome + ': <b>' + validos.length + '</b> ofertas nesta página' +
    '<br>Total capturado: <b>' + base.itens.length + '</b>' + (validos.length ? '' : '<br><span style="color:#ff8a8a">Nada lido aqui. Role a página até o fim e clique de novo; se seguir zerado, baixe o arquivo e mande assim mesmo.</span>') +
    '<div style="margin-top:10px;display:flex;gap:8px"><button id="tph-baixar" style="flex:1;padding:8px;border:0;border-radius:8px;background:#FFCB05;font-weight:700;cursor:pointer">Baixar arquivo</button>' +
    '<button id="tph-limpar" style="padding:8px;border:0;border-radius:8px;background:#333;color:#fff;cursor:pointer">Limpar</button>' +
    '<button id="tph-fechar" style="padding:8px;border:0;border-radius:8px;background:#333;color:#fff;cursor:pointer">✕</button></div>';
  document.body.appendChild(p);
  p.querySelector('#tph-fechar').onclick = () => p.remove();
  p.querySelector('#tph-limpar').onclick = () => { localStorage.removeItem(KEY); p.remove(); };
  p.querySelector('#tph-baixar').onclick = () => {
    const blob = new Blob([JSON.stringify(base, null, 1)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'captura-' + loja + '-' + agora.slice(0, 16).replace(/[:T]/g, '-') + '.json';
    document.body.appendChild(a); a.click(); a.remove();
  };
})();
