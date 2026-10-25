// tools/merge-lock.mjs + leitura em tools/pode-integrar.mjs: concorrência, falha no meio, trava órfã, relógio e
// metadados adulterados. SÓ API simulada em memória (sem rede, sem gh real, nenhuma escrita no GitHub).
import assert from 'node:assert/strict';
import {
  main as cli, adquirir, liberar, status, lerLock, lerMensagem, montarMensagem, situacao, CODIGOS, LOCK_REF, TTL_MAX,
} from '../tools/merge-lock.mjs';
import { avaliar, ESTADOS, REQUIRED } from '../tools/pode-integrar.mjs';

const R = 'o/r';
const M = 'c0b6bf44de79deaffc7649afd5946d7be977376b';
const T0 = Date.parse('2026-10-25T10:00:00.000Z');
const em = (min) => new Date(T0 + min * 60000);
const hex = (c) => c.repeat(40);
const pendura = () => new Promise(() => {}); // processo "morto": a chamada nunca volta

/** GitHub falso: refs + objetos tag; cada chamada cede o event loop em ordem aleatória-determinística (intercala). */
function github({ semente = 1 } = {}) {
  let s = semente; const rnd = () => { s = (s * 16807) % 2147483647; return s % 3; };
  const st = { main: M, refs: new Map(), tags: new Map(), seq: 0, escritas: [], morrerApos: null, perderRespostaDelete: false };
  const api = async (args) => {
    for (let i = rnd(); i >= 0; i--) await new Promise((r) => setImmediate(r));
    assert.equal(args[0], 'api');
    assert.ok(!args.some((a) => /pulls\/\d+\/merge/.test(a)), 'nunca rota de merge');
    const metodo = args[1] === '-X' ? args[2] : 'GET';
    const rota = metodo === 'GET' ? args[1] : args[3];
    const campos = Object.fromEntries(args.filter((_, i) => args[i - 1] === '-f').map((f) => [f.slice(0, f.indexOf('=')), f.slice(f.indexOf('=') + 1)]));
    if (metodo !== 'GET') st.escritas.push(`${metodo} ${rota}`);
    let r;
    if (metodo === 'GET' && rota === `repos/${R}/git/ref/heads/main`) r = { object: { sha: st.main, type: 'commit' } };
    else if (metodo === 'GET' && rota === `repos/${R}/git/ref/tags/merge-lock`) {
      const x = st.refs.get(LOCK_REF); if (!x) throw new Error('gh: Not Found (HTTP 404)');
      r = { ref: LOCK_REF, object: { sha: x, type: st.tags.has(x) ? 'tag' : 'commit' } };
    } else if (metodo === 'GET' && /^repos\/o\/r\/git\/tags\/[0-9a-f]{40}$/.test(rota)) {
      r = st.tags.get(rota.slice(-40)); if (!r) throw new Error('HTTP 404');
    } else if (metodo === 'POST' && rota === `repos/${R}/git/tags`) {
      const sha = (++st.seq).toString(16).padStart(40, 'e');
      st.tags.set(sha, { sha, tag: campos.tag, message: campos.message, object: { sha: campos.object, type: 'commit' } });
      r = { sha };
    } else if (metodo === 'POST' && rota === `repos/${R}/git/refs`) {
      // criação condicional do lado do servidor: 422 se a ref já existe (comportamento documentado do GitHub)
      if (st.refs.has(campos.ref)) throw new Error('gh: Reference already exists (HTTP 422)');
      st.refs.set(campos.ref, campos.sha); r = { ref: campos.ref, object: { sha: campos.sha } };
    } else if (metodo === 'DELETE' && rota === `repos/${R}/git/refs/tags/merge-lock`) {
      if (!st.refs.delete(LOCK_REF)) throw new Error('gh: Reference does not exist (HTTP 422)');
      if (st.perderRespostaDelete) { st.perderRespostaDelete = false; throw new Error('connection reset'); }
      r = {};
    } else throw new Error(`rota inesperada ${metodo} ${rota}`);
    if (st.morrerApos && st.morrerApos(metodo, rota)) return pendura();
    return r;
  };
  return { st, api };
}
const dono = (i) => ({ sessao: `sess-${i}`, pr: 900 + i, sha: hex('abcdef0123456789'[i % 16]) });

