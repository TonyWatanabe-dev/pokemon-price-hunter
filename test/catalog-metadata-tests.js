// Metadados de coleção (issue #110): integridade de config/catalog.json — códigos, nomes, aliases, séries e datas de lançamento.
// Princípio: dado ausente fica ausente (null/indefinido); nunca string vazia, placeholder ou data inventada.
// Coleções com nomes parecidos NÃO podem compartilhar alias: cada alias aponta para uma única coleção.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { normalize } from '../src/match.js';

let n = 0; const t = (name, fn) => { fn(); n++; };

const ALLOWED_KEYS = new Set(['id', 'name', 'series', 'aliases', 'fallbackAliases', 'combines', 'releaseDate']);
// Coleções costumam ser anunciadas com até ~1 ano de antecedência; uma data além disso é quase certamente erro de digitação.
const MAX_FUTURE_DAYS = 366;
const PLACEHOLDER = /^(-+|\?+|n\/?a|null|undefined|tbd|tba|todo|xxx+|0000-00-00|indefinid[oa]|desconhecid[oa]|a definir)$/i;

// Chave de comparação: minúsculas, sem acento, sem pontuação nem espaço ("EV 3.5" ≡ "ev3,5" ≡ "ev35").
export const aliasKey = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

const isBlank = (v) => typeof v !== 'string' || !v.trim() || v !== v.trim() || /\s{2,}/.test(v) || PLACEHOLDER.test(v.trim());

function checkReleaseDate(v, now) {
  if (v === undefined || v === null) return null;   // ausente: permitido (não confirmado)
  if (typeof v !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(v)) return `data de lançamento fora do formato ISO AAAA-MM-DD: ${JSON.stringify(v)}`;
  const d = new Date(`${v}T00:00:00Z`);
  if (Number.isNaN(d.getTime()) || d.toISOString().slice(0, 10) !== v) return `data de lançamento inexistente: ${v}`;
  if (d.getTime() > now.getTime() + MAX_FUTURE_DAYS * 864e5) return `data de lançamento mais de ${MAX_FUTURE_DAYS} dias no futuro: ${v}`;
  if (v < '1996-01-01') return `data de lançamento anterior ao Pokémon TCG: ${v}`;
  return null;
}

