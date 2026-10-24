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
//    - fonte vigiada (rodada → watched; começa pelo Mercado Livre) que já trouxe anúncios e, nas últimas CONSEC
//      rodadas, ficou bloqueada, com erro ou ativa com zero anúncios.
//    - motor de oportunidades parado: nas últimas CONSEC rodadas o banco sincronizou, mas a batida do motor ficou
//      para trás (engine.status 'parado', ver src/opstate.js). Sem batida ainda ('sem_heartbeat') nunca avisa.
//    - deploy de produção degradado (deployIssues): o último deployment "Production" da API do GitHub (criado pela
//      integração da Vercel) terminou em failure/error, ou ficou pendente por mais de DEPLOY_STUCK_MIN min.
//      Leitura ausente ou ilegível não avisa (sem evidência não há alarme, e o Vigia não cai por isso).
//    - WhatsApp parado (whatsappIssues, 24/10/2026): as últimas WA_FAILED rodadas concluídas do envio automático ao
//      grupo falharam (sessão caída, número bloqueado, grupo não achado). Rodada pulada (kill switch) não conta.
// Avisos: um na transição para falha (ou quando surge problema novo), um lembrete a cada REMIND_MIN min enquanto
// continuar, e um de recuperação depois de 2 checagens saudáveis seguidas (evita aviso em vaivém).
// O "livro" (ledger) guarda o que já foi avisado; só muda quando a mensagem chega a pelo menos um canal.
// Aviso antecipado (não é falha, não muda o estado): copag_vencendo — referência Copag oficial que sai da nota em até
// 7 dias (copagWarnings / decideWarning); avisa quando a lista muda e lembra a cada WARN_REMIND_MIN.

export const RULES = { STOP_MIN: 45, META_LAG_MIN: 45, CONSEC: 2, MIN_READ_FOR_ZERO: 10, REMIND_MIN: 360, FAILED_RUNS: 2, WARN_REMIND_MIN: 1440, UNKNOWN_CONSEC: 3, DEPLOY_STUCK_MIN: 30, WA_FAILED: 4 };
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

/**
 * Aviso antecipado copag_vencendo: a última rodada (ops.last.copag, ver copagSummary em src/opstate.js) listou referência
 * Copag oficial que sai da view reference_price_current em até 7 dias. Só aviso: não muda o estado (saudável continua
 * saudável), nem nota, nem ranking. Item já vencido em relação a `now` não entra (a próxima rodada deixa de listá-lo).
 */
export function copagWarnings(meta, now) {
  const N = Date.parse(now);
  const xs = (Array.isArray(meta?.ops?.last?.copag?.expiring) ? meta.ops.last.copag.expiring : [])
    .filter((x) => x && typeof x.id === 'string' && Number.isFinite(Date.parse(x.expires_at)) && Date.parse(x.expires_at) >= N)
    .sort((a, b) => Date.parse(a.expires_at) - Date.parse(b.expires_at) || a.id.localeCompare(b.id));
  if (!xs.length) return [];
  const items = xs.map((x) => `${x.id} (verificada em ${hhmm(x.verified_at)}; sai da nota após ${hhmm(x.expires_at)})`);
  return [{ code: 'copag_vencendo', products: xs.map((x) => x.id), expiresAt: xs[0].expires_at,
    key: 'copag_vencendo:' + xs.map((x) => `${x.id}@${x.expires_at}`).join(','),
    text: `Referência Copag oficial vence em breve: ${items.join('; ')}. Sem nova auditoria na loja Copag, esses produtos passam a usar a referência de mercado (ou ficam sem referência). Ver docs/referencia-copag.md, "Validade e renovação".` }];
}

/**
 * Deploy de produção (somente leitura): `deploy` = { deployment: { sha, created_at, environment }, statuses: [{ state,
 * created_at }] } do último deployment "Production" (statuses em qualquer ordem; vale o mais recente).
 * failure/error → deploy_falhou; pending/queued/in_progress há mais de DEPLOY_STUCK_MIN min → deploy_preso.
 * Sem dado, dado inválido, success ou inactive: nenhum motivo.
 */
