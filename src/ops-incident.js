// Issue de incidente do Vigia (Fase 7, item 5 — SRE/Operations). Funções puras: recebem o resumo da checagem
// (tools/watchdog.mjs, VIGIA_RESUMO) e as issues abertas, e devolvem UMA ação idempotente:
//   create  — estado degradado/parado sem issue de incidente aberta;
//   comment — a issue existe e o conjunto de problemas (status + códigos) mudou desde o último registro;
//   close   — duas checagens saudáveis seguidas (a atual e a anterior) com a issue aberta;
//   none    — nada mudou, estado desconhecido ou resumo inválido (sem evidência não há ação).
// A issue do incidente é reconhecida só pelo marcador no corpo E pelo autor confiável (o bot do workflow); o texto
// vindo dos dados passa por redact e não pode forjar marcador nem mencionar pessoas.
import { redact } from './redact.js';

export const INCIDENT_MARKER = '<!-- vigia:incidente -->';
export const INCIDENT_LABEL = 'ops:incidente';
export const TRUSTED_AUTHOR = 'github-actions[bot]';
const FP_RE = /<!--\s*vigia:estado status=(degradado|parado) codigos=([a-z_,]*)\s*-->/g;
const BAD = new Set(['degradado', 'parado']);
const TITLE = { parado: 'Vigia: TCG Price Hunter parado', degradado: 'Vigia: TCG Price Hunter com problema' };

const lower = (s) => String(s ?? '').trim().toLowerCase();
const codeOk = (c) => typeof c === 'string' && /^[a-z_]{1,40}$/.test(c);

/** Texto vindo dos dados, seguro para a issue: sem segredo, sem quebra, sem marcador HTML e sem menção. */
export function safeText(s, max = 400) {
  return redact(String(s ?? '').replace(/[\r\n\t]+/g, ' '), { env: {}, max })
    .replace(/<!--|-->/g, '').replace(/[<>]/g, '').replace(/@(?=[\w-])/g, '@​');
}

/** Resumo válido do Vigia ou null (fail-closed: resumo ilegível nunca gera ação). */
export function parseResumo(raw) {
  let r = raw;
  if (typeof raw === 'string') { try { r = JSON.parse(raw); } catch { return null; } }
  if (!r || typeof r !== 'object') return null;
  if (!['saudavel', 'degradado', 'parado', 'desconhecido'].includes(r.status)) return null;
  const lista = Array.isArray(r.reasonsDetail) ? r.reasonsDetail : null;
  const reasons = (lista || []).filter((x) => x && codeOk(x.code));
  // Só para a mensagem da issue (não muda ação nem impressão digital): por que a lista de motivos ficou vazia.
  const discarded = (lista || []).filter((x) => !(x && codeOk(x.code))).map((x) => (x && typeof x === 'object' ? String(x.code ?? '') : typeof x));
  return { status: r.status, previousStatus: typeof r.previousStatus === 'string' ? r.previousStatus : null, reasons,
    reasonsInfo: { received: lista ? lista.length : null, discarded },
    facts: r.facts && typeof r.facts === 'object' ? r.facts : {}, now: typeof r.now === 'string' ? r.now : null };
}

export const fingerprint = (status, codes) => `${status}:${[...new Set(codes)].sort().join(',')}`;
export const fingerprintMarker = (status, codes) => `<!-- vigia:estado status=${status} codigos=${[...new Set(codes)].sort().join(',')} -->`;

/** Issue de incidente aberta (menor número), reconhecida por marcador + autor confiável. */
export function findIncident(issues, { trustedAuthor = TRUSTED_AUTHOR } = {}) {
  return (Array.isArray(issues) ? issues : [])
    .filter((i) => i && Number.isInteger(i.number) && i.state !== 'closed' && !i.pull_request && lower(i.author) === lower(trustedAuthor) && String(i.body ?? '').includes(INCIDENT_MARKER))
    .sort((a, b) => a.number - b.number)[0] || null;
}

/** Última impressão digital registrada (corpo da issue e comentários do autor confiável, nessa ordem). */
export function lastFingerprint(issue, comments, { trustedAuthor = TRUSTED_AUTHOR } = {}) {
  const texts = [String(issue?.body ?? ''), ...(Array.isArray(comments) ? comments : []).filter((c) => lower(c?.author) === lower(trustedAuthor)).map((c) => String(c?.body ?? ''))];
  let fp = null;
  for (const t of texts) for (const m of t.matchAll(FP_RE)) fp = fingerprint(m[1], m[2] ? m[2].split(',').filter(Boolean) : []);
  return fp;
}

