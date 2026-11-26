// node tools/ml-token.mjs exchange <código>   → primeira autorização (workflow "Mercado Livre: autorizar")
// node tools/ml-token.mjs refresh             → renova o acesso se estiver perto de vencer e testa se o ML aceita
// Nunca imprime tokens.
import fs from 'node:fs';
import { loadAffiliates } from '../api/_lib/affiliates.mjs';
import { exchange, accessToken, load, probe, endpointsLine } from '../src/mlauth.js';

let mlb = null; try { mlb = Object.keys(loadAffiliates()?.anuncios || {})[0] || null; } catch { /* sem config */ }
const [cmd, arg] = process.argv.slice(2);
const out = (k, v) => { if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `${k}=${v}\n`); };
try {
  if (cmd === 'exchange') {
    if (!arg) throw new Error('informe o código devolvido pelo Mercado Livre');
    const t = await exchange(arg.trim());
    console.log(`Autorizado. Conta ML ${t.userId ?? '?'}; acesso válido até ${new Date(t.expiresAt).toISOString()}.`);
    out('changed', 'true');
  } else if (cmd === 'refresh') {
    if (!process.env.ML_CLIENT_SECRET) { console.log('Mercado Livre ainda não configurado (sem ML_CLIENT_SECRET).'); process.exit(0); }
    if (!load()) { console.log('Mercado Livre ainda não autorizado (rode o workflow "Mercado Livre: autorizar").'); process.exit(0); }
    let r = await accessToken();
    console.log(r.refreshed ? 'Acesso ao Mercado Livre renovado.' : 'Acesso ao Mercado Livre ainda dentro do prazo.');
    let p = r.token ? await probe(r.token, { mlb }) : { ok: false, me: null, reason: 'sem token' };
    // 401 na conta = token recusado antes do prazo: tenta uma renovação forçada e testa de novo.
    if (!p.ok && p.me === 401 && !r.refreshed) {
      try { r = await accessToken({ marginMs: Infinity }); console.log('Token recusado (401): renovado à força.'); p = await probe(r.token, { mlb }); } catch (e) { p.reason += `; renovação forçada falhou: ${e.message}`; }
    }
    if (r.refreshed) out('changed', 'true');
    out('ml_ok', p.ok ? 'true' : 'false');
    if (p.ok) { console.log('Teste real: o Mercado Livre aceitou o acesso (conta e catálogo).'); if (p.endpoints) console.log(endpointsLine(p.endpoints)); }
    else console.log(`::warning title=Mercado Livre recusou o acesso::${p.reason}. As ofertas do ML vão vencer e o grupo fica sem posts do ML. Reautorize no workflow "Mercado Livre: autorizar" com a conta dona do app; se continuar, confira o app no painel de desenvolvedor do ML.`);
  } else { console.log('uso: ml-token.mjs exchange <código> | refresh'); process.exit(2); }
} catch (e) {
  console.log('Falhou: ' + e.message);
  process.exit(cmd === 'refresh' ? 0 : 1); // na rodada normal, falha do ML não derruba a caça
}
