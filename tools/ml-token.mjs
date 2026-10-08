// node tools/ml-token.mjs exchange <código>   → primeira autorização (workflow "Mercado Livre: autorizar")
// node tools/ml-token.mjs refresh             → renova o acesso se estiver perto de vencer
// Nunca imprime tokens.
import fs from 'node:fs';
import { exchange, accessToken, load } from '../src/mlauth.js';

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
    const r = await accessToken();
    console.log(r.refreshed ? 'Acesso ao Mercado Livre renovado.' : 'Acesso ao Mercado Livre ainda válido.');
    if (r.refreshed) out('changed', 'true');
  } else { console.log('uso: ml-token.mjs exchange <código> | refresh'); process.exit(2); }
} catch (e) {
  console.log('Falhou: ' + e.message);
  process.exit(cmd === 'refresh' ? 0 : 1); // na rodada normal, falha do ML não derruba a caça
}
