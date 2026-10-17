// Cliente mínimo do Firestore pela API REST, com conta de serviço (alertas por usuário no Telegram, docs/alertas-telegram-usuario.md).
// Sem dependência nova: o token OAuth sai de um JWT assinado com node:crypto (RS256). A conta de serviço vem do chamador
// (em produção, o Secret FIREBASE_SERVICE_ACCOUNT, JSON); este módulo nunca registra o conteúdo dela nem o token.
// Conta de serviço ignora as regras do Firestore: por isso só o robô a usa, e só para users/{uid}.
import crypto from 'node:crypto';

export const TOKEN_URI = 'https://oauth2.googleapis.com/token';
export const SCOPE = 'https://www.googleapis.com/auth/datastore';
export const API = 'https://firestore.googleapis.com/v1';
export const TIMEOUT_MS = 10000;

export class FirestoreError extends Error {
  constructor(msg, status) { super(msg); this.status = status; }
}

/** Lê e valida o JSON da conta de serviço. null = ausente ou inválido (falha fechada: o recurso fica desligado). */
/** JSON da conta de serviço como veio do secret: tira BOM, espaços e aspas externas (colagem comum no GitHub). */
const limparSA = (raw) => { let s = String(raw).replace(/^\uFEFF/, '').trim(); if (/^(['"`]).*\1$/s.test(s) && s.length > 2 && s[1] === '{') s = s.slice(1, -1).trim(); return s; };

/** Por que a conta de serviço não vale, sem expor conteúdo: só o motivo e o tamanho (para o log da Action). */
export function motivoServiceAccount(raw) {
  if (!raw || typeof raw !== 'string' || !raw.trim()) return 'vazio (secret ausente, com outro nome ou num Environment)';
  const s = limparSA(raw); const tam = `${s.length} caracteres`;
  if (s[0] !== '{') return `não começa com "{" (${tam}): cole o arquivo JSON inteiro`;
  let j; try { j = JSON.parse(s); } catch { return `JSON incompleto ou quebrado (${tam}): cole do "{" ao "}" final`; }
  if (j?.type && j.type !== 'service_account') return `tipo "${String(j.type).slice(0, 30)}": não é chave de conta de serviço`;
  if (!(typeof j?.client_email === 'string' && /@/.test(j.client_email))) return 'sem client_email';
  if (!(typeof j?.private_key === 'string' && /BEGIN (RSA )?PRIVATE KEY/.test(j.private_key))) return 'sem private_key';
  if (!(typeof j?.project_id === 'string' && /^[a-z0-9-]{4,40}$/.test(j.project_id))) return 'project_id inválido';
  return null;
}

export function parseServiceAccount(raw) {
  if (!raw || typeof raw !== 'string') return null;
  let j; try { j = JSON.parse(limparSA(raw)); } catch { return null; }
  if (!j || typeof j !== 'object') return null;
  const ok = typeof j.client_email === 'string' && /@/.test(j.client_email) && typeof j.private_key === 'string'
    && /BEGIN (RSA )?PRIVATE KEY/.test(j.private_key) && typeof j.project_id === 'string' && /^[a-z0-9-]{4,40}$/.test(j.project_id);
  // token_uri é fixo (TOKEN_URI): um JSON adulterado não manda a assinatura para outro endereço.
  return ok ? { clientEmail: j.client_email, privateKey: j.private_key, projectId: j.project_id } : null;
}

const b64u = (b) => Buffer.from(b).toString('base64').replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');

/** JWT RS256 para o fluxo jwt-bearer do Google. Pura (now em segundos). */
export function signJwt(sa, nowSec) {
  const head = b64u(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
  const body = b64u(JSON.stringify({ iss: sa.clientEmail, scope: SCOPE, aud: TOKEN_URI, iat: nowSec, exp: nowSec + 3600 }));
  const sig = crypto.sign('RSA-SHA256', Buffer.from(`${head}.${body}`), sa.privateKey);
  return `${head}.${body}.${b64u(sig)}`;
}

// ---------------------------------------------------------------- valores do Firestore (REST) <-> JS
export function encode(v) {
  if (v === null || v === undefined) return { nullValue: null };
  if (typeof v === 'boolean') return { booleanValue: v };
  if (typeof v === 'number') return Number.isSafeInteger(v) ? { integerValue: String(v) } : { doubleValue: v };
  if (typeof v === 'string') return { stringValue: v };
  if (Array.isArray(v)) return { arrayValue: { values: v.map(encode) } };
  if (typeof v === 'object') return { mapValue: { fields: encodeFields(v) } };
  throw new FirestoreError('valor não suportado');
}
export const encodeFields = (o) => Object.fromEntries(Object.entries(o).filter(([, x]) => x !== undefined).map(([k, x]) => [k, encode(x)]));

export function decode(v) {
  if (!v || typeof v !== 'object') return null;
  if ('nullValue' in v) return null;
  if ('booleanValue' in v) return !!v.booleanValue;
  if ('integerValue' in v) { const n = Number(v.integerValue); return Number.isSafeInteger(n) ? n : null; }
  if ('doubleValue' in v) return Number(v.doubleValue);
  if ('stringValue' in v) return String(v.stringValue);
  if ('timestampValue' in v) return String(v.timestampValue);
  if ('arrayValue' in v) return (v.arrayValue.values || []).map(decode);
  if ('mapValue' in v) return decodeFields(v.mapValue.fields);
  return null;
}
export const decodeFields = (f) => Object.fromEntries(Object.entries(f || {}).map(([k, x]) => [k, decode(x)]));

const UID = /^[A-Za-z0-9_-]{1,128}$/;
const FIELD = /^[A-Za-z][A-Za-z0-9]{0,40}$/;

/**
 * Cliente de users/{uid}. opts = { serviceAccount (de parseServiceAccount), fetch, now?: () => ms, timeoutMs? }.
 * Interface (a mesma do falso dos testes):
 *  getUser(uid) -> { uid, data, updateTime } | null
 *  patchUser(uid, campos, mascara, { updateTime }) -> { updateTime }   (campo na máscara e ausente em `campos` = apagado)
 *  linkedUsers({ chatId?, limit }) -> [{ uid, data, updateTime }]     (telegram.chatId > 0, ou == chatId)
 * Erro de rede/API lança FirestoreError (status quando houver), sem token nem corpo na mensagem.
 */
export function firestoreClient({ serviceAccount: sa, fetch: f, now = Date.now, timeoutMs = TIMEOUT_MS } = {}) {
  if (!sa || typeof f !== 'function') throw new FirestoreError('conta de serviço e fetch são obrigatórios');
  let cached = null;
  const base = `${API}/projects/${sa.projectId}/databases/(default)/documents`;
  async function token() {
    if (cached && cached.exp - 60e3 > now()) return cached.value;
    const assertion = signJwt(sa, Math.floor(now() / 1000));
    const r = await f(TOKEN_URI, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, signal: AbortSignal.timeout(timeoutMs),
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }).toString() });
    const j = await r.json().catch(() => null);
    if (!r.ok || typeof j?.access_token !== 'string') throw new FirestoreError(`token OAuth recusado (HTTP ${r.status})`, r.status);
    cached = { value: j.access_token, exp: now() + (Number(j.expires_in) || 3600) * 1000 };
    return cached.value;
  }
  async function call(method, url, body) {
    const r = await f(url, { method, headers: { authorization: `Bearer ${await token()}`, 'content-type': 'application/json' }, signal: AbortSignal.timeout(timeoutMs), ...(body ? { body: JSON.stringify(body) } : {}) });
    if (r.status === 404 && method === 'GET') return null;
    const j = await r.json().catch(() => null);
    if (!r.ok) throw new FirestoreError(`Firestore ${method} recusado (HTTP ${r.status}${j?.error?.status ? ' ' + j.error.status : ''})`, r.status);
    return j;
  }
  const doc = (d) => ({ uid: String(d.name).split('/').pop(), data: decodeFields(d.fields), updateTime: d.updateTime });
  return {
    async getUser(uid) {
      if (!UID.test(String(uid))) throw new FirestoreError('uid inválido');
      const j = await call('GET', `${base}/users/${uid}`);
      return j ? doc(j) : null;
    },
    async patchUser(uid, campos, mascara, { updateTime } = {}) {
      if (!UID.test(String(uid))) throw new FirestoreError('uid inválido');
      if (!mascara?.length || !mascara.every((m) => FIELD.test(m))) throw new FirestoreError('máscara inválida');
      const q = new URLSearchParams(); for (const m of mascara) q.append('updateMask.fieldPaths', m);
      // Sempre com pré-condição: o documento precisa existir e, com updateTime, não pode ter mudado desde a leitura.
      if (updateTime) q.set('currentDocument.updateTime', updateTime); else q.set('currentDocument.exists', 'true');
      const j = await call('PATCH', `${base}/users/${uid}?${q}`, { fields: encodeFields(campos || {}) });
      return { updateTime: j?.updateTime };
    },
    async linkedUsers({ chatId, limit = 500 } = {}) {
      const filter = chatId != null
        ? { fieldFilter: { field: { fieldPath: 'telegram.chatId' }, op: 'EQUAL', value: encode(Number(chatId)) } }
        : { fieldFilter: { field: { fieldPath: 'telegram.chatId' }, op: 'GREATER_THAN', value: encode(0) } };
      const j = await call('POST', `${base}:runQuery`, { structuredQuery: { from: [{ collectionId: 'users' }], where: filter, limit: Math.max(1, Math.min(1000, Math.floor(limit))) } });
      return (Array.isArray(j) ? j : []).filter((x) => x?.document).map((x) => doc(x.document)).sort((a, b) => a.uid.localeCompare(b.uid));
    },
  };
}
