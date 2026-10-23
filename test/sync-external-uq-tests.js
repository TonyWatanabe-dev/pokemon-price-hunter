// Incidente de 22/10/2026: o mesmo anúncio do ML voltou com outro legacy_id e offer_external_uq derrubou a sincronização.
// O sync limpa o id externo da linha antiga antes do upsert (reproduzido e validado num PostgreSQL descartável).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const src = readFileSync(new URL('../src/core/sync.js', import.meta.url), 'utf8');
const i = src.indexOf('UPDATE offer o SET external_offer_id = NULL'); const j = src.indexOf('INSERT INTO offer (legacy_id, product_id, store_id, marketplace_id, seller_id, external_offer_id');
assert.ok(i > 0 && j > i, 'limpeza do id externo antes do upsert de ofertas');
assert.match(src.slice(i, j), /o\.legacy_id IS DISTINCT FROM x\.legacy_id/, 'só linhas de outro legacy_id');
assert.match(src.slice(i, j), /coalesce\(o\.seller_id, 0\) = coalesce\(x\.seller_id, 0\)/, 'mesma chave do índice (vendedor)');
console.log('sync-external-uq-tests ok');
