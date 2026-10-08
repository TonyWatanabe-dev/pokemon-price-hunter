// Diagnóstico da conexão (sem revelar a URL): descreve o formato da DATABASE_URL e testa a conexão.
// Uso: DATABASE_URL=... node tools/db-diagnose.mjs <saida.json>
// Sai com código 1 se não conectar. Imprime a versão do servidor na última linha quando conecta.
import fs from 'node:fs';
const out = process.argv[2] || 'connect.json';
const raw = process.env.DATABASE_URL || '';
const rep = { at: new Date().toISOString(), url: {} };
let u = null;
try { u = new URL(raw); } catch (e) { rep.url.parseError = 'URL inválida (não é uma URI postgres://...)'; }
if (u) {
  const host = u.hostname;
  rep.url = {
    scheme: u.protocol,
    port: u.port || '(padrão 5432)',
    database: u.pathname.replace(/^\//, '') || '(vazio)',
    hostKind: /pooler\.supabase\.com$/.test(host) ? 'pooler Supabase (Supavisor)' : /^db\..+\.supabase\.co$/.test(host) ? 'conexão direta Supabase (só IPv6)' : 'outro',
    hostRegion: (host.match(/^aws-\d+-([a-z0-9-]+)\.pooler/) || [])[1] || null,
    userShape: /^postgres\.[a-z0-9]{10,}$/.test(u.username) ? 'postgres.<projeto> (formato do pooler)' : u.username === 'postgres' ? 'postgres (sem id do projeto)' : 'outro',
    passwordPresent: !!u.password,
    passwordHasPlaceholder: /YOUR-PASSWORD|\[|\]/i.test(decodeURIComponent(u.password || '')),
    passwordNeedsEncoding: /[@#/?:% ]/.test(u.password || '') && !/%[0-9A-F]{2}/i.test(u.password || ''),
    queryParams: [...u.searchParams.keys()],
    whitespace: raw !== raw.trim(),
  };
}
let ok = false;
// Logo após trocar a senha, o pooler do Supabase pode recusar algumas conexões até atualizar o cache
// de credenciais (doc do Supabase: "a few consecutive reconnects fail before one succeeds"). Tenta até 5 vezes.
rep.attempts = [];
for (let i = 0; i < 5 && !ok; i++) {
  if (i) await new Promise((r) => setTimeout(r, 20000));
  try {
    const { default: pg } = await import('pg');
    const c = new pg.Client({ connectionString: raw, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 10000 });
    await c.connect(); await c.end(); ok = true; rep.attempts.push('ok');
  } catch (e) { rep.attempts.push(`${e.code || ''} ${e.message}`); if (e.code !== '28P01') break; }
}
ok = false;
try {
  const { pool, close } = await import('../src/db/pg.js');
  const p = await pool();
  const r = await p.query("SELECT current_setting('server_version') v, current_setting('search_path') sp");
  rep.connected = true; rep.serverVersion = r.rows[0].v; rep.searchPath = r.rows[0].sp; ok = true;
  await close();
} catch (e) {
  rep.connected = false;
  rep.error = { code: e.code || null, errno: e.errno || null, syscall: e.syscall || null, message: e.message };
}
// "tenant/user not found" no pooler: quase sempre o índice do cluster no host (aws-0, aws-1...). Testa os outros
// só para diagnóstico; não muda nada e não grava a URL.
if (!ok && u && /tenant\/user .* not found/i.test(rep.error?.message || '') && /^aws-\d+-/.test(u.hostname)) {
  rep.url.hostCluster = u.hostname.split('-').slice(0, 2).join('-');
  rep.clusterProbe = {};
  const { default: pg } = await import('pg');
  for (const k of [0, 1, 2]) {
    const alt = new URL(raw); alt.hostname = u.hostname.replace(/^aws-\d+-/, `aws-${k}-`);
    if (alt.hostname === u.hostname) continue;
    const c = new pg.Client({ connectionString: alt.toString(), ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 8000 });
    try { await c.connect(); const r = await c.query("SELECT current_setting('server_version') v"); rep.clusterProbe[`aws-${k}`] = 'conecta (PostgreSQL ' + r.rows[0].v + ')'; }
    catch (e) { rep.clusterProbe[`aws-${k}`] = 'falha: ' + (e.code || '') + ' ' + e.message; }
    finally { await c.end().catch(() => {}); }
  }
}
let txt = JSON.stringify(rep, null, 2);
if (u) for (const s of [u.password, decodeURIComponent(u.password || ''), u.username, u.hostname].filter((x) => x && x.length > 3)) txt = txt.split(s).join('***');
fs.writeFileSync(out, txt);
console.log(txt.replace(/"message": ".*"/, '"message": "(ver relatório)"'));
if (ok) console.log(rep.serverVersion.split(' ')[0]);
process.exitCode = ok ? 0 : 1;
