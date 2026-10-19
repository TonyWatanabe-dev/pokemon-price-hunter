// Cliente mínimo da Zernio para a linha editorial (Instagram + TikTok conectados no perfil "TCG Price Hunter").
// Decisão do proprietário em 16/10/2026: IG/TikTok = editorial (artes do canvas e vídeos de abertura), sem post
// automático de oferta. Fluxo (docs.zernio.com): GET /accounts → POST /media/presign → PUT bytes → POST /posts com
// scheduledFor + timezone. Sem rede própria: fetch injetado. A chave nunca volta em resultado nem em log.
import { redact } from '../../redact.js';

export const API_PADRAO = 'https://zernio.com/api/v1';
export const FUSO = 'America/Sao_Paulo';
/** URL de vídeo aceita na agenda: só https em raw.githubusercontent.com (arquivo renderizado e versionado no repositório). */
export function urlDeVideo(u) {
  let x; try { x = new URL(u); } catch { throw new Error('url do vídeo inválida'); }
  if (x.protocol !== 'https:' || x.hostname !== 'raw.githubusercontent.com' || !/\.mp4$/i.test(x.pathname)) throw new Error('url do vídeo precisa ser https://raw.githubusercontent.com/.../*.mp4');
  return x.href;
}

export const PLATAFORMAS = Object.freeze(['instagram', 'tiktok', 'youtube']);
export const TITULO_YT_MAX = 100;
export const TIPOS = Object.freeze(['carrossel', 'imagem', 'story', 'video']);
export const LEGENDA_MAX = 2200;
export const CARROSSEL_MAX = 10;
/** Exigências da Zernio/TikTok para conta Business: público, consentimento e prévia confirmados, não gerado por IA. */
export const TIKTOK_SETTINGS = Object.freeze({
  privacy_level: 'PUBLIC_TO_EVERYONE', allow_comment: true, allow_duet: false, allow_stitch: false,
  content_preview_confirmed: true, express_consent_given: true, video_made_with_ai: false,
});

const obj = (o) => (o && typeof o === 'object' && !Array.isArray(o) ? o : {});
const https = (u) => { try { const x = new URL(String(u ?? '')); return x.protocol === 'https:' && !x.username && !x.password ? x : null; } catch { return null; } };
const DATA = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2})?$/;
const MIME = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', mp4: 'video/mp4' };

export const mimeDe = (nome) => MIME[String(nome).split('.').pop().toLowerCase()] ?? null;