/** Lista os problemas de metadados de coleção de um catálogo (vazio = íntegro). */
export function auditCollections(catalog, { now = new Date() } = {}) {
  const errs = [];
  const cols = catalog?.collections;
  if (!Array.isArray(cols) || !cols.length) return ['catálogo sem coleções'];
  const ids = new Map(); const idKeys = new Map(); const names = new Map();
  const owner = new Map();   // aliasKey -> { id, what } da coleção dona (aliases, fallbackAliases e nome)
  const claim = (key, id, what) => {
    if (!key) { errs.push(`${id}: ${what} vazio após normalização`); return; }
    const prev = owner.get(key);
    if (prev && prev.id !== id) errs.push(`${what} "${key}" de ${id} colide com ${prev.what} de ${prev.id}`);
    else if (!prev) owner.set(key, { id, what });
  };
  const seriesSpelling = new Map(); const prefixSeries = new Map();

  for (const [i, c] of cols.entries()) {
    const id = c?.id;
    const where = typeof id === 'string' && id ? id : `#${i}`;
    for (const k of Object.keys(c || {})) if (!ALLOWED_KEYS.has(k)) errs.push(`${where}: campo desconhecido "${k}"`);
    if (typeof id !== 'string' || !/^[a-z]+[0-9]+(_[0-9]+[a-z]?)?$/.test(id)) errs.push(`${where}: código inválido ${JSON.stringify(id)}`);
    else {
      if (ids.has(id)) errs.push(`${id}: código duplicado`); ids.set(id, c);
      const k = aliasKey(id);
      if (idKeys.has(k) && idKeys.get(k) !== id) errs.push(`${id}: código conflita com ${idKeys.get(k)} após normalização`); idKeys.set(k, id);
    }
    if (isBlank(c?.name)) errs.push(`${where}: nome vazio ou inválido ${JSON.stringify(c?.name)}`);
    else {
      const k = aliasKey(c.name);
      if (names.has(k)) errs.push(`${where}: nome igual ao de ${names.get(k)}`); names.set(k, where);
    }
    if (isBlank(c?.series)) errs.push(`${where}: série vazia ou inválida ${JSON.stringify(c?.series)}`);
    else {
      const sk = aliasKey(c.series);
      if (seriesSpelling.has(sk) && seriesSpelling.get(sk) !== c.series) errs.push(`${where}: série grafada de dois jeitos ("${seriesSpelling.get(sk)}" × "${c.series}")`);
      seriesSpelling.set(sk, c.series);
      const prefix = typeof id === 'string' ? (id.match(/^[a-z]+/) || [''])[0] : '';
      if (prefix) {
        if (prefixSeries.has(prefix) && prefixSeries.get(prefix) !== c.series) errs.push(`${where}: série "${c.series}" diverge das outras coleções "${prefix}*" ("${prefixSeries.get(prefix)}")`);
        else prefixSeries.set(prefix, c.series);
      }
    }
    if (!Array.isArray(c?.aliases)) errs.push(`${where}: aliases ausente (use [] quando não houver)`);
    const lists = [['alias', c?.aliases || []], ['fallbackAlias', c?.fallbackAliases ?? []]];
    if (c && 'fallbackAliases' in c && (!Array.isArray(c.fallbackAliases) || !c.fallbackAliases.length)) errs.push(`${where}: fallbackAliases vazio ou inválido`);
    if (Array.isArray(c?.aliases) && !c.aliases.length && !c.combines) errs.push(`${where}: sem aliases (só coleção combinada pode não ter)`);
    const seen = new Set();
    for (const [what, list] of lists) for (const a of Array.isArray(list) ? list : []) {
      if (isBlank(a)) { errs.push(`${where}: ${what} vazio ou inválido ${JSON.stringify(a)}`); continue; }
      if (normalize(a) !== a) errs.push(`${where}: ${what} "${a}" não está normalizado (esperado "${normalize(a)}") e nunca casaria com o título`);
      if (seen.has(a)) errs.push(`${where}: ${what} "${a}" repetido`); seen.add(a);
      claim(aliasKey(a), where, what);
    }
    if (!isBlank(c?.name)) claim(aliasKey(c.name), where, 'nome');
    for (const key of ['releaseDate']) { const e = checkReleaseDate(c?.[key], now); if (e) errs.push(`${where}: ${e}`); }
  }

  for (const c of cols) {
    if (c?.combines === undefined) continue;
    if (!Array.isArray(c.combines) || c.combines.length < 2) { errs.push(`${c.id}: combines precisa de ao menos duas coleções`); continue; }
    if (new Set(c.combines).size !== c.combines.length) errs.push(`${c.id}: combines repetido`);
    for (const x of c.combines) {
      if (x === c.id) errs.push(`${c.id}: combina a si mesma`);
      else if (!ids.has(x)) errs.push(`${c.id}: combina coleção inexistente ${x}`);
      else if (ids.get(x).combines) errs.push(`${c.id}: combina outra coleção combinada ${x}`);
      else if (ids.get(x).series !== c.series) errs.push(`${c.id}: combina ${x} de outra série`);
    }
  }

  const prodIds = new Set();
  for (const p of catalog.products || []) {
    if (prodIds.has(p.id)) errs.push(`produto ${p.id}: id duplicado`); prodIds.add(p.id);
    if (!ids.has(p.collection)) errs.push(`produto ${p.id}: coleção inexistente ${p.collection}`);
    if (typeof p.id !== 'string' || !p.id.startsWith(`${p.collection}-`)) errs.push(`produto ${p.id}: id não começa pela coleção ${p.collection}`);
  }
  for (const key of Object.keys(catalog.copag || {})) {
    const col = key.split('-')[0];
    if (!ids.has(col)) errs.push(`preço Copag ${key}: coleção inexistente ${col}`);
  }
  return errs;
}

