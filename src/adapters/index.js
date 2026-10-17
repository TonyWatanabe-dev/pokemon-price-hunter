import * as shopify from './shopify.js';
import * as vtex from './vtex.js';
import * as jsonld from './jsonld.js';
import * as woocommerce from './woocommerce.js';
import * as mercadolivre from './mercadolivre.js';
export const adapters = { shopify, vtex, woocommerce, jsonld, mercadolivre };

export async function detectPlatform(base) {
  if (await shopify.detect(base)) return 'shopify';
  if (await vtex.detect(base)) return 'vtex';
  if (await woocommerce.detect(base)) return 'woocommerce';
  if (await jsonld.detect(base)) return 'jsonld';
  return null;
}
