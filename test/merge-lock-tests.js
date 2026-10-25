// tools/merge-lock.mjs: lock de merge por ref no GitHub. SÓ API simulada (sem rede, sem gh real).
// Cenários: aquisição concorrente (um recebe 422), idempotência, resposta perdida, expiração, liberação por não-dono,
// dono morto + liberação forçada manual, main andou entre adquirir e integrar, escrita bloqueada sem autorização.
import assert from 'node:assert/strict';
import {
  main, adquirir, liberar, status, lerLock, lerMensagem, montarMensagem, situacao, idade, CODIGOS, EM_USO, LOCK_REF, TTL_PADRAO_MIN,
} from '../tools/merge-lock.mjs';

const R = 'o/r';
const M = 'c0b6bf44de79deaffc7649afd5946d7be977376b';
const M2 = 'd1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1d1';
const HA = 'a'.repeat(40); const HB = 'b'.repeat(40);
const T0 = Date.parse('2026-10-25T10:00:00.000Z');
const em = (min) => new Date(T0 + min * 60000);

/** GitHub falso compartilhado: refs + objetos tag. Cada chamada cede o event loop (permite intercalar clientes). */
function github({ main: m = M } = {}) {
  const st = { main: m, refs: new Map(), tags: new Map(), seq: 0, escritas: [], perderRespostaRef: false, falharLeituraLock: false };
  const api = async (args) => {
    await new Promise((r) => setImmediate(r));
    assert.equal(args[0], 'api');
    assert.ok(!args.some((a) => /\/merge$|\/pulls\/\d+\/merge/.test(a)), 'nunca rota de merge');
    const metodo = args[1] === '-X' ? args[2] : 'GET';
    const rota = metodo === 'GET' ? args[1] : args[3];
    const campos = Object.fromEntries(args.filter((_, i) => args[i - 1] === '-f').map((f) => [f.slice(0, f.indexOf('=')), f.slice(f.indexOf('=') + 1)]));
    if (metodo !== 'GET') st.escritas.push(`${metodo} ${rota}`);
    if (metodo === 'GET') {
      if (rota === `repos/${R}/git/ref/heads/main`) return { object: { sha: st.main, type: 'commit' } };
      if (rota === `repos/${R}/git/ref/tags/merge-lock`) {
        if (st.falharLeituraLock) throw new Error('HTTP 502');
        const s = st.refs.get(LOCK_REF); if (!s) throw new Error('gh: Not Found (HTTP 404)');
        return { ref: LOCK_REF, object: { sha: s, type: st.tags.has(s) ? 'tag' : 'commit' } };
      }
      const t = rota.match(/^repos\/o\/r\/git\/tags\/([0-9a-f]{40})$/);
      if (t) { const x = st.tags.get(t[1]); if (!x) throw new Error('HTTP 404'); return x; }
    }
    if (metodo === 'POST' && rota === `repos/${R}/git/tags`) {
      assert.equal(campos.tag, 'merge-lock'); assert.equal(campos.type, 'commit');
      const sha = (++st.seq).toString(16).padStart(40, 'e');
      st.tags.set(sha, { sha, tag: campos.tag, message: campos.message, object: { sha: campos.object, type: 'commit' } });
      return { sha };
    }
    if (metodo === 'POST' && rota === `repos/${R}/git/refs`) {
      assert.equal(campos.ref, LOCK_REF);
      if (st.refs.has(campos.ref)) throw new Error('gh: Reference already exists (HTTP 422)');
      st.refs.set(campos.ref, campos.sha);
      if (st.perderRespostaRef) { st.perderRespostaRef = false; throw new Error('connection reset'); }
      return { ref: campos.ref, object: { sha: campos.sha } };
    }
    if (metodo === 'DELETE' && rota === `repos/${R}/git/refs/tags/merge-lock`) {
      if (!st.refs.delete(LOCK_REF)) throw new Error('HTTP 422 Reference does not exist');
      return {};
    }
    throw new Error(`rota inesperada ${metodo} ${rota}`);
  };
  return { st, api };
}
const A = { sessao: 'sess-A', pr: 918, sha: HA };
const B = { sessao: 'sess-B', pr: 922, sha: HB };

assert.equal(EM_USO, false, 'proposta: escrita real desligada até autorização do dono');
assert.equal(TTL_PADRAO_MIN, 30);
assert.equal(idade(65 * 60000), '1 h 05 min');