const catalog = JSON.parse(fs.readFileSync(new URL('../config/catalog.json', import.meta.url), 'utf8'));
const NOW = new Date('2026-10-10T00:00:00Z');
const base = () => ({ collections: [
  { id: 'sv8', name: 'Fagulhas Impetuosas', series: 'Escarlate e Violeta', aliases: ['fagulhas impetuosas', 'sv8'] },
  { id: 'sv8_5', name: 'Evoluções Prismáticas', series: 'Escarlate e Violeta', aliases: ['evolucoes prismaticas', 'sv8.5'] },
] });
const fails = (cat, re) => { const e = auditCollections(cat, { now: NOW }); assert.ok(e.some((x) => re.test(x)), `esperava erro ${re} — veio ${JSON.stringify(e)}`); };

t('config/catalog.json: metadados de coleção íntegros', () => {
  assert.deepEqual(auditCollections(catalog), []);
  assert.ok(catalog.collections.length >= 20, 'catálogo de coleções não pode encolher por acidente');
});

t('dados reais: datas de lançamento ausentes ficam ausentes (sem string vazia/placeholder)', () => {
  for (const c of catalog.collections) {
    for (const k of ['releaseDate', 'release_date', 'release', 'lancamento', 'launch']) if (k in c) assert.ok(k === 'releaseDate' && (c[k] === null || /^\d{4}-\d{2}-\d{2}$/.test(c[k])), `${c.id}.${k}=${JSON.stringify(c[k])}`);
  }
});

t('base sintética íntegra passa', () => assert.deepEqual(auditCollections(base(), { now: NOW }), []));

t('códigos duplicados ou conflitantes', () => {
  const dup = base(); dup.collections[1].id = 'sv8'; fails(dup, /código duplicado/);
  const conf = base(); conf.collections.push({ id: 'sv85', name: 'Outra', series: 'Escarlate e Violeta', aliases: ['outra'] }); fails(conf, /conflita com sv8_5/);
  const bad = base(); bad.collections[0].id = 'SV 8'; fails(bad, /código inválido/);
});

t('alias apontando para duas coleções (inclusive só por acento, espaço ou pontuação)', () => {
  const a = base(); a.collections[1].aliases.push('sv8'); fails(a, /alias "sv8" de sv8_5 colide com alias de sv8$/);
  const b = base(); b.collections[1].aliases.push('fagulhas-impetuosas'); fails(b, /alias "fagulhasimpetuosas" de sv8_5 colide com alias de sv8$/);
  const e = base(); e.collections[1].aliases.push('Fagulhas Impetuosas'); fails(e, /não está normalizado/); fails(e, /de sv8_5 colide com alias de sv8$/);
  const c = base(); c.collections[0].aliases.push('sv8.5'); fails(c, /alias "sv85" de sv8_5 colide com alias de sv8$/);
  const d = base(); d.collections[0].fallbackAliases = ['evolucoes prismaticas']; fails(d, /colide com fallbackAlias de sv8$/);
});

t('alias igual ao nome de outra coleção', () => {
  const a = base(); a.collections[0].aliases.push('evolucoes prismaticas'); fails(a, /nome "evolucoesprismaticas" de sv8_5 colide com alias de sv8$/);
  const b = base(); b.collections.push({ id: 'sv9', name: 'Fagulhas Impetuosas', series: 'Escarlate e Violeta', aliases: ['amigos de jornada'] }); fails(b, /nome igual ao de sv8/);
});

t('nomes parecidos NÃO são mesclados: coleções distintas convivem com aliases próprios', () => {
  const cat = { collections: [
    { id: 'sv2', name: 'Evoluções em Paldea', series: 'Escarlate e Violeta', aliases: ['evolucoes em paldea'] },
    { id: 'sv8_5', name: 'Evoluções Prismáticas', series: 'Escarlate e Violeta', aliases: ['evolucoes prismaticas'] },
  ] };
  assert.deepEqual(auditCollections(cat, { now: NOW }), []);
  cat.collections[1].aliases.push('evolucoes'); cat.collections[0].aliases.push('evolucoes'); fails(cat, /alias "evolucoes" de sv8_5 colide com alias de sv2$/);
});

