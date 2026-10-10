// Links de afiliado do Mercado Livre (docs/afiliados.md). Único leitor de config/affiliates.json.
// Regras: (1) afiliado é só o DESTINO do clique: nunca entra em ranking, melhor oferta, preço, frete, estoque ou nota;
// (2) a URL original da oferta continua sendo o dado (o.url) e é o destino sempre que não houver link próprio validado;
// (3) só anúncio do Mercado Livre com link gerado para ELE no painel troca de destino — link geral nunca vai para anúncio;
// (4) o link é usado inteiro, como veio do painel: nada é anexado, montado ou reescrito.
import fs from 'node:fs';

// Onde ficam os anúncios (URL original da oferta) e para onde um link de afiliado pode levar.
const ML_HOST = /^(?:[a-z0-9-]+\.)*mercadoli(?:vre\.com\.br|bre\.com)$/;
export const DESTINATION_HOSTS = new Set(['meli.la', 'mercadolivre.com.br', 'www.mercadolivre.com.br', 'produto.mercadolivre.com.br']);
const LISTING_ID = /^MLB\d{6,15}$/;

// Id do anúncio (MLB123456789) numa URL do Mercado Livre; null para outra loja, página de catálogo sem vendedor ou URL inválida.
export function mlListingId(url) {
  let u; try { u = new URL(String(url ?? '').trim()); } catch { return null; }
  if ((u.protocol !== 'https:' && u.protocol !== 'http:') || !ML_HOST.test(u.hostname.toLowerCase())) return null;
  const f = (u.searchParams.get('pdp_filters') || '').match(/item_id:(MLB\d{6,15})\b/i);   // página do produto com o vendedor escolhido
  if (f) return f[1].toUpperCase();
  const p = u.pathname.match(/^\/MLB-?(\d{6,15})(?:[-_/]|$)/i);                            // anúncio: produto.mercadolivre.com.br/MLB-123-...
  return p ? 'MLB' + p[1] : null;
}

// Destino aceito: https, sem credenciais, sem porta, sem espaços, num domínio do Mercado Livre. Qualquer outra coisa: null.
export function validDestination(v) {
  if (typeof v !== 'string' || v !== v.trim() || /[\s"'<>\\]/.test(v)) return null;
  let u; try { u = new URL(v); } catch { return null; }
  if (u.protocol !== 'https:' || u.username || u.password || u.port || !DESTINATION_HOSTS.has(u.hostname.toLowerCase())) return null;
  if (!/^https:\/\/[^/?#]+\//i.test(v)) return null;   // host escrito exatamente (sem truques de barra/@ antes do caminho)
  return v;
}

// Config bruta -> config usada. Entradas inválidas ficam de fora (e listadas em `rejeitados`), nunca quebram o site.
export function parseAffiliates(raw) {
  const ml = raw && typeof raw === 'object' ? raw.mercadolivre : null;
  const anuncios = {}; const rejeitados = [];
  const map = ml && typeof ml.anuncios === 'object' && !Array.isArray(ml.anuncios) ? ml.anuncios : {};
  for (const [k, v] of Object.entries(map)) {
    const id = String(k).trim().toUpperCase().replace(/^MLB-/, 'MLB'); const dest = validDestination(v);
    if (LISTING_ID.test(id) && dest) anuncios[id] = dest; else rejeitados.push(k);
  }
  const g = ml?.geral; const gUrl = validDestination(g?.url);
  const geral = g && g.ativo === true && g.destinoConfirmado === true && gUrl
    ? { url: gUrl, rotulo: typeof g.rotulo === 'string' && g.rotulo.trim() ? g.rotulo.trim().slice(0, 60) : 'Ver mais no Mercado Livre' } : null;
  return { anuncios, geral, rejeitados };
}

const FILE = new URL('../../config/affiliates.json', import.meta.url);
let cached = null;
export function loadAffiliates({ file = FILE, fresh = false } = {}) {
  if (cached && !fresh) return cached;
  let raw = null; try { raw = JSON.parse(fs.readFileSync(file, 'utf8')); } catch { raw = null; }   // ausente ou inválida: tudo como sem afiliado
  cached = parseAffiliates(raw);
  return cached;
}

// Destino do clique para a URL de uma oferta: o link do anúncio, se houver; senão a própria URL, intacta.
export function resolveOutbound(url, cfg = loadAffiliates()) {
  const id = mlListingId(url);
  return (id && cfg?.anuncios?.[id]) || url;
}

// O que o navegador recebe (GET /api/v1/afiliados): só entradas validadas.
export function publicAffiliates(cfg = loadAffiliates()) {
  return { v: 1, anuncios: { ...cfg.anuncios }, geral: cfg.geral ? { ...cfg.geral } : null };
}
