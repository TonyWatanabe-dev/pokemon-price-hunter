// Frequência adaptativa por loja: o tempo da rodada vai para quem muda. Loja cujo resultado (anúncios casados, preço e
// estoque) não mudou espera cada vez mais (30 → 60 → 120 min); mudou, volta a toda rodada. Loja que lê anúncios e
// não casa nenhum por ZERO_RODADAS rodadas seguidas é lida a cada 6 h (em vez de pausar à mão: se passar a vender
// lacrado, volta sozinha). Mercado Livre e loja oficial Copag: sempre toda rodada.
// Teto de 120 min < 3 h: a oferta de loja adiada continua publicada como leitura recente (recentRead em src/run.js).
import crypto from 'node:crypto';

export const MAX_MIN = 120; export const ZERO_MIN = 360; export const ZERO_RODADAS = 8;
export const ligada = (env = process.env) => String(env.FREQ_ADAPTATIVA ?? '1') !== '0';
export const sempre = (store) => store?.platform === 'mercadolivre' || store?.id === 'mercadolivre' || !!store?.copagSource || store?.kind === 'official';

/** Assinatura do que importa na leitura: url, preço e estoque de cada anúncio casado (ordem não importa). */
export const assinatura = (itens) => crypto.createHash('sha1').update([...itens].sort().join('\n')).digest('hex').slice(0, 16);

/** Atualiza src (sig, zeroRuns, intervalMin) depois de uma leitura bem-sucedida. */
export function aposLeitura(src, store, { sig, matched, listings }) {
  const mudou = !src.sig || src.sig !== sig;
  src.zeroRuns = matched === 0 && listings > 0 ? (src.zeroRuns || 0) + 1 : 0;
  src.sig = sig;
  if (sempre(store)) src.intervalMin = 0;
  else if (src.zeroRuns >= ZERO_RODADAS) src.intervalMin = ZERO_MIN;
  else if (mudou) src.intervalMin = 0;
  else src.intervalMin = Math.min(MAX_MIN, Math.max(30, (src.intervalMin || 15) * 2));
  return src.intervalMin;
}

/** A loja pode esperar nesta rodada? Só loja ativa, com leitura recente e intervalo definido. */
export function adiar(src, store, now = Date.now()) {
  if (!src || src.status !== 'ACTIVE' || !(src.intervalMin > 0) || sempre(store)) return false;
  const t = Date.parse(src.lastSuccess || src.lastCheck || ''); if (!Number.isFinite(t)) return false;
  return now - t < src.intervalMin * 60e3;
}
