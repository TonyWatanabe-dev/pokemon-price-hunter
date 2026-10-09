// Regras do vigia (tools/watchdog.mjs). Funções puras: recebem dados já lidos e devolvem estado e aviso.
//
// Estados: saudavel · degradado · parado · desconhecido (sem dados suficientes: nunca avisa nem muda o livro).
// Regras explícitas (constantes em RULES):
//  • parado: dados publicados há mais de STOP_MIN min.
//  • degradado (dados frescos, mas):
//    - as últimas FAILED_RUNS rodadas concluídas do robô falharam;
//    - meta.json ilegível; ou a seção ops ficou META_LAG_MIN min atrás dos dados publicados;
//    - nas últimas CONSEC rodadas registradas: o banco não recebeu a rodada anterior (sync atrasado);
//      o banco não pôde ser lido; o robô ficou sem DATABASE_URL; o leitor oficial ficou indisponível;
//    - "zero notas válidas": só conta como falha quando o leitor respondeu (ok), leu pelo menos
//      MIN_READ_FOR_ZERO linhas e nenhuma valeu, nas últimas CONSEC rodadas. Com menos linhas lidas
//      (pouca oferta ao vivo), fica só registrado: não há contexto para chamar de falha.
// Avisos: um na transição para falha (ou quando surge problema novo), um lembrete a cada REMIND_MIN min enquanto
// continuar, e um de recuperação depois de 2 checagens saudáveis seguidas (evita aviso em vaivém).
// O "livro" (ledger) guarda o que já foi avisado; só muda quando a mensagem chega a pelo menos um canal.

export const RULES = { STOP_MIN: 45, META_LAG_MIN: 45, CONSEC: 2, MIN_READ_FOR_ZERO: 10, REMIND_MIN: 360, FAILED_RUNS: 2 };
const BAD = new Set(['degradado', 'parado']);

const min = (a, b) => (Number.isFinite(a) && Number.isFinite(b) ? Math.round((a - b) / 6e4) : null);
export const hhmm = (iso) => { const t = Date.parse(iso); return Number.isFinite(t) ? new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }).format(new Date(t)) : '?'; };
const dur = (m) => (m == null ? '?' : m < 90 ? `${m} min` : `${(m / 60).toFixed(1).replace('.', ',')} h`);

