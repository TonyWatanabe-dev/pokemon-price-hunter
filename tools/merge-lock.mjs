#!/usr/bin/env node
// Lock de integração na `main` pelo próprio GitHub (opção (b) de docs/governanca-merge.md §7). PROPOSTA ISOLADA:
// nada no repositório chama esta ferramenta, ela NUNCA faz merge e as escritas (adquirir/liberar) ficam DESLIGADAS
// no modo real até o dono autorizar (EM_USO = false → código 5, nenhuma chamada). `status` só lê.
//
// Mecanismo: uma tag ANOTADA `refs/tags/merge-lock`. O objeto tag aponta para o SHA da main no momento da aquisição e
// a mensagem leva os metadados do dono em JSON (sessão, PR, SHA do head validado, UTC de aquisição e expiração).
// A exclusividade vem de `POST git/refs`: o GitHub cria a ref ou responde 422 se ela já existe (atômico do lado do
// servidor). O objeto tag é criado ANTES da ref, então toda ref de lock nasce com dono legível; um objeto tag órfão
// (sessão morreu entre os dois POSTs, ou perdeu a corrida) não é referenciado por nada e é inofensivo.
// Por que não uma ref leve + metadados em outra ref: seriam duas escritas não atômicas e um lock poderia existir sem
// dono legível. Por que não refs/heads: um branch novo dispara deploy de preview na Vercel e eventos de push/create.
//
// Regras:
//   - dono = (sessão, PR, SHA do head). O mesmo dono readquire sem escrever (idempotente); resposta perdida no POST
//     é resolvida relendo a ref.
//   - ocupado por outro dono → recusa (código 1) mostrando dono, idade e expiração.
//   - expiração (padrão 30 min, 5–120): lock expirado NÃO é tomado automaticamente (apagar+criar entre duas sessões
//     não é atômico). Só `liberar --forcar --tag <sha do objeto tag> --motivo "..."`, manual, e só se já expirou, se
//     os metadados são ilegíveis/fora de faixa (TTL incoerente, expiração adulterada) ou se o relógio de quem
//     adquiriu estava adiantado (adquiridoEm > agora + 5 min).
//   - relógio: idade/expiração são calculadas com o relógio de QUEM LÊ contra o UTC gravado por quem adquiriu.
//   - liberar por quem não é dono → recusa (código 1).
// Códigos: 0 ok/livre · 1 ocupado ou recusado · 2 uso inválido · 3 leitura/escrita falhou ou lock ilegível ·
//          5 escrita não autorizada (EM_USO=false).
// Uso:
//   node tools/merge-lock.mjs status   [--repo dono/repo] [--json]
//   node tools/merge-lock.mjs adquirir --sessao <id> --pr <n> --sha <head 40 hex> [--ttl-min 30] [--repo] [--json]
//   node tools/merge-lock.mjs liberar  --sessao <id> --pr <n> --sha <head>                      [--repo] [--json]
//   node tools/merge-lock.mjs liberar  --forcar --tag <sha do objeto tag> --motivo "<texto>"     [--repo] [--json]
import { execFileSync } from 'node:child_process';
import { comRetry } from './gh-retry.mjs';

/** Liga as escritas no modo real. Mudar exige PR revisada e autorização do dono (docs/governanca-merge.md §7.4). */
export const EM_USO = false;
export const LOCK_REF = 'refs/tags/merge-lock';
export const LOCK_TAG = 'merge-lock';
export const BASE = 'main';
export const TTL_PADRAO_MIN = 30;
export const TTL_MIN = 5;
export const TTL_MAX = 120;
/** Tolerância de relógio: adquiridoEm mais no futuro que isto (relógio de quem adquiriu adiantado) = suspeito. */
export const TOLERANCIA_RELOGIO_MS = 5 * 60000;
export const CODIGOS = Object.freeze({ OK: 0, OCUPADO: 1, USO: 2, FALHA: 3, NAO_AUTORIZADO: 5 });
const SHA = /^[0-9a-f]{40}$/;
const RE_SESSAO = /^[A-Za-z0-9._:\/@-]{3,120}$/;