/** Valida um item da agenda. Devolve lista de problemas (vazia = ok). */
export function validarItem(it) {
  const p = [];
  const i = obj(it);
  if (!/^[a-z0-9-]{3,60}$/.test(i.id ?? '')) p.push('id inválido');
  if (!TIPOS.includes(i.tipo)) p.push('tipo inválido');
  if (!DATA.test(i.quando ?? '')) p.push('quando deve ser AAAA-MM-DDTHH:MM (horário de Brasília)');
  const plats = Array.isArray(i.plataformas) ? i.plataformas : [];
  if (!plats.length || plats.some((x) => !PLATAFORMAS.includes(x))) p.push('plataformas inválidas');
  if (plats.includes('tiktok') && i.tipo !== 'video') p.push('TikTok só recebe vídeo nesta agenda');
  if (plats.includes('youtube')) {
    if (i.tipo !== 'video') p.push('YouTube só recebe vídeo (Shorts) nesta agenda');
    if (typeof i.titulo !== 'string' || !i.titulo.trim()) p.push('YouTube precisa de titulo');
    else if (i.titulo.length > TITULO_YT_MAX) p.push('titulo do YouTube acima de 100 caracteres');
  }
  const arqs = Array.isArray(i.arquivos) ? i.arquivos : [];
  if (i.tipo === 'carrossel' && (arqs.length < 2 || arqs.length > CARROSSEL_MAX)) p.push(`carrossel precisa de 2 a ${CARROSSEL_MAX} imagens`);
  if (['imagem', 'story'].includes(i.tipo) && arqs.length !== 1) p.push('imagem/story precisa de exatamente 1 arquivo');
  if (i.tipo === 'video' && arqs.length !== 1 && typeof i.drive !== 'string' && typeof i.url !== 'string') p.push('vídeo precisa de 1 arquivo, do campo drive ou de url (vazio = pendente)');
  if (i.url !== undefined) { try { urlDeVideo(i.url); } catch (e) { p.push(e.message); } }
  for (const a of arqs) if (!mimeDe(a)) p.push(`formato não suportado: ${a}`);
  if (i.tipo !== 'story') {
    if (typeof i.legenda !== 'string' || !i.legenda.trim()) p.push('legenda vazia');
    else if (i.legenda.length > LEGENDA_MAX) p.push('legenda acima de 2.200 caracteres');
    if (/https?:\/\//i.test(i.legenda ?? '')) p.push('legenda com URL (Instagram não linka; use "link na bio")');
  }
  return p;
}

/** Corpo de POST /posts para uma plataforma. urls = URLs públicas das mídias já enviadas. */
export function montarPost(it, { accountId, plataforma, urls, simular = false }) {
  const tipoMidia = (u) => (/\.mp4(\?|$)/i.test(u) || it.tipo === 'video' ? 'video' : 'image');
  const entrada = { platform: plataforma, accountId };
  if (plataforma === 'instagram') {
    entrada.platformSpecificData = it.tipo === 'story' ? { contentType: 'story' } : { shareToFeed: true, isAiGenerated: false, commentsEnabled: true };
    if (it.tipo === 'video' && Number.isFinite(it.capaMs)) entrada.platformSpecificData.thumbOffset = it.capaMs;
  }
  if (plataforma === 'youtube') {
    // Shorts: vídeo vertical de até 3 min; sem flag de tipo. Sem miniatura via API.
    entrada.platformSpecificData = { title: it.titulo, visibility: 'public', madeForKids: false, containsSyntheticMedia: false, categoryId: '20' };
  }
  return {
    content: it.tipo === 'story' ? '' : it.legenda,
    mediaItems: urls.map((url) => ({ type: tipoMidia(url), url })),
    platforms: [entrada],
    scheduledFor: it.quando.length === 16 ? `${it.quando}:00` : it.quando,
    timezone: FUSO,
    ...(plataforma === 'youtube' && Array.isArray(it.tags) && it.tags.length ? { tags: it.tags.slice(0, 15) } : {}),
    ...(plataforma === 'tiktok' ? { tiktokSettings: { ...TIKTOK_SETTINGS, media_type: 'video', commercialContentType: it.afiliado ? 'brand_content' : 'none', ...(Number.isFinite(it.capaMs) ? { video_cover_timestamp_ms: it.capaMs } : {}) } } : {}),
    ...(simular ? { dryRun: true } : {}),
  };
}

export function criarCliente({ chave, fetch: fetchFn, apiBase = API_PADRAO, timeoutMs = 30000 }) {
  if (typeof chave !== 'string' || chave.trim().length < 16) throw new Error('chave da Zernio ausente');
  if (typeof fetchFn !== 'function') throw new Error('fetch não injetado');
  const base = https(apiBase)?.href.replace(/\/+$/, '');
  if (!base) throw new Error('apiBase inválida');
  const k = chave.trim();
  const limpo = (s) => redact(String(s ?? ''), { env: { ZERNIO_API_KEY: k }, max: 300 });

  async function chamar(url, { metodo = 'GET', corpo, cab = {}, bruto = false, tempo = timeoutMs } = {}) {
    const init = { method: metodo, redirect: 'error', headers: { ...cab } };
    if (!bruto) init.headers.authorization = `Bearer ${k}`;
    if (corpo !== undefined) { init.body = bruto ? corpo : JSON.stringify(corpo); if (!bruto) init.headers['content-type'] = 'application/json'; }
    if (typeof AbortSignal?.timeout === 'function') init.signal = AbortSignal.timeout(tempo);
    let res; try { res = await fetchFn(url, init); } catch (e) { throw new Error(`rede: ${limpo(e?.message ?? e)}`); }
    let dado = {}; if (!bruto) { try { dado = obj(await res.json()); } catch { /* sem json */ } }
    if (!res.ok) throw new Error(`HTTP ${res.status}${dado.message || dado.error ? ': ' + limpo(dado.message || JSON.stringify(dado.error)) : ''}`);
    return { status: res.status, dado };
  }

  return {
    /** Contas conectadas ao perfil: só rede e nome de usuário (sem ids nem tokens). */
    async contas(profileId) {
      const q = profileId ? `?profileId=${encodeURIComponent(profileId)}` : '';
      const { dado } = await chamar(`${base}/accounts${q}`);
      return (Array.isArray(dado.accounts) ? dado.accounts : []).map((a) => ({ rede: a?.platform, usuario: a?.username ?? a?.displayName ?? '', ativa: a?.isActive !== false }));
    },
    async conta(plataforma, profileId) {
      const q = profileId ? `?profileId=${encodeURIComponent(profileId)}` : '';
      const { dado } = await chamar(`${base}/accounts${q}`);
      const l = (Array.isArray(dado.accounts) ? dado.accounts : []).filter((a) => a?.platform === plataforma && a.isActive !== false);
      if (l.length !== 1) throw new Error(`esperava 1 conta ${plataforma} ativa, achei ${l.length}`);
      return l[0]._id;
    },
    async enviar(bytes, nome) {
      const contentType = mimeDe(nome);
      const { dado } = await chamar(`${base}/media/presign`, { metodo: 'POST', corpo: { filename: nome, contentType, size: bytes.byteLength } });
      const up = https(dado.uploadUrl); const pub = https(dado.publicUrl);
      if (!up || !pub) throw new Error('presign sem uploadUrl/publicUrl');
      await chamar(up.href, { metodo: 'PUT', corpo: bytes, cab: { 'content-type': contentType }, bruto: true, tempo: Math.max(timeoutMs, 300000) });
      return pub.href;
    },
    /** Posts agendados do perfil (GET /posts?status=scheduled). */
    async agendados(profileId) {
      const q = new URLSearchParams({ status: 'scheduled', limit: '200', ...(profileId ? { profileId } : {}) });
      const { dado } = await chamar(`${base}/posts?${q}`);
      return Array.isArray(dado.posts) ? dado.posts : [];
    },
    async cancelar(postId) {
      if (!/^[a-f0-9]{24}$/i.test(String(postId))) throw new Error('postId inválido');
      await chamar(`${base}/posts/${postId}`, { metodo: 'DELETE' });
    },
    async postar(corpo, idempotencia) {
      const { status, dado } = await chamar(`${base}/posts`, { metodo: 'POST', corpo, cab: idempotencia ? { 'idempotency-key': idempotencia } : {} });
      const post = obj(dado.post);
      if (corpo.dryRun) return { status: dado.canPublish === false ? 'invalido' : 'validado', detalhe: dado.canPublish === false ? limpo(JSON.stringify(dado.platforms ?? dado).slice(0, 300)) : '' };
      if (status === 207 || post.status === 'failed') throw new Error(`Zernio recusou: ${limpo(JSON.stringify(post.platforms ?? post).slice(0, 300))}`);
      return { status: post.status ?? 'scheduled', id: post._id ?? null };
    },
  };
}