t('campos obrigatórios vazios, com espaço sobrando ou placeholder', () => {
  for (const [field, v, re] of [['name', '', /nome vazio/], ['name', ' Fagulhas Impetuosas', /nome vazio/], ['name', 'Fagulhas  Impetuosas', /nome vazio/], ['name', 'TBD', /nome vazio/],
    ['series', undefined, /série vazia/], ['series', '-', /série vazia/], ['aliases', undefined, /aliases ausente/], ['aliases', [], /sem aliases/]]) {
    const c = base(); c.collections[0][field] = v; fails(c, re);
  }
  const a = base(); a.collections[0].aliases.push(''); fails(a, /alias vazio/);
  const b = base(); b.collections[0].aliases.push('fagulhas  impetuosas'); fails(b, /alias vazio/);
  const r = base(); r.collections[0].aliases.push('sv8'); fails(r, /repetido/);
  const u = base(); u.collections[0].aliases.push('Fagulhas Impetuosas!'); fails(u, /não está normalizado/);
  const f = base(); f.collections[0].fallbackAliases = []; fails(f, /fallbackAliases vazio/);
  const k = base(); k.collections[0].lancamento = '2024-11-08'; fails(k, /campo desconhecido "lancamento"/);
});

t('data de lançamento: ausente ok; ISO válida ok; vazia, placeholder, inválida ou futura demais falham', () => {
  for (const ok of [undefined, null, '2024-11-08', '2027-06-30']) { const c = base(); c.collections[0].releaseDate = ok; assert.deepEqual(auditCollections(c, { now: NOW }), [], String(ok)); }
  for (const [v, re] of [['', /formato ISO/], ['TBD', /formato ISO/], ['0000-00-00', /inexistente/], ['2024-02-30', /inexistente/], ['08/11/2024', /formato ISO/],
    ['2024-11', /formato ISO/], ['2024-11-08T00:00:00Z', /formato ISO/], [20241108, /formato ISO/], ['2028-01-01', /no futuro/], ['1990-01-01', /anterior/]]) {
    const c = base(); c.collections[0].releaseDate = v; fails(c, re);
  }
});

t('séries coerentes', () => {
  const a = base(); a.collections[1].series = 'Escarlate & Violeta'; fails(a, /diverge/);
  const b = base(); b.collections[1].series = 'escarlate e violeta'; fails(b, /grafada de dois jeitos/);
});

t('coleção combinada: só referencia coleções reais, da mesma série', () => {
  const ok = base(); ok.collections.push({ id: 'sv8_9', name: 'Combo', series: 'Escarlate e Violeta', aliases: [], combines: ['sv8', 'sv8_5'] });
  assert.deepEqual(auditCollections(ok, { now: NOW }), []);
  const miss = base(); miss.collections.push({ id: 'sv8_9', name: 'Combo', series: 'Escarlate e Violeta', aliases: [], combines: ['sv8', 'sv99'] }); fails(miss, /inexistente sv99/);
  const one = base(); one.collections.push({ id: 'sv8_9', name: 'Combo', series: 'Escarlate e Violeta', aliases: [], combines: ['sv8'] }); fails(one, /ao menos duas/);
});

t('produtos e preços Copag só apontam para coleções existentes', () => {
  const p = base(); p.products = [{ id: 'sv7-etb', collection: 'sv7' }]; fails(p, /coleção inexistente sv7/);
  const q = base(); q.copag = { 'sv7-etb': { msrp: 1 } }; fails(q, /preço Copag sv7-etb/);
});

console.log(`✓ Metadados de coleção (catalog.json): ${n} grupos de testes passaram`);
