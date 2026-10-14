// Social Media — legenda do card no formato aprovado pelo proprietário (#690). Puro: sem rede, banco ou secrets.
//
//   🇧🇷 <b>título</b>
//
//   De <b>R$ anterior</b> ❌        ← só com preço anterior confiável (listPrice da própria loja, maior que o atual)
//   Por <b>R$ atual</b> ✅
//
//   loja
//   link                           ← link de afiliado do anúncio quando existir (config/affiliates.json), senão o da loja
//   [linha de divulgação]          ← só quando o link é de afiliado
//
// Saída em HTML do Telegram (parse_mode=HTML): tudo que vem da loja passa por limpar() e escape, então nenhum texto
// externo vira marcação. Sem horário. Centavos sempre mantidos.
import { limpar, cortar } from './rascunho.js';

export const PARSE_MODE = 'HTML';
export const LEGENDA_MAX = 1024;
export const DIVULGACAO = 'Link de afiliado: podemos receber comissão, sem custo extra para você.';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const valor = (v) => (typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : null);
export const reais = (v) => 'R$ ' + v.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const https = (u) => { try { const x = new URL(u); return x.protocol === 'https:' && !x.username && !x.password ? u : null; } catch { return null; } };

/** Preço anterior confiável: o "de" que a própria loja mostra (listPrice), só se for maior que o atual. Senão null. */
export function precoAnterior(oferta) {
  const atual = valor(oferta?.price); const de = valor(oferta?.listPrice);
  return atual != null && de != null && de > atual + 0.009 ? de : null;
}

/** { titulo, atual, anterior?, loja, link, afiliado? } → { texto, parseMode }. Lança se faltar dado essencial. */
export function montarLegenda({ titulo, atual, anterior = null, loja, link, afiliado = false }) {
  const t = limpar(titulo); const l = limpar(loja); const a = valor(atual); const url = https(link);
  if (!t) throw new Error('legenda: título vazio');
  if (!l) throw new Error('legenda: loja vazia');
  if (a == null) throw new Error('legenda: preço atual inválido');
  if (!url) throw new Error('legenda: link não é https');
  const de = valor(anterior) != null && anterior > a ? anterior : null;
  const precos = [de != null && `De <b>${esc(reais(de))}</b> ❌`, `Por <b>${esc(reais(a))}</b> ✅`].filter(Boolean).join('\n');
  const rodape = `\n\n${precos}\n\n${esc(l)}\n${esc(url)}${afiliado ? '\n\n' + esc(DIVULGACAO) : ''}`;
  const espaco = LEGENDA_MAX - rodape.length - '🇧🇷 <b></b>'.length;
  if (espaco < 10) throw new Error('legenda: texto fixo excede o limite');
  const texto = `🇧🇷 <b>${esc(cortar(t, Math.floor(espaco / 5)))}</b>${rodape}`;   // /5: pior caso do escape (&amp;)
  return { texto, parseMode: PARSE_MODE };
}
