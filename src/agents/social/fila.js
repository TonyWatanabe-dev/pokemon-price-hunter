// Social Media — fila editorial, calendário e kill switch PUROS (issue #635; escopo da #631/#560). Desativado por padrão.
// Somente rascunho → aprovação humana: não publica, não chama API de Telegram/Instagram/WhatsApp, não acessa rede, banco
// nem secrets. O estado é um objeto/JSON passado pelo chamador; nenhuma função muta a fila recebida (devolve uma nova).
// Dado inválido ou corrompido lança erro: nunca é aceito parcialmente.

export const SOCIAL_ENABLED_DEFAULT = false;
export const VERSAO = 1;
export const ESTADOS = Object.freeze(['rascunho', 'aprovado', 'rejeitado', 'publicado']);
// Publicação fica fora do MVP: nenhuma transição leva a 'publicado' (estado reservado para o futuro).
export const TRANSICOES = Object.freeze({
  rascunho: Object.freeze(['aprovado', 'rejeitado']),
  aprovado: Object.freeze([]),
  rejeitado: Object.freeze([]),
  publicado: Object.freeze([]),
});
// fusoMin: deslocamento do fuso em minutos para contar "por dia" (America/Sao_Paulo = UTC-3, sem horário de verão).
export const PADROES = Object.freeze({ janelaRepeticaoHoras: 24, porDia: 3, intervaloMin: 120, janelaHoras: 24, fusoMin: -180 });
export const CAMPOS = Object.freeze(['id', 'canal', 'chaveDedupe', 'texto', 'estado', 'criadoEm', 'atualizadoEm', 'agendadoPara', 'motivo']);

const MIN = 60e3, H = 60 * MIN, DIA = 24 * H;
const CANAL = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const CHAVE_MAX = 200, TEXTO_MAX = 4000, MOTIVO_MAX = 500;

const erro = (msg) => new Error('social/fila: ' + msg);
const plano = (o) => !!o && typeof o === 'object' && !Array.isArray(o) && Object.getPrototypeOf(o) === Object.prototype;
const isIso = (s) => typeof s === 'string' && ISO.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString() === s;
const iso = (ms) => new Date(ms).toISOString();
const ordenado = (it) => Object.fromEntries(CAMPOS.map((k) => [k, it[k]]));

function instante(now) {
  const ms = now instanceof Date ? now.getTime() : typeof now === 'number' ? now : typeof now === 'string' ? Date.parse(now) : NaN;
  if (!Number.isFinite(ms)) throw erro('now inválido ou ausente');
  return ms;
}
function numero(v, nome, { min = 0, inteiro = false, positivo = false } = {}) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v < min || (positivo && v <= 0) || (inteiro && !Number.isInteger(v))) throw erro(`${nome} inválido`);
  return v;
}
function validarCanal(canal) {
  if (typeof canal !== 'string' || !CANAL.test(canal)) throw erro('canal inválido');
  return canal;
}

/** Ligado só com SOCIAL_ENABLED=1|true explícito; ausente (ou qualquer outro valor) = desligado. */
export function habilitado(env = {}) {
  const v = String(env?.SOCIAL_ENABLED ?? '').trim().toLowerCase();
  return SOCIAL_ENABLED_DEFAULT || v === '1' || v === 'true';
}

/** Kill switch: SOCIAL_PAUSA com lista de canais (vírgula, ponto e vírgula ou espaço) ou "todos". */
export function pausado(canal, env = {}) {
  const raw = env?.SOCIAL_PAUSA;
  if (raw == null) return false;
  const lista = String(raw).toLowerCase().split(/[\s,;]+/).filter(Boolean);
  return lista.includes('todos') || lista.includes(String(canal).toLowerCase());
}

