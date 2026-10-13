// Retentativa limitada para leituras do `gh` (só `gh api` GET). Escritas nunca são repetidas.
// `run(args, input)` é o executor real (ou falso nos testes); `sleep` é injetável.
export const TENTATIVAS = 3; // 1ª tentativa + 2 repetições
export const BASE_MS = 500;

/** Leitura = `gh api` sem método não-GET, sem campos (-f/-F/--input) e sem corpo via stdin. */
export function ehLeitura(args, input) {
  if (input !== undefined || args[0] !== 'api') return false;
  for (let i = 1; i < args.length; i++) {
    const a = args[i];
    if (a === '-X' || a === '--method') { if (String(args[i + 1]).toUpperCase() !== 'GET') return false; i++; continue; }
    if (/^(--method=|-X)/.test(a)) { if (a.replace(/^(--method=|-X)/, '').toUpperCase() !== 'GET') return false; continue; }
    if (/^(-f|-F|--field|--raw-field|--input)/.test(a)) return false;
  }
  return true;
}

const dorme = (ms) => new Promise((r) => setTimeout(r, ms));

/** Executa `run`; em leitura, repete com backoff exponencial até `tentativas`; o último erro propaga. */
export async function comRetry(run, args, input, { tentativas = TENTATIVAS, baseMs = BASE_MS, sleep = dorme } = {}) {
  const max = ehLeitura(args, input) ? tentativas : 1;
  for (let n = 1; ; n++) {
    try { return await run(args, input); } catch (e) {
      if (n >= max) throw e;
      await sleep(baseMs * 2 ** (n - 1));
    }
  }
}