export function deployIssues(deploy, now) {
  const N = Date.parse(now);
  const d = deploy?.deployment;
  if (!d || typeof d !== 'object' || !Number.isFinite(N)) return [];
  const sts = (Array.isArray(deploy.statuses) ? deploy.statuses : []).filter((x) => x && typeof x.state === 'string' && Number.isFinite(Date.parse(x.created_at)))
    .sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
  const sha = /^[0-9a-f]{7,40}$/i.test(String(d.sha || '')) ? String(d.sha).slice(0, 7) : '?';
  const st = sts[0]?.state?.toLowerCase() || null;
  if (st === 'failure' || st === 'error') return [{ code: 'deploy_falhou', text: `O último deploy de produção (${sha}, ${hhmm(sts[0].created_at)}) terminou em ${st}: o site pode estar numa versão anterior.` }];
  const created = Date.parse(d.created_at);
  if ((st === null || ['pending', 'queued', 'in_progress'].includes(st)) && Number.isFinite(created) && min(N, created) > RULES.DEPLOY_STUCK_MIN)
    return [{ code: 'deploy_preso', text: `O deploy de produção ${sha} está ${st || 'sem status'} desde ${hhmm(d.created_at)} (${dur(min(N, created))}).` }];
  return [];
}

/** Envio automático ao WhatsApp: as últimas WA_FAILED rodadas concluídas (sem as puladas) falharam → grupo parado. */
export function whatsappIssues(waRuns) {
  const done = completedRuns(waRuns).filter((r) => r.conclusion !== 'skipped').slice(0, RULES.WA_FAILED);
  if (done.length < RULES.WA_FAILED || done.some((r) => r.conclusion === 'success')) return [];
  return [{ code: 'whatsapp_parado', text: `As ${RULES.WA_FAILED} últimas rodadas do envio ao grupo do WhatsApp falharam (última às ${hhmm(done[0].at)}): o grupo está sem ofertas. Confira a sessão (pode ser preciso parear de novo) e se o número foi bloqueado.` }];
}

export function evaluate({ now = new Date().toISOString(), stateGeneratedAt, meta, metaError = null, runs, deploy = null, waRuns = null }) {
  const ev = evaluateStatus({ now, stateGeneratedAt, meta, metaError, runs, deploy, waRuns });
  return { ...ev, warnings: copagWarnings(meta, now) };
}

function evaluateStatus({ now, stateGeneratedAt, meta, metaError, runs, deploy, waRuns }) {
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
    const down = (x) => !!x && (['BLOCKED', 'ERROR'].includes(x.status) || (x.status === 'ACTIVE' && x.listings === 0));
    for (const id of Object.keys(last.watched || {})) {
      const xs = recs.map((r) => r.watched?.[id]); const x = xs[xs.length - 1];
      if (!xs.every(down)) continue;
      const seen = xs.map((y) => y.lastNonEmpty).filter(Boolean).pop();
      if (!seen) continue;   // fonte que nunca trouxe anúncio: sem histórico de atividade, não avisa
      const how = x.status === 'BLOCKED' ? 'bloqueada' : x.status === 'ERROR' ? 'com erro' : 'sem nenhum anúncio';
      add('fonte_degradada', `${x.name || id} ${how} nas últimas ${RULES.CONSEC} rodadas (último com anúncios: ${hhmm(seen)}). Os preços dessa fonte podem estar faltando.`);
    }
    if (all((r) => r.engine?.status === 'parado')) add('motor_parado', `Motor de oportunidades parado (última execução: ${hhmm(last.engine.runAt)}): as notas podem estar antigas.`);
  }
  for (const x of deployIssues(deploy, now)) { const preso = x.code === 'deploy_preso'; add(preso ? 'deploy_preso' : 'deploy_falhou', x.text); }
  const wa = whatsappIssues(waRuns); if (wa.length) add('whatsapp_parado', wa[0].text);
  if (reasons.length) return { status: 'degradado', reasons, facts };
  if (!ops?.last) { add(metaError === 'ausente' || !meta ? 'meta_ausente' : 'ops_ausente', 'Ainda sem estado operacional registrado: banco e leitor não verificados.'); return { status: 'desconhecido', reasons, facts }; }
  return { status: 'saudavel', reasons, facts };
}

const EMPTY = { notifiedStatus: 'saudavel', notifiedAt: null, notifiedCodes: [], incidentSince: null, lastStatus: null, lastCheckAt: null, warnKey: null, warnAt: null, unkCount: 0, unkAt: null };
export function normalizeLedger(l) {
  if (!l || typeof l !== 'object' || !['saudavel', 'degradado', 'parado'].includes(l.notifiedStatus)) return { ...EMPTY };
  return { ...EMPTY, ...l, notifiedCodes: Array.isArray(l.notifiedCodes) ? l.notifiedCodes : [] };
}