const msgErro = (e) => String(e?.message || e).split('\n')[0].slice(0, 160);
const eh404 = (e) => /HTTP 404|Not Found/i.test(String(e?.message || e));
const eh422 = (e) => /HTTP 422|Reference already exists/i.test(String(e?.message || e));

/** Idade legível ("12 min", "2 h 05 min"). */
export function idade(ms) {
  const m = Math.max(0, Math.floor(ms / 60000));
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${String(m % 60).padStart(2, '0')} min`;
}

/** Mensagem do objeto tag: 1ª linha legível + JSON. */
export function montarMensagem(dono) {
  return `merge-lock: PR #${dono.pr} por ${dono.sessao}\n\n${JSON.stringify(dono)}\n`;
}

/** Extrai e valida os metadados da mensagem; null se ilegível. */
export function lerMensagem(msg) {
  const t = String(msg || ''); const a = t.indexOf('{'); const b = t.lastIndexOf('}');
  if (a < 0 || b <= a) return null;
  let o; try { o = JSON.parse(t.slice(a, b + 1)); } catch { return null; }
  if (!o || o.versao !== 1 || !RE_SESSAO.test(o.sessao || '') || !Number.isInteger(o.pr) || o.pr <= 0) return null;
  if (!SHA.test(o.sha || '') || !SHA.test(o.main || '')) return null;
  const ini = Date.parse(o.adquiridoEm); const fim = Date.parse(o.expiraEm);
  if (!Number.isFinite(ini) || !Number.isFinite(fim)) return null;
  // validade coerente e limitada: sem isso, um expiraEm adulterado (ex.: 2099) travaria para sempre — a forçada só
  // vale depois de expirar. Fora da faixa = ilegível (forçada permitida; pode-integrar → revisão humana).
  if (!Number.isInteger(o.ttlMin) || o.ttlMin < TTL_MIN || o.ttlMin > TTL_MAX || fim - ini !== o.ttlMin * 60000) return null;
  return o;
}

export const mesmoDono = (o, { sessao, pr, sha }) => !!o && o.sessao === sessao && o.pr === Number(pr) && o.sha === sha;

/** Lê o lock: { livre:true } | { livre:false, tagSha, dono|null, ilegivel?, motivo? }. Lança em falha de leitura. */
export async function lerLock(api, repo) {
  let ref;
  try { ref = await api(['api', `repos/${repo}/git/ref/tags/${LOCK_TAG}`]); } catch (e) { if (eh404(e)) return { livre: true }; throw e; }
  const obj = ref?.object;
  if (!obj || !SHA.test(obj.sha || '')) throw new Error('ref de lock sem sha');
  if (obj.type !== 'tag') return { livre: false, tagSha: obj.sha, dono: null, ilegivel: true, motivo: `ref aponta direto para ${obj.type} (sem metadados; criada fora da ferramenta)` };
  const tag = await api(['api', `repos/${repo}/git/tags/${obj.sha}`]);
  const dono = lerMensagem(tag?.message);
  if (!dono) return { livre: false, tagSha: obj.sha, dono: null, ilegivel: true, motivo: 'metadados do lock ilegíveis' };
  if (tag?.object?.sha && tag.object.sha !== dono.main) return { livre: false, tagSha: obj.sha, dono, ilegivel: true, motivo: 'tag aponta para SHA diferente do registrado' };
  return { livre: false, tagSha: obj.sha, dono };
}

