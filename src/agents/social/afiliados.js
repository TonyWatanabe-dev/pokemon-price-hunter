// Social Media MVP — links de afiliado dos rascunhos (issue #642, origem #560/#631). Desativado por padrão.
// Módulo puro: não publica, não acessa rede, banco nem secrets. Só lê config/social-afiliados.json e valida.
// Regras (as mesmas de docs/afiliados.md): (1) afiliado nunca entra em ranking, preço, melhor oferta ou nota;
// (2) a URL original da oferta é sempre o link do post; (3) link geral é só o "link do canal", separado, e nunca
// substitui o link de um anúncio específico; (4) nenhum link é montado, encurtado ou reescrito: vale inteiro, como veio.
import fs from 'node:fs';
import { DESTINATION_HOSTS } from '../../../api/_lib/affiliates.mjs';

export const SOCIAL_ENABLED_DEFAULT = false;
// SOCIAL_ENABLED ausente (ou qualquer valor diferente de "1"/"true") = desligado.
export const socialEnabled = (env = process.env) => SOCIAL_ENABLED_DEFAULT || ['1', 'true'].includes(String(env?.SOCIAL_ENABLED ?? '').trim().toLowerCase());

// Hosts aceitos por marketplace. Mercado Livre: os mesmos de api/_lib/affiliates.mjs. Shopee: pendente (sem host = sem link).
export const HOSTS = Object.freeze({
  mercadolivre: Object.freeze([...DESTINATION_HOSTS]),
  amazon: Object.freeze(['link.amazon', 'amzn.to', 'amazon.com.br']),
  shopee: Object.freeze([]),
});
export const MARKETPLACES = Object.freeze(Object.keys(HOSTS));
export const TIPOS = Object.freeze(['geral']);

/** Link aceito: https, sem credenciais, sem porta, sem espaços/aspas, host exato permitido para o marketplace.
 *  Devolve a própria URL, intacta; qualquer outra coisa: null. Nunca monta, encurta ou reescreve. */
export function validarLink(url, marketplace) {
  const hosts = Object.hasOwn(HOSTS, marketplace) ? HOSTS[marketplace] : null;
  if (!hosts?.length || typeof url !== 'string' || url !== url.trim() || /[\s"'<>\\]/.test(url)) return null;
  let u; try { u = new URL(url); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || u.port || !hosts.includes(u.hostname.toLowerCase())) return null;
  if (!/^https:\/\/[^/?#@]+\/./i.test(url)) return null;   // host escrito exatamente e caminho presente (sem truques de barra/@)
  return url;
}

/** Config bruta -> { links: { [marketplace]: entrada } }. Diferente do site, aqui config inválida é ERRO:
 *  rascunho com link duvidoso não deve ser gerado em silêncio. */
export function parseConfig(raw) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw) || !Array.isArray(raw.links)) throw new Error('social-afiliados: config inválida (esperado { links: [] })');
  const links = {};
  raw.links.forEach((e, i) => {
    const onde = `social-afiliados: links[${i}]`;
    if (!e || typeof e !== 'object' || Array.isArray(e)) throw new Error(`${onde} não é objeto`);
    if (!MARKETPLACES.includes(e.marketplace)) throw new Error(`${onde}: marketplace desconhecido`);
    if (Object.hasOwn(links, e.marketplace)) throw new Error(`${onde}: marketplace repetido (${e.marketplace})`);
    if (!TIPOS.includes(e.tipo)) throw new Error(`${onde}: tipo inválido`);
    if (typeof e.origem !== 'string' || !e.origem.trim()) throw new Error(`${onde}: origem ausente`);
    if (typeof e.validado !== 'boolean') throw new Error(`${onde}: validado deve ser booleano`);
    if (!validarLink(e.url, e.marketplace)) throw new Error(`${onde}: url recusada para ${e.marketplace}`);
    links[e.marketplace] = Object.freeze({ marketplace: e.marketplace, url: e.url, tipo: e.tipo, origem: e.origem.trim(), validado: e.validado });
  });
  return Object.freeze({ links: Object.freeze(links) });
}

const FILE = new URL('../../../config/social-afiliados.json', import.meta.url);
/** Lê e valida o arquivo. Ausente, JSON inválido ou conteúdo inválido: lança. */
export function loadConfig({ file = FILE } = {}) {
  let raw;
  try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch (e) { throw new Error(`social-afiliados: não foi possível ler a config (${e.message})`); }
  return parseConfig(raw);
}

/** Links de um post. urlOferta é devolvida intacta (é o link do anúncio). linkCanal é o link geral do marketplace,
 *  separado, ou null quando não existe (ex.: Shopee). O link geral NUNCA substitui a URL da oferta. */
export function linkParaPost({ marketplace, urlOferta } = {}, cfg = loadConfig()) {
  let u; try { u = new URL(String(urlOferta ?? '')); } catch { u = null; }
  if (typeof urlOferta !== 'string' || urlOferta !== urlOferta.trim() || !u || (u.protocol !== 'https:' && u.protocol !== 'http:')) {
    throw new Error('social-afiliados: urlOferta inválida');
  }
  const g = Object.hasOwn(cfg?.links ?? {}, marketplace) ? cfg.links[marketplace] : null;
  const linkCanal = g ? { marketplace: g.marketplace, url: g.url, tipo: g.tipo, origem: g.origem, validado: g.validado } : null;
  return { marketplace: marketplace ?? null, urlOferta, linkCanal };
}
