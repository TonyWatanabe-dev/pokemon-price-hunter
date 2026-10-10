// Guarda de URLs externas (SSRF): só http/https, sem credenciais, sem loopback/privado/link-local.
// Checagem sintática (sem DNS): bloqueia IP literal e nomes locais; não cobre DNS rebinding.
export class UnsafeUrlError extends Error {
  constructor(msg) { super(msg); this.unsafe = true; }
}

const ipv4 = (h) => { const m = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/); return m ? m.slice(1).map(Number) : null; };

export function isPrivateHost(hostname) {
  let h = String(hostname).toLowerCase().replace(/\.$/, '');
  if (h.startsWith('[') && h.endsWith(']')) h = h.slice(1, -1);
  if (h === 'localhost' || h.endsWith('.localhost') || h.endsWith('.local') || h.endsWith('.internal')) return true;
  const v4 = ipv4(h);
  if (v4) {
    const [a, b] = v4;
    return v4.some((n) => n > 255) || a === 0 || a === 10 || a === 127 || (a === 169 && b === 254) || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 100 && b >= 64 && b <= 127) || a >= 224;
  }
  if (h.includes(':')) {
    const mapped = h.match(/^::ffff:(.+)$/);
    if (mapped) {
      if (ipv4(mapped[1])) return isPrivateHost(mapped[1]);
      return true; // forma hex do IPv4-mapeado: bloqueia por segurança
    }
    return h === '::' || h === '::1' || /^f[cd]/.test(h) || /^fe[89ab]/.test(h);
  }
  return false;
}

export function assertSafeUrl(input) {
  let u;
  try { u = new URL(input); } catch { throw new UnsafeUrlError('URL inválida'); }
  if (u.protocol !== 'http:' && u.protocol !== 'https:') throw new UnsafeUrlError(`Esquema não permitido: ${u.protocol}`);
  if (u.username || u.password) throw new UnsafeUrlError('URL com credenciais não é permitida');
  if (isPrivateHost(u.hostname)) throw new UnsafeUrlError(`Destino não permitido: ${u.hostname}`);
  return u;
}