function validarItem(it, i) {
  const onde = `item ${i}`;
  if (!plano(it)) throw erro(`${onde}: não é objeto`);
  const ks = Object.keys(it);
  if (ks.length !== CAMPOS.length || !CAMPOS.every((k) => Object.hasOwn(it, k))) throw erro(`${onde}: campos inesperados ou ausentes`);
  if (typeof it.id !== 'string' || !it.id) throw erro(`${onde}: id inválido`);
  if (typeof it.canal !== 'string' || !CANAL.test(it.canal)) throw erro(`${onde}: canal inválido`);
  if (typeof it.chaveDedupe !== 'string' || !it.chaveDedupe.trim() || it.chaveDedupe !== it.chaveDedupe.trim() || it.chaveDedupe.length > CHAVE_MAX) throw erro(`${onde}: chaveDedupe inválida`);
  if (typeof it.texto !== 'string' || it.texto.length > TEXTO_MAX) throw erro(`${onde}: texto inválido`);
  if (!ESTADOS.includes(it.estado)) throw erro(`${onde}: estado inválido`);
  if (!isIso(it.criadoEm) || !isIso(it.atualizadoEm) || it.atualizadoEm < it.criadoEm) throw erro(`${onde}: datas inválidas`);
  if (it.agendadoPara !== null && !isIso(it.agendadoPara)) throw erro(`${onde}: agendadoPara inválido`);
  if (it.agendadoPara !== null && it.estado !== 'aprovado' && it.estado !== 'publicado') throw erro(`${onde}: só item aprovado pode ter horário`);
  if (it.motivo !== null && (typeof it.motivo !== 'string' || it.motivo.length > MOTIVO_MAX)) throw erro(`${onde}: motivo inválido`);
}

/** Valida a forma completa da fila; lança no primeiro problema. Devolve uma cópia com campos em ordem estável. */
export function validarFila(fila) {
  if (!plano(fila)) throw erro('fila não é objeto');
  const ks = Object.keys(fila);
  if (ks.length !== 2 || !Object.hasOwn(fila, 'versao') || !Object.hasOwn(fila, 'itens')) throw erro('fila com campos inesperados ou ausentes');
  if (fila.versao !== VERSAO) throw erro('versão desconhecida');
  if (!Array.isArray(fila.itens)) throw erro('itens não é lista');
  const ids = new Set();
  fila.itens.forEach((it, i) => {
    validarItem(it, i);
    if (ids.has(it.id)) throw erro(`item ${i}: id duplicado`);
    ids.add(it.id);
  });
  return { versao: VERSAO, itens: fila.itens.map(ordenado) };
}

export const filaVazia = () => ({ versao: VERSAO, itens: [] });
const entrada = (fila) => (fila == null ? filaVazia() : validarFila(fila));

/** Enfileira um rascunho. Idempotente por chaveDedupe + canal: a mesma chave no mesmo canal dentro de janelaHoras
 *  (padrão 24 h, contada da criação do item anterior, em qualquer estado) é recusada e a fila volta inalterada. */
export function enfileirar(fila, item, { now, janelaHoras = PADROES.janelaRepeticaoHoras } = {}) {
  const f = entrada(fila);
  const t = instante(now);
  numero(janelaHoras, 'janelaHoras', { positivo: true });
  if (!plano(item)) throw erro('item inválido');
  const canal = validarCanal(item.canal);
  if (typeof item.chaveDedupe !== 'string' || !item.chaveDedupe.trim() || item.chaveDedupe.trim().length > CHAVE_MAX) throw erro('chaveDedupe inválida');
  const chave = item.chaveDedupe.trim();
  const texto = item.texto === undefined ? '' : item.texto;
  if (typeof texto !== 'string' || texto.length > TEXTO_MAX) throw erro('texto inválido');

  const anterior = f.itens.filter((x) => x.canal === canal && x.chaveDedupe === chave && t - Date.parse(x.criadoEm) < janelaHoras * H).pop();
  if (anterior) return { status: 'duplicado', fila: f, item: { ...anterior } };

  const criadoEm = iso(t);
  const novo = { id: `${canal}:${chave}:${criadoEm}`, canal, chaveDedupe: chave, texto, estado: 'rascunho', criadoEm, atualizadoEm: criadoEm, agendadoPara: null, motivo: null };
  if (f.itens.some((x) => x.id === novo.id)) throw erro('id já existe');
  return { status: 'enfileirado', fila: { versao: VERSAO, itens: [...f.itens, novo] }, item: { ...novo } };
}

/** Muda o estado de um item. Só rascunho → aprovado | rejeitado; 'publicado' é sempre recusado neste MVP. */
export function transicionar(fila, id, para, { now, motivo = null } = {}) {
  const f = entrada(fila);
  const t = instante(now);
  const idx = f.itens.findIndex((x) => x.id === id);
  if (idx < 0) throw erro('item inexistente');
  if (para === 'publicado') throw erro('publicação fora do escopo do MVP: transição para "publicado" recusada');
  if (!ESTADOS.includes(para)) throw erro('estado desconhecido');
  const atual = f.itens[idx];
  if (!TRANSICOES[atual.estado].includes(para)) throw erro(`transição inválida: ${atual.estado} → ${para}`);
  if (motivo !== null && (typeof motivo !== 'string' || motivo.length > MOTIVO_MAX)) throw erro('motivo inválido');
  const item = { ...atual, estado: para, atualizadoEm: iso(Math.max(t, Date.parse(atual.atualizadoEm))), motivo };
  const itens = f.itens.slice();
  itens[idx] = item;
  return { fila: { versao: VERSAO, itens }, item: { ...item } };
}
export const aprovar = (fila, id, opts) => transicionar(fila, id, 'aprovado', opts);
export const rejeitar = (fila, id, opts) => transicionar(fila, id, 'rejeitado', opts);

