// Social Media MVP — calendário de lançamentos do catálogo (issue #658; escopo da #631/#560). Desativado por padrão.
// Módulo puro: não publica, não acessa rede, banco nem secrets; não lê arquivo (o chamador passa o config/catalog.json já
// lido). Data de lançamento só existe se a coleção trouxer os campos release_date (AAAA-MM-DD) e release_date_source (URL
// https da fonte), no mesmo padrão de ean/ean_source: sem data = não agenda; data ou fonte inválida = recusada com motivo.
// Nada é inferido (nem de coleções combinadas, nem de série). Os slots viram rascunhos na fila editorial (fila.js) e
// seguem para aprovação humana; o horário sugerido é só informativo — quem agenda é agendar() depois da aprovação.
import { enfileirar, habilitado, filaVazia, validarFila } from './fila.js';
import { limpar, cortar, NOME_MAX, AVISO_COMPRA } from './rascunho.js';

export const SOCIAL_ENABLED_DEFAULT = false;
export const CAMPOS = Object.freeze({ data: 'release_date', fonte: 'release_date_source' });
// janelaDias: só sugere slots entre agora e agora + janelaDias; horaLocal/fusoMin: horário do slot no fuso do site
// (America/Sao_Paulo = UTC-3, sem horário de verão), como em fila.js.
export const PADROES = Object.freeze({ janelaDias: 30, horaLocal: 10, fusoMin: -180 });
export const SLOTS = Object.freeze([
  Object.freeze({ tipo: 'anuncio', diasAntes: 7 }),
  Object.freeze({ tipo: 'vespera', diasAntes: 1 }),
  Object.freeze({ tipo: 'lancamento', diasAntes: 0 }),
]);
export const MOTIVOS = Object.freeze({
  DATA_INVALIDA: 'data de lançamento inválida',
  SEM_FONTE: 'data de lançamento sem fonte https',
  COLECAO_INVALIDA: 'coleção sem id',
});

const MIN = 60e3, DIA = 24 * 60 * MIN;
const DATA = /^(\d{4})-(\d{2})-(\d{2})$/;
const erro = (m) => new Error('social/lancamentos: ' + m);
const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const txt = (v) => (typeof v === 'string' ? v.trim() : '');
const nowDe = (now) => (now === undefined ? Date.now() : now instanceof Date ? now.getTime() : typeof now === 'number' ? now : typeof now === 'string' ? Date.parse(now) : NaN);
const https = (u) => { try { const x = new URL(u); return x.protocol === 'https:' && !!x.host; } catch { return false; } };
const dataBr = ({ d, m, a }) => `${String(d).padStart(2, '0')}/${String(m).padStart(2, '0')}/${a}`;

function dataValida(s) {
  const r = DATA.exec(txt(s));
  if (!r) return null;
  const [a, m, d] = r.slice(1).map(Number);
  const t = Date.UTC(a, m - 1, d);
  const x = new Date(t);
  return x.getUTCFullYear() === a && x.getUTCMonth() === m - 1 && x.getUTCDate() === d ? { a, m, d } : null;
}

function config({ janelaDias = PADROES.janelaDias, horaLocal = PADROES.horaLocal, fusoMin = PADROES.fusoMin } = {}) {
  if (typeof janelaDias !== 'number' || !Number.isFinite(janelaDias) || janelaDias <= 0) throw erro('janelaDias inválido');
  if (!Number.isInteger(horaLocal) || horaLocal < 0 || horaLocal > 23) throw erro('horaLocal inválido');
  if (!Number.isInteger(fusoMin) || fusoMin < -720 || fusoMin > 840) throw erro('fusoMin inválido');
  return { janelaDias, horaLocal, fusoMin };
}

/** Datas de lançamento declaradas no catálogo. Devolve { lancamentos: [{ colecao, nome, serie, data, fonte }],
 *  semData: [colecao], recusadas: [{ colecao, motivo }] }; lançamentos por data e depois id. Catálogo sem lista de
 *  coleções lança erro (dado corrompido nunca vira calendário vazio silencioso). */
