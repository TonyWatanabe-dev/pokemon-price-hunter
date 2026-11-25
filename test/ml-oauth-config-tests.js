// OAuth do Mercado Livre: app e endereço de retorno vêm da configuração do repositório (25/11/2026, troca de app no
// painel do ML). Sem variável, vale o app antigo fixo — e o log precisa dizer qual app e qual retorno foram usados,
// porque "invalid_grant" é justamente código de outro app, de outro retorno, já usado ou vencido.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { spawnSync } from 'node:child_process';

let n = 0; const t = (nome, fn) => { try { fn(); n++; } catch (e) { e.message = `[${nome}] ${e.message}`; throw e; } };
const raiz = new URL('..', import.meta.url);
const ler = (p) => fs.readFileSync(new URL(p, raiz), 'utf8');

t('appId e REDIRECT seguem as variáveis do ambiente', async () => {
  const mod = new URL('../src/mlauth.js', import.meta.url).href;
  const antes = { id: process.env.ML_CLIENT_ID, uri: process.env.ML_REDIRECT_URI };
  try {
    delete process.env.ML_CLIENT_ID; delete process.env.ML_REDIRECT_URI;
    const m = await import(mod);
    assert.equal(m.appId(), '7868227182755647', 'sem variável, o app antigo');
    assert.equal(m.REDIRECT(), 'https://tcg-price-hunter.vercel.app/ml/callback');
    process.env.ML_CLIENT_ID = '9999999999'; process.env.ML_REDIRECT_URI = 'https://tcgpricehunter.com.br/ml/callback';
    assert.equal(m.appId(), '9999999999', 'ML_CLIENT_ID manda');
    assert.equal(m.REDIRECT(), 'https://tcgpricehunter.com.br/ml/callback', 'ML_REDIRECT_URI manda');
  } finally {
    if (antes.id == null) delete process.env.ML_CLIENT_ID; else process.env.ML_CLIENT_ID = antes.id;
    if (antes.uri == null) delete process.env.ML_REDIRECT_URI; else process.env.ML_REDIRECT_URI = antes.uri;
  }
});

t('os workflows passam ML_REDIRECT_URI junto do app e da secret', () => {
  for (const wf of ['.github/workflows/ml-auth.yml', '.github/workflows/hunter.yml']) {
    const y = ler(wf);
    const ids = (y.match(/ML_CLIENT_ID: \$\{\{ vars\.ML_CLIENT_ID \}\}/g) || []).length;
    const uris = (y.match(/ML_REDIRECT_URI: \$\{\{ vars\.ML_REDIRECT_URI \}\}/g) || []).length;
    assert.ok(ids > 0 && uris === ids, `${wf}: ${ids} app x ${uris} retorno`);
  }
});

t('ml-token diz qual app e qual retorno usou, e explica o invalid_grant; nunca imprime token', () => {
  const src = ler('tools/ml-token.mjs');
  assert.match(src, /appId\(\)/); assert.match(src, /REDIRECT\(\)/);
  assert.match(src, /invalid_grant/); assert.match(src, /invalid_client/);
  assert.ok(!/\bt\.access\b|\baccess_token\b|r\.token/.test(src), 'não imprime token');
  const r = spawnSync(process.execPath, ['tools/ml-token.mjs'], { cwd: new URL('.', raiz).pathname, encoding: 'utf8' });
  assert.equal(r.status, 2, 'sem comando: uso e saída 2');
  assert.match(r.stdout.trim(), /^uso: ml-token\.mjs/);
});

console.log(`✓ ml-oauth-config: ${n} grupos passaram`);