// mensagem: ida e volta; lixo é ilegível
{
  const d = { versao: 1, ferramenta: 'x', sessao: 's-1', pr: 1, sha: HA, main: M, adquiridoEm: em(0).toISOString(), expiraEm: em(30).toISOString(), ttlMin: 30 };
  assert.deepEqual(lerMensagem(montarMensagem(d)), d);
  for (const m of ['', 'oi', '{x', JSON.stringify({ ...d, versao: 2 }), JSON.stringify({ ...d, sha: 'abc' }), JSON.stringify({ ...d, pr: 0 })]) assert.equal(lerMensagem(m), null, m);
}

// 1. aquisição concorrente: dois clientes ao mesmo tempo, exatamente um vence; o outro recebe 422 e vê o dono
{
  const { st, api } = github();
  const [ra, rb] = await Promise.all([adquirir(api, R, { ...A, agora: em(0) }), adquirir(api, R, { ...B, agora: em(0) })]);
  const codigos = [ra.codigo, rb.codigo].sort();
  assert.deepEqual(codigos, [CODIGOS.OK, CODIGOS.OCUPADO], JSON.stringify([ra, rb]));
  const perdedor = ra.codigo ? ra : rb; const vencedor = ra.codigo ? rb : ra;
  assert.match(perdedor.resultado, /perdeu a corrida \(422/);
  assert.equal(perdedor.situacao.dono.sessao, vencedor.situacao.dono.sessao);
  assert.equal(st.refs.size, 1);
  assert.equal(st.tags.size, 2, 'o objeto tag do perdedor fica órfão (inofensivo, não referenciado)');
  const atual = await lerLock(api, R);
  assert.equal(atual.dono.sessao, vencedor.situacao.dono.sessao);
}

// 2. idempotência: mesmo dono readquire sem escrever; resposta perdida no POST é confirmada relendo
{
  const { st, api } = github();
  assert.equal((await adquirir(api, R, { ...A, agora: em(0) })).codigo, CODIGOS.OK);
  const n = st.escritas.length;
  const de = await adquirir(api, R, { ...A, agora: em(5) });
  assert.equal(de.codigo, CODIGOS.OK); assert.match(de.resultado, /já era seu/); assert.equal(st.escritas.length, n, 'nada escrito');
  const outroPr = await adquirir(api, R, { ...A, pr: 919, agora: em(5) });
  assert.equal(outroPr.codigo, CODIGOS.OCUPADO, 'mesma sessão, outra PR = outro dono');
  const g = github(); g.st.perderRespostaRef = true;
  const p = await adquirir(g.api, R, { ...A, agora: em(0) });
  assert.equal(p.codigo, CODIGOS.OK); assert.match(p.resultado, /confirmado relendo/);
  const h = github(); h.st.falharLeituraLock = true;
  await assert.rejects(adquirir(h.api, R, { ...A, agora: em(0) }), /502/, 'leitura falhou: nunca escreve às cegas');
  assert.equal(h.st.escritas.length, 0);
}

// 3. metadados: dono, PR, SHA, main e UTC no corpo da tag; tag aponta para a main
{
  const { st, api } = github();
  await adquirir(api, R, { ...A, ttlMin: 45, agora: em(0) });
  const tag = st.tags.get(st.refs.get(LOCK_REF));
  assert.equal(tag.object.sha, M);
  assert.match(tag.message, /^merge-lock: PR #918 por sess-A\n/);
  const d = lerMensagem(tag.message);
  assert.deepEqual([d.sessao, d.pr, d.sha, d.main, d.adquiridoEm, d.expiraEm, d.ttlMin], ['sess-A', 918, HA, M, '2026-10-25T10:00:00.000Z', '2026-10-25T10:45:00.000Z', 45]);
}

// 4. liberação por não-dono recusada; dono libera; liberar livre é idempotente
{
  const { st, api } = github();
  await adquirir(api, R, { ...A, agora: em(0) });
  const nd = await liberar(api, R, { ...B, agora: em(1) });
  assert.equal(nd.codigo, CODIGOS.OCUPADO); assert.match(nd.resultado, /não é o dono/);
  assert.equal((await liberar(api, R, { ...A, sha: HB, agora: em(1) })).codigo, CODIGOS.OCUPADO, 'mesma sessão com outro SHA não libera');
  assert.ok(st.refs.has(LOCK_REF));
  assert.equal((await liberar(api, R, { ...A, agora: em(2) })).codigo, CODIGOS.OK);
  assert.ok(!st.refs.has(LOCK_REF));
  const n = st.escritas.length;
  const de = await liberar(api, R, { ...A, agora: em(3) });
  assert.equal(de.codigo, CODIGOS.OK); assert.match(de.resultado, /já estava livre/); assert.equal(st.escritas.length, n);
}

// 5. expiração + dono morto: ninguém toma automaticamente; forçada só depois de expirar, com tag certa e motivo
{
  const { st, api } = github();
  await adquirir(api, R, { ...A, agora: em(0) }); // sessão A "morre" aqui, sem liberar
  const tagA = st.refs.get(LOCK_REF);
  const s10 = await status(api, R, { agora: em(10) });
  assert.equal(s10.expirado, false); assert.equal(Math.round(s10.idadeMs / 60000), 10);
  const cedo = await adquirir(api, R, { ...B, agora: em(10) });
  assert.equal(cedo.codigo, CODIGOS.OCUPADO); assert.match(cedo.resultado, /ocupado: espere/);
  assert.equal((await liberar(api, R, { forcar: true, tag: tagA, motivo: 'sessão A morreu', agora: em(10) })).codigo, CODIGOS.OCUPADO, 'forçada antes de expirar: recusada');
  const tarde = await adquirir(api, R, { ...B, agora: em(31) });
  assert.equal(tarde.codigo, CODIGOS.OCUPADO); assert.match(tarde.resultado, /expirado: só liberação forçada manual/);
  assert.equal((await status(api, R, { agora: em(31) })).expirado, true);
  assert.equal((await liberar(api, R, { forcar: true, tag: 'f'.repeat(40), motivo: 'sessão A morreu', agora: em(31) })).codigo, CODIGOS.OCUPADO, 'tag errada: recusada');
  const ok = await liberar(api, R, { forcar: true, tag: tagA, motivo: 'sessão A morreu; #918 não integrada', agora: em(31) });
  assert.equal(ok.codigo, CODIGOS.OK); assert.match(ok.resultado, /À FORÇA/);
  assert.equal((await adquirir(api, R, { ...B, agora: em(32) })).codigo, CODIGOS.OK);
  // o próprio dono com lock expirado: não renova sozinho
  const g = github(); await adquirir(g.api, R, { ...A, agora: em(0) });
  assert.match((await adquirir(g.api, R, { ...A, agora: em(40) })).resultado, /seu lock EXPIROU/);
}

// 6. main andou entre adquirir e integrar: status acusa; pode-integrar trata (ver pode-integrar-tests)
{
  const { st, api } = github();
  await adquirir(api, R, { ...A, agora: em(0) });
  st.main = M2; // alguém integrou fora do lock
  const s = await status(api, R, { agora: em(3), quem: A });
  assert.equal(s.mainAndou, true); assert.equal(s.seu, true); assert.equal(s.mainAtual, M2);
  const { cod, txt } = await rodaCli(['status', '--repo', R], { api });
  assert.equal(cod, CODIGOS.OCUPADO); assert.match(txt, /a main andou desde a aquisição/);
  assert.equal(situacao({ livre: true }, { agora: em(0) }).livre, true);
}

// 7. lock criado à mão (ref leve, sem metadados) = ilegível, código 3 no status, liberação só forçada
{
  const { st, api } = github(); st.refs.set(LOCK_REF, M);
  const l = await lerLock(api, R); assert.equal(l.ilegivel, true); assert.equal(l.dono, null);
  assert.equal((await rodaCli(['status', '--repo', R], { api })).cod, CODIGOS.FALHA);
  assert.equal((await liberar(api, R, { ...A, agora: em(0) })).codigo, CODIGOS.OCUPADO);
  assert.equal((await liberar(api, R, { forcar: true, tag: M, motivo: 'ref criada à mão', agora: em(0) })).codigo, CODIGOS.OK);
}

// 8. CLI: escrita no modo real recusada sem chamar a API (EM_USO=false); uso inválido; JSON; falha → 3
async function rodaCli(argv, { api, emUso, apiReal = false, agora = () => em(0) }) {
  const linhas = []; const cod = await main(argv, { api, log: (s) => linhas.push(s), agora, emUso, apiReal });
  return { cod, txt: linhas.join('\n'), linhas };
}
{
  const { st, api } = github();
  for (const argv of [['adquirir', '--sessao', 's-1', '--pr', '1', '--sha', HA], ['liberar', '--sessao', 's-1', '--pr', '1', '--sha', HA]]) {
    const r = await rodaCli(argv, { api, apiReal: true });
    assert.equal(r.cod, CODIGOS.NAO_AUTORIZADO); assert.match(r.txt, /não está em uso.*autorização do dono/);
  }
  assert.equal(st.escritas.length, 0);
  const lidas = []; const espia = async (a) => { lidas.push(a); return api(a); };
  assert.equal((await rodaCli(['status', '--repo', R], { api: espia, apiReal: true })).cod, CODIGOS.OK, 'status só lê e funciona no modo real');
  assert.ok(lidas.every((a) => a.length === 2));
  const usos = [[], ['merge'], ['adquirir'], ['adquirir', '--sessao', 'x', '--pr', '1', '--sha', HA], ['adquirir', '--sessao', 's-1', '--pr', '0', '--sha', HA],
    ['adquirir', '--sessao', 's-1', '--pr', '1', '--sha', 'abc'], ['adquirir', '--sessao', 's-1', '--pr', '1', '--sha', HA, '--ttl-min', '500'],
    ['liberar', '--forcar', '--tag', HA, '--motivo', 'curto'], ['adquirir', '--forcar', '--sessao', 's-1', '--pr', '1', '--sha', HA], ['status', '--repo', 'o/r; x']];
  for (const u of usos) assert.equal((await rodaCli(u, { api, apiReal: true })).cod, CODIGOS.USO, u.join(' '));
  assert.equal(st.escritas.length, 0);
  const j = await rodaCli(['adquirir', '--sessao', 's-1', '--pr', '7', '--sha', HA, '--repo', R, '--json'], { api, emUso: true });
  const o = JSON.parse(j.linhas[0]); assert.equal(o.codigo, 0); assert.equal(o.situacao.dono.pr, 7);
  const o2 = await rodaCli(['adquirir', '--sessao', 's-2', '--pr', '8', '--sha', HB, '--repo', R], { api });
  assert.equal(o2.cod, CODIGOS.OCUPADO); assert.match(o2.txt, /ocupado por sessão s-1 · PR #7/);
  const g = github(); g.st.falharLeituraLock = true;
  assert.equal((await rodaCli(['status', '--repo', R], { api: g.api })).cod, CODIGOS.FALHA);
  assert.match((await rodaCli(['adquirir', '--sessao', 's-1', '--pr', '7', '--sha', HA, '--repo', R], { api: g.api })).txt, /fail-closed/);
  assert.equal(g.st.escritas.length, 0);
}

// 9. a ferramenta não é chamada por nada do repositório (só pelo pode-integrar, e só as funções de leitura)
{
  const fs = await import('node:fs'); const path = await import('node:path');
  const raiz = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
  const achados = [];
  const varre = (d) => { for (const e of fs.readdirSync(d, { withFileTypes: true })) {
    if (['node_modules', '.git'].includes(e.name)) continue;
    const p = path.join(d, e.name);
    if (e.isDirectory()) varre(p); else if (/\.(m?js|ya?ml|sh|json)$/.test(e.name) && fs.readFileSync(p, 'utf8').includes('merge-lock.mjs')) achados.push(path.relative(raiz, p));
  } };
  varre(raiz);
  // só os testes da própria ferramenta (test/merge-lock-*.js, test/pode-integrar-*.js) e os dois módulos
  const fora = achados.filter((p) => !/^test\/(merge-lock|pode-integrar)-[\w-]+\.js$/.test(p));
  assert.deepEqual(fora.sort(), ['tools/merge-lock.mjs', 'tools/pode-integrar.mjs']);
  assert.ok(achados.includes('test/merge-lock-tests.js'));
  const src = fs.readFileSync(path.join(raiz, 'tools/pode-integrar.mjs'), 'utf8');
  // só nomes de leitura/constantes podem ser importados (nunca adquirir/liberar/main)
  const imp = src.match(/import \{([^}]+)\} from '\.\/merge-lock\.mjs'/);
  assert.ok(imp, 'pode-integrar importa merge-lock');
  const nomes = imp[1].split(',').map((x) => x.trim().split(/\s+as\s+/)[0]).filter(Boolean);
  assert.deepEqual(nomes.filter((x) => !['lerLock', 'situacao', 'descrever', 'LOCK_REF', 'EM_USO'].includes(x)), [], nomes.join(','));
  assert.doesNotMatch(src, /\badquirir\b|\bliberar\(/);
}

console.log('merge-lock-tests ok');
