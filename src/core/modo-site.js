// Modo "site só com parceiros" (decisão do proprietário, 07/11/2026): só a chave e a lista de lojas, sem nada de afiliado.
// A chave é do dono: vem da variável SITE_SO_PARCEIROS do workflow ('1' liga) e não aparece em nenhum dado público.
// A lista precisa ser igual à do módulo de parceiros em api/_lib (test/so-parceiros-tests.js confere).
export const LOJAS_PARCEIRAS = Object.freeze(['mercadolivre', 'amazon', 'shopee']);
export const ligado = (env = process.env) => String(env?.SITE_SO_PARCEIROS ?? '') === '1';
export const lojaParceira = (storeId) => LOJAS_PARCEIRAS.includes(storeId);
