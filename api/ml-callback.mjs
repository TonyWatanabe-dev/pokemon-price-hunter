// Volta da autorização do Mercado Livre: só MOSTRA o código para colar no workflow do GitHub.
// Não guarda nada e não usa segredo nenhum.
const WF = 'https://github.com/TonyWatanabe-dev/pokemon-price-hunter/actions/workflows/ml-auth.yml';
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export default function handler(req, res) {
  const u = new URL(req.url, 'https://x');
  const code = u.searchParams.get('code') || '';
  const err = u.searchParams.get('error_description') || u.searchParams.get('error') || '';
  const ok = /^TG-[\w-]{6,200}$/.test(code);
  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.end(`<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>Mercado Livre autorizado</title>
<style>body{font:16px/1.5 system-ui,sans-serif;background:#0b0d17;color:#eef;margin:0;padding:24px;display:grid;place-items:center;min-height:100vh}main{max-width:560px}h1{font-size:22px}input{width:100%;box-sizing:border-box;font:600 16px ui-monospace,monospace;padding:14px;border-radius:12px;border:1px solid #445;background:#151a2e;color:#fff}a{display:inline-block;margin-top:16px;background:#ffcb05;color:#111;font-weight:700;padding:12px 18px;border-radius:999px;text-decoration:none}ol{padding-left:20px}small{color:#99a}</style></head><body><main>
${ok ? `<h1>Autorizado no Mercado Livre</h1><p>Copie o código abaixo. Ele vale por poucos minutos.</p><input readonly value="${esc(code)}" onclick="this.select()" aria-label="Código"><ol><li>Abra o workflow no GitHub.</li><li>Toque em <b>Run workflow</b>, cole o código e confirme.</li></ol><a href="${WF}" rel="noreferrer">Abrir no GitHub</a>`
  : `<h1>Não veio código</h1><p>${err ? esc(err) : 'O Mercado Livre não devolveu a autorização.'} Tente autorizar de novo.</p>`}
<p><small>TCG Price Hunter · esta página não guarda nada.</small></p></main></body></html>`);
}