/** Rodadas do robô (gh run list): só as concluídas que contam (cancelada/pulada não é sinal de saúde). */
export function completedRuns(runs) {
  return (Array.isArray(runs) ? runs : []).filter((r) => r && r.status === 'completed' && !['cancelled', 'skipped', 'neutral'].includes(r.conclusion))
    .map((r) => ({ conclusion: r.conclusion, at: r.updatedAt || r.createdAt, event: r.event })).filter((r) => Number.isFinite(Date.parse(r.at)))
    .sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

export function evaluate({ now = new Date().toISOString(), stateGeneratedAt, meta, metaError = null, runs }) {
  const N = Date.parse(now);
  const reasons = [];
  const add = (code, text) => reasons.push({ code, text });
  const done = completedRuns(runs);
  const lastRun = done[0] || null;
  const facts = {
    dataGeneratedAt: stateGeneratedAt || null, dataAgeMin: min(N, Date.parse(stateGeneratedAt || '')),
    lastRunAt: lastRun?.at || null, lastRunAgeMin: lastRun ? min(N, Date.parse(lastRun.at)) : null, lastRunConclusion: lastRun?.conclusion || null,
    metaLastAt: meta?.ops?.last?.generatedAt || null,
  };
  if (!Number.isFinite(Date.parse(stateGeneratedAt || ''))) {
    add('dados_indisponiveis', 'Não deu para ler os dados publicados (ramo data).');
    return { status: 'desconhecido', reasons, facts };
  }
  // ---- parado
  if (facts.dataAgeMin > RULES.STOP_MIN) {
    add('dados_parados', `Os preços não atualizam desde ${hhmm(stateGeneratedAt)} (${dur(facts.dataAgeMin)}).`);
    if (!lastRun || facts.lastRunAgeMin > RULES.STOP_MIN) add('sem_rodadas', `Nenhuma rodada do robô concluída ${lastRun ? 'desde ' + hhmm(lastRun.at) : 'recentemente'}: confira o disparo externo (cron-job.org).`);
    else if (lastRun.conclusion !== 'success') add('rodada_falhou', `A última rodada (${hhmm(lastRun.at)}) falhou.`);
    else add('rodada_sem_publicar', `A última rodada (${hhmm(lastRun.at)}) terminou, mas os dados não foram publicados.`);
    return { status: 'parado', reasons, facts };
  }
  // ---- degradado
  const failed = done.slice(0, RULES.FAILED_RUNS);
  if (failed.length === RULES.FAILED_RUNS && failed.every((r) => r.conclusion !== 'success')) add('rodadas_falhando', `As ${RULES.FAILED_RUNS} últimas rodadas do robô falharam (última às ${hhmm(failed[0].at)}).`);
  if (metaError === 'ilegivel') add('meta_ilegivel', 'O estado operacional (data/meta.json) está ilegível.');
  const ops = meta?.ops;
  const recs = Array.isArray(ops?.runs) ? ops.runs.slice(-RULES.CONSEC) : [];
  if (ops?.last && min(Date.parse(stateGeneratedAt), Date.parse(ops.last.generatedAt)) > RULES.META_LAG_MIN) add('meta_desatualizado', `O estado operacional parou em ${hhmm(ops.last.generatedAt)}, mas os dados seguem sendo publicados.`);
  if (recs.length === RULES.CONSEC) {
    const all = (f) => recs.every(f);
    const last = recs[recs.length - 1];
    if (all((r) => r.dbSync?.status === 'atrasado')) add('sync_falhando', `O banco não recebeu as últimas rodadas (último dado no banco: ${hhmm(last.dbSync.lastSeenAt)}). O site e a API podem mostrar preços antigos.`);
    else if (all((r) => r.dbSync?.status === 'indisponivel')) add('banco_inacessivel', `O robô não conseguiu ler o banco (${last.dbSync.reason || 'sem detalhe'}).`);
    else if (all((r) => r.dbSync?.status === 'desligado')) add('banco_desligado', 'O robô está rodando sem DATABASE_URL: sem sincronização nem nota oficial.');
    if (all((r) => r.reader?.status === 'unavailable')) add('leitor_indisponivel', `Leitor da nota oficial indisponível (${last.reader.reason || 'sem detalhe'}): alertas saem sem a nota.`);
    else if (all((r) => r.reader?.status === 'ok' && r.reader.read >= RULES.MIN_READ_FOR_ZERO && r.reader.valid === 0)) add('leitor_sem_nota', `Leitor oficial sem nenhuma nota válida (${last.reader.valid}/${last.reader.read}).`);
  }
  if (reasons.length) return { status: 'degradado', reasons, facts };
  if (!ops?.last) { add(metaError === 'ausente' || !meta ? 'meta_ausente' : 'ops_ausente', 'Ainda sem estado operacional registrado: banco e leitor não verificados.'); return { status: 'desconhecido', reasons, facts }; }
  return { status: 'saudavel', reasons, facts };
}

const EMPTY = { notifiedStatus: 'saudavel', notifiedAt: null, notifiedCodes: [], incidentSince: null, lastStatus: null, lastCheckAt: null };
export function normalizeLedger(l) {
  if (!l || typeof l !== 'object' || !['saudavel', 'degradado', 'parado'].includes(l.notifiedStatus)) return { ...EMPTY };
  return { ...EMPTY, ...l, notifiedCodes: Array.isArray(l.notifiedCodes) ? l.notifiedCodes : [] };
}

const LABEL = { parado: 'TCG Price Hunter parado', degradado: 'TCG Price Hunter com problema' };
const HEAD = { parado: '🔴 ' + LABEL.parado, degradado: '🟠 ' + LABEL.degradado };
const ACTIONS = 'https://github.com/TonyWatanabe-dev/pokemon-price-hunter/actions';
const CODE_LABEL = {
  dados_parados: 'preços sem atualizar', sem_rodadas: 'robô sem disparo', rodada_falhou: 'rodada com falha', rodada_sem_publicar: 'dados sem publicar',
  rodadas_falhando: 'rodadas falhando', meta_ilegivel: 'estado operacional ilegível', meta_desatualizado: 'estado operacional parado',
  sync_falhando: 'banco sem sincronizar', banco_inacessivel: 'banco inacessível', banco_desligado: 'robô sem banco',
  leitor_indisponivel: 'leitor oficial indisponível', leitor_sem_nota: 'leitor sem nota válida',
};

/** Decide se avisa. Não altera o livro: use commitLedger depois de tentar enviar. */
export function decide(ev, ledgerIn, now = new Date().toISOString()) {
  const L = normalizeLedger(ledgerIn);
  const codes = ev.reasons.map((r) => r.code);
  const lines = ev.reasons.map((r) => '• ' + r.text);
  if (ev.status === 'desconhecido') return { notify: null };
  if (BAD.has(ev.status)) {
    const changed = L.notifiedStatus !== ev.status;
    const fresh = codes.filter((c) => !L.notifiedCodes.includes(c));
    const due = !changed && L.notifiedAt && min(Date.parse(now), Date.parse(L.notifiedAt)) >= RULES.REMIND_MIN;
    if (changed || fresh.length) return { notify: { kind: 'falha', title: HEAD[ev.status], text: [HEAD[ev.status], '', ...lines, '', ACTIONS].join('\n') } };
    if (due) return { notify: { kind: 'lembrete', title: `⏰ ${LABEL[ev.status]} (continua)`, text: [`⏰ Continua: ${LABEL[ev.status]} desde ${hhmm(L.incidentSince)} (${dur(min(Date.parse(now), Date.parse(L.incidentSince)))}).`, '', ...lines, '', ACTIONS].join('\n') } };
    return { notify: null };
  }
  // saudável: recuperação só depois de 2 checagens saudáveis seguidas
  if (BAD.has(L.notifiedStatus) && L.lastStatus === 'saudavel') {
    const was = L.notifiedCodes.length ? `: ${L.notifiedCodes.map((c) => CODE_LABEL[c] || c).join('; ')}` : '';
    const lasted = L.incidentSince ? ` Problema durou ${dur(min(Date.parse(now), Date.parse(L.incidentSince)))}${was}.` : '';
    return { notify: { kind: 'recuperado', title: '🟢 TCG Price Hunter recuperado', text: `🟢 TCG Price Hunter recuperado: dados de ${hhmm(ev.facts.dataGeneratedAt)}, banco e leitor oficial normais.${lasted}` } };
  }
  return { notify: null };
}

/** Atualiza o livro. O que foi avisado só muda quando a mensagem chegou a pelo menos um canal. */
export function commitLedger(ledgerIn, ev, decision, delivered, now = new Date().toISOString()) {
  const L = normalizeLedger(ledgerIn);
  if (ev.status === 'desconhecido') return { ...L, lastCheckAt: now };
  const out = { ...L, lastStatus: ev.status, lastCheckAt: now };
  if (BAD.has(ev.status) && !L.incidentSince) out.incidentSince = now;
  if (decision.notify && delivered) {
    out.notifiedAt = now;
    if (decision.notify.kind === 'recuperado') { out.notifiedStatus = 'saudavel'; out.notifiedCodes = []; out.incidentSince = null; }
    else { out.notifiedStatus = ev.status; out.notifiedCodes = [...new Set([...(L.notifiedStatus === ev.status ? L.notifiedCodes : []), ...ev.reasons.map((r) => r.code)])]; }
  }
  // saudável sem aviso pendente: incidente encerrado
  if (ev.status === 'saudavel' && out.notifiedStatus === 'saudavel') out.incidentSince = null;
  return out;
}
