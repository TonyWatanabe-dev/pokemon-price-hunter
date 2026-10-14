// Social Media MVP — contrato de eventos de métricas e agregação local por canal/dia (issue #649; escopo #631/#560).
// Módulo puro: não publica, não acessa rede, banco nem secrets. Registrar evento exige SOCIAL_ENABLED (ausente =
// desligado); agregar só lê os eventos passados por quem chama. Sem inventar atribuição: métrica cuja fonte não foi
// declarada (ou ainda não existe, como `publicado`/`clique`) sai `null` (ausente), nunca 0. Evento inválido ou
// duplicado fica de fora da contagem e é listado em `ignorados`.
import { habilitado, PADROES, validarFila } from './fila.js';
import { verificarTrilha } from './aprovacao.js';

export const VERSAO = 1;
// Tipos emitidos pelo fluxo do MVP (rascunho → aprovação humana → kill switch).
export const TIPOS = Object.freeze(['rascunho_criado', 'aprovado', 'rejeitado', 'pausado']);
// Reservados para quando houver publicador/rastreio de clique: fazem parte do contrato, mas não têm fonte no MVP.
export const RESERVADOS = Object.freeze(['publicado', 'clique']);
export const METRICAS = Object.freeze([...TIPOS, ...RESERVADOS]);
// Um evento por item para estes tipos; `pausado` é do canal (itemId opcional) e pode se repetir em instantes distintos.
const UNICO_POR_ITEM = new Set(['rascunho_criado', 'aprovado', 'rejeitado']);

const MIN = 60e3, DIA = 24 * 60 * MIN;
const CANAL = /^[a-z0-9][a-z0-9_-]{0,39}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const ITEM_MAX = 300;
const ACAO_PARA_TIPO = { aprovar: 'aprovado', rejeitar: 'rejeitado' };

const erro = (msg) => new Error('social/metricas: ' + msg);
const plano = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const isIso = (s) => typeof s === 'string' && ISO.test(s) && Number.isFinite(Date.parse(s)) && new Date(s).toISOString() === s;