// 1. N aquisições simultâneas (Promise.all), várias sementes de intercalação: exatamente uma vence
for (const semente of [1, 7, 42, 1234, 99991]) {
  const { st, api } = github({ semente });
  const N = 12;
  const rs = await Promise.all(Array.from({ length: N }, (_, i) => adquirir(api, R, { ...dono(i), agora: em(0) })));
  const ok = rs.filter((r) => r.codigo === CODIGOS.OK);
  assert.equal(ok.length, 1, `semente ${semente}: ${rs.map((r) => r.resultado).join(' | ')}`);
  assert.ok(rs.filter((r) => r.codigo !== CODIGOS.OK).every((r) => r.codigo === CODIGOS.OCUPADO && r.situacao.dono.sessao === ok[0].situacao.dono.sessao));
  assert.equal(st.refs.size, 1);
  assert.equal((await lerLock(api, R)).dono.sessao, ok[0].situacao.dono.sessao, 'o dono gravado é o vencedor');
}

// 2. tentativa duplicada do mesmo dono (5 em paralelo): todas OK, uma única ref, dono certo
{
  const { st, api } = github({ semente: 5 });
  const rs = await Promise.all(Array.from({ length: 5 }, () => adquirir(api, R, { ...dono(1), agora: em(0) })));
  assert.ok(rs.every((r) => r.codigo === CODIGOS.OK), rs.map((r) => r.resultado).join(' | '));
  assert.equal(st.refs.size, 1); assert.equal((await lerLock(api, R)).dono.sessao, 'sess-1');
  // duplicado misturado com concorrentes: ou todas as cópias do mesmo dono vencem juntas, ou nenhuma
  for (const semente of [3, 11, 77]) {
    const g = github({ semente });
    const quem = [1, 1, 2, 1, 3, 2];
    const r2 = await Promise.all(quem.map((i) => adquirir(g.api, R, { ...dono(i), agora: em(0) })));
    const venc = (await lerLock(g.api, R)).dono.sessao;
    quem.forEach((i, k) => assert.equal(r2[k].codigo === CODIGOS.OK, `sess-${i}` === venc, `semente ${semente} pos ${k}`));
  }
}

// 3. processo interrompido
{
  // 3a. morreu ENTRE criar o objeto tag e criar a ref: não há lock; objeto órfão inofensivo; outro adquire já
  const g = github(); g.st.morrerApos = (m, r) => m === 'POST' && r.endsWith('/git/tags');
  adquirir(g.api, R, { ...dono(1), agora: em(0) }); // nunca resolve
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
  assert.equal(g.st.tags.size, 1); assert.equal(g.st.refs.size, 0);
  g.st.morrerApos = null;
  assert.equal((await adquirir(g.api, R, { ...dono(2), agora: em(1) })).codigo, CODIGOS.OK);

  // 3b. morreu DEPOIS de criar a ref (trava órfã): bloqueia até expirar; ninguém toma sozinho; recuperação manual
  const { st, api } = github(); st.morrerApos = (m, r) => m === 'POST' && r.endsWith('/git/refs');
  adquirir(api, R, { ...dono(1), agora: em(0) });
  for (let i = 0; i < 20; i++) await new Promise((r) => setImmediate(r));
  st.morrerApos = null;
  assert.equal(st.refs.size, 1);
  const orfa = st.refs.get(LOCK_REF);
  assert.equal((await adquirir(api, R, { ...dono(2), agora: em(5) })).codigo, CODIGOS.OCUPADO);
  const dep = await adquirir(api, R, { ...dono(2), agora: em(31) });
  assert.equal(dep.codigo, CODIGOS.OCUPADO); assert.match(dep.resultado, /expirado: só liberação forçada manual/);
  assert.equal(st.refs.get(LOCK_REF), orfa, 'expirado não é tomado automaticamente');
  // recuperação pela CLI (modo simulado; no modo real exigiria EM_USO=true)
  const linhas = [];
  const cod = await cli(['liberar', '--forcar', '--tag', orfa, '--motivo', 'sess-1 morreu; PR #901 conferida: não integrada', '--repo', R], { api, log: (x) => linhas.push(x), agora: () => em(31) });
  assert.equal(cod, CODIGOS.OK, linhas.join('\n')); assert.match(linhas.join('\n'), /À FORÇA/);
  assert.equal((await adquirir(api, R, { ...dono(2), agora: em(32) })).codigo, CODIGOS.OK);
}

