import * as shopify from './shopify.js';
import * as vtex from './vtex.js';
import * as jsonld from './jsonld.js';
import * as mercadolivre from './mercadolivre.js';
export const adapters = { shopify, vtex, jsonld, mercadolivre };

export async function detectPlatform(base) {
  if (await shopify.detect(base)) return 'shopify';
  if (await vtex.detect(base)) return 'vtex';
  if (await jsonld.detect(base)) return 'jsonld';
  return null;
}
