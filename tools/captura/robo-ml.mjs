#!/usr/bin/env node
// Robô LOCAL do Mercado Livre (27/11/2026). Roda no PC do dono pelo Agendador do Windows (nunca no GitHub Actions) e lê as
// buscas PÚBLICAS do ML, uma por vez, com User-Agent próprio e honesto, respeitando o robots.txt. Grava o mesmo arquivo do
// botão "Capturar ofertas" (tools/captura/bookmarklet.js) em tools/captura/auto/, que segue para tools/captura-importar.mjs.
//
//   node tools/captura/robo-ml.mjs
//
// Regras: sem cookie, login, proxy ou rotação de IP; 1 requisição por vez, 8 s + 0–4 s de intervalo; se o robots.txt não
// carregar, aborta; se uma resposta não for 200, ou for verificação/CAPTCHA/login, ou vier sem nenhum cartão, PARA a rodada
// na hora (sem tentar de novo) e sai com código 2. Códigos de saída: 0 ok (inclusive 0 itens), 1 erro, 2 bloqueio/parada.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');

export const UA = 'TCGPriceHunterBot/1.0 (+https://tcgpricehunter.com.br/bot)';
export const UA_TOKEN = 'TCGPriceHunterBot';
export const BASE = 'https://lista.mercadolivre.com.br';
export const SLUGS = Object.freeze([
  'pokemon-tcg-blister-unitario', 'pokemon-tcg-blister-duplo', 'pokemon-tcg-blister-triplo', 'pokemon-tcg-blister-quadruplo',
  'pokemon-tcg-booster-copag', 'pokemon-tcg-treinador-avancado', 'pokemon-tcg-box-colecao', 'pokemon-tcg-reinado-delta',
  'pokemon-tcg-escuridao-absoluta', 'pokemon-tcg-30-anos', 'pokemon-tcg-booster-box',
]);
export const SUFIXO_PAG2 = '_Desde_49_NoIndex_True';
export const INTERVALO_MS = 8000;
export const JITTER_MS = 4000;

export function urlBusca(slug, pagina) {
  return `${BASE}/${slug}${pagina === 2 ? SUFIXO_PAG2 : ''}`;
}
export function listaDeBuscas() {
  return SLUGS.flatMap((slug) => [1, 2].map((pagina) => ({ slug, pagina, url: urlBusca(slug, pagina) })));
}

// ---------------------------------------------------------------- robots.txt

