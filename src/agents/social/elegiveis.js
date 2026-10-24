// Social Media MVP — contrato e seleção de ofertas elegíveis para virar post (issue #633, escopo da #631/#560).
// Somente rascunho: este módulo não publica, não chama Telegram/Instagram/WhatsApp, não acessa rede nem banco.
// Recebe ofertas no formato já servido pela API (/api/v1, read-db/read-state) ou pelo state.json e decide, com
// motivo explícito, quais podem virar rascunho. Dado incerto = não elegível. Desativado por padrão (SOCIAL_ENABLED).
// Afiliado: só para saber se o destino exige aviso (api/_lib/affiliates.mjs); nunca entra na seleção nem na ordem.
import { offerFreshness } from '../../../api/_lib/freshness.mjs';
import { byComparableTotal } from '../../../api/_lib/offer-rank.mjs';
import { loadAffiliates, resolveOutbound } from '../../../api/_lib/affiliates.mjs';

export const SOCIAL_ENABLED_DEFAULT = false;
/** Liga só com SOCIAL_ENABLED=1. Ausente ou qualquer outro valor = desligado. */
export const socialHabilitado = (env = process.env) => SOCIAL_ENABLED_DEFAULT || env?.SOCIAL_ENABLED === '1';

// Não entra nos posts dos grupos (Telegram/WhatsApp montam o texto em legenda.js, sem frase de afiliado desde 24/10/2026).
export const DISCLOSURE_AFILIADO = 'Link de afiliado: podemos receber comissão, sem custo extra para você.';

export const MOTIVOS = Object.freeze({
  INVALIDA: 'oferta inválida',
  SEM_PRODUTO: 'sem produto identificado',
  SEM_LOJA: 'sem loja identificada',
  ESTOQUE: 'estoque não confirmado',
  PENDENTE: 'oferta pendente/stale',
  ANOMALA: 'oferta anômala',
  NAO_CONFIRMADA: 'leitura não confirmada',
  PRECO: 'preço ausente ou inválido',
  URL: 'URL ausente ou não https',
  SEM_HORARIO: 'sem horário de leitura',
  FRESCOR: 'frescor não atual',
  RELOGIO: 'relógio inválido',
  DUPLICADA: 'duplicada',
});

const ESTOQUE_OK = new Set(['in_stock', 'IN_STOCK']);
const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const txt = (v) => (typeof v === 'string' || (typeof v === 'number' && Number.isFinite(v)) ? String(v).trim() : '');
const num = (v) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
// Os dois formatos: API (product.id, store.id, last_seen_at, status) e state.json (productId, storeId, source_timestamp, stale).
const produtoDe = (o) => txt(o.productId ?? o.product_id ?? (isObj(o.product) ? o.product.id : null));
const lojaDe = (o) => txt(o.storeId ?? o.store_id ?? (isObj(o.store) ? o.store.id : null));
const horarioDe = (o) => o.last_seen_at ?? o.source_timestamp ?? null;
const nowDe = (now) => (now === undefined ? Date.now() : now instanceof Date ? now.getTime() : typeof now === 'number' ? now : NaN);

function urlHttps(v) {
  if (typeof v !== 'string' || v !== v.trim() || /\s/.test(v)) return false;
  let u; try { u = new URL(v); } catch { return false; }
  return u.protocol === 'https:' && !!u.hostname && !u.username && !u.password;
}

const nao = (motivo, extra = {}) => ({ ok: false, motivo, ...extra });

/** Contrato da oferta que pode virar post. Devolve { ok, motivo } (motivo vazio quando elegível).
 *  Frescor: o da PRÓPRIA oferta (offerFreshness, mesmos limites da API), só "atual" serve. */
