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

// Marca (não enumerável) do resultado de parseResumo. tools/vigia-incidente.mjs analisa o resumo e passa o objeto já
// analisado a planIncident, que analisava de novo: o objeto analisado tem `reasons`, não `reasonsDetail`, então a
// 2ª análise zerava os motivos (estado, fatos e horário têm o mesmo nome e passavam). Era a causa do "(sem detalhe)"
// em 28/28 incidentes (#756–#933) e da impressão digital sempre com `codigos=` vazio. Agora a análise é idempotente.
const PARSED = Symbol('vigia:resumo-analisado');

/** Resumo válido do Vigia ou null (fail-closed: resumo ilegível nunca gera ação). Idempotente. */
export function parseResumo(raw) {
  if (raw && typeof raw === 'object' && raw[PARSED]) return raw;
  let r = raw;
  if (typeof raw === 'string') { try { r = JSON.parse(raw); } catch { return null; } }
  if (!r || typeof r !== 'object') return null;
  if (!['saudavel', 'degradado', 'parado', 'desconhecido'].includes(r.status)) return null;
  const lista = Array.isArray(r.reasonsDetail) ? r.reasonsDetail : null;
  const reasons = (lista || []).filter((x) => x && codeOk(x.code));
  // Só para a mensagem da issue (não muda ação nem impressão digital): por que a lista de motivos ficou vazia.
  const discarded = (lista || []).filter((x) => !(x && codeOk(x.code))).map((x) => (x && typeof x === 'object' ? String(x.code ?? '') : typeof x));
  const out = { status: r.status, previousStatus: typeof r.previousStatus === 'string' ? r.previousStatus : null, reasons,
    reasonsInfo: { received: lista ? lista.length : null, discarded },
    facts: r.facts && typeof r.facts === 'object' ? r.facts : {}, now: typeof r.now === 'string' ? r.now : null };
  Object.defineProperty(out, PARSED, { value: true });
  return out;
}

// Motivos que, sozinhos e com dados frescos, costumam ser indisponibilidade transitória (ex.: 429 do Mercado Livre,
// que nas últimas 24 h voltou sempre na 3ª rodada). Só muda o texto da issue: ação e impressão digital não mudam.
export const TRANSITORIOS = new Set(['fonte_degradada']);
const FRESCO_MIN = 20;
export const ACAO = {
  fonte_degradada: 'ver `data/sources.json` → `status`/`reason` da fonte (429 = limite de requisições, 403 = bloqueio, tempo esgotado = fora do ar). Se passar de 3 rodadas (~45 min), conferir cadência/backoff.',
  sync_falhando: 'conferir o passo de sincronização do banco na última rodada do robô.',
  banco_inacessivel: 'conferir conexão/credencial do banco (sem ler secrets) e o status do provedor.',
  banco_desligado: 'o robô rodou sem DATABASE_URL: conferir a configuração do workflow.',
  leitor_indisponivel: 'conferir o leitor da nota oficial (ops.last.reader.reason em `data/meta.json`).',
  leitor_sem_nota: 'o leitor respondeu, mas nenhuma nota valeu: conferir referências e filtros.',
  rodadas_falhando: 'abrir as 2 últimas rodadas do robô (hunter.yml) e ler o erro.',
  dados_parados: 'conferir o disparo externo (cron-job.org) e a última rodada do robô.',
  sem_rodadas: 'conferir o disparo externo (cron-job.org).',
  meta_desatualizado: 'o robô publica dados, mas não grava `ops`: conferir o passo do estado operacional.',
  meta_ilegivel: 'ler `data/meta.json` no ramo data (JSON quebrado).',
  deploy_falhou: 'abrir o deploy de produção na Vercel.',
  deploy_preso: 'abrir o deploy de produção na Vercel.',
  whatsapp_parado: 'conferir a sessão do WhatsApp (pareamento) e se o número foi bloqueado.',
  motor_parado: 'conferir a batida do motor de oportunidades (engine em `data/meta.json`).',
};

/**
 * Tipo do incidente, só para orientar quem lê a issue:
 *   observabilidade — estado ruim sem nenhum motivo legível (o problema é o próprio diagnóstico);
 *   transitorio     — só motivos de TRANSITORIOS, dados frescos e última rodada com sucesso (tende a fechar sozinho);
 *   real            — qualquer outro caso.
 */
export function classificar(resumo) {
  const r = parseResumo(resumo);
  if (!r || !BAD.has(r.status)) return null;
  if (!r.reasons.length) return { tipo: 'observabilidade', texto: `falha de observabilidade: estado ${r.status} sem motivo legível (${semDetalhe(r.reasonsInfo)}). Rode \`node tools/vigia-diagnostico.mjs\` com o commit do ramo data da checagem para ver o motivo.` };
  const f = r.facts || {};
  const fresco = Number.isFinite(f.dataAgeMin) && f.dataAgeMin <= FRESCO_MIN && f.lastRunConclusion === 'success';
  if (r.status === 'degradado' && fresco && r.reasons.every((x) => TRANSITORIOS.has(x.code)))
    return { tipo: 'transitorio', texto: 'indisponibilidade transitória provável: só fonte vigiada fora, dados frescos e última rodada com sucesso. Se a fonte voltar, o incidente fecha sozinho depois de 2 checagens saudáveis.' };
  return { tipo: 'real', texto: 'incidente: requer verificação.' };
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
  const tipo = classificar(r);
  return [
    `**Estado:** ${r.status}${r.now ? ` (checagem de ${safeText(r.now, 40)})` : ''}`,
    ...(tipo ? [`**Tipo:** ${tipo.texto}`] : []),
    '',
    '**Problemas:**',
    ...(r.reasons.length ? r.reasons.map((x) => `- \`${x.code}\`: ${safeText(x.text)}${ACAO[x.code] ? `\n  - O que olhar: ${ACAO[x.code]}` : ''}`) : [`- (sem detalhe: ${semDetalhe(r.reasonsInfo)})`]),
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