/** Lê o robots.txt em grupos { agentes: [minúsculo], regras: [{ permite, padrao }] }. */
export function parseRobots(texto) {
  const grupos = [];
  let atual = null;
  let lendoAgentes = false;
  for (const bruta of String(texto || '').split(/\r?\n/)) {
    const linha = bruta.replace(/#.*$/, '').trim();
    if (!linha) continue;
    const m = /^([A-Za-z-]+)\s*:\s*(.*)$/.exec(linha);
    if (!m) continue;
    const campo = m[1].toLowerCase();
    const valor = m[2].trim();
    if (campo === 'user-agent') {
      if (!atual || !lendoAgentes) { atual = { agentes: [], regras: [] }; grupos.push(atual); }
      atual.agentes.push(valor.toLowerCase());
      lendoAgentes = true;
    } else if (campo === 'allow' || campo === 'disallow') {
      lendoAgentes = false;
      if (atual) atual.regras.push({ permite: campo === 'allow', padrao: valor });
    } else {
      lendoAgentes = false;
    }
  }
  return grupos;
}

function padraoParaRegex(padrao) {
  const fim = padrao.endsWith('$');
  const corpo = fim ? padrao.slice(0, -1) : padrao;
  const re = corpo.split('*').map((p) => p.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp(`^${re}${fim ? '$' : ''}`);
}

/**
 * Decide se `ua` pode abrir `caminho` (path + query). Grupo específico do nosso UA tem prioridade sobre `*`;
 * dentro do grupo vale a regra de padrão mais longo, e Allow vence o empate. Disallow vazio não bloqueia.
 */
export function robotsPermite(grupos, ua, caminho) {
  const nome = String(ua).split(/[\s/]/)[0].toLowerCase();
  const especificos = grupos.filter((g) => g.agentes.some((a) => a !== '*' && a && nome.includes(a)));
  const escolhidos = especificos.length ? especificos : grupos.filter((g) => g.agentes.includes('*'));
  let melhor = null;
  for (const g of escolhidos) {
    for (const r of g.regras) {
      if (!r.padrao) continue;
      if (!padraoParaRegex(r.padrao).test(caminho)) continue;
      if (!melhor || r.padrao.length > melhor.padrao.length || (r.padrao.length === melhor.padrao.length && r.permite && !melhor.permite)) melhor = r;
    }
  }
  return melhor ? melhor.permite : true;
}

// ---------------------------------------------------------------- parser do HTML da busca

const ENTIDADES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ', ordm: 'º', ordf: 'ª', aacute: 'á', eacute: 'é', iacute: 'í', oacute: 'ó', uacute: 'ú', agrave: 'à', acirc: 'â', ecirc: 'ê', ocirc: 'ô', atilde: 'ã', otilde: 'õ', ccedil: 'ç', Aacute: 'Á', Eacute: 'É', Iacute: 'Í', Oacute: 'Ó', Uacute: 'Ú', Acirc: 'Â', Ecirc: 'Ê', Ocirc: 'Ô', Atilde: 'Ã', Otilde: 'Õ', Ccedil: 'Ç' };
export function decodificarEntidades(s) {
  return String(s ?? '').replace(/&(#x[0-9a-f]+|#\d+|[a-z]+\d*);/gi, (todo, e) => {
    if (e[0] === '#') {
      const n = e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10);
      try { return String.fromCodePoint(n); } catch { return todo; }
    }
    return Object.hasOwn(ENTIDADES, e) ? ENTIDADES[e] : todo;
  });
}
const texto = (html) => decodificarEntidades(String(html || '').replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>/gi, ' ').replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();

const VOID = new Set(['br', 'img', 'input', 'hr', 'meta', 'link', 'source', 'wbr']);
/** Acha o próximo elemento cujo atributo class contém o token exato; devolve { tag, aberto, interno, ini, fim }. */
function elemento(html, token, de = 0) {
  const reAbre = /<([a-zA-Z][a-zA-Z0-9]*)\b([^>]*)>/g;
  reAbre.lastIndex = de;
  let m;
  while ((m = reAbre.exec(html))) {
    const cls = /\bclass\s*=\s*(?:"([^"]*)"|'([^']*)')/.exec(m[2]);
    if (!cls || !(cls[1] ?? cls[2]).split(/\s+/).includes(token)) continue;
    const tag = m[1].toLowerCase();
    const ini = m.index;
    const iniInterno = ini + m[0].length;
    if (VOID.has(tag) || m[0].endsWith('/>')) return { tag, aberto: m[0], interno: '', ini, fim: iniInterno };
    const re = new RegExp(`<(/?)${tag}\\b[^>]*>`, 'gi');
    re.lastIndex = iniInterno;
    let nivel = 1;
    let c;
    while ((c = re.exec(html))) {
      nivel += c[1] ? -1 : (c[0].endsWith('/>') ? 0 : 1);
      if (nivel === 0) return { tag, aberto: m[0], interno: html.slice(iniInterno, c.index), ini, fim: c.index + c[0].length };
    }
    return { tag, aberto: m[0], interno: html.slice(iniInterno), ini, fim: html.length };
  }
  return null;
}
function todosElementos(html, token) {
  const lista = [];
  let de = 0;
  for (let el; (el = elemento(html, token, de));) { lista.push(el); de = el.ini + 1; }
  return lista;
}

const brl = (s) => {
  const m = /R\$\s*([\d.]+(?:,\d{1,2})?)/.exec(s || '');
  if (m) return Number(m[1].replace(/\./g, '').replace(',', '.'));
  const r = /([\d.]+)\s+reais?(?:\s+com\s+(\d{1,2})\s+centavos?)?/i.exec(s || '');
  return r ? Number(r[1].replace(/\./g, '') + '.' + String(r[2] || '0').padStart(2, '0')) : null;
};
function valorAndes(el) {
  if (!el) return null;
  const f = elemento(el.interno, 'andes-money-amount__fraction');
  if (f) {
    const c = elemento(el.interno, 'andes-money-amount__cents');
    const n = Number(texto(f.interno).replace(/\./g, '') + '.' + (c ? texto(c.interno).padEnd(2, '0') : '00'));
    return Number.isFinite(n) ? n : null;
  }
  const aria = /aria-label\s*=\s*"([^"]*)"/.exec(el.aberto);
  return brl(decodificarEntidades(aria ? aria[1] : '')) ?? brl(texto(el.interno));
}