export function datasDeLancamento(catalogo) {
  if (!isObj(catalogo) || !Array.isArray(catalogo.collections)) throw erro('catálogo sem lista de coleções');
  const lancamentos = [], semData = [], recusadas = [];
  catalogo.collections.forEach((c, i) => {
    const colecao = isObj(c) ? txt(c.id) : '';
    if (!colecao) { recusadas.push({ colecao: `#${i}`, motivo: MOTIVOS.COLECAO_INVALIDA }); return; }
    const bruto = c[CAMPOS.data];
    if (bruto === undefined || bruto === null || bruto === '') { semData.push(colecao); return; }
    const data = dataValida(bruto);
    if (!data) { recusadas.push({ colecao, motivo: MOTIVOS.DATA_INVALIDA }); return; }
    const fonte = txt(c[CAMPOS.fonte]);
    if (!https(fonte)) { recusadas.push({ colecao, motivo: MOTIVOS.SEM_FONTE }); return; }
    const nome = cortar(limpar(c.name), NOME_MAX) || colecao;
    lancamentos.push({ colecao, nome, serie: cortar(limpar(c.series), NOME_MAX) || null, data: txt(bruto), fonte });
  });
  lancamentos.sort((x, y) => x.data.localeCompare(y.data) || x.colecao.localeCompare(y.colecao));
  return { lancamentos, semData, recusadas };
}

function textoDo(tipo, l, d) {
  const quando = dataBr(d);
  const chamada = tipo === 'anuncio' ? `Lançamento chegando: ${l.nome} sai em ${quando}.`
    : tipo === 'vespera' ? `É amanhã: ${l.nome} sai em ${quando}.`
    : `Lançamento hoje (${quando}): ${l.nome}.`;
  return `${chamada}\nData conforme o catálogo do TCG Price Hunter; pode mudar.\n${AVISO_COMPRA}`;
}

/** Slots de conteúdo para os lançamentos do catálogo dentro de [now, now + janelaDias]: anúncio (D-7), véspera (D-1) e
 *  dia do lançamento (D0), às horaLocal no fuso do site. Nunca no passado. Desligado (SOCIAL_ENABLED ausente) não sugere
 *  nada. Devolve { status, slots: [{ colecao, nome, data, fonte, tipo, quando, chaveDedupe, texto }], semData, recusadas }. */
export function sugerirSlots(catalogo, { now, env = {}, ...opts } = {}) {
  const { janelaDias, horaLocal, fusoMin } = config(opts);
  const t0 = nowDe(now);
  if (!Number.isFinite(t0)) throw erro('now inválido');
  const { lancamentos, semData, recusadas } = datasDeLancamento(catalogo);
  if (!habilitado(env)) return { status: 'desligado', slots: [], semData, recusadas };
  const limite = t0 + janelaDias * DIA;
  const slots = [];
  for (const l of lancamentos) {
    const d = dataValida(l.data);
    for (const { tipo, diasAntes } of SLOTS) {
      const t = Date.UTC(d.a, d.m - 1, d.d - diasAntes, horaLocal) - fusoMin * MIN;
      if (t < t0 || t > limite) continue;
      slots.push({ colecao: l.colecao, nome: l.nome, data: l.data, fonte: l.fonte, tipo, quando: new Date(t).toISOString(),
        chaveDedupe: `lancamento:${l.colecao}:${l.data}:${tipo}`, texto: textoDo(tipo, l, d) });
    }
  }
  slots.sort((x, y) => x.quando.localeCompare(y.quando) || x.chaveDedupe.localeCompare(y.chaveDedupe));
  return { status: 'ok', slots, semData, recusadas };
}

/** Coloca os slots sugeridos como rascunhos na fila editorial do canal (fila.js; não muta a fila recebida). Idempotente:
 *  a janela de repetição cobre todo o período em que o mesmo slot pode ser sugerido de novo. A data muda a chave, então
 *  adiamento no catálogo gera rascunho novo para revisão humana. Desligado devolve a fila inalterada. */
export function enfileirarLancamentos(fila, catalogo, { canal, now, env = {}, ...opts } = {}) {
  const f = fila == null ? filaVazia() : validarFila(fila);
  const t0 = nowDe(now);
  const r = sugerirSlots(catalogo, { now: t0, env, ...opts });
  const base = { status: r.status, fila: f, enfileirados: [], duplicados: [], semData: r.semData, recusadas: r.recusadas };
  if (r.status !== 'ok') return base;
  const janelaHoras = (config(opts).janelaDias + 1) * 24;
  let atual = f;
  for (const s of r.slots) {
    const e = enfileirar(atual, { canal, chaveDedupe: s.chaveDedupe, texto: s.texto }, { now: t0, janelaHoras });
    atual = e.fila;
    const info = { id: e.item.id, colecao: s.colecao, tipo: s.tipo, sugeridoPara: s.quando, fonte: s.fonte };
    (e.status === 'enfileirado' ? base.enfileirados : base.duplicados).push(info);
  }
  return { ...base, fila: atual };
}
