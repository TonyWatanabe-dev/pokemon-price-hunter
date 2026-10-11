// Minimização de logs: tira segredos e dados pessoais de mensagens de erro/log antes de gravar ou imprimir, e limita o tamanho.
// Os valores reais das variáveis sensíveis (se presentes em `env`) são trocados primeiro; depois entram os padrões genéricos.

const SENSITIVE_ENV = /(TOKEN|SECRET|PASSWORD|PASSWD|API_?KEY|DATABASE_URL|TOPIC|CHAT_ID|CEP)/i;

export function redact(input, { env = process.env, max = 200 } = {}) {
  let out = String(input ?? '');
  for (const [k, v] of Object.entries(env || {})) {
    if (SENSITIVE_ENV.test(k) && v && String(v).length >= 4) out = out.split(String(v)).join('***');
  }
  out = out
    .replace(/\b[a-z][a-z0-9+.-]*:\/\/[^\s/@:]+:[^\s/@]+@\S*/gi, '[url]')                 // URL com usuário:senha
    .replace(/postgres(ql)?:\/\/\S+/gi, '[url]')
    .replace(/\bbot\d+:[\w-]+/g, 'bot***')                                                // token de bot do Telegram
    .replace(/\b(Bearer|Basic)\s+[\w.~+/=-]{8,}/gi, '$1 ***')
    .replace(/\b(APP_USR|TG)-[\w-]{8,}/g, '***')                                         // formato de token do Mercado Livre
    .replace(/\beyJ[\w-]{8,}\.[\w-]{8,}\.[\w-]*/g, '***')                                // JWT
    .replace(/([?&;\s"']?(?:access_token|refresh_token|client_secret|token|api_?key|key|secret|password|senha|code)["']?\s*[=:]\s*)["']?[^\s&"',;]+/gi, '$1***')
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g, '[email]')                                  // e-mail
    .replace(/\b\d{3}\.?\d{3}\.?\d{3}-?\d{2}\b/g, '[cpf]')                                // CPF
    .replace(/\b\d{5}-?\d{3}\b/g, '[cep]');                                               // CEP
  return out.length > max ? out.slice(0, max) + '…' : out;
}
