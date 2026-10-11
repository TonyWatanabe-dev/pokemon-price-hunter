// Busca de produtos sem acento e sem diferença de maiúsculas ("pokemon" acha "Pokémon", "colecao" acha "Coleção").
// Mesma regra no banco (read-db.mjs) e no fallback do state.json (read-state.mjs). Sem extensão (unaccent) e sem migration:
// translate() é nativo do PostgreSQL. O termo continua literal: a comparação é por position()/includes(), então % e _ não
// viram curinga.

/** Termo ou nome comparável: sem acentos (NFD, tira as marcas combinantes) e em minúsculas. */
export const normalizeSearch = (t) => String(t ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

// Letras acentuadas do português (maiúsculas e minúsculas) → letra sem acento, minúscula. As maiúsculas estão no mapa
// porque lower() do PostgreSQL só converte letras não ASCII quando o LC_CTYPE do banco permite (com "C", 'É' fica 'É').
const FROM = 'ÁÀÂÃÄÉÈÊËÍÌÎÏÓÒÔÕÖÚÙÛÜÇÑáàâãäéèêëíìîïóòôõöúùûüçñ';
const TO = 'aaaaaeeeeiiiiooooouuuucnaaaaaeeeeiiiiooooouuuucn';
if (FROM.length !== TO.length) throw new Error('search.mjs: mapa de acentos desalinhado');

/** Expressão SQL que normaliza `expr` como normalizeSearch (para as letras acentuadas do português). */
export const sqlFold = (expr) => `translate(lower(${expr}), '${FROM}', '${TO}')`;