// 4. liberação por não-dono recusada (outra sessão, mesma sessão/outra PR, mesma sessão/outro head), nada apagado
{
  const { st, api } = github();
  await adquirir(api, R, { ...dono(1), agora: em(0) });
  const n = st.escritas.length;
  for (const q of [dono(2), { ...dono(1), pr: 1 }, { ...dono(1), sha: hex('9') }]) {
    const r = await liberar(api, R, { ...q, agora: em(1) });
    assert.equal(r.codigo, CODIGOS.OCUPADO); assert.match(r.resultado, /não é o dono/);
  }
  assert.equal(st.escritas.length, n, 'nenhuma escrita'); assert.ok(st.refs.has(LOCK_REF));
  // resposta do DELETE perdida (apagou, mas a conexão caiu): relê e confirma em vez de acusar falha
  st.perderRespostaDelete = true;
  const r = await liberar(api, R, { ...dono(1), agora: em(2) });
  assert.equal(r.codigo, CODIGOS.OK, r.resultado); assert.match(r.resultado, /confirmado relendo/);
  assert.ok(!st.refs.has(LOCK_REF));
}

// 5. metadados adulterados/fora de faixa: viram "ilegível" (forçada permitida já; pode-integrar → revisão humana)
{
  const d = { versao: 1, ferramenta: 'x', sessao: 'sess-1', pr: 901, sha: hex('a'), main: M, adquiridoEm: em(0).toISOString(), expiraEm: em(30).toISOString(), ttlMin: 30 };
  assert.ok(lerMensagem(montarMensagem(d)));
  for (const [nome, o] of [
    ['expira em 2099 (trava eterna)', { expiraEm: '2099-01-01T00:00:00.000Z' }],
    ['expira antes de adquirir', { expiraEm: em(-1).toISOString() }],
    ['ttl acima do máximo', { ttlMin: TTL_MAX + 1, expiraEm: em(TTL_MAX + 1).toISOString() }],
    ['ttl incoerente com expiraEm', { ttlMin: 30, expiraEm: em(60).toISOString() }],
  ]) assert.equal(lerMensagem(montarMensagem({ ...d, ...o })), null, nome);
  // trava "eterna" gravada à mão: antes desta correção, nunca expirava e a forçada era recusada para sempre
  const { st, api } = github();
  const tagSha = hex('7'); st.tags.set(tagSha, { sha: tagSha, message: montarMensagem({ ...d, expiraEm: '2099-01-01T00:00:00.000Z' }), object: { sha: M } });
  st.refs.set(LOCK_REF, tagSha);
  const l = await lerLock(api, R); assert.equal(l.ilegivel, true);
  assert.equal((await liberar(api, R, { forcar: true, tag: tagSha, motivo: 'trava com expiração adulterada', agora: em(1) })).codigo, CODIGOS.OK);
}

// 6. relógio: quem adquiriu estava adiantado (adquiridoEm no futuro) → suspeito; forçada permitida; nunca PODE
{
  const { st, api } = github();
  await adquirir(api, R, { ...dono(1), agora: em(180) }); // relógio 3 h adiantado
  const s = await status(api, R, { agora: em(0), quem: dono(1) });
  assert.equal(s.relogioSuspeito, true); assert.equal(s.expirado, false);
  const tagSha = st.refs.get(LOCK_REF);
  assert.equal((await liberar(api, R, { forcar: true, tag: tagSha, motivo: 'relógio da sessão adiantado 3 h', agora: em(1) })).codigo, CODIGOS.OK);
  // dentro da tolerância (1 min adiantado) não acusa
  await adquirir(api, R, { ...dono(1), agora: em(1) });
  assert.equal((await status(api, R, { agora: em(0) })).relogioSuspeito, false);
}