/** Situação do lock em relação a um instante, à main atual e (opcional) a quem pergunta. Pura. */
export function situacao(lock, { agora, mainAtual = null, quem = null } = {}) {
  if (!lock || lock.livre) return { livre: true };
  const t = new Date(agora).getTime();
  const d = lock.dono;
  const s = { livre: false, tagSha: lock.tagSha, dono: d, ilegivel: !!lock.ilegivel, motivo: lock.motivo || null };
  if (d) {
    s.idadeMs = t - Date.parse(d.adquiridoEm);
    s.expirado = t >= Date.parse(d.expiraEm);
    // relógio de quem adquiriu adiantado: o lock pareceria válido por mais tempo que o TTL. Não é tomado sozinho,
    // mas libera a forçada manual e o pode-integrar pede revisão humana.
    s.relogioSuspeito = s.idadeMs < -TOLERANCIA_RELOGIO_MS;
    s.mainAtual = mainAtual;
    s.mainAndou = !!(mainAtual && mainAtual !== d.main);
  }
  if (quem) s.seu = !!d && mesmoDono(d, quem);
  return s;
}

export function descrever(s) {
  if (s.livre) return 'livre';
  if (!s.dono) return `ocupado por dono desconhecido (${s.motivo}); tag ${s.tagSha}`;
  const d = s.dono;
  return `ocupado por sessão ${d.sessao} · PR #${d.pr} · head ${d.sha.slice(0, 10)} · main ${d.main.slice(0, 10)} · `
    + `adquirido ${d.adquiridoEm} (há ${idade(s.idadeMs)}) · expira ${d.expiraEm}${s.expirado ? ' · EXPIRADO' : ''}`
    + `${s.relogioSuspeito ? ' · RELÓGIO SUSPEITO (adquirido no futuro)' : ''}${s.ilegivel ? ` · ILEGÍVEL (${s.motivo})` : ''} · tag ${s.tagSha}`;
}

// ---------------------------------------------------------------- operações (api injetável)
/** Campo de escrita do `gh api` (-f nome=valor). */
const f = (nome, valor) => ['-f', `${nome}=${valor}`];
const lerMain = async (api, repo) => {
  const r = await api(['api', `repos/${repo}/git/ref/heads/${BASE}`]);
  if (!SHA.test(r?.object?.sha || '')) throw new Error('ref da main sem sha');
  return r.object.sha;
};

export async function status(api, repo, { agora, quem = null } = {}) {
  const lock = await lerLock(api, repo);
  const mainAtual = lock.livre ? null : await lerMain(api, repo).catch(() => null);
  return situacao(lock, { agora, mainAtual, quem });
}

export async function adquirir(api, repo, { sessao, pr, sha, ttlMin = TTL_PADRAO_MIN, agora }) {
  const quem = { sessao, pr: Number(pr), sha };
  const antes = await lerLock(api, repo);
  if (!antes.livre) {
    const s = situacao(antes, { agora, quem });
    if (s.seu && !s.expirado) return { codigo: CODIGOS.OK, resultado: 'já era seu (idempotente; nada escrito)', situacao: s };
    if (s.seu && s.expirado) return { codigo: CODIGOS.OCUPADO, resultado: 'seu lock EXPIROU: libere (liberar) e adquira de novo; nada escrito', situacao: s };
    return { codigo: CODIGOS.OCUPADO, resultado: s.expirado ? 'ocupado e expirado: só liberação forçada manual (ver doc)' : 'ocupado: espere ou fale com o dono', situacao: s };
  }
  const main = await lerMain(api, repo);
  const t = new Date(agora);
  const dono = { versao: 1, ferramenta: 'tools/merge-lock.mjs', sessao, pr: Number(pr), sha, main, adquiridoEm: t.toISOString(), expiraEm: new Date(t.getTime() + ttlMin * 60000).toISOString(), ttlMin };
  // campos montados por f() (o nome do objeto git "tag" não tem relação com afiliados; ver affiliate-isolation-tests)
  const tag = await api(['api', '-X', 'POST', `repos/${repo}/git/tags`, ...f('tag', LOCK_TAG), ...f('message', montarMensagem(dono)), ...f('object', main), ...f('type', 'commit')]);
  if (!SHA.test(tag?.sha || '')) throw new Error('objeto tag criado sem sha');
  try {
    await api(['api', '-X', 'POST', `repos/${repo}/git/refs`, ...f('ref', LOCK_REF), ...f('sha', tag.sha)]);
  } catch (e) {
    // 422 = outro criou primeiro; outro erro = resposta pode ter se perdido. Nos dois casos, relê e decide.
    const depois = await lerLock(api, repo);
    const s = situacao(depois, { agora, quem });
    if (!depois.livre && depois.tagSha === tag.sha) return { codigo: CODIGOS.OK, resultado: 'adquirido (confirmado relendo após erro na resposta)', situacao: s };
    if (s.seu) return { codigo: CODIGOS.OK, resultado: 'já era seu (outra tentativa desta sessão venceu)', situacao: s };
    if (eh422(e)) return { codigo: CODIGOS.OCUPADO, resultado: 'perdeu a corrida (422: a ref já existe)', situacao: s };
    throw e;
  }
  return { codigo: CODIGOS.OK, resultado: 'adquirido', situacao: situacao({ livre: false, tagSha: tag.sha, dono }, { agora, quem }) };
}

