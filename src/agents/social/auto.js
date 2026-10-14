// Social Media — regras do envio automático do Telegram definidas pelo proprietário (#690). Puro: sem rede nem I/O.
//   1. Intervalo mínimo de 5 min entre mensagens, para não floodar o grupo.
//   2. Exceção: oferta que acabou de entrar no radar (firstSeen recente) e nunca foi postada sai na hora.
//   3. A mesma oferta no máximo 1× a cada 24 h.
//   5. Madrugada (0h–7h, horário de Brasília): só ofertas novas; as repostagens ficam para o dia.
//   4. Entre as demais, links de afiliado do proprietário primeiro (ordem já vem de candidatos()).
// Diário = lista { ofertaId, at (ISO), messageId } dos envios feitos; só entra o que a Bot API confirmou.
export const REGRAS = Object.freeze({ intervaloMin: 5, repetirHoras: 24, novaMin: 60, novasPorRodada: 3, diarioMax: 2000, silencio: [0, 7] });

const ms = (iso) => { const t = Date.parse(iso); return Number.isFinite(t) ? t : null; };

/** Lista de candidatos (ordem de prioridade) + diário → o que enviar NESTA rodada, na ordem. */
export function planejar(candidatos, diario, { now = Date.now(), regras = REGRAS } = {}) {
  const ultimoPorOferta = new Map();
  let ultimo = null;
  for (const d of Array.isArray(diario) ? diario : []) {
    const t = ms(d?.at); if (t == null || typeof d.ofertaId !== 'string') continue;
    ultimoPorOferta.set(d.ofertaId, Math.max(ultimoPorOferta.get(d.ofertaId) ?? 0, t));
    ultimo = Math.max(ultimo ?? 0, t);
  }
  const livre = (c) => { const t = ultimoPorOferta.get(c.item.ofertaId); return t == null || now - t >= regras.repetirHoras * 3600e3; };
  const nova = (c) => { const f = ms(c.oferta?.firstSeen); return f != null && now - f <= regras.novaMin * 60e3 && !ultimoPorOferta.has(c.item.ofertaId); };
  const vistos = new Set();
  const unicos = candidatos.filter((c) => !vistos.has(c.item.ofertaId) && vistos.add(c.item.ofertaId));
  if (regras.maxDia) {   // teto de mensagens em 24 h (WhatsApp); vale também para ofertas novas
    const hoje = (Array.isArray(diario) ? diario : []).filter((d) => { const t = ms(d?.at); return t != null && now - t < 24 * 3600e3; }).length;
    if (hoje >= regras.maxDia) return { enviar: [], motivo: `teto de ${regras.maxDia} mensagens em 24 h` };
  }
  const novas = unicos.filter(nova).slice(0, regras.novasPorRodada);
  if (novas.length) return { enviar: novas, motivo: 'oferta nova no radar' };
  const hora = Number(new Date(now).toLocaleString('en-US', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hourCycle: 'h23' }));
  if (regras.silencio && hora >= regras.silencio[0] && hora < regras.silencio[1]) return { enviar: [], motivo: 'madrugada: só ofertas novas' };
  if (ultimo != null && now - ultimo < regras.intervaloMin * 60e3) return { enviar: [], motivo: `intervalo de ${regras.intervaloMin} min ainda não passou` };
  const prox = unicos.find(livre);
  return prox ? { enviar: [prox], motivo: prox.afiliado ? 'próxima com link de afiliado' : 'próxima da fila' } : { enviar: [], motivo: 'todas já postadas nas últimas 24 h' };
}

/** Diário + novos envios, sem entradas com mais de 48 h e limitado em tamanho. */
export function registrar(diario, envios, { now = Date.now(), regras = REGRAS } = {}) {
  const corte = now - 2 * regras.repetirHoras * 3600e3;
  return [...(Array.isArray(diario) ? diario : []), ...envios].filter((d) => (ms(d?.at) ?? 0) >= corte).slice(-regras.diarioMax);
}

// WhatsApp (decisão do proprietário em 14/10/2026, automação não oficial): mais espaçado para reduzir risco de bloqueio.
export const REGRAS_WHATSAPP = Object.freeze({ ...REGRAS, intervaloMin: 30, novasPorRodada: 1, maxDia: 20 });
