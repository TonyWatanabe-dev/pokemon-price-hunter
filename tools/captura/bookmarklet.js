// Botão "Capturar ofertas" (favorito do Chrome). O DONO abre a página de busca do Mercado Livre, da Shopee ou da Amazon e
// clica no favorito: o script lê só o que já está na tela dele (id do anúncio, título, preço, preço "de", vendedor, frete
// grátis), soma ao que foi capturado antes naquela loja (localStorage do próprio site) e mostra um painel com "Baixar".
// Não navega, não abre páginas, não pagina e não faz requisição nenhuma: é a leitura de uma página aberta por uma pessoa.
// A leitura da página fica em tools/captura/leitor.js (compartilhada com a extensão); este arquivo só tem o painel e depende dele:
// não roda sozinho, o build concatena os dois. O arquivo baixado vai para tools/captura-importar.mjs.
// Gerar a versão de favorito: node tools/captura/build.mjs
(() => {
  const KEY = 'tph_captura_v1';
  const agora = new Date().toISOString();
  const { loja, itens } = lerPagina(document, location, agora);
  if (!loja) { alert('Capturar ofertas: abra uma busca do Mercado Livre, da Shopee ou da Amazon.'); return; }
  const validos = itensValidos(itens);
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
