// api/_seo.mjs state(): download do state.json com prazo. GitHub raw pendurado não pode segurar /api/pagina nem o sitemap.
// Sem rede: fetch falso que só termina se o sinal abortar. Cada cenário roda em subprocesso (o módulo guarda cache de state).
import assert from 'node:assert/strict';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const seo = pathToFileURL(path.join(root, 'api/_seo.mjs')).href;
const fresh = () => ({ generatedAt: new Date().toISOString(), products: [], offers: [], collections: [], types: [] });

// modo: lista de respostas por chamada: 'ok' | 'trava' | 'trava-corpo' | '500'
function rodar(modos, codigo) {
  const script = `
    const modos = ${JSON.stringify(modos)}; let i = 0; const st = ${JSON.stringify(fresh())};
    const trava = (signal) => new Promise((_, rej) => signal?.addEventListener('abort', () => rej(signal.reason)));
    globalThis.fetch = async (url, opts = {}) => {
      const m = modos[i++] || 'ok';
      if (m === 'trava') return trava(opts.signal);
      if (m === '500') return new Response('x', { status: 500 });
      if (m === 'trava-corpo') return { ok: true, status: 200, json: () => trava(opts.signal) };
      return new Response(JSON.stringify(st), { status: 200 });
    };
    const S = await import(${JSON.stringify(seo)});
    // AbortSignal.timeout usa timer sem ref: na função real há a requisição segurando o processo; aqui, um intervalo.
    const vivo = setInterval(() => {}, 1000);
    const out = {}; ${codigo}
    clearInterval(vivo); console.log(JSON.stringify(out));`;
  const r = spawnSync(process.execPath, ['--input-type=module', '-e', script], { cwd: root, encoding: 'utf8', timeout: 20000 });
  if (r.status !== 0) throw new Error(r.stderr || r.error?.message || 'subprocesso falhou');
  return JSON.parse(r.stdout.trim().split('\n').pop());
}
let n = 0; const t = (name, fn) => { fn(); n++; };

t('prazo padrão de 5 s e sinal passado ao fetch', () => {
  const o = rodar(['ok'], `out.ms = S.STATE_TIMEOUT_MS; let sinal = null; const f = globalThis.fetch;
    globalThis.fetch = (u, opts) => { sinal = opts?.signal; return f(u, opts); };
    await S.state(); out.temSinal = !!sinal && typeof sinal.aborted === 'boolean';`);
  assert.equal(o.ms, 5000); assert.equal(o.temSinal, true);
});

t('sucesso: devolve o state', () => {
  const o = rodar(['ok'], `const s = await S.state({ timeoutMs: 200 }); out.ok = Array.isArray(s.products);`);
  assert.equal(o.ok, true);
});

t('servidor pendurado sem cache: lança dentro do prazo (não segura a função)', () => {
  const o = rodar(['trava'], `const t0 = Date.now(); try { await S.state({ timeoutMs: 150 }); out.r = 'ok'; } catch (e) { out.r = 'erro'; out.nome = e?.name; } out.ms = Date.now() - t0;`);
  assert.equal(o.r, 'erro'); assert.match(String(o.nome), /TimeoutError|AbortError/); assert.ok(o.ms < 3000, `${o.ms} ms`);
});

t('corpo pendurado depois dos cabeçalhos também respeita o prazo', () => {
  const o = rodar(['trava-corpo'], `const t0 = Date.now(); try { await S.state({ timeoutMs: 150 }); out.r = 'ok'; } catch { out.r = 'erro'; } out.ms = Date.now() - t0;`);
  assert.equal(o.r, 'erro'); assert.ok(o.ms < 3000, `${o.ms} ms`);
});

t('pendurado com cache bom e em dia: usa o último state (mesmo fallback de antes)', () => {
  const o = rodar(['ok', 'trava'], `await S.state({ timeoutMs: 150 });
    const real = Date.now; Date.now = () => real() + 11 * 60e3;   // passa o cache de 10 min, ainda dentro do frescor
    const s = await S.state({ timeoutMs: 150 }); out.ok = Array.isArray(s.products); Date.now = real;`);
  assert.equal(o.ok, true);
});

t('recuperação: depois de um estouro, a próxima chamada busca de novo e funciona', () => {
  const o = rodar(['trava', 'ok'], `try { await S.state({ timeoutMs: 150 }); } catch { out.primeira = 'erro'; }
    const s = await S.state({ timeoutMs: 150 }); out.segunda = Array.isArray(s.products);`);
  assert.equal(o.primeira, 'erro'); assert.equal(o.segunda, true);
});

t('HTTP 500 continua lançando sem cache (comportamento anterior preservado)', () => {
  const o = rodar(['500'], `try { await S.state({ timeoutMs: 150 }); out.r = 'ok'; } catch (e) { out.r = String(e.message); }`);
  assert.equal(o.r, 'state 500');
});

console.log(`✓ Prazo do state.json (api/_seo.mjs): ${n} grupos de testes passaram`);
