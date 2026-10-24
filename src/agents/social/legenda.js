// Social Media — legenda do card no formato aprovado pelo proprietário (#690). Puro: sem rede, banco ou secrets.
//
//   🇧🇷 <b>título</b>               ← importado: bandeira do idioma (🇺🇸 🇯🇵 🇨🇳 🇰🇷)
//   🌐 Idioma: Inglês             ← só no importado (produto com sufixo -en/-ja/-zh/-ko); nunca compara com a Copag
//
//   De <b>R$ anterior</b> ❌        ← só com preço anterior confiável (listPrice da própria loja, maior que o atual)
//   Por <b>R$ atual</b> ✅
//
//   loja
//   link                           ← link de afiliado do anúncio quando existir (config/affiliates.json), senão o da loja
//
// Saída em HTML do Telegram (parse_mode=HTML): tudo que vem da loja passa por limpar() e escape, então nenhum texto
// externo vira marcação. Sem horário. Centavos sempre mantidos.
import { limpar, cortar } from './rascunho.js';

export const PARSE_MODE = 'HTML';
export const LEGENDA_MAX = 1024;
// Sem linha de divulgação de afiliado nos grupos (decisão do proprietário, 24/10/2026): o post traz só o essencial.

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const valor = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
export const reais = (v) => 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
// Hosts de link curto de afiliado e parâmetro de associado da Amazon (ex.: URL da oferta que já veio com link de afiliado).
// Só detecta; nada é montado. Usado por quem chama para marcar a oferta como de afiliado (repostagem).
const HOSTS_AFILIADO = new Set(['meli.la', 'amzn.to', 'link.amazon']);
const AMAZON = /(^|\.)amazon\.com(\.br)?$/;
/** true quando o link, por si só, é de afiliado (link curto de programa ou Amazon com id de associado). */
export function linkDeAfiliado(link) {
  let u; try { u = new URL(String(link ?? '')); } catch { return false; }
  const h = u.hostname.toLowerCase();
  return HOSTS_AFILIADO.has(h) || (AMAZON.test(h) && u.searchParams.has('tag'));
}
const https = (u) => { try { const x = new URL(u); return x.protocol === 'https:' && !x.username && !x.password ? u : null; } catch { return null; } };

/** Preço anterior confiável: o "de" que a própria loja mostra (listPrice), só se for maior que o atual. Senão null. */
export function precoAnterior(oferta) {
  const atual = valor(oferta?.price); const de = valor(oferta?.listPrice);
  return atual != null && de != null && de > atual + 0.009 ? de : null;
}

// Idioma do produto pelo id (src/match.js): sufixo -en/-ja/-zh/-ko = importado.
export const IDIOMAS = { en: ['🇺🇸', 'Inglês'], ja: ['🇯🇵', 'Japonês'], zh: ['🇨🇳', 'Chinês'], ko: ['🇰🇷', 'Coreano'] };
export const idiomaDe = (produtoId) => (String(produtoId ?? '').match(/-(en|ja|zh|ko)$/) || [])[1] || null;

/** { titulo, atual, anterior?, loja, link, afiliado?, produtoId? } → { texto, parseMode }. Lança se faltar dado essencial. */
export function montarLegenda({ titulo, atual, anterior = null, loja, link, afiliado = false, produtoId = null }) {
  const t = limpar(titulo); const l = limpar(loja); const a = valor(atual); const url = https(link);
  if (!t) throw new Error('legenda: título vazio');
  if (!l) throw new Error('legenda: loja vazia');
  if (a == null) throw new Error('legenda: preço atual inválido');
  if (!url) throw new Error('legenda: link não é https');
  const de = valor(anterior) != null && anterior > a ? anterior : null;
  const precos = [de != null && `De <b>${esc(reais(de))}</b> ❌`, `Por <b>${esc(reais(a))}</b> ✅`].filter(Boolean).join('\n');
  const rodape = `\n\n${precos}\n\n${esc(l)}\n${esc(url)}`;
  const lang = IDIOMAS[idiomaDe(produtoId)] || null;
  const bandeira = lang ? lang[0] : '🇧🇷'; const linhaIdioma = lang ? `\n🌐 Idioma: ${lang[1]}` : '';
  const espaco = LEGENDA_MAX - rodape.length - linhaIdioma.length - `${bandeira} <b></b>`.length;
  if (espaco < 10) throw new Error('legenda: texto fixo excede o limite');
  const texto = `${bandeira} <b>${esc(cortar(t, Math.floor(espaco / 5)))}</b>${linhaIdioma}${rodape}`;   // /5: pior caso do escape (&amp;)
  return { texto, parseMode: PARSE_MODE };
}