const LABEL = { parado: 'TCG Price Hunter parado', degradado: 'TCG Price Hunter com problema' };
const HEAD = { parado: '🔴 ' + LABEL.parado, degradado: '🟠 ' + LABEL.degradado };
const ACTIONS = 'https://github.com/TonyWatanabe-dev/pokemon-price-hunter/actions';
export const CODE_LABEL = {
  dados_parados: 'preços sem atualizar', sem_rodadas: 'robô sem disparo', rodada_falhou: 'rodada com falha', rodada_sem_publicar: 'dados sem publicar',
  rodadas_falhando: 'rodadas falhando', meta_ilegivel: 'estado operacional ilegível', meta_desatualizado: 'estado operacional parado',
  sync_falhando: 'banco sem sincronizar', banco_inacessivel: 'banco inacessível', banco_desligado: 'robô sem banco',
  leitor_indisponivel: 'leitor oficial indisponível', leitor_sem_nota: 'leitor sem nota válida', fonte_degradada: 'fonte sem anúncios ou bloqueada',
  motor_parado: 'motor de oportunidades parado', deploy_falhou: 'deploy de produção falhou', deploy_preso: 'deploy de produção preso', whatsapp_parado: 'grupo do WhatsApp sem envios',
};

/** Decide se avisa. Não altera o livro: use commitLedger depois de tentar enviar. */
export function decide(ev, ledgerIn, now = new Date().toISOString()) {
  const L = normalizeLedger(ledgerIn);
  const codes = ev.reasons.map((r) => r.code);
  const lines = ev.reasons.map((r) => '• ' + r.text);
  if (ev.status === 'desconhecido') {
    // dados_indisponiveis persistente: avisa na 3ª checagem seguida e só lembra a cada REMIND_MIN; outros motivos de desconhecido nunca avisam
    if (!codes.includes('dados_indisponiveis') || (L.unkCount || 0) + 1 < RULES.UNKNOWN_CONSEC) return { notify: null };
    const head = '🟡 TCG Price Hunter: dados publicados indisponíveis';
    if (!L.unkAt) return { notify: { kind: 'indisponivel', title: head, text: [head, '', ...lines, `Já são ${RULES.UNKNOWN_CONSEC} checagens seguidas sem conseguir ler.`, '', ACTIONS].join('\n') } };
    if (min(Date.parse(now), Date.parse(L.unkAt)) >= RULES.REMIND_MIN) return { notify: { kind: 'lembrete_indisponivel', title: head + ' (continua)', text: [head + ' (continua)', '', ...lines, '', ACTIONS].join('\n') } };
    return { notify: null };
  }
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

/**
 * Avisos (ev.warnings, hoje só copag_vencendo), separados das falhas: não abrem incidente nem mudam o estado avisado.
 * Avisa quando a lista (produtos + vencimentos) muda e lembra a cada WARN_REMIND_MIN enquanto continuar.
 * Não altera o livro: use commitWarning depois de tentar enviar.
 */
export function decideWarning(ev, ledgerIn, now = new Date().toISOString()) {
  const L = normalizeLedger(ledgerIn);
  const w = Array.isArray(ev?.warnings) ? ev.warnings : [];
  if (!w.length) return { key: null, notify: null };
  const key = w.map((x) => x.key || x.code).join('|');
  const due = L.warnKey === key && L.warnAt && min(Date.parse(now), Date.parse(L.warnAt)) >= RULES.WARN_REMIND_MIN;
  if (L.warnKey === key && !due) return { key, notify: null };
  const head = '🟡 TCG Price Hunter: aviso antecipado';
  return { key, notify: { kind: 'aviso', title: head, text: [`${head}${due ? ' (continua)' : ''}`, '', ...w.map((x) => '• ' + x.text), '', 'Nota e ranking não mudam agora.'].join('\n') } };
}
/** Livro dos avisos: só registra o aviso entregue; sem aviso pendente, limpa (um aviso novo pode ser enviado depois). */
export function commitWarning(ledgerIn, decision, delivered, now = new Date().toISOString()) {
  const L = normalizeLedger(ledgerIn);
  if (!decision?.key) return { ...L, warnKey: null, warnAt: null };
  if (decision.notify && delivered) return { ...L, warnKey: decision.key, warnAt: now };
  return L;
}

/** Atualiza o livro. O que foi avisado só muda quando a mensagem chegou a pelo menos um canal. */
export function commitLedger(ledgerIn, ev, decision, delivered, now = new Date().toISOString()) {
  const L = normalizeLedger(ledgerIn);
  if (ev.status === 'desconhecido') {
    if (!ev.reasons.some((r) => r.code === 'dados_indisponiveis')) return { ...L, lastCheckAt: now, unkCount: 0, unkAt: null };
    const out = { ...L, lastCheckAt: now, unkCount: (L.unkCount || 0) + 1 };
    if (decision?.notify && delivered) out.unkAt = now;
    return out;
  }
  const out = { ...L, lastStatus: ev.status, lastCheckAt: now, unkCount: 0, unkAt: null };
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