export async function liberar(api, repo, { sessao, pr, sha, forcar = false, tag = null, motivo = '', agora }) {
  const lock = await lerLock(api, repo);
  if (lock.livre) return { codigo: CODIGOS.OK, resultado: 'já estava livre (nada escrito)', situacao: { livre: true } };
  const quem = forcar ? null : { sessao, pr: Number(pr), sha };
  const s = situacao(lock, { agora, quem });
  if (forcar) {
    if (lock.tagSha !== tag) return { codigo: CODIGOS.OCUPADO, resultado: `recusado: --tag ${String(tag).slice(0, 10)} não é o lock atual (${lock.tagSha.slice(0, 10)}); releia o status`, situacao: s };
    if (s.dono && !s.ilegivel && !s.expirado && !s.relogioSuspeito) return { codigo: CODIGOS.OCUPADO, resultado: 'recusado: lock ainda não expirou; liberação forçada só depois da expiração (ou se ilegível / relógio suspeito)', situacao: s };
  } else if (!s.seu) {
    return { codigo: CODIGOS.OCUPADO, resultado: 'recusado: você não é o dono do lock', situacao: s };
  }
  // relê imediatamente antes de apagar (o GitHub não tem DELETE condicional; isto estreita a janela, não a elimina)
  const agoraLock = await lerLock(api, repo);
  if (agoraLock.livre) return { codigo: CODIGOS.OK, resultado: 'já estava livre (nada escrito)', situacao: { livre: true } };
  if (agoraLock.tagSha !== lock.tagSha) return { codigo: CODIGOS.OCUPADO, resultado: 'recusado: o lock mudou durante a liberação', situacao: situacao(agoraLock, { agora, quem }) };
  try {
    await api(['api', '-X', 'DELETE', `repos/${repo}/git/refs/tags/${LOCK_TAG}`]);
  } catch (e) {
    // resposta perdida ou 422 (já não existia): relê; livre = a liberação valeu. Qualquer outra coisa propaga.
    const depois = await lerLock(api, repo);
    if (depois.livre) return { codigo: CODIGOS.OK, resultado: 'liberado (confirmado relendo após erro na resposta)', situacao: { livre: true } };
    throw e;
  }
  return { codigo: CODIGOS.OK, resultado: forcar ? `liberado À FORÇA (motivo: ${motivo})` : 'liberado', situacao: s };
}

// ---------------------------------------------------------------- CLI
const gh = (args) => comRetry((a) => {
  const out = execFileSync('gh', a, { encoding: 'utf8', maxBuffer: 8 << 20, stdio: ['ignore', 'pipe', 'pipe'] });
  return out.trim() ? JSON.parse(out) : {};
}, args);

