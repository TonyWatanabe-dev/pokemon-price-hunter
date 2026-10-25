#!/usr/bin/env node
// Smoke real do frete por CEP (#84): cota, direto nas lojas VTEX, uma oferta atual por loja do state.json.
// Só leitura (simulação de carrinho da VTEX), respeita robots.txt. Não liga a flag nem grava nada:
// imprime um resumo (stdout + ::notice::) para servir de evidência. Nos testes, `notice` é injetado: sem isso as
// cotações falsas do teste viravam anotações "HTTP 403 na cotação" em todo run do CI e pareciam falha real.
// Uso: node tools/frete-smoke.mjs --state data/state.json --cep 01310100 [--max 8]
import fs from 'node:fs';
import { calcSources, resolveVtexOffer, normalizeCep, parseVtexSimulation } from '../api/_lib/shipping-calc.mjs';
import { apiVtexFetchQuote } from '../api/_lib/shipping-fetch.mjs';

export async function main(argv = process.argv.slice(2), { log = console.log, notice = (s) => console.error(`::notice::${s}`), fetchQuote = apiVtexFetchQuote, pausaMs = 1500 } = {}) {
  const arg = (k, d) => { const i = argv.indexOf(k); return i >= 0 ? argv[i + 1] : d; };
  const st = JSON.parse(fs.readFileSync(arg('--state'), 'utf8'));
  const cep = normalizeCep(arg('--cep', '01310100'));
  if (!cep) { log('CEP inválido'); return 1; }
  const max = Math.min(20, Number(arg('--max', 8)) || 8);
  const porLoja = new Map();
  for (const o of st.offers || []) {
    if (porLoja.has(o.storeId)) continue;
    const alvo = resolveVtexOffer(st, o.id);
    if (!alvo) continue;
    porLoja.set(o.storeId, { o, alvo });
    if (porLoja.size >= max) break;
  }
  log(`## Smoke do frete (#84) — CEP ${cep}\n\nLojas VTEX ativas: ${calcSources(st).length} · lojas testadas: ${porLoja.size}\n`);
  let ok = 0;
  for (const { o, alvo } of porLoja.values()) {
    let q;
    try { q = parseVtexSimulation(await fetchQuote({ ...alvo, quantity: 1, cep })); } catch (e) { q = { status: 'error', reason: String(e?.message || e).slice(0, 120) }; }
    const opts = (q.options || []).map((x) => `${x.kind === 'pickup' ? 'Retirada ' : ''}${x.method} R$ ${x.price.toFixed(2)}`).join('; ');
    if (q.status === 'ok') ok++;
    const linha = `${o.storeName || o.storeId}: ${q.status}${opts ? ` — ${opts}` : q.reason ? ` — ${q.reason}` : ''}`;
    log(`- ${linha}`);
    notice(`frete-smoke ${linha.slice(0, 400)}`);
    if (pausaMs) await new Promise((r) => setTimeout(r, pausaMs));
  }
  log(`\n**${ok}/${porLoja.size}** lojas devolveram cotação.`);
  notice(`frete-smoke total ${ok}/${porLoja.size} lojas com cotação (CEP ${cep})`);
  return 0;
}
if (process.argv[1]?.endsWith('frete-smoke.mjs')) process.exitCode = await main();
