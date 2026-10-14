// Social Media — MVP gerador de rascunhos (issue #634, decisão de escopo da #631, origem #560). Desativado por padrão.
// Módulo puro e determinístico: sem IA, sem rede, sem banco, sem secrets. NÃO publica nem chama API de Telegram/Instagram;
// só devolve o texto do rascunho para prévia e aprovação humana. Não monta nem escolhe link de afiliado: o link do post é a
// página do produto no site, e a frase de divulgação entra quando a oferta já vem com disclosure (api/_lib/affiliates.mjs).
import { money } from '../../format.js';

export const SOCIAL_ENABLED_DEFAULT = false;
export const CANAIS = Object.freeze(['telegram', 'instagram']);
export const LIMITES = Object.freeze({ telegram: 1024, instagram: 2200 });   // legenda de mídia do Telegram; legenda do Instagram
export const NOME_MAX = 300;
export const LOJA_MAX = 80;
export const CHAMADA_MAX = 160;   // linha de abertura opcional (modelos editoriais, src/agents/social/modelos.js)
export const DISCLOSURE = 'Link de afiliado: o TCG Price Hunter pode receber uma comissão se você comprar, sem custo extra para você. Isso não muda o ranking, a melhor oferta, o preço nem a nota.';
export const AVISO_COMPRA = 'Confira preço, frete e estoque na loja antes de comprar.';
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Só liga com SOCIAL_ENABLED=1 explícito; ausente ou qualquer outro valor = desligado. Quem chama o gerador confere isto. */
export const socialEnabled = (env = {}) => SOCIAL_ENABLED_DEFAULT || (env && env.SOCIAL_ENABLED === '1');

const erro = (m) => Object.assign(new Error(`rascunho social: ${m}`), { code: 'RASCUNHO_INVALIDO' });
const obj = (o) => (o && typeof o === 'object' && !Array.isArray(o) ? o : {});
const https = (u) => { if (typeof u !== 'string') return null; try { const x = new URL(u); return x.protocol === 'https:' && x.host ? x : null; } catch { return null; } };

/** Texto vindo da loja vira texto puro de uma linha: sem HTML, sem markdown, sem URL, sem @menção, sem caracteres invisíveis. */
export function limpar(s) {
  return String(s ?? '').normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f-\u009f­​-‏‪-‮⁠-⁤⁦-⁩﻿]/g, ' ')
    .replace(/<[^>]*>?/g, ' ')
    .replace(/\b(?:https?:\/\/|www\.)\S*/gi, ' ')
    .replace(/[<>*_`~|#[\]\\@]/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

// Corta por ponto de código (nunca parte um emoji ao meio) medindo em unidades UTF-16, que é o que as APIs contam.
function cortar(s, max) {
  if (s.length <= max) return s;
  let out = '';
  for (const ch of s) { if (out.length + ch.length > max - 1) break; out += ch; }
  return out.trimEnd() + '…';
}

const quando = (iso) => (typeof iso === 'string' && !Number.isNaN(Date.parse(iso))
  ? new Date(iso).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
  : null);

/** oferta = { produto: { nome, slug }, loja: { nome }, preco, precoTotal|null, url, urlDestino, disclosure, lidaEm };
 *  opts = { canal: 'telegram'|'instagram', siteUrl, chamada? }. chamada = linha de abertura opcional, texto puro de uma linha.
 *  Devolve { canal, texto, link, avisos } ou lança erro explícito. */
export function gerarRascunho(oferta, opts) {
  const { canal, siteUrl, chamada: chamadaBruta } = obj(opts);
  if (!CANAIS.includes(canal)) throw erro(`canal desconhecido: ${String(canal)}`);
  const o = obj(oferta); const produto = obj(o.produto); const loja = obj(o.loja);
  if (typeof o.preco !== 'number' || !Number.isFinite(o.preco) || o.preco <= 0) throw erro('oferta sem preço válido');
  if (!https(o.url)) throw erro('oferta sem URL https');
  if (o.urlDestino != null && !https(o.urlDestino)) throw erro('urlDestino não é https');
  const site = https(siteUrl);
  if (!site) throw erro('siteUrl não é https');
  const slug = typeof produto.slug === 'string' ? produto.slug : '';
  if (!SLUG.test(slug)) throw erro('slug do produto inválido');
  const avisos = [];
  let chamada = '';
  if (chamadaBruta != null) {
    if (typeof chamadaBruta !== 'string') throw erro('chamada não é texto');
    chamada = limpar(chamadaBruta);
    if (!chamada) throw erro('chamada vazia');
    if (chamada.length > CHAMADA_MAX) throw erro('chamada excede o limite');
  }

  const nomeLimpo = limpar(produto.nome); const lojaLimpa = limpar(loja.nome);
  if (!nomeLimpo) throw erro('produto sem nome');
  if (!lojaLimpa) throw erro('loja sem nome');
  if (nomeLimpo !== String(produto.nome).trim() || lojaLimpa !== String(loja.nome).trim()) avisos.push('texto da loja limpo: marcação, link ou menção removidos');
  const nomeLoja = cortar(lojaLimpa, LOJA_MAX);
  if (nomeLoja !== lojaLimpa) avisos.push('nome da loja truncado');

  let precoLinha = `${money(o.preco)} em ${nomeLoja}`;
  if (o.precoTotal == null) { precoLinha += ' (frete a calcular)'; avisos.push('frete desconhecido: total a calcular'); }
  else if (typeof o.precoTotal === 'number' && Number.isFinite(o.precoTotal) && o.precoTotal >= o.preco) precoLinha += ` · total com frete ${money(o.precoTotal)}`;
  else { precoLinha += ' (frete a calcular)'; avisos.push('precoTotal inválido ignorado: frete tratado como desconhecido'); }

  const visto = quando(o.lidaEm);
  if (!visto) avisos.push('sem data de leitura do preço');
  const link = `${site.origin}/produto/${slug}`;
  const rodape = [
    precoLinha,
    visto && `Preço visto em ${visto}.`,
    AVISO_COMPRA,
    canal === 'telegram' ? link : 'Link para a página do produto na bio.',
    o.disclosure === true && DISCLOSURE,
  ].filter(Boolean).join('\n');

  // O nome é a única parte variável longa: é ele que encolhe para caber no limite, nunca preço, link ou divulgação.
  const espaco = LIMITES[canal] - rodape.length - 1 - (chamada ? chamada.length + 1 : 0);
  if (espaco < 1) throw erro('texto fixo excede o limite do canal');
  const nome = cortar(nomeLimpo, Math.min(NOME_MAX, espaco));
  if (nome !== nomeLimpo) avisos.push('nome do produto truncado');
  return { canal, texto: `${chamada ? chamada + '\n' : ''}${nome}\n${rodape}`, link, avisos };
}