function idMLB(chunk) {
  for (const h of [...chunk.matchAll(/href\s*=\s*"([^"]*)"/gi)].map((m) => decodificarEntidades(m[1]))) {
    let d = h;
    try { d = decodeURIComponent(h); } catch { /* mantém */ }
    const m = /[?&#]wid=MLB-?(\d+)/i.exec(d) || /item_id[:=]MLB-?(\d+)/i.exec(d) || /\/MLB-(\d{6,})/.exec(d);
    if (m) return 'MLB' + m[1];
  }
  return null;
}

/** Fatia a página em cartões: li.ui-search-layout__item (preferido) ou .poly-card. */
function fatiarCartoes(html) {
  const marcas = (tagRe, token) => {
    const p = [];
    for (const m of html.matchAll(tagRe)) {
      const cls = /\bclass\s*=\s*"([^"]*)"/.exec(m[0]);
      if (cls && cls[1].split(/\s+/).includes(token)) p.push(m.index);
    }
    return p;
  };
  const qualquer = /<[a-zA-Z][a-zA-Z0-9]*\b[^>]*>/g;
  let pos = marcas(/<li\b[^>]*>/gi, 'ui-search-layout__item');
  if (!pos.length) pos = marcas(qualquer, 'poly-card');
  if (!pos.length) pos = marcas(qualquer, 'ui-search-result__wrapper');
  return pos.map((ini, i) => html.slice(ini, Math.min(pos[i + 1] ?? html.length, ini + 20000)));
}

/**
 * Lê uma página de busca do ML (função pura, sem rede). Devolve um item por cartão, no formato do bookmarklet;
 * itens sem id, título ou preço > 0 vêm assim mesmo (use `itensValidos`). `agora` = ISO do momento da captura.
 */
export function lerBuscaML(html, agora = new Date().toISOString()) {
  const itens = [];
  for (const c of fatiarCartoes(String(html || ''))) {
    const id = idMLB(c);
    const t = elemento(c, 'poly-component__title') || elemento(c, 'ui-search-item__title');
    const titulo = t ? texto(t.interno) : texto((/<h[23]\b[^>]*>([\s\S]*?)<\/h[23]>/i.exec(c) || [])[1]);
    const atual = elemento(c, 'poly-price__current');
    const montantes = todosElementos(c, 'andes-money-amount');
    const noAtual = atual && todosElementos(atual.interno, 'andes-money-amount').find((e) => !/andes-money-amount--previous/.test(e.aberto));
    const elPreco = noAtual || montantes.find((e) => !/andes-money-amount--previous/.test(e.aberto));
    const preco = valorAndes(elPreco);
    const de = valorAndes(montantes.find((e) => /andes-money-amount--previous/.test(e.aberto)));
    const s = elemento(c, 'poly-component__seller') || elemento(c, 'ui-search-official-store-label');
    const vendedor = (s ? texto(s.interno).replace(/^por\s+/i, '') : '') || null;
    itens.push({
      loja: 'mercadolivre', id, titulo, preco, precoDe: de > preco ? de : null, vendedor,
      freteGratis: /frete gr[áa]tis/i.test(texto(c)),
      url: id ? `https://produto.mercadolivre.com.br/MLB-${id.slice(3)}-_JM` : null,
      capturadoEm: agora,
    });
  }
  return itens;
}
export const itensValidos = (itens) => itens.filter((i) => i.id && i.titulo && i.preco > 0);

// ---------------------------------------------------------------- bloqueio / verificação