export function ofertaElegivel(oferta, { now } = {}) {
  if (!isObj(oferta)) return nao(MOTIVOS.INVALIDA);
  const t = nowDe(now);
  if (!Number.isFinite(t)) return nao(MOTIVOS.RELOGIO);
  if (!produtoDe(oferta)) return nao(MOTIVOS.SEM_PRODUTO);
  if (!lojaDe(oferta)) return nao(MOTIVOS.SEM_LOJA);
  if (!ESTOQUE_OK.has(oferta.stock ?? oferta.stock_status)) return nao(MOTIVOS.ESTOQUE);
  if (oferta.stale === true || (oferta.status !== undefined && oferta.status !== 'active')) return nao(MOTIVOS.PENDENTE);
  if (oferta.anomalous !== undefined && oferta.anomalous !== false) return nao(MOTIVOS.ANOMALA);
  if (oferta.confirmed === false) return nao(MOTIVOS.NAO_CONFIRMADA);
  const preco = num(oferta.price);
  if (preco == null || preco <= 0) return nao(MOTIVOS.PRECO);
  if (!urlHttps(oferta.url)) return nao(MOTIVOS.URL);
  const at = horarioDe(oferta);
  if (at == null || at === '') return nao(MOTIVOS.SEM_HORARIO);
  const fr = offerFreshness(at, t);
  if (fr.status !== 'atual') return nao(MOTIVOS.FRESCOR, { frescor: fr.status });
  return { ok: true, motivo: '' };
}

/** Chave de dedupe estável entre rodadas: produto + loja + preço em centavos. null se faltar algum dos três. */
export function chaveDedupe(oferta) {
  if (!isObj(oferta)) return null;
  const p = produtoDe(oferta); const l = lojaDe(oferta); const preco = num(oferta.price);
  if (!p || !l || preco == null || preco <= 0) return null;
  return `${p}|${l}|${Math.round(preco * 100)}`;
}

/** true se o destino do clique for link de afiliado (resolvido só por api/_lib/affiliates.mjs). */
export function exigeDisclosure(url, cfg = loadAffiliates()) {
  if (typeof url !== 'string' || !url) return false;
  if (resolveOutbound(url, cfg) !== url) return true;
  const destinos = [...Object.values(cfg?.anuncios || {}), cfg?.geral?.url].filter(Boolean);
  return destinos.includes(url);   // a própria URL já é um link de afiliado configurado
}

// Mesma ordem de "menor total" da API (offer-rank.mjs), nos dois formatos. Nada de comissão ou afiliado.
const vista = (o) => ({
  id: txt(o.id),
  shippingKnown: o.shippingKnown === true || (isObj(o.shipping) && (o.shipping.status === 'free' || o.shipping.status === 'known')),
  total: num(o.total) ?? num(o.total_price) ?? num(o.price),
});

/** Filtra as elegíveis, ordena pelo menor total comparável, remove duplicatas (fica a primeira) e aplica o limite.
 *  Devolve { elegiveis, recusadas: [{ id, motivo }] } — as recusas ficam para auditoria do rascunho. */
export function selecionarElegiveis(ofertas, { now, limite } = {}) {
  if (limite !== undefined && !(Number.isInteger(limite) && limite >= 0)) throw new TypeError('limite deve ser inteiro >= 0');
  const recusadas = []; const candidatas = [];
  (Array.isArray(ofertas) ? ofertas : []).forEach((o, i) => {
    const r = ofertaElegivel(o, { now });
    if (r.ok) candidatas.push({ o, v: vista(o), i });
    else recusadas.push({ id: isObj(o) ? txt(o.id) || null : null, motivo: r.motivo });
  });
  candidatas.sort((a, b) => byComparableTotal(a.v, b.v) || a.i - b.i);
  const vistas = new Set(); const elegiveis = [];
  for (const { o } of candidatas) {
    const k = chaveDedupe(o);
    if (vistas.has(k)) { recusadas.push({ id: txt(o.id) || null, motivo: MOTIVOS.DUPLICADA }); continue; }
    vistas.add(k); elegiveis.push(o);
  }
  return { elegiveis: limite === undefined ? elegiveis : elegiveis.slice(0, limite), recusadas };
}
