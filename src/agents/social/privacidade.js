// Community Manager — privacidade nas mensagens da comunidade (issue #659, MVP Social Media em rascunho, #560/#631).
// Módulo puro: não publica, não acessa rede, banco, arquivo nem secrets; não lê process.env (redact recebe env vazio).
// Mascara telefone, e-mail, CPF e chaves Pix de um texto recebido ANTES de ir para log/auditoria e devolve só a
// versão mascarada: o dado original não é guardado, nem em contagem, hash ou trecho. Os padrões genéricos de
// src/redact.js (tokens, senhas, URL com credencial, CEP) entram por último.
// A máscara é proteção, não ação: vale mesmo com o Social desligado (SOCIAL_ENABLED ausente = desligado, quem
// integrar decide se a mensagem é processada). Na dúvida, mascara: número de 11 dígitos vira [cpf] ou [telefone].
import { redact } from '../../redact.js';

export const SOCIAL_ENABLED_DEFAULT = false;
export const TEXTO_MAX = 2000;
export const MARCAS = Object.freeze({ telefone: '[telefone]', email: '[email]', cpf: '[cpf]', pix: '[chave-pix]' });

// Mesma limpeza do classificador (moderacao.js): largura total vira ASCII e invisíveis somem, para "１１ ９８７６５-４３２１"
// ou um e-mail com caractere de largura zero não escaparem da máscara.
const INVISIVEIS = /[​-‏⁠-⁤﻿­]/g;
const limpo = (s) => s.normalize('NFKC').replace(INVISIVEIS, '');

// Chave aleatória do Pix (EVP): UUID, com ou sem hífens.
const PIX_ALEATORIA = /(?<![\p{L}\p{N}])[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}(?![\p{L}\p{N}])/giu;
// Valor logo após "chave pix" / "pix:" com dígito ou @ (CNPJ, CPF, telefone ou e-mail usado como chave).
const PIX_ROTULO = /(\bchave(?:\s+(?:do|de|da))?\s+pix\b\s*(?:[:=-]\s*|(?:é|eh|e)\s+)?|\bpix\s*[:=]\s*)(?!\[)([^\s,;]*[\d@][^\s,;]*)/giu;
const EMAIL = /[\p{L}\p{N}._%+-]+@[\p{L}\p{N}-]+(?:\.[\p{L}\p{N}-]+)+/gu;
const CPF_FORMATADO = /(?<![\p{L}\p{N}])\d{3}\.\d{3}\.\d{3}-\d{2}(?!\p{N})/gu;
const TELEFONE = [
  // Com DDD, opcionalmente +55: (11) 98765-4321, 11 98765 4321, +55 11 3333-4444, 5511987654321.
  /(?<![\p{L}\p{N}+])(?:\+\s?55[\s.-]?|55[\s.-]?)?(?:\(\s?[1-9]{2}\s?\)|[1-9]{2})[\s.-]?(?:9[\s.-]?)?\d{4}[\s.-]?\d{4}(?!\p{N})/gu,
  // Celular sem DDD com separador: 98765-4321.
  /(?<![\p{L}\p{N}])9\d{4}[\s.-]\d{4}(?!\p{N})/gu,
];
const CPF_NU = /(?<![\p{L}\p{N}])\d{11}(?!\p{N})/gu;

/** Mascara um texto recebido. Nunca lança: não-string vira ''. Devolve { texto, mascarados } em que mascarados
 *  conta só QUANTOS de cada tipo foram trocados ({ telefone, email, cpf, pix }), nunca o valor.
 *  opts = { max } limita o tamanho do texto devolvido (padrão TEXTO_MAX). */
export function mascararMensagem(texto, opts) {
  const o = opts && typeof opts === 'object' && !Array.isArray(opts) ? opts : {};
  const max = Number.isInteger(o.max) && o.max > 0 ? o.max : TEXTO_MAX;
  const mascarados = { telefone: 0, email: 0, cpf: 0, pix: 0 };
  if (typeof texto !== 'string' || !texto) return { texto: '', mascarados };
  const troca = (tipo) => () => { mascarados[tipo]++; return MARCAS[tipo]; };

  // Corta antes de processar (entrada gigante não trava o regex) e de novo no fim (as marcas mudam o tamanho).
  let t = limpo(texto.slice(0, max * 4));
  t = t.replace(PIX_ROTULO, (_, rotulo) => { mascarados.pix++; return rotulo + MARCAS.pix; });
  t = t.replace(PIX_ALEATORIA, troca('pix'));
  t = t.replace(EMAIL, troca('email'));
  t = t.replace(CPF_FORMATADO, troca('cpf'));
  for (const re of TELEFONE) t = t.replace(re, troca('telefone'));
  t = t.replace(CPF_NU, troca('cpf'));
  t = redact(t, { env: {}, max: Infinity });
  return { texto: t.length > max ? t.slice(0, max) + '…' : t, mascarados };
}

/** Atalho: só o texto mascarado, pronto para log/auditoria. */
export function mascararTexto(texto, opts) {
  return mascararMensagem(texto, opts).texto;
}

/** Mascara os trechos de um resultado de classificarMensagem (moderacao.js) antes de registrá-lo: o motivo
 *  "contato-terceiro" carrega o telefone no trecho. Devolve uma cópia; entrada inválida vira { nivel: 'ok', motivos: [] }. */
export function mascararClassificacao(resultado) {
  const r = resultado && typeof resultado === 'object' && !Array.isArray(resultado) ? resultado : {};
  const motivos = Array.isArray(r.motivos) ? r.motivos : [];
  return {
    nivel: typeof r.nivel === 'string' ? r.nivel : 'ok',
    motivos: motivos.filter((m) => m && typeof m === 'object').map((m) => ({ ...m, trecho: mascararTexto(String(m.trecho ?? ''), { max: 80 }) })),
  };
}