function isoDe(now) {
  const ms = now instanceof Date ? now.getTime() : typeof now === 'number' ? now : typeof now === 'string' ? Date.parse(now) : NaN;
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

/** Motivo pelo qual o evento não segue o contrato, ou '' se válido. */
export function motivoInvalido(ev) {
  if (!plano(ev)) return 'evento não é objeto';
  if (ev.v !== VERSAO) return 'versão desconhecida';
  if (RESERVADOS.includes(ev.tipo)) return `tipo reservado sem fonte no MVP: ${ev.tipo}`;
  if (!TIPOS.includes(ev.tipo)) return 'tipo desconhecido';
  if (typeof ev.canal !== 'string' || !CANAL.test(ev.canal)) return 'canal inválido';
  if (!isIso(ev.ts)) return 'ts inválido';
  if (ev.itemId !== null && (typeof ev.itemId !== 'string' || !ev.itemId || ev.itemId.length > ITEM_MAX)) return 'itemId inválido';
  if (ev.itemId === null && UNICO_POR_ITEM.has(ev.tipo)) return 'itemId obrigatório';
  return '';
}

/** Monta um evento do contrato { v, tipo, canal, itemId, ts }. Lança se inválido (nunca devolve evento parcial). */
export function evento({ tipo, canal, itemId = null, ts, now } = {}) {
  const e = { v: VERSAO, tipo, canal, itemId: itemId == null ? null : String(itemId), ts: ts ?? isoDe(now) };
  const m = motivoInvalido(e);
  if (m) throw erro(m);
  return Object.freeze(e);
}

/** Acrescenta um evento à lista (sem mutar a recebida). Desligado (SOCIAL_ENABLED ausente) não registra nada. */
export function registrar(eventos, dados, { env = {} } = {}) {
  const lista = Array.isArray(eventos) ? eventos : [];
  if (!habilitado(env)) return { status: 'desligado', eventos: lista, evento: null };
  const e = evento(dados);
  if (lista.some((x) => !motivoInvalido(x) && chave(x) === chave(e))) return { status: 'duplicado', eventos: lista, evento: null };
  return { status: 'registrado', eventos: [...lista, e], evento: e };
}

const chave = (e) => (UNICO_POR_ITEM.has(e.tipo) ? [e.tipo, e.canal, e.itemId] : [e.tipo, e.canal, e.itemId, e.ts]).join('\u0000');

/** Eventos `rascunho_criado` a partir da fila (fila.js), datados pelo criadoEm. Decisões NÃO vêm da fila: o
 *  atualizadoEm muda ao agendar e não é fonte confiável do instante da aprovação (use deTrilha). */
export function deFila(fila) {
  const f = validarFila(fila);
  const eventos = f.itens.map((it) => evento({ tipo: 'rascunho_criado', canal: it.canal, itemId: it.id, ts: it.criadoEm }));
  return { fontes: ['rascunho_criado'], eventos, ignorados: [] };
}

/** Eventos `aprovado`/`rejeitado` a partir da trilha de auditoria (aprovacao.js). A trilha não guarda canal: quem chama
 *  informa `canalPorItem` ({ itemId: canal }); item sem canal conhecido é ignorado (não se atribui canal por palpite).
 *  Trilha adulterada lança erro (falha fechada). */
export function deTrilha(trilha, canalPorItem = {}) {
  const v = verificarTrilha(trilha);
  if (!v.ok) throw erro('trilha de auditoria inválida');
  const canais = plano(canalPorItem) ? canalPorItem : {};
  const eventos = [], ignorados = [];
  trilha.forEach((t, indice) => {
    const canal = Object.hasOwn(canais, t.itemId) ? canais[t.itemId] : undefined;
    if (canal === undefined) { ignorados.push({ indice, motivo: 'canal do item desconhecido' }); return; }
    const e = { v: VERSAO, tipo: ACAO_PARA_TIPO[t.acao], canal, itemId: t.itemId, ts: t.ts };
    const m = motivoInvalido(e);
    if (m) ignorados.push({ indice, motivo: m });
    else eventos.push(Object.freeze(e));
  });
  return { fontes: ['aprovado', 'rejeitado'], eventos, ignorados };
}

function validarFontes(fontes) {
  if (!Array.isArray(fontes)) throw erro('fontes inválidas');
  for (const f of fontes) {
    if (RESERVADOS.includes(f)) throw erro(`fonte reservada sem implementação no MVP: ${f}`);
    if (!TIPOS.includes(f)) throw erro(`fonte desconhecida: ${f}`);
  }
  return new Set(fontes);
}

const contagensVazias = (fontes) => Object.fromEntries(METRICAS.map((m) => [m, fontes.has(m) ? 0 : null]));
// Só com as duas fontes de decisão e ao menos uma decisão; senão ausente.
function taxaAprovacao(c) {
  if (c.aprovado === null || c.rejeitado === null) return null;
  const total = c.aprovado + c.rejeitado;
  return total ? Math.round((c.aprovado / total) * 1e4) / 1e4 : null;
}
const resumo = (c) => ({ contagens: c, taxaAprovacao: taxaAprovacao(c) });

/** Agrega eventos por canal e por dia local (fusoMin, padrão America/Sao_Paulo como na fila).
 *  `fontes` declara quais tipos têm coleta real (padrão: todos os TIPOS do MVP); tipo fora de `fontes` sai null e seus
 *  eventos vão para `ignorados`. `canal` filtra um canal. Retorna { fontes, linhas, porCanal, total, ignorados }. */
export function agregar(eventos, { fontes = TIPOS, canal, fusoMin = PADROES.fusoMin } = {}) {
  if (!Array.isArray(eventos)) throw erro('eventos não é lista');
  const declaradas = validarFontes(fontes);
  if (canal !== undefined && (typeof canal !== 'string' || !CANAL.test(canal))) throw erro('canal inválido');
  if (!Number.isInteger(fusoMin) || fusoMin < -720 || fusoMin > 840) throw erro('fusoMin inválido');
  const fuso = fusoMin * MIN;
  const diaDe = (ts) => new Date(Math.floor((Date.parse(ts) + fuso) / DIA) * DIA).toISOString().slice(0, 10);

  const vistos = new Set(), ignorados = [], porDia = new Map(), porCanal = new Map();
  const total = contagensVazias(declaradas);
  eventos.forEach((ev, indice) => {
    const m = motivoInvalido(ev);
    if (m) { ignorados.push({ indice, motivo: m }); return; }
    if (canal !== undefined && ev.canal !== canal) return;
    if (!declaradas.has(ev.tipo)) { ignorados.push({ indice, motivo: `tipo sem fonte declarada: ${ev.tipo}` }); return; }
    const k = chave(ev);
    if (vistos.has(k)) { ignorados.push({ indice, motivo: 'evento duplicado' }); return; }
    vistos.add(k);
    const kd = ev.canal + '\u0000' + diaDe(ev.ts);
    if (!porDia.has(kd)) porDia.set(kd, { canal: ev.canal, dia: diaDe(ev.ts), contagens: contagensVazias(declaradas) });
    if (!porCanal.has(ev.canal)) porCanal.set(ev.canal, contagensVazias(declaradas));
    porDia.get(kd).contagens[ev.tipo]++;
    porCanal.get(ev.canal)[ev.tipo]++;
    total[ev.tipo]++;
  });

  const linhas = [...porDia.values()]
    .sort((a, b) => (a.canal < b.canal ? -1 : a.canal > b.canal ? 1 : a.dia < b.dia ? -1 : a.dia > b.dia ? 1 : 0))
    .map((l) => ({ canal: l.canal, dia: l.dia, ...resumo(l.contagens) }));
  const canais = Object.fromEntries([...porCanal.keys()].sort().map((c) => [c, resumo(porCanal.get(c))]));
  return { fontes: TIPOS.filter((t) => declaradas.has(t)), linhas, porCanal: canais, total: resumo(total), ignorados };
}
