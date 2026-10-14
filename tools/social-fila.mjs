// Social Media MVP — CLI local para listar e decidir a fila de rascunhos (issue #656; escopo da #631/#560).
// Junta src/agents/social/fila.js (estado do item) e src/agents/social/aprovacao.js (decisão humana + trilha de auditoria
// encadeada por sha256). Só lê/grava arquivos locais: fila, trilha e âncora (ultimoHash guardado à parte). Não publica,
// não acessa rede, banco nem secrets; do ambiente só lê SOCIAL_ENABLED, SOCIAL_OPERADOR, TAREFAS_OPERADORES e
// GITHUB_REPOSITORY. Desligado por padrão: sem SOCIAL_ENABLED=1|true, aprovar/rejeitar saem com código 2 (listar só lê).
// Falha fechada: trilha inválida, âncora divergente, operador não autorizado ou item já decidido não gravam nada.
// Ordem de escrita: trilha → âncora → fila (nenhuma decisão vale na fila sem estar antes na trilha).
//
// Uso: node tools/social-fila.mjs listar [--estado rascunho|aprovado|rejeitado|publicado]
//      node tools/social-fila.mjs aprovar <id> [--operador login] [--motivo texto]
//      node tools/social-fila.mjs rejeitar <id> --motivo texto [--operador login]
//   Comuns: [--fila caminho] [--trilha caminho] [--ancora caminho] [--now ISO]
//   --fila      fila local (padrão: data/social/fila.json do repositório)
//   --trilha    trilha de auditoria, lista JSON append-only (padrão: trilha.json ao lado da fila)
//   --ancora    último hash da trilha, em arquivo separado (padrão: trilha.ultimo-hash ao lado da fila)
//   --operador  login do operador (padrão: SOCIAL_OPERADOR); precisa estar em TAREFAS_OPERADORES (ou ser o dono do repo)
//   --now       horário da decisão (padrão: agora). Só para ensaio/teste.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { deJson, paraJson, filaVazia, transicionar, habilitado, ESTADOS } from '../src/agents/social/fila.js';
import { decidir, verificarTrilha, ultimoHash, sha256, HASH_INICIAL } from '../src/agents/social/aprovacao.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const FILA_PADRAO = path.join(ROOT, 'data/social/fila.json');
export const COMANDOS = Object.freeze(['listar', 'aprovar', 'rejeitar']);
export const SAIDAS = Object.freeze({ OK: 0, ERRO: 1, DESLIGADO: 2 });
const DECISAO = { aprovar: 'aprovar', rejeitar: 'rejeitar' };
const HEX64 = /^[a-f0-9]{64}$/;

// Só as variáveis do gate e dos operadores saem do ambiente: nada de token, chave ou outra variável sensível.
const envSocial = (env = {}) => ({
  SOCIAL_ENABLED: env.SOCIAL_ENABLED, SOCIAL_OPERADOR: env.SOCIAL_OPERADOR,
  TAREFAS_OPERADORES: env.TAREFAS_OPERADORES, GITHUB_REPOSITORY: env.GITHUB_REPOSITORY,
});

