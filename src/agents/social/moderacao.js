// Community Manager — classificador de mensagens suspeitas (issue #643, MVP Social Media em rascunho, #560/#631).
// Módulo puro: sem imports, sem rede, sem banco, sem secrets, sem process.env. SÓ classifica e devolve motivos:
// não bane, não apaga, não responde. Qualquer ação fica para aprovação humana (ver docs/social-comunidade.md).
// Desativado por padrão: SOCIAL_ENABLED ausente = desligado (quem integrar lê o env e passa para socialHabilitado).

export const SOCIAL_ENABLED_DEFAULT = false;
export const NIVEIS = Object.freeze(['ok', 'suspeito', 'golpe']);
const PESO = { ok: 0, suspeito: 1, golpe: 2 };

// Regras explícitas. Gravidade fixa por regra; o nível da mensagem é o da regra mais grave que casou.
export const REGRAS = Object.freeze({
  'pix-antecipado': { nivel: 'golpe', descricao: 'Pedido de Pix/pagamento antecipado fora de loja' },
  'pedido-senha-codigo': { nivel: 'golpe', descricao: 'Pedido de senha, código de verificação ou dado de acesso' },
  'link-encurtado': { nivel: 'suspeito', descricao: 'Link encurtado desconhecido (esconde o destino)' },
  'link-desconhecido': { nivel: 'suspeito', descricao: 'Link fora da lista de hosts conhecidos' },
  'pre-venda-sem-fonte': { nivel: 'suspeito', descricao: '"Pré-venda" sem link de loja conhecida como fonte' },
  'contato-terceiro': { nivel: 'suspeito', descricao: 'Telefone/WhatsApp de terceiros' },
});

// Hosts conhecidos por padrão: o próprio site, destinos de afiliado já aceitos (api/_lib/affiliates.mjs e o
// domínio dos links Amazon Associados) e a loja oficial. As lojas de config/stores.json entram por opts.hostsConhecidos
// (use hostsDeLojas); este módulo não lê arquivo. Subdomínio de host conhecido também é conhecido.
export const HOSTS_CONHECIDOS_PADRAO = Object.freeze([
  'tcg-price-hunter.vercel.app',
  'meli.la', 'mercadolivre.com.br', 'mercadolibre.com',
  'amazon.com.br',
  'copagloja.com.br',
]);

// Encurtadores públicos: o destino real fica escondido. meli.la é encurtador, mas é destino de afiliado conhecido.
export const ENCURTADORES = Object.freeze([
  'bit.ly', 'bitly.com', 'tinyurl.com', 'cutt.ly', 'encurtador.com.br', 'is.gd', 'v.gd', 't.co', 'goo.gl', 'ow.ly',
  'rebrand.ly', 'shorturl.at', 'tiny.cc', 's.id', 'rb.gy', 'amzn.to', 'buff.ly', 'shre.ink', 'l1nk.dev', 'encr.pw',
  'abre.ai', 'bl.ink', 'short.io', 'lnkd.in', 'linktr.ee',
]);
const WHATSAPP_HOSTS = ['wa.me', 'whatsapp.com', 'wa.link'];

/** Liga o módulo só com SOCIAL_ENABLED = "1"/"true" explícito. Recebe o env (não lê process.env). */
export function socialHabilitado(env) {
  const v = env && typeof env === 'object' ? env.SOCIAL_ENABLED : undefined;
  return SOCIAL_ENABLED_DEFAULT || v === '1' || v === 'true';
}

