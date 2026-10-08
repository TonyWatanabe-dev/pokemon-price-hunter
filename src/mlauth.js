// Acesso oficial à API do Mercado Livre (OAuth). O token renovável é de uso único e troca a cada
// renovação, então fica guardado CRIPTOGRAFADO no ramo de dados (público): data/ml-auth.enc.
// A chave vem do ML_CLIENT_SECRET (Secret do GitHub); sem ele, o arquivo é ilegível.
import crypto from 'node:crypto';
import fs from 'node:fs';
import { dataPath } from './db.js';

const FILE = () => dataPath('ml-auth.enc');
const TOKEN_URL = 'https://api.mercadolibre.com/oauth/token';
export const REDIRECT = () => process.env.ML_REDIRECT_URI || 'https://tcg-price-hunter.vercel.app/ml/callback';
const cfg = () => ({ id: process.env.ML_CLIENT_ID, secret: process.env.ML_CLIENT_SECRET });
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
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(`OAuth do Mercado Livre recusou (${r.status}): ${j.error || ''} ${j.message || ''}`.trim());
  const t = { access: j.access_token, refresh: j.refresh_token, expiresAt: Date.now() + (j.expires_in || 21600) * 1000, userId: j.user_id || null, scope: j.scope || null, at: new Date().toISOString() };
  save(t);
  return t;
}

// Primeira autorização: troca o código que o ML devolve no /ml/callback.
export const exchange = (code) => tokenCall({ grant_type: 'authorization_code', code, redirect_uri: REDIRECT() });

// Token de acesso válido (renova se faltar menos de 30 min). Retorna { token, refreshed }.
export async function accessToken({ marginMs = 30 * 60e3 } = {}) {
  const t = load();
  if (!t) return { token: process.env.ML_ACCESS_TOKEN || null, refreshed: false };
  if (t.expiresAt - Date.now() > marginMs) return { token: t.access, refreshed: false };
  if (!t.refresh) return { token: null, refreshed: false };
  const n = await tokenCall({ grant_type: 'refresh_token', refresh_token: t.refresh });
  return { token: n.access, refreshed: true };
}