/** argv (sem node e script) → opções. Lança em comando/argumento desconhecido ou valor ausente. */
export function lerArgs(argv) {
  const [cmd, ...resto] = argv;
  if (!COMANDOS.includes(cmd)) throw new Error(`comando desconhecido: ${cmd ?? '(nenhum)'} (use ${COMANDOS.join(', ')})`);
  const o = { cmd, id: undefined, fila: FILA_PADRAO, trilha: undefined, ancora: undefined, operador: undefined, motivo: undefined, now: undefined, estado: undefined };
  const valor = (i, nome) => { const v = resto[i + 1]; if (v === undefined || v.startsWith('--')) throw new Error(`${nome} exige um valor`); return v; };
  for (let i = 0; i < resto.length; i++) {
    const a = resto[i];
    if (a === '--fila') o.fila = valor(i++, a);
    else if (a === '--trilha') o.trilha = valor(i++, a);
    else if (a === '--ancora') o.ancora = valor(i++, a);
    else if (a === '--operador') o.operador = valor(i++, a);
    else if (a === '--motivo') o.motivo = valor(i++, a);
    else if (a === '--now') o.now = valor(i++, a);
    else if (a === '--estado') {
      const e = valor(i++, a);
      if (!ESTADOS.includes(e)) throw new Error(`estado desconhecido: ${e} (use ${ESTADOS.join(', ')})`);
      o.estado = e;
    } else if (!a.startsWith('--') && cmd !== 'listar' && o.id === undefined) o.id = a;
    else throw new Error(`argumento desconhecido: ${a}`);
  }
  if (cmd === 'listar' && (o.operador !== undefined || o.motivo !== undefined)) throw new Error('listar não aceita --operador nem --motivo');
  if (cmd !== 'listar' && o.estado !== undefined) throw new Error(`${cmd} não aceita --estado`);
  if (cmd !== 'listar' && !o.id) throw new Error(`${cmd} exige o id do item`);
  const dir = path.dirname(o.fila);
  o.trilha ??= path.join(dir, 'trilha.json');
  o.ancora ??= path.join(dir, 'trilha.ultimo-hash');
  return o;
}

const ler = (arq) => { try { return fs.readFileSync(arq, 'utf8'); } catch (e) { if (e.code === 'ENOENT') return null; throw e; } };

/** Lê fila, trilha e âncora. Arquivo ausente = vazio; conteúdo inválido lança. Trilha com eventos exige âncora. */
export function carregar({ fila, trilha, ancora }) {
  const tf = ler(fila);
  const f = tf === null ? filaVazia() : deJson(tf);
  const tt = ler(trilha);
  let eventos = [];
  if (tt !== null) {
    try { eventos = JSON.parse(tt); } catch { throw new Error('trilha corrompida (JSON inválido)'); }
    if (!Array.isArray(eventos)) throw new Error('trilha inválida: esperado lista de eventos');
  }
  const ta = ler(ancora);
  const a = ta === null ? null : ta.trim();
  if (a !== null && !HEX64.test(a)) throw new Error('âncora inválida: esperado sha256 hex');
  if (a === null && eventos.length) throw new Error('âncora ausente: trilha com eventos sem o último hash guardado à parte');
  const v = verificarTrilha(eventos, { ultimoHash: a ?? HASH_INICIAL });
  return { fila: f, trilha: eventos, ancora: a, verificacao: v };
}