export const SINAIS_BLOQUEIO = /captcha|account-verification|\/jms\/|suspicious/i;
/** Devolve o motivo (string) se a resposta parece bloqueio/verificação/login; senão null. */
export function detectarBloqueio({ status, urlFinal, html, cartoes }) {
  if (status !== 200) return `HTTP ${status}`;
  if (SINAIS_BLOQUEIO.test(String(urlFinal || ''))) return `URL final de verificação: ${urlFinal}`;
  if (/\/login\b|\/registration\b/i.test(String(urlFinal || ''))) return `URL final de login: ${urlFinal}`;
  if (!cartoes) {
    const sinal = SINAIS_BLOQUEIO.exec(String(html || ''));
    return sinal ? `página sem cartões com sinal de verificação ("${sinal[0]}")` : 'página sem nenhum cartão';
  }
  return null;
}

// ---------------------------------------------------------------- rodada

const dorme = (ms) => new Promise((r) => setTimeout(r, ms));
const p2 = (n) => String(n).padStart(2, '0');
export const carimbo = (d = new Date()) => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}-${p2(d.getHours())}-${p2(d.getMinutes())}`;

async function buscar(url) {
  return fetch(url, { headers: { 'User-Agent': UA, Accept: 'text/html' }, redirect: 'follow', signal: AbortSignal.timeout(30000) });
}

export async function rodar({ pausa = dorme, buscarFn = buscar, saidaDir = path.join(root, 'tools', 'captura', 'auto'), log = console.log } = {}) {
  let robots;
  try {
    const r = await buscarFn(`${BASE}/robots.txt`);
    if (r.status !== 200) throw new Error(`HTTP ${r.status}`);
    robots = parseRobots(await r.text());
  } catch (e) {
    log(`ERRO: robots.txt não carregou (${e.message}); rodada abortada.`);
    return { codigo: 1, itens: 0 };
  }
  const mapa = new Map();
  const agora = new Date().toISOString();
  let primeira = true;
  let parada = false;
  for (const { slug, pagina, url } of listaDeBuscas()) {
    const u = new URL(url);
    if (!robotsPermite(robots, UA, u.pathname + u.search)) { log(`PULADA (robots.txt): ${slug} pág. ${pagina}`); continue; }
    if (!primeira) await pausa(INTERVALO_MS + Math.random() * JITTER_MS);
    primeira = false;
    let r; let html;
    try { r = await buscarFn(url); html = await r.text(); } catch (e) { log(`ERRO de rede em ${slug} pág. ${pagina}: ${e.message}; rodada parada.`); parada = true; break; }
    const cartoes = lerBuscaML(html, agora);
    const motivo = detectarBloqueio({ status: r.status, urlFinal: r.url, html, cartoes: cartoes.length });
    // Busca curta (pág. 2 sem resultado) não é bloqueio: segue. Bloqueio de verdade para a rodada sem tentar de novo, mas o que
    // já foi lido nesta rodada (páginas públicas lidas antes do bloqueio) continua valendo e é gravado.
    if (motivo === 'página sem nenhum cartão' && pagina === 2) { log(`${slug} pág. ${pagina}: sem cartões (busca curta)`); continue; }
    if (motivo) { log(`PARADA em ${slug} pág. ${pagina}: ${motivo}. Rodada interrompida sem nova tentativa.`); parada = true; break; }
    const validos = itensValidos(cartoes);
    for (const i of validos) mapa.set(i.id, i);
    log(`${slug} pág. ${pagina}: ${cartoes.length} cartões, ${validos.length} válidos`);
  }
  const itens = [...mapa.values()];
  if (!itens.length) { log('Nenhum item válido na rodada.'); return { codigo: parada ? 2 : 0, itens: 0 }; }
  fs.mkdirSync(saidaDir, { recursive: true });
  const arquivo = path.join(saidaDir, `captura-mercadolivre-${carimbo()}.json`);
  fs.writeFileSync(arquivo, JSON.stringify({ versao: 1, loja: 'mercadolivre', origem: 'robo-local', itens }, null, 1));
  log(`ITENS: ${itens.length}`);
  log(`ARQUIVO: ${arquivo}`);
  return { codigo: parada ? 2 : 0, itens: itens.length, arquivo };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  rodar().then((r) => process.exit(r.codigo), (e) => { console.error(e); process.exit(1); });
}
