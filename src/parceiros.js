// Site só com parceiros (decisão do proprietário em 07/11/2026; docs/afiliados.md). Flag SITE_SO_PARCEIROS ('1' liga;
// qualquer outro valor mantém o comportamento anterior). Este módulo só CHAMA as funções exportadas por
// api/_lib/affiliates.mjs, o único arquivo que lê a configuração de afiliados: aqui não há leitura de config nem link.
// É a ÚNICA exceção de src/ ao isolamento do afiliado (test/so-parceiros-tests.js garante que mais ninguém importa o módulo).
import { ofertaParceira, ofertasManuaisParceiras, carregarParceiros } from '../api/_lib/affiliates.mjs';
import { marketReferenceOf } from './core/references.js';
import { LOJAS_PARCEIRAS, ligado, lojaParceira } from './core/modo-site.js';

export { LOJAS_PARCEIRAS, ligado, lojaParceira };

/** Configuração dos parceiros (config/ do repositório ou HUNTER_CONFIG_DIR). */
export const carregar = (env = process.env) => carregarParceiros({ dir: env?.HUNTER_CONFIG_DIR || null });

/** Oferta que pode ser publicada: anúncio do ML com link do dono ou leitura manual de Amazon/Shopee. */
export const ehParceira = (o, par) => !!o && (o.manual === true && o.sourceType === 'manual_afiliado' ? LOJAS_PARCEIRAS.includes(o.storeId) : ofertaParceira(o, par.cfg));

/** Leituras manuais vigentes (somem sozinhas: 48 h) já no formato de oferta do robô. */
export const manuais = (par, { now, products, maxHoras = 48 }) => ofertasManuaisParceiras({ now, products, maxHoras, amazon: par.amazon, shopee: par.shopee });

/**
 * Referência de mercado de um produto a partir de TODAS as ofertas limpas (todas as lojas), antes do filtro de publicação:
 * mesma régua do Price Engine (≥ 3 ofertas, ≥ 2 fontes independentes, mediana do preço). Só números: nenhum nome de loja.
 * Devolve null quando o mercado não sustenta uma referência.
 */
export function marketRefOf(clean) {
  const m = marketReferenceOf((clean || []).map((o) => ({ price: o.price, store_id: o.storeId, marketplace_id: o.storeKind === 'marketplace' ? o.storeId : 'direct',
    seller_key: o.storeKind === 'marketplace' ? (o.sellerId ?? o.seller ?? null) : null })));
  return m.ok ? { price: m.price, offers: m.offers, sources: m.sources, composition: m.composition, confidence: m.confidence } : null;
}