export async function main(argv = process.argv.slice(2), { api = gh, log = console.log, agora = () => new Date(), emUso = EM_USO, apiReal = api === gh } = {}) {
  const opt = (k) => { const i = argv.indexOf(`--${k}`); return i >= 0 ? argv[i + 1] : null; };
  const cmd = argv[0];
  const repo = opt('repo') || process.env.GITHUB_REPOSITORY || 'TonyWatanabe-dev/pokemon-price-hunter';
  const json = argv.includes('--json');
  const uso = 'uso: node tools/merge-lock.mjs status|adquirir|liberar [--sessao id --pr n --sha head] [--ttl-min 30] [--forcar --tag sha --motivo texto] [--repo] [--json]';
  const falha = (m) => { log(`uso inválido — ${m}`); return CODIGOS.USO; };
  if (!['status', 'adquirir', 'liberar'].includes(cmd)) { log(uso); return CODIGOS.USO; }
  if (!/^[\w.-]+\/[\w.-]+$/.test(repo)) return falha('repositório inválido');
  const forcar = argv.includes('--forcar');
  const sessao = opt('sessao'); const prN = Number(String(opt('pr') ?? '').replace(/^#/, '')); const sha = opt('sha');
  const tag = opt('tag'); const motivo = String(opt('motivo') || '').trim();
  const ttl = opt('ttl-min') == null ? TTL_PADRAO_MIN : Number(opt('ttl-min'));
  const precisaDono = cmd === 'adquirir' || (cmd === 'liberar' && !forcar);
  if (precisaDono) {
    if (!RE_SESSAO.test(sessao || '')) return falha('--sessao obrigatório (3–120 caracteres: letras, números, . _ : / @ -)');
    if (!Number.isInteger(prN) || prN <= 0) return falha('--pr obrigatório (número da PR)');
    if (!SHA.test(sha || '')) return falha('--sha obrigatório (SHA completo do head validado, 40 hex)');
  }
  if (cmd === 'adquirir' && (!Number.isInteger(ttl) || ttl < TTL_MIN || ttl > TTL_MAX)) return falha(`--ttl-min entre ${TTL_MIN} e ${TTL_MAX}`);
  if (forcar && cmd !== 'liberar') return falha('--forcar só vale com liberar');
  if (forcar && (!SHA.test(tag || '') || motivo.length < 10)) return falha('liberação forçada exige --tag <sha do objeto tag, 40 hex> e --motivo com pelo menos 10 caracteres');
  if (cmd !== 'status' && apiReal && !emUso) {
    log(`${cmd} RECUSADO: o lock de merge é proposta e não está em uso (EM_USO=false em tools/merge-lock.mjs). Entrar em uso exige autorização do dono (docs/governanca-merge.md §7.4). Nada foi lido nem escrito.`);
    return CODIGOS.NAO_AUTORIZADO;
  }

  const t = agora();
  let r;
  try {
    if (cmd === 'status') {
      const quem = sessao && prN > 0 && sha ? { sessao, pr: prN, sha } : null;
      const s = await status(api, repo, { agora: t, quem });
      r = { codigo: s.livre ? CODIGOS.OK : s.ilegivel ? CODIGOS.FALHA : CODIGOS.OCUPADO, resultado: descrever(s), situacao: s };
      if (!s.livre && s.mainAndou) r.resultado += ` · ATENÇÃO: a main andou desde a aquisição (agora ${s.mainAtual || 'outra'})`;
    } else if (cmd === 'adquirir') r = await adquirir(api, repo, { sessao, pr: prN, sha, ttlMin: ttl, agora: t });
    else r = await liberar(api, repo, { sessao, pr: prN, sha, forcar, tag, motivo, agora: t });
  } catch (e) {
    r = { codigo: CODIGOS.FALHA, resultado: `falha na API: ${msgErro(e)} (fail-closed: trate como ocupado e confira com status)`, situacao: null };
  }
  if (json) { log(JSON.stringify({ comando: cmd, repo, lidoEm: t.toISOString(), ...r }, null, 2)); return r.codigo; }
  log(`merge-lock ${cmd} → ${r.resultado}  (código ${r.codigo})`);
  if (r.situacao && !r.situacao.livre && cmd !== 'status') log(`  ${descrever(r.situacao)}`);
  log(`  lido em ${t.toISOString()} (UTC) · esta ferramenta nunca faz merge`);
  return r.codigo;
}

if (process.argv[1]?.endsWith('merge-lock.mjs')) process.exitCode = await main();
