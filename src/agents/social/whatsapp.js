// Social Media — WhatsApp (#690). Decisão do proprietário em 14/10/2026: grupo "TCG Price Hunter | 01" via automação
// NÃO oficial (sessão de "aparelho conectado", biblioteca Baileys), assumindo o risco de bloqueio do número.
// Este módulo é puro (sem rede): legenda no formato do WhatsApp e cifragem da sessão guardada no cache do Actions.
import crypto from 'node:crypto';

const ENT = { '&amp;': '&', '&lt;': '<', '&gt;': '>' };
/** Legenda HTML do Telegram (legenda.js) → texto do WhatsApp: <b>x</b> vira *x*; entidades voltam a caracteres. */
export function legendaWhatsApp(html) {
  return String(html).replace(/<b>([\s\S]*?)<\/b>/g, (_, t) => `*${t.trim()}*`).replace(/<[^>]+>/g, '').replace(/&(?:amp|lt|gt);/g, (m) => ENT[m]);
}

const VERSAO = 1;
const chaveDe = (segredo) => {
  if (typeof segredo !== 'string' || segredo.length < 24) throw new Error('SOCIAL_WHATSAPP_CHAVE ausente ou curta (mínimo 24 caracteres)');
  return crypto.createHash('sha256').update(segredo).digest();
};

/** Pasta da sessão ({ nomeArquivo: conteúdo }) → bloco cifrado AES-256-GCM. */
export function cifrarSessao(arquivos, segredo) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', chaveDe(segredo), iv);
  const corpo = Buffer.concat([c.update(Buffer.from(JSON.stringify(arquivos), 'utf8')), c.final()]);
  return Buffer.concat([Buffer.from([VERSAO]), iv, c.getAuthTag(), corpo]);
}

export function decifrarSessao(bloco, segredo) {
  const b = Buffer.from(bloco);
  if (b.length < 30 || b[0] !== VERSAO) throw new Error('sessão do WhatsApp em formato desconhecido');
  const d = crypto.createDecipheriv('aes-256-gcm', chaveDe(segredo), b.subarray(1, 13));
  d.setAuthTag(b.subarray(13, 29));
  return JSON.parse(Buffer.concat([d.update(b.subarray(29)), d.final()]).toString('utf8'));
}

/** Grupo pelo título exato (evita postar em grupo errado). grupos = resultado de groupFetchAllParticipating(). */
export function acharGrupo(grupos, titulo) {
  const lista = Object.values(grupos || {}).filter((g) => g && g.subject === titulo);
  if (lista.length !== 1) return null;
  return lista[0].id;
}