// Escrita atômica: arquivo temporário na mesma pasta + rename.
function gravar(arq, conteudo) {
  fs.mkdirSync(path.dirname(arq), { recursive: true });
  const tmp = `${arq}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, conteudo);
  fs.renameSync(tmp, arq);
}

const resumoTexto = (s, max = 80) => { const l = String(s).split('\n').find((x) => x.trim()) ?? ''; return l.length > max ? l.slice(0, max - 1) + '…' : l; };

/** Linhas de listagem (puro). Mostra a decisão registrada na trilha e avisa divergências entre fila e trilha. */
export function listar({ fila, trilha, verificacao }, { estado } = {}) {
  const porItem = new Map(trilha.map((e) => [e?.itemId, e]));
  const itens = fila.itens.filter((x) => !estado || x.estado === estado);
  const L = [`fila: ${fila.itens.length} item(ns)${estado ? `, ${itens.length} em "${estado}"` : ''} · trilha: ${trilha.length} evento(s), ${verificacao.ok ? 'íntegra' : 'INVÁLIDA'} · nada publicado`];
  for (const e of verificacao.erros) L.push(`  ! trilha[${e.indice}]: ${e.motivo}`);
  for (const it of itens) {
    L.push(`- ${it.id} [${it.canal}] ${it.estado} · criado ${it.criadoEm}${it.agendadoPara ? ` · agendado ${it.agendadoPara}` : ''}`);
    L.push(`    ${resumoTexto(it.texto) || '(texto vazio)'}`);
    const ev = porItem.get(it.id);
    if (ev) {
      L.push(`    decisão: ${ev.acao} por ${ev.operador} em ${ev.ts}${ev.motivo ? ` · motivo: ${ev.motivo}` : ''}`);
      if (ev.hashTexto !== sha256(it.texto)) L.push('    ! texto alterado depois da decisão: a aprovação não vale para este texto');
      if (it.estado === 'rascunho') L.push('    ! inconsistente: decisão na trilha, mas o item continua rascunho na fila');
    } else if (it.estado === 'aprovado' || it.estado === 'rejeitado') L.push('    ! inconsistente: item decidido sem evento na trilha');
  }
  return L;
}

/** Decide um item (puro): valida via decidir (aprovacao.js) e aplica a transição (fila.js). Lança em qualquer recusa. */
export function decidirItem({ fila, trilha, verificacao }, { cmd, id, operador, motivo, now, env }) {
  if (!verificacao.ok) throw new Error(`trilha de auditoria inválida: ${verificacao.erros.map((e) => e.motivo).join('; ')}`);
  const item = fila.itens.find((x) => x.id === id);
  if (!item) throw new Error(`item inexistente: ${id}`);
  const ts = now === undefined ? new Date() : new Date(now);
  if (!Number.isFinite(ts.getTime())) throw new Error('--now inválido');
  const r = decidir({ id: item.id, texto: item.texto, status: item.estado }, { decisao: DECISAO[cmd], operador, motivo, now: ts, trilha, env });
  if (!r.ok) throw new Error(r.erro);
  // O motivo gravado na fila é o mesmo do evento (já passou por redact.js).
  const t = transicionar(fila, id, r.item.status, { now: r.evento.ts, motivo: r.evento.motivo || null });
  return { fila: t.fila, item: t.item, trilha: [...trilha, r.evento], evento: r.evento };
}

/** CLI. Devolve o código de saída; `io` permite testar sem tocar no console real. */
export function main(argv = process.argv.slice(2), env = process.env, io = { log: console.log, error: console.error }) {
  let o;
  try { o = lerArgs(argv); } catch (e) { io.error(`social-fila: ${e.message}`); return SAIDAS.ERRO; }
  const social = envSocial(env);
  try {
    if (o.cmd === 'listar') {
      const estado = carregar(o);
      for (const l of listar(estado, { estado: o.estado })) io.log(l);
      return estado.verificacao.ok ? SAIDAS.OK : SAIDAS.ERRO;
    }
    if (!habilitado(social)) {
      io.error('social-fila: desligado (SOCIAL_ENABLED ausente ou diferente de 1/true). Nenhuma decisão registrada.');
      return SAIDAS.DESLIGADO;
    }
    const operador = o.operador ?? social.SOCIAL_OPERADOR;
    if (!String(operador ?? '').trim()) throw new Error('operador ausente (use --operador ou SOCIAL_OPERADOR)');
    // Trava simples contra duas decisões simultâneas sobre a mesma fila.
    const trava = `${o.fila}.lock`;
    fs.mkdirSync(path.dirname(trava), { recursive: true });
    let fd;
    try { fd = fs.openSync(trava, 'wx'); } catch (e) {
      if (e.code === 'EEXIST') throw new Error(`fila em uso (${trava}); se nenhuma decisão estiver em andamento, remova a trava`);
      throw e;
    }
    try {
      const r = decidirItem(carregar(o), { cmd: o.cmd, id: o.id, operador, motivo: o.motivo, now: o.now, env: social });
      gravar(o.trilha, JSON.stringify(r.trilha, null, 2) + '\n');
      gravar(o.ancora, ultimoHash(r.trilha) + '\n');
      gravar(o.fila, paraJson(r.fila));
      io.log(`social-fila: ${r.item.id} → ${r.item.estado} por ${r.evento.operador} (evento ${r.evento.hash.slice(0, 12)}; nada publicado)`);
      return SAIDAS.OK;
    } finally {
      fs.closeSync(fd);
      fs.rmSync(trava, { force: true });
    }
  } catch (e) {
    io.error(`social-fila: ${e.message}`);
    return SAIDAS.ERRO;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exitCode = main();
