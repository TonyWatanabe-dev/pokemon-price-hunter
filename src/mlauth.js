// Acesso oficial à API do Mercado Livre (OAuth). O token renovável é de uso único e troca a cada
// renovação, então fica guardado CRIPTOGRAFADO no ramo de dados (público): data/ml-auth.enc.
// A chave vem do ML_CLIENT_SECRET (Secret do GitHub); sem ele, o arquivo é ilegível.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { dataPath } from './db.js';

const FILE = () => dataPath('ml-auth.enc');
const TOKEN_URL = 'https://api.mercadolibre.com/oauth/token';
export const OAUTH_TIMEOUT_MS = 15000;   // prazo da chamada de token (troca e renovação)
export const REDIRECT = () => process.env.ML_REDIRECT_URI || 'https://tcg-price-hunter.vercel.app/ml/callback';
// App ID é público (aparece na URL de autorização); só a Secret Key é segredo.
const cfg = () => ({ id: process.env.ML_CLIENT_ID || '7868227182755647', secret: process.env.ML_CLIENT_SECRET });
const key = (secret) => crypto.createHash('sha256').update('tcgph-ml|' + secret).digest();

export function seal(obj, secret = cfg().secret) {
  const iv = crypto.randomBytes(12);
  const c = crypto.createCipheriv('aes-256-gcm', key(secret), iv);
  const ct = Buffer.concat([c.update(JSON.stringify(obj), 'utf8'), c.final()]);
  return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}
export function open(b64, secret = cfg().secret) {
  const buf = Buffer.from(b64, 'base64');
  const d = crypto.createDecipheriv('aes-256-gcm', key(secret), buf.subarray(0, 12));
  d.setAuthTag(buf.subarray(12, 28));
  return JSON.parse(Buffer.concat([d.update(buf.subarray(28)), d.final()]).toString('utf8'));
}
/** Hora da última autorização do dono (ISO) ou null. Nunca expõe o token. */
// Arquivo gravado antes deste campo: usa a hora do token (a autorização de 25/11/2026 foi a última gravação).
export const authorizedAt = () => { const o = load(); return o?.authorizedAt ?? o?.at ?? null; };
export function load() {
  const { secret } = cfg(); if (!secret) return null;
  try { return open(fs.readFileSync(FILE(), 'utf8').trim(), secret); } catch { return null; }
}
function save(t) { fs.mkdirSync(dataPath(''), { recursive: true }); fs.writeFileSync(FILE(), seal(t) + '\n'); }

