// Página de produto que diz explicitamente que o produto não existe mais, mesmo respondendo HTTP 200 ("soft 404").
// Caso real (24/10/2026, docs/triagem-lojas-sem-produto-2026-10-24.md): as 29 páginas das ofertas da BQD passaram a abrir
// o tema de erro da Nuvemshop (h1 "Erro - 404", sem título, JSON-LD só com produtos de vitrine) com HTTP 200.
//
// Regra conservadora (só sinais explícitos e verificáveis):
//  • o sinal precisa estar no <h1> ou no <title> da página — nunca em script, estilo, link, analytics ou texto solto;
//  • a página NÃO pode trazer o próprio produto (LS.product da Nuvemshop, og:type product ou Product do JSON-LD com o
//    link da página): com produto próprio e mensagem de erro ao mesmo tempo, é ambígua → inconclusiva, nunca removida;
//  • "esgotado", "indisponível", "avise-me" e ausência de preço NÃO são remoção (produto temporariamente sem estoque).
// Status HTTP real (404/410) é tratado pelo leitor (src/adapters/jsonld.js). Timeout, rede, 403, 429, CAPTCHA/WAF e
// falha de parsing nunca chegam aqui como remoção: são falha de leitura (a oferta fica como não confirmada).
import { jsonLdNodes } from './adapters/parse-limits.js';

const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/<[^>]+>/g, ' ').replace(/&nbsp;|&#160;/g, ' ').replace(/\s+/g, ' ').trim();
// Frases de inexistência (já sem acento e em minúsculas). "404" só vale junto de "erro/error/not found/nao encontrad".
const ERRO_404 = /(^|[^\w])(erro|error)\s*[-–:]?\s*404([^\w]|$)|(^|[^\w])404\s*[-–:|]?\s*(erro|error|not found|nao encontrad|pagina nao encontrad)/;
const NAO_EXISTE = /\b(pagina nao encontrada|produto nao encontrado|page not found|product not found|esta pagina nao existe|pagina inexistente|produto inexistente|o produto (que voce procura )?nao existe)\b/;

/** Texto do <h1> (o primeiro) e do <title>, sem tags e normalizado. */
export function cabecalhos(html) {
  const h = String(html || '').replace(/<!--[\s\S]*?-->/g, ' ').replace(/<(script|style|noscript|template)\b[\s\S]*?<\/\1>/gi, ' ');
  return { h1: norm(h.match(/<h1\b[^>]*>([\s\S]*?)<\/h1>/i)?.[1]), titulo: norm(h.match(/<title\b[^>]*>([\s\S]*?)<\/title>/i)?.[1]) };
}

/** A página traz o próprio produto? (Nuvemshop LS.product, og:type product, ou Product do JSON-LD apontando para a página.) */
export function temProdutoProprio(html, url) {
  const h = String(html || '');
  if (/LS\.product\s*=\s*\{\s*id\s*:/.test(h)) return true;
  if (/<meta[^>]+property=["']og:type["'][^>]+content=["'](og:)?product["']/i.test(h) || /<meta[^>]+content=["'](og:)?product["'][^>]+property=["']og:type["']/i.test(h)) return true;
  let aqui = ''; try { aqui = decodeURIComponent(new URL(url).pathname).replace(/\/$/, '').toLowerCase(); } catch { /* sem URL: só os sinais acima */ }
  if (!aqui) return false;
  const { nodes } = jsonLdNodes(h);
  const caminho = (u) => { try { return decodeURIComponent(new URL(u, url).pathname).replace(/\/$/, '').toLowerCase(); } catch { return ''; } };
  return nodes.some((n) => [].concat(n['@type']).some((t) => /^product$/i.test(String(t))) && [n.url, n['@id'], ...[].concat(n.offers || []).map((o) => o?.url)].some((u) => typeof u === 'string' && caminho(u) === aqui));
}

/**
 * -> { estado: 'removida' | 'inconclusiva' | 'normal', motivo }
 * removida: sinal explícito no h1/título e nenhum produto próprio na página. inconclusiva: sinal explícito, mas a página
 * também traz o produto. normal: nenhum sinal explícito (inclusive esgotado, sem preço, "404" só em script ou link).
 */
export function paginaRemovida(html, url) {
  const { h1, titulo } = cabecalhos(html);
  const onde = [['h1', h1], ['título', titulo]].find(([, t]) => t && (ERRO_404.test(t) || NAO_EXISTE.test(t)));
  if (!onde) return { estado: 'normal', motivo: null };
  const motivo = `${onde[0]} "${onde[1].slice(0, 60)}"`;
  if (temProdutoProprio(html, url)) return { estado: 'inconclusiva', motivo: `${motivo}, mas a página traz o próprio produto` };
  return { estado: 'removida', motivo };
}

/** Rodadas seguidas com evidência de remoção antes de tirar a oferta (uma rodada só nunca remove). */
export const RODADAS_REMOCAO = 2;

/**
 * Atualiza o contador por URL (guardado em url-cache.json, no cache da loja): soma 1 para cada URL com evidência nesta
 * rodada, zera as que abriram sem evidência e mantém as que falharam ou não foram planejadas (falha de leitura não é
 * evidência nem contraprova).
 * gone: { url: motivo } desta rodada · lidas: URLs planejadas que abriram · anterior: { url: { n, motivo, desde } }.
 */
export function atualizarRemocoes(anterior = {}, gone = {}, lidas = [], agora = new Date().toISOString()) {
  const out = {};
  for (const [u, motivo] of Object.entries(gone)) { const a = anterior[u]; out[u] = { n: (a?.n || 0) + 1, motivo, desde: a?.desde || agora }; }
  const vistas = new Set(lidas);
  for (const [u, a] of Object.entries(anterior)) if (!(u in out) && !vistas.has(u)) out[u] = a; // não planejada nesta rodada: mantém
  return out;
}
/** URLs com evidência confirmada (RODADAS_REMOCAO rodadas seguidas). */
export const remocoesConfirmadas = (mapa = {}) => new Set(Object.entries(mapa).filter(([, a]) => a?.n >= RODADAS_REMOCAO).map(([u]) => u));