/** Sugere horários para os itens aprovados e sem horário do canal (ordem de criação), respeitando o limite por dia
 *  (contando os já agendados), o intervalo mínimo entre publicações e a janela [now, now + janelaHoras]. Nunca no
 *  passado. Desligado (SOCIAL_ENABLED ausente) ou pausado (SOCIAL_PAUSA) não agenda nada. A fila devolvida traz
 *  agendadoPara preenchido; persistir ou não é decisão do chamador. Itens sem vaga ficam em semVaga. */
export function agendar(fila, { canal, now, porDia = PADROES.porDia, intervaloMin = PADROES.intervaloMin, janelaHoras = PADROES.janelaHoras, fusoMin = PADROES.fusoMin, env = {} } = {}) {
  const f = entrada(fila);
  const t0 = instante(now);
  validarCanal(canal);
  numero(porDia, 'porDia', { min: 1, inteiro: true });
  numero(intervaloMin, 'intervaloMin');
  numero(janelaHoras, 'janelaHoras', { positivo: true });
  numero(fusoMin, 'fusoMin', { min: -720, inteiro: true });
  if (fusoMin > 840) throw erro('fusoMin inválido');
  const vazio = (status) => ({ status, canal, sugestoes: [], semVaga: [], fila: f });
  if (!habilitado(env)) return vazio('desligado');
  if (pausado(canal, env)) return vazio('pausado');

  const doCanal = f.itens.filter((x) => x.canal === canal);
  const ocupados = doCanal.filter((x) => x.agendadoPara !== null).map((x) => Date.parse(x.agendadoPara));
  const pendentes = doCanal.filter((x) => x.estado === 'aprovado' && x.agendadoPara === null)
    .sort((a, b) => (a.criadoEm < b.criadoEm ? -1 : a.criadoEm > b.criadoEm ? 1 : a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const limite = t0 + janelaHoras * H, intervalo = intervaloMin * MIN, fuso = fusoMin * MIN;
  const diaDe = (ms) => Math.floor((ms + fuso) / DIA);
  const vaga = (inicio) => {
    for (let t = inicio; t <= limite;) {
      const d = diaDe(t);
      if (ocupados.filter((o) => diaDe(o) === d).length >= porDia) { t = (d + 1) * DIA - fuso; continue; }
      const conflitos = ocupados.filter((o) => Math.abs(t - o) < intervalo);
      if (conflitos.length) { t = Math.max(...conflitos) + intervalo; continue; }
      return t;
    }
    return null;
  };

  const sugestoes = [], semVaga = [], quando = new Map();
  let cursor = Math.ceil(t0 / MIN) * MIN;
  for (const p of pendentes) {
    const t = vaga(cursor);
    if (t === null) { semVaga.push(p.id); continue; }
    ocupados.push(t); quando.set(p.id, t); cursor = t;
    sugestoes.push({ id: p.id, quando: iso(t) });
  }
  const itens = f.itens.map((x) => (quando.has(x.id) ? { ...x, agendadoPara: iso(quando.get(x.id)), atualizadoEm: iso(Math.max(t0, Date.parse(x.atualizadoEm))) } : x));
  return { status: 'ok', canal, sugestoes, semVaga, fila: { versao: VERSAO, itens } };
}

/** Serialização estável: valida antes, campos em ordem fixa, 2 espaços e quebra de linha final. */
export function paraJson(fila) {
  return JSON.stringify(validarFila(fila), null, 2) + '\n';
}

/** Lê a fila de JSON. Texto inválido ou forma inesperada lança erro; nunca devolve fila parcial. */
export function deJson(texto) {
  if (typeof texto !== 'string') throw erro('JSON ausente');
  let dado;
  try { dado = JSON.parse(texto); } catch { throw erro('JSON corrompido'); }
  return validarFila(dado);
}
