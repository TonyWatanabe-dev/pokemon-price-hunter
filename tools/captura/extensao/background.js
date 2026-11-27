// Service worker da extensão "TCG Price Hunter – Captura". Recebe os itens lidos pelo content script, acumula o lote do dia por
// loja em chrome.storage.local e grava o arquivo em Downloads/tph-capturas/ (no máximo 1 gravação por loja a cada 30 s).
// Não faz requisição de rede, não guarda token, senha nem cookie.
importScripts('lote.js');

const CHAVE = 'lote';
let fila = Promise.resolve(); // serializa as leituras/escritas do storage
const timers = {};

const emFila = (fn) => { const p = fila.then(fn); fila = p.catch(() => {}); return p; };
const ler = async () => (await chrome.storage.local.get(CHAVE))[CHAVE] || loteVazio(dia(new Date()));
const salvar = (lote) => chrome.storage.local.set({ [CHAVE]: lote });

async function gravar(loja) {
  const lote = await ler();
  const agora = Date.now();
  if (!aGravar(lote, loja, agora)) return;
  await chrome.downloads.download({
    url: urlDados(montarArquivo(lote, loja)),
    filename: nomeArquivo(loja, lote.dia),
    conflictAction: 'overwrite',
    saveAs: false,
  });
  await salvar(marcarGravado(lote, loja, agora));
}

function agendarGravacao(lote, loja) {
  const espera = esperaGravacao(lote, loja, Date.now());
  clearTimeout(timers[loja]);
  timers[loja] = setTimeout(() => emFila(() => gravar(loja)).catch(() => {}), espera);
}

async function aoReceber(msg, sender) {
  if (msg.tipo === 'itens') {
    const lote = acumular(await ler(), msg.loja, msg.itens, dia(new Date()));
    await salvar(lote);
    if (msg.url) {
      const { buscas } = await chrome.storage.local.get('buscas');
      await chrome.storage.local.set({ buscas: marcarBusca(buscas, msg.url, msg.naPagina, Date.now()) });
    }
    if (sender.tab) {
      chrome.action.setBadgeBackgroundColor({ color: '#FFCB05', tabId: sender.tab.id });
      chrome.action.setBadgeText({ text: String(total(lote, msg.loja)), tabId: sender.tab.id });
    }
    agendarGravacao(lote, msg.loja);
  } else if (msg.tipo === 'limpar') {
    await salvar(loteVazio(dia(new Date())));
    for (const l of LOJAS) clearTimeout(timers[l]);
    chrome.action.setBadgeText({ text: '' });
  }
}

chrome.runtime.onMessage.addListener((msg, sender, responder) => {
  if (!msg || (msg.tipo !== 'itens' && msg.tipo !== 'limpar')) return false;
  emFila(() => aoReceber(msg, sender)).then(() => responder({ ok: true }), () => responder({ ok: false }));
  return true;
});
