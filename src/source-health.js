// Rendimento das lojas (Lote 5): classificação DERIVADA, ao lado do status (que não muda: site, API e cobertura dependem dele).
// Nada é apagado: loja, contadores (checks, ok, fails) e histórico continuam; a classe só explica o que a loja rende.
//   ok              ativa e com anúncio casado (ou ainda sem leituras vazias suficientes para concluir)
//   sem_resultado   ativa, mas a busca voltou vazia em EMPTY_STREAK leituras bem-sucedidas seguidas (contador emptyStreak)
//   sem_match       ativa, com anúncios, mas nenhum casou com o catálogo na última leitura
//   nunca_funcionou bloqueada/erro, nenhuma leitura bem-sucedida (ok = 0) em NEVER_CHECKS tentativas ou mais
//   falhando        bloqueada/erro que já funcionou (ou com poucas tentativas)
//   null            fora da coleta (PENDING, UNAVAILABLE, PAUSED)

export const EMPTY_STREAK = 3;      // leituras vazias seguidas (≈ 45 min com rodadas de 15 min)
export const NEVER_CHECKS = 20;     // tentativas sem nenhum sucesso
export const BACKOFF_MAX_MIN = 360; // espera máxima entre tentativas: 6 h
export const BACKOFF_NEVER_MIN = 1440; // loja que nunca funcionou: até 24 h (continua sendo tentada, nunca removida)
export const YIELD_CLASSES = ['ok', 'sem_resultado', 'sem_match', 'nunca_funcionou', 'falhando'];

/** Classe de rendimento de uma fonte (data/sources.json). */
export function classifySource(s = {}) {
  if (s.status === 'ACTIVE') {
    if (s.listings > 0) return s.matched > 0 ? 'ok' : 'sem_match';
    return (s.emptyStreak || 0) >= EMPTY_STREAK ? 'sem_resultado' : 'ok';
  }
  if (s.status === 'BLOCKED' || s.status === 'ERROR') return !(s.ok > 0) && (s.checks || 0) >= NEVER_CHECKS ? 'nunca_funcionou' : 'falhando';
  return null;
}

/** Espera (min) antes de tentar de novo uma loja bloqueada/com erro: 15, 30, 60… até 6 h; 24 h se nunca funcionou. */
export function backoffMinutes(s = {}) {
  if (!(s.fails > 0)) return 0;
  const cap = classifySource(s) === 'nunca_funcionou' ? BACKOFF_NEVER_MIN : BACKOFF_MAX_MIN;
  return Math.min(cap, 15 * 2 ** Math.min(s.fails - 1, 20));
}

/** Contador de leituras vazias: atualizado só numa leitura bem-sucedida (falha não zera nem soma). */
export const nextEmptyStreak = (s, listings) => (listings > 0 ? 0 : (s.emptyStreak || 0) + 1);

/** Contagem por classe (chaves fixas, zero quando não há). */
export function yieldCounts(sources) {
  const out = Object.fromEntries(YIELD_CLASSES.map((k) => [k, 0]));
  for (const s of Object.values(sources || {})) { const k = classifySource(s); if (k) out[k]++; }
  return out;
}
