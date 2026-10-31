// Social Media — regras do envio automático dos grupos (Telegram #690; WhatsApp usa as mesmas com outro ritmo). Puro: sem rede nem I/O.
// Regra do proprietário em 17/10/2026:
//   1. Intervalo mínimo entre mensagens (Telegram 5 min, WhatsApp 30 min), para não floodar o grupo.
//   2. Oferta que acabou de entrar no radar (firstSeen recente) e nunca foi postada sai na hora.
//   3. Oferta SEM link de afiliado do dono: no Telegram sai UMA VEZ só; no WhatsApp pode voltar depois de 6 h (23/10).
//   4. Oferta COM link de afiliado do dono: postada e repostada a cada 24 h (decisão do dono 18/10; antes 48 h), espaçada (no máximo 1 afiliada a cada
//      20 min no Telegram e 60 min no WhatsApp); entre uma e outra saem as demais ofertas.
//   5. Madrugada (0h–7h, horário de Brasília): só ofertas novas; o resto fica para o dia.
// Diário = lista { ofertaId, at (ISO), messageId, afiliado } dos envios feitos; só entra o que a API do canal confirmou.
// Ele guarda 30 dias, para lembrar o que já saiu uma vez.
export const REGRAS = Object.freeze({ intervaloMin: 5, repetirHoras: 24, repetirHorasAfiliado: 24, afiliadoIntervaloMin: 20, naoAfiliadoUmaVez: true, memoriaDias: 30,
  novaMin: 60, novasPorRodada: 3, diarioMax: 20000, silencio: [0, 7] });

const ms = (iso) => { const t = Date.parse(iso); return Number.isFinite(t) ? t : null; };

/** Lista de candidatos (ordem de prioridade) + diário → o que enviar NESTA rodada, na ordem. */
export function planejar(candidatos, diario, { now = Date.now(), regras = REGRAS } = {}) {
  const ultimoPorOferta = new Map();
  let ultimo = null; let ultimoAfil = null;
  for (const d of Array.isArray(diario) ? diario : []) {
    const t = ms(d?.at); if (t == null || typeof d.ofertaId !== 'string') continue;
    ultimoPorOferta.set(d.ofertaId, Math.max(ultimoPorOferta.get(d.ofertaId) ?? 0, t));
    ultimo = Math.max(ultimo ?? 0, t);
    if (d.afiliado === true) ultimoAfil = Math.max(ultimoAfil ?? 0, t);
  }
  const H = 3600e3;
  const livre = (c) => {
    const t = ultimoPorOferta.get(c.item.ofertaId); if (t == null) return true;
    if (c.afiliado) return now - t >= (regras.repetirHorasAfiliado ?? regras.repetirHoras) * H;
    return regras.naoAfiliadoUmaVez ? false : now - t >= regras.repetirHoras * H;
  };
  const nova = (c) => { const f = ms(c.oferta?.firstSeen); return f != null && now - f <= regras.novaMin * 60e3 && !ultimoPorOferta.has(c.item.ofertaId); };
  const vistos = new Set();
  const unicos = candidatos.filter((c) => !vistos.has(c.item.ofertaId) && vistos.add(c.item.ofertaId));
  if (regras.maxDia) {   // teto de mensagens em 24 h (WhatsApp); vale também para ofertas novas
    const hoje = (Array.isArray(diario) ? diario : []).filter((d) => { const t = ms(d?.at); return t != null && now - t < 24 * H; }).length;
    if (hoje >= regras.maxDia) return { enviar: [], motivo: `teto de ${regras.maxDia} mensagens em 24 h` };
  }
  // O intervalo mínimo vale para TODAS as mensagens, inclusive ofertas recém-detectadas.
  if (ultimo != null && now - ultimo < regras.intervaloMin * 60e3) return { enviar: [], motivo: `intervalo de ${regras.intervaloMin} min ainda não passou` };
  const novas = unicos.filter(nova).slice(0, regras.novasPorRodada);
  if (novas.length) return { enviar: novas, motivo: 'oferta nova no radar' };
  const hora = Number(new Date(now).toLocaleString('en-US', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hourCycle: 'h23' }));
  if (regras.silencio && hora >= regras.silencio[0] && hora < regras.silencio[1]) return { enviar: [], motivo: 'madrugada: só ofertas novas' };
  const afilPronto = ultimoAfil == null || now - ultimoAfil >= (regras.afiliadoIntervaloMin ?? 0) * 60e3;
  const afil = afilPronto ? unicos.find((c) => c.afiliado && livre(c)) : null;
  if (afil) return { enviar: [afil], motivo: 'link de afiliado (ciclo de 24 h)' };
  const outra = unicos.find((c) => !c.afiliado && livre(c));
  if (outra) return { enviar: [outra], motivo: 'próxima da fila (sai uma vez só)' };
  return { enviar: [], motivo: afilPronto ? 'nada novo: afiliadas já postadas nas últimas 24 h e as demais já saíram' : `espaçamento entre afiliadas (${regras.afiliadoIntervaloMin} min)` };
}

/** Diário + novos envios, guardando `memoriaDias` (o que já saiu uma vez não volta) e limitado em tamanho. */
export function registrar(diario, envios, { now = Date.now(), regras = REGRAS } = {}) {
  const corte = now - Math.max(2 * (regras.repetirHorasAfiliado ?? regras.repetirHoras), (regras.memoriaDias ?? 2) * 24) * 3600e3;
  return [...(Array.isArray(diario) ? diario : []), ...envios].filter((d) => (ms(d?.at) ?? 0) >= corte).slice(-regras.diarioMax);
}

// WhatsApp (decisão do proprietário em 14/10/2026, automação não oficial): espaçado para reduzir risco de bloqueio.
// 23/10/2026, pedido do dono ("entregue mais anúncios, pode reenviar o dia todo até o horário limite"): uma mensagem a
// cada 30 min das 7h à meia-noite (34 no dia) e oferta sem afiliado pode voltar depois de 6 h, para a fila não secar.
// 31/10/2026: intervalo mínimo de 30 min entre TODAS as mensagens, inclusive ofertas novas; afiliadas também respeitam
// o mesmo espaçamento. Uma oferta por rodada, teto diário preservado; automação permanece desligada até liberação da conta.
export const REGRAS_WHATSAPP = Object.freeze({ ...REGRAS, intervaloMin: 30, afiliadoIntervaloMin: 30, novasPorRodada: 1, maxDia: 70,
  naoAfiliadoUmaVez: false, repetirHoras: 6 });