async function tokenCall(params) {
  const { id, secret } = cfg();
  if (!id || !secret) throw new Error('faltam ML_CLIENT_ID e ML_CLIENT_SECRET');
  const r = await fetch(TOKEN_URL, {
    method: 'POST',
    headers: { accept: 'application/json', 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: id, client_secret: secret, ...params }),
    signal: AbortSignal.timeout(OAUTH_TIMEOUT_MS),   // prazo: OAuth travado não segura o passo de renovação
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(`OAuth do Mercado Livre recusou (${r.status}): ${j.error || ''} ${j.message || ''}`.trim());
  const t = { access: j.access_token, refresh: j.refresh_token, expiresAt: Date.now() + (j.expires_in || 21600) * 1000, userId: j.user_id || null, scope: j.scope || null, at: new Date().toISOString(),
    // authorizedAt: hora da última autorização feita pelo dono (troca de código); a renovação preserva.
    authorizedAt: params.grant_type === 'authorization_code' ? new Date().toISOString() : (() => { const o = load(); return o?.authorizedAt ?? o?.at ?? null; })() };
  save(t);
  return t;
}

// Primeira autorização: troca o código que o ML devolve no /ml/callback.
export const exchange = (code) => tokenCall({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT() });

// Token de acesso válido (renova se faltar menos de 30 min). Retorna { token, refreshed, scope }.
// scope é só o nome dos escopos que o OAuth devolveu (ex.: "offline_access read"), para o diagnóstico; nunca o token.
export async function accessToken({ marginMs = 30 * 60e3 } = {}) {
  const t = load();
  if (!t) return { token: process.env.ML_ACCESS_TOKEN || null, refreshed: false, scope: null };
  if (t.expiresAt - Date.now() > marginMs) return { token: t.access, refreshed: false, scope: t.scope || null };
  if (!t.refresh) return { token: null, refreshed: false, scope: null };
  const n = await tokenCall({ grant_type: 'refresh_token', refresh_token: t.refresh });
  return { token: n.access, refreshed: true, scope: n.scope || null };
}

// Sonda: confere se o ML aceita o acesso de verdade (a validade do token não basta: o ML pode barrar
// o app inteiro com 403 "PolicyAgent" mesmo com token dentro do prazo). Duas leituras leves:
// /users/me (o token vale?) e a busca de catálogo (o app pode ler dados?). Nunca devolve o token.
const API = 'https://api.mercadolibre.com';
// mlb: id de anúncio (MLB…) para testar /items; quem chama obtém de api/_lib/affiliates.mjs (src/ não lê afiliados).
export async function probe(token, { timeoutMs = OAUTH_TIMEOUT_MS, mlb = null } = {}) {
  const { getJson } = await import('./http.js');   // cliente com guarda de URL (sem fetch direto aqui)
  // withBody: devolve o JSON em `json` (uso interno; nunca é logado nem sai de probe).
  const hit = async (path, withBody = false) => {
    try { const j = await getJson(API + path, { headers: { authorization: `Bearer ${token}` }, timeout: timeoutMs }); return { status: 200, policy: false, message: '', ...(withBody ? { json: j } : {}) }; } catch (e) {
      const status = e.httpStatus ?? e.status ?? 0;
      const body = String(e.forensics?.bodyHead || '');
      return { status, policy: /PolicyAgent/.test(body), message: (status ? '' : String(e.message || e)).slice(0, 120) };
    }
  };
  const me = await hit('/users/me');
  const catalog = me.status === 200 ? await hit('/products/search?status=active&site_id=MLB&q=pokemon%20copag&limit=1', true) : null;
  const ok = me.status === 200 && catalog?.status === 200;
  let reason = null;
  if (!ok) {
    const bad = me.status !== 200 ? { where: 'conta (/users/me)', ...me } : { where: 'catálogo', ...catalog };
    reason = `${bad.where} respondeu ${bad.status || 'sem resposta'}${bad.policy ? ' (bloqueio de política do ML: PolicyAgent)' : ''}${bad.message ? `: ${bad.message}` : ''}`;
  }
  const out = { ok, me: me.status, catalog: catalog?.status ?? null, policy: me.policy || !!catalog?.policy, reason };
  if (ok) out.endpoints = await probeEndpoints(hit, catalog.json, mlb);
  return out;
}

// Diagnóstico por endpoint (só código HTTP; nunca corpo, preço ou token). Leituras sequenciais.
async function probeEndpoints(hit, catalogJson, mlb) {
  const short = (r, extra = {}) => ({ status: r.status, policy: !!r.policy, ...extra });
  const ep = {};
  const pid = catalogJson?.results?.[0]?.id;
  if (pid) {
    const id = encodeURIComponent(String(pid));
    const prod = await hit(`/products/${id}`, true);
    ep.produto = short(prod, { buyBox: typeof prod.json?.buy_box_winner?.price === 'number' });
    ep.produtoItems = short(await hit(`/products/${id}/items?limit=1`));
  } else { ep.produto = null; ep.produtoItems = null; }
  if (mlb && /^MLB\d+$/.test(mlb)) {
    ep.item = short(await hit(`/items/${mlb}`));
    const mg = await hit(`/items?ids=${mlb}`, true);
    const code = Array.isArray(mg.json) ? mg.json[0]?.code : undefined;
    ep.itemsMulti = short(mg, { code: Number.isInteger(code) ? code : null });
  } else { ep.item = null; ep.itemsMulti = null; }
  ep.siteSearch = short(await hit('/sites/MLB/search?q=pokemon&limit=1'));
  return ep;
}

/** Uma linha legível da sonda de endpoints (só códigos; sem token, corpo ou preço). */
export function endpointsLine(ep) {
  if (!ep) return null;
  const f = (n, r, extra = '') => `${n}=${r ? `${r.status}${r.policy ? ' PolicyAgent' : ''}${extra}` : 'n/d'}`;
  return 'Sonda de endpoints: ' + [
    f('produto', ep.produto, ep.produto ? ` (buyBox ${ep.produto.buyBox ? 'sim' : 'não'})` : ''),
    f('produto/items', ep.produtoItems),
    f('item', ep.item),
    f('multiget', ep.itemsMulti, ep.itemsMulti?.code != null ? ` (item ${ep.itemsMulti.code})` : ''),
    f('busca', ep.siteSearch),
  ].join(' · ');
}