const bare = (h) => String(h || '').trim().toLowerCase().replace(/^www\./, '').replace(/\.$/, '');
const hostOf = (u) => { try { return bare(new URL(/^https?:\/\//i.test(u) ? u : 'https://' + u).hostname); } catch { return null; } };
const casa = (host, lista) => lista.some((k) => host === k || host.endsWith('.' + k));
const cut = (s, n = 80) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

/** Hosts das lojas a partir do conteúdo de config/stores.json ({ stores: [{ url }] }) ou de uma lista de URLs/hosts. */
export function hostsDeLojas(config) {
  const itens = Array.isArray(config) ? config : (config && Array.isArray(config.stores) ? config.stores.map((s) => s?.url) : []);
  return [...new Set(itens.filter((x) => typeof x === 'string' && x.trim()).map(hostOf).filter(Boolean))];
}

// Texto para regras de palavra: NFKC (largura total vira ASCII), sem caracteres invisíveis, sem acento, minúsculo.
// Os links são extraídos ANTES de tirar acento: "mercadolívre.com.br" não pode virar o host conhecido.
const INVISIVEIS = /[​-‏⁠-⁤﻿­]/g;
const limpo = (s) => s.normalize('NFKC').replace(INVISIVEIS, '');
const dobrado = (s) => s.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/\s+/g, ' ');

const URL_COM_ESQUEMA = /https?:\/\/[^\s<>"'`]+/giu;
const TLDS = 'com|br|net|org|io|ly|me|la|gg|co|to|at|gd|id|gl|cc|xyz|info|shop|store|site|online|top|link|app|dev|click|live|vip|pro|biz|us|ru|cn|tk|ml|ga|cf|ai|in|pw|ee';
const DOMINIO_NU = new RegExp(`(?<![\\p{L}\\p{N}@._-])(?:[\\p{L}\\p{N}-]+\\.)+(?:${TLDS})(?![\\p{L}\\p{N}-])(?:[/?#][^\\s<>"'\`]*)?`, 'giu');
const fimPontuacao = (u) => u.replace(/[.,;:!?)\]}»"']+$/u, '');

function links(texto) {
  const achados = [];
  const resto = texto.replace(URL_COM_ESQUEMA, (u) => { achados.push(fimPontuacao(u)); return ' '; });
  for (const m of resto.matchAll(DOMINIO_NU)) achados.push(fimPontuacao(m[0]));
  return achados.map((u) => ({ url: u, host: hostOf(u) }));
}

// Pix/pagamento antecipado: pedido de Pix para uma pessoa ou de pagamento antes do envio. "Aceita Pix?" não casa.
const PIX = [
  /\bchave (?:do |de |)pix\b/g,
  /\b(?:meu|minha) (?:chave )?pix\b/g,
  /\bme (?:manda|mande|envia|envie|faz|faca|paga|pague|passa|passe|transfere|transfira)\b.{0,15}\bpix\b/g,
  /\b(?:manda|mande|envia|envie|faz|faca|paga|pague|transfere|transfira|deposita|deposite)\b (?:o |um |no |via )?pix (?:pra|para|na minha|no meu|nessa|nesse|neste|nesta)\b/g,
  /\bpix\b.{0,40}\b(?:antecipad|adiantad|na frente|antes do envio|antes de enviar|pra reservar|para reservar|garantir (?:a|sua) vaga)/g,
  /\b(?:pagamento|pagar|deposito|transferencia|sinal)\b.{0,20}\b(?:antecipad|adiantad|na frente|antes do envio|antes de enviar)/g,
];

// Senha/código: verbo de pedido + alvo.
const VERBO = '(?:passa|passe|manda|mande|envia|envie|informa|informe|fala|fale|diz|diga|confirma|confirme|digita|digite|compartilha|compartilhe|repassa|repasse|me da|me de|qual (?:e |eh |)(?:a |o |)(?:sua|seu|tua|teu))';
const ALVO = '(?:senha|codigo (?:de )?(?:verificacao|seguranca|confirmacao|acesso|ativacao|\\d+ digitos)|codigo (?:que|q) (?:chegou|recebeu|voce recebeu|foi enviado|te mandaram)|codigo (?:do|de|por|via) (?:sms|whats|whatsapp|zap|e-?mail|telegram|instagram|cartao)|token|2fa|otp|cvv)';
const SENHA = new RegExp(`\\b${VERBO}\\b.{0,25}\\b${ALVO}\\b`, 'g');
// Aviso com negação logo antes ("nunca passe sua senha", "não mande Pix para a chave Pix de ninguém") não é pedido.
const NEGACAO = /\b(?:nunca|nao|jamais|nem|ninguem)\b[^.!?,;:]{0,25}$/;
const pedido = (d, re) => { for (const m of d.matchAll(re)) if (!NEGACAO.test(d.slice(Math.max(0, m.index - 35), m.index))) return m[0]; return null; };

const PRE_VENDA = /\b(?:pre ?-? ?venda|encomenda antecipada|reserva antecipada)\b/;
const CHAMA_WHATS = /\b(?:chama|chame|me chama|me chame|fala comigo|me add|add|me adiciona|contato|contata|chamar)\b.{0,15}\b(?:whats ?app|whats|zap|zapzap|wpp)\b/;
const TELEFONE = /(?<![\p{L}\p{N}/.,])(?:\+?\s?55[\s.-]?)?(?:\(\s?[1-9]{2}\s?\)|[1-9]{2})[\s.-]?9?[\s.]?\d{4}[\s.-]?\d{4}(?![\p{L}\p{N}/,])/gu;
const digitos = (s) => s.replace(/\D/g, '').replace(/^55(?=\d{10,11}$)/, '');

/** Classifica uma mensagem da comunidade. Nunca lança: texto vazio, não-string ou só espaços → { nivel: 'ok', motivos: [] }.
 *  opts = { hostsConhecidos: [], telefonesConhecidos: [] } somam-se aos padrões (ex.: hostsDeLojas(config/stores.json)).
 *  Cada motivo: { regra, nivel, descricao, trecho }. Não executa nenhuma ação. */
export function classificarMensagem(texto, opts) {
  if (typeof texto !== 'string' || !texto.trim()) return { nivel: 'ok', motivos: [] };
  const o = opts && typeof opts === 'object' && !Array.isArray(opts) ? opts : {};
  const conhecidos = [...HOSTS_CONHECIDOS_PADRAO, ...hostsDeLojas(Array.isArray(o.hostsConhecidos) ? o.hostsConhecidos : [])];
  const fones = new Set((Array.isArray(o.telefonesConhecidos) ? o.telefonesConhecidos : []).map((t) => digitos(String(t))).filter(Boolean));
  const t = limpo(texto.slice(0, 20000));
  const d = dobrado(t);
  const motivos = []; const vistos = new Set();
  const add = (regra, trecho) => {
    const k = regra + '\u0000' + trecho; if (vistos.has(k)) return; vistos.add(k);
    motivos.push({ regra, nivel: REGRAS[regra].nivel, descricao: REGRAS[regra].descricao, trecho: cut(trecho.trim()) });
  };

  for (const re of PIX) { const m = pedido(d, re); if (m) { add('pix-antecipado', m); break; } }
  const sc = pedido(d, SENHA); if (sc) add('pedido-senha-codigo', sc);

  const ls = links(t);
  let fonteConhecida = false;
  for (const { url, host } of ls) {
    if (!host) { add('link-desconhecido', url); continue; }
    if (casa(host, conhecidos)) { fonteConhecida = true; continue; }
    if (casa(host, WHATSAPP_HOSTS)) add('contato-terceiro', url);
    else if (casa(host, ENCURTADORES)) add('link-encurtado', url);
    else add('link-desconhecido', url);
  }
  const pv = d.match(PRE_VENDA); if (pv && !fonteConhecida) add('pre-venda-sem-fonte', pv[0]);
  const cw = d.match(CHAMA_WHATS); if (cw) add('contato-terceiro', cw[0]);
  // Telefone: procurado no texto sem os links (número dentro de URL de produto não é contato).
  const semLinks = t.replace(URL_COM_ESQUEMA, ' ').replace(DOMINIO_NU, ' ');
  for (const m of semLinks.matchAll(TELEFONE)) if (!fones.has(digitos(m[0]))) add('contato-terceiro', m[0]);

  const nivel = motivos.reduce((n, m) => (PESO[m.nivel] > PESO[n] ? m.nivel : n), 'ok');
  return { nivel, motivos };
}