// 7. verificador (pode-integrar) com o lock REAL produzido pela ferramenta no GitHub simulado
{
  const H = dono(1).sha;
  const verdes = REQUIRED.map((name, i) => ({ id: i + 1, name, status: 'completed', conclusion: 'success', head_sha: H, app: { id: 1 } }));
  const prot = { required_status_checks: { strict: true, contexts: [...REQUIRED], checks: REQUIRED.map((c) => ({ context: c, app_id: 1 })) }, enforce_admins: { enabled: true }, required_pull_request_reviews: { required_approving_review_count: 1 } };
  const pr = { number: 901, state: 'open', merged: false, draft: false, mergeable: true, mergeable_state: 'clean', base: { ref: 'main' }, head: { sha: H }, body: 'x', labels: [] };
  const base = (o) => avaliar({ pr, prFinal: pr, checkRuns: verdes, compare: { behind_by: 0, base_commit: { sha: M } }, protecao: prot, arquivos: [{ filename: 'src/x.js' }], mainSha: M, mainShaFinal: M, repo: R, ...o });

  const { st, api } = github();
  await adquirir(api, R, { ...dono(2), agora: em(0) }); // outra sessão segura o lock
  let lock = await lerLock(api, R);
  const outro = base({ lock, sessao: 'sess-1', lidoEm: em(5).toISOString() });
  assert.equal(outro.estado, ESTADOS.NAO_PODE); assert.ok(outro.motivos.some((m) => /lock de merge de outro dono — ocupado por sessão sess-2/.test(m)));
  const expirado = base({ lock, sessao: 'sess-1', lidoEm: em(31).toISOString() });
  assert.equal(expirado.estado, ESTADOS.REVISAO, 'lock alheio expirado: humano decide');
  await liberar(api, R, { ...dono(2), agora: em(6) });
  await adquirir(api, R, { ...dono(1), agora: em(7) });
  lock = await lerLock(api, R);
  assert.equal(base({ lock, sessao: 'sess-1', lidoEm: em(8).toISOString() }).estado, ESTADOS.PODE, 'lock próprio vigente');
  assert.equal(base({ lock, lidoEm: em(8).toISOString() }).estado, ESTADOS.NAO_PODE, 'sem --sessao, não é reconhecido como seu');

  // tag adulterada (objeto aponta para SHA diferente do registrado): mesmo "sendo seu", não pode dar PODE
  const tg = st.tags.get(st.refs.get(LOCK_REF)); tg.object = { sha: hex('d'), type: 'commit' };
  lock = await lerLock(api, R); assert.equal(lock.ilegivel, true); assert.ok(lock.dono);
  assert.equal(base({ lock, sessao: 'sess-1', lidoEm: em(8).toISOString() }).estado, ESTADOS.REVISAO);

  // relógio suspeito no próprio lock: revisão humana, não PODE
  const g = github(); await adquirir(g.api, R, { ...dono(1), agora: em(180) });
  const sus = base({ lock: await lerLock(g.api, R), sessao: 'sess-1', lidoEm: em(0).toISOString() });
  assert.equal(sus.estado, ESTADOS.REVISAO); assert.ok(sus.revisao.some((m) => /relógio/.test(m)));

  // --exigir-lock com a ferramenta desligada: a mensagem diz que adquirir está desligado (não manda "adquirir")
  const ex = base({ lock: { livre: true }, exigirLock: true, lidoEm: em(0).toISOString() });
  assert.equal(ex.estado, ESTADOS.NAO_PODE); assert.ok(ex.motivos.some((m) => /EM_USO=false/.test(m)), ex.motivos.join(' | '));
}

// 8. situacao pura: lock livre e lock sem dono
assert.equal(situacao({ livre: true }, { agora: em(0) }).livre, true);
assert.equal(situacao({ livre: false, tagSha: hex('1'), dono: null, ilegivel: true, motivo: 'x' }, { agora: em(0) }).relogioSuspeito, undefined);

console.log('merge-lock-concorrencia-tests ok');