/** Por que a issue saiu sem motivo: o resumo chegou sem a lista, com a lista vazia ou com códigos fora do formato. */
export function semDetalhe(info) {
  if (!info || info.received == null) return 'o resumo da checagem chegou sem a lista de motivos (reasonsDetail)';
  if (!info.received) return 'o resumo da checagem chegou com a lista de motivos vazia';
  const xs = (info.discarded || []).slice(0, 3).map((c) => `"${safeText(c, 40).replace(/`/g, '')}"`);
  return `${info.received} motivo(s) recebido(s), ${info.discarded?.length ?? 0} descartado(s) por código fora do formato [a-z_]: ${xs.join(', ')}`;
}

function diagnosis(r, { runUrl } = {}) {
  const f = r.facts || {};
  const fato = (k, v) => (v == null || v === '' ? null : `- ${k}: ${safeText(v, 80)}`);
  return [
    `**Estado:** ${r.status}${r.now ? ` (checagem de ${safeText(r.now, 40)})` : ''}`,
    '',
    '**Problemas:**',
    ...(r.reasons.length ? r.reasons.map((x) => `- \`${x.code}\`: ${safeText(x.text)}`) : [`- (sem detalhe: ${semDetalhe(r.reasonsInfo)})`]),
    '',
    '**Fatos lidos (somente leitura):**',
    ...[fato('Dados publicados em', f.dataGeneratedAt), fato('Idade dos dados (min)', f.dataAgeMin), fato('Última rodada concluída', f.lastRunAt),
      fato('Conclusão da última rodada', f.lastRunConclusion), fato('Estado operacional (ops.last)', f.metaLastAt)].filter(Boolean),
    ...(runUrl && /^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\/actions\/runs\/\d+$/.test(runUrl) ? ['', `Checagem: ${runUrl}`] : []),
    '',
    'Procedimento: `docs/runbook.md` e `docs/vigia.md`. Esta issue só registra o diagnóstico: o Vigia não reinicia, não altera dados nem faz deploy.',
  ].join('\n');
}

/**
 * Decide a ação. `openIssues`: issues abertas com o label do incidente ({ number, state, author, body }).
 * `comments`: comentários da issue encontrada ({ author, body }). Ordem de chamada: findIncident → buscar comentários → planIncident.
 */
export function planIncident({ resumo, openIssues = [], comments = [], runUrl = null, trustedAuthor = TRUSTED_AUTHOR } = {}) {
  const r = parseResumo(resumo);
  if (!r) return { type: 'none', reason: 'resumo do Vigia ausente ou inválido' };
  const issue = findIncident(openIssues, { trustedAuthor });
  const codes = r.reasons.map((x) => x.code);
  if (BAD.has(r.status)) {
    const fp = fingerprint(r.status, codes);
    const body = `${diagnosis(r, { runUrl })}\n\n${fingerprintMarker(r.status, codes)}`;
    if (!issue) return { type: 'create', title: TITLE[r.status], labels: [INCIDENT_LABEL], body: `${INCIDENT_MARKER}\n${body}`, fingerprint: fp };
    if (lastFingerprint(issue, comments, { trustedAuthor }) === fp) return { type: 'none', issue: issue.number, reason: 'incidente já registrado com os mesmos problemas' };
    return { type: 'comment', issue: issue.number, body: `Vigia: o incidente mudou.\n\n${body}`, fingerprint: fp };
  }
  if (r.status === 'saudavel' && issue) {
    if (r.previousStatus !== 'saudavel') return { type: 'none', issue: issue.number, reason: 'aguardando a 2ª checagem saudável seguida' };
    return { type: 'close', issue: issue.number, body: `Vigia: recuperado — duas checagens saudáveis seguidas${r.now ? ` (última: ${safeText(r.now, 40)})` : ''}. Fechando o incidente.` };
  }
  return { type: 'none', reason: r.status === 'desconhecido' ? 'estado desconhecido: sem evidência, sem ação' : 'saudável e sem incidente aberto' };
}
