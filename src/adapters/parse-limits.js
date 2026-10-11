// Limites de tamanho para o parsing de páginas de loja (issue #106). Funções puras: não fazem rede, não lançam
// exceção com entrada hostil e não dependem de estado global além dos tetos lidos do ambiente.
//
// Espelham a semântica atual de src/adapters/jsonld.js (mesma extração, mesma ordem, mesmos nós), com tetos:
//   - extractJsonLdBlocks  ↔ html.matchAll(/<script[^>]+application\/ld\+json[^>]*>([\s\S]*?)<\/script>/gi) + raw.trim()
//   - parseJsonSafe        ↔ try { JSON.parse(raw.trim()) } catch { /* JSON-LD inválido */ }
//   - flattenLimited       ↔ flatten(node, acc)  (arrays e @graph, na mesma ordem)
//   - jsonLdNodes          ↔ o laço de parseProductPage que monta `nodes`
//   - extractLsVariants    ↔ html.match(/LS\.variants\s*=\s*(\[[\s\S]*?\]);\s*\n/)?.[1] + JSON.parse
//   - clampText            ↔ título / SKU / EAN, hoje sem limite
// O limite de bytes do corpo HTTP inteiro é outro assunto (PR #127, src/http.js); aqui o teto é por bloco/campo.
//
// Tetos padrão (ajustáveis por variável de ambiente, como os demais HUNTER_*). A maior entrada das fixtures do
// repositório (test/run-tests.js e test/collectors-tests.js) fica bem abaixo de cada teto: 100x para bytes de
// bloco, nós e LS.variants; 10x para quantidade de blocos; 3x para título; 4x para SKU/EAN.
// test/parse-limits-tests.js mede as fixtures e confere essas margens.
export const DEFAULT_LIMITS = Object.freeze({
  // Bloco ld+json: fixtures têm até ~0,4 KB; Product com avaliações e muitas ofertas raramente passa de 50 KB.
  jsonLdMaxBlockBytes: 256 * 1024, // HUNTER_JSONLD_MAX_BLOCK_BYTES
  // Blocos por página: fixtures têm até 2; lojas reais usam 2–6 (Organization, WebSite, BreadcrumbList, Product...).
  jsonLdMaxBlocks: 32, // HUNTER_JSONLD_MAX_BLOCKS
  // Nós achatados por página (somando todos os blocos): fixtures têm até 2; @graph do Yoast/WooCommerce tem ~10.
  jsonLdMaxNodes: 1000, // HUNTER_JSONLD_MAX_NODES
  // Profundidade de arrays/@graph aninhados: fixtures têm 0–1; schema.org real não passa de 2–3.
  jsonLdMaxDepth: 16, // HUNTER_JSONLD_MAX_DEPTH
  // LS.variants da Nuvemshop: fixture tem ~0,25 KB; ~0,5 KB por variação, então 512 KB comporta ~1000 variações.
  nsVariantsMaxBytes: 512 * 1024, // HUNTER_NS_VARIANTS_MAX_BYTES
  // Título: fixtures têm até ~90 caracteres; título de produto real fica abaixo de 200.
  titleMaxChars: 300, // HUNTER_TITLE_MAX_CHARS
  // SKU/EAN: fixture 'ME04-04'; EAN-13 tem 13 dígitos, GTIN-14 tem 14.
  codeMaxChars: 64, // HUNTER_CODE_MAX_CHARS
});

const ENV_KEYS = Object.freeze({
  jsonLdMaxBlockBytes: 'HUNTER_JSONLD_MAX_BLOCK_BYTES',
  jsonLdMaxBlocks: 'HUNTER_JSONLD_MAX_BLOCKS',
  jsonLdMaxNodes: 'HUNTER_JSONLD_MAX_NODES',
  jsonLdMaxDepth: 'HUNTER_JSONLD_MAX_DEPTH',
  nsVariantsMaxBytes: 'HUNTER_NS_VARIANTS_MAX_BYTES',
  titleMaxChars: 'HUNTER_TITLE_MAX_CHARS',
  codeMaxChars: 'HUNTER_CODE_MAX_CHARS',
});

/**
 * Tetos efetivos: padrão + variáveis de ambiente HUNTER_* (inteiro positivo; valor inválido é ignorado) + `overrides`.
 * Lido a cada chamada, para que testes e o ciclo possam ajustar sem reimportar o módulo.
 */
export function parseLimits(overrides = {}, env = process.env) {
  const out = { ...DEFAULT_LIMITS };
  for (const [k, name] of Object.entries(ENV_KEYS)) {
    const v = Number(env?.[name]);
    if (Number.isInteger(v) && v > 0) out[k] = v;
  }
  for (const [k, v] of Object.entries(overrides || {})) if (k in out && Number.isInteger(v) && v > 0) out[k] = v;
  return out;
}

const SCRIPT_OPEN = /<script/gi;
const SCRIPT_CLOSE = /<\/script>/gi;
const bytes = (s) => Buffer.byteLength(s, 'utf8');

/**
 * Blocos <script ... application/ld+json ...> da página, já com trim(), na ordem em que aparecem.
 * Mesma regra de casamento de jsonld.js, mas por varredura linear (sem regex com [\s\S]*? sobre a página inteira).
 * Bloco acima de jsonLdMaxBlockBytes é descartado; depois de jsonLdMaxBlocks blocos a varredura para.
 * @returns {{ blocks: string[], dropped: { tooLarge: number, tooMany: boolean } }}
 */
export function extractJsonLdBlocks(html, limits = {}) {
  const L = parseLimits(limits);
  const blocks = []; const dropped = { tooLarge: 0, tooMany: false };
  if (typeof html !== 'string') return { blocks, dropped };
  const open = new RegExp(SCRIPT_OPEN.source, 'gi'); const close = new RegExp(SCRIPT_CLOSE.source, 'gi');
  let seen = 0;
  for (let m = open.exec(html); m; m = open.exec(html)) {
    const attrStart = m.index + m[0].length;
    const tagEnd = html.indexOf('>', attrStart);
    if (tagEnd < 0) break; // tag não fecha: nada mais casa
    const attrs = html.slice(attrStart, tagEnd);
    if (!attrs.length || !attrs.toLowerCase().includes('application/ld+json')) { open.lastIndex = attrStart; continue; }
    close.lastIndex = tagEnd + 1;
    const c = close.exec(html);
    if (!c) break; // sem </script>: o regex original também não casa (nem este nem os seguintes)
    if (seen >= L.jsonLdMaxBlocks) { dropped.tooMany = true; break; }
    seen++;
    const raw = html.slice(tagEnd + 1, c.index);
    if (bytes(raw) > L.jsonLdMaxBlockBytes) dropped.tooLarge++;
    else blocks.push(raw.trim());
    open.lastIndex = c.index + c[0].length;
  }
  return { blocks, dropped };
}

/**
 * JSON.parse que nunca lança: texto inválido, vazio, não-string ou acima de `maxBytes` → null.
 * (JSON válido "null" também dá null, como no fluxo atual, onde flatten(null) não acrescenta nada.)
 */
export function parseJsonSafe(text, maxBytes = Infinity) {
  if (typeof text !== 'string') return null;
  if (Number.isFinite(maxBytes) && bytes(text) > maxBytes) return null;
  try { return JSON.parse(text.trim()); } catch { return null; }
}

/**
 * Achata JSON-LD como o flatten de jsonld.js: array → cada item; objeto → entra na lista e desce em @graph.
 * Para em jsonLdMaxNodes nós (contando o que já está em `acc`), não desce além de jsonLdMaxDepth níveis
 * e não visita o mesmo objeto/array duas vezes (protege contra ciclos em objetos montados em memória).
 * Um orçamento de visitas (10x o teto de nós) também corta arrays enormes de valores que não são objetos.
 * @param {*} node  raiz (resultado de parseJsonSafe)
 * @param {object[]} acc  lista de saída (mutada e devolvida, como no flatten original)
 * @param {object} limits  sobrescreve os tetos; `limits.stats`, se passado, recebe { truncated, tooDeep, cycles }
 */
export function flattenLimited(node, acc = [], limits = {}) {
  const L = parseLimits(limits);
  const stats = limits?.stats || {};
  stats.truncated ??= false; stats.tooDeep ??= 0; stats.cycles ??= 0;
  const seen = new WeakSet();
  let budget = L.jsonLdMaxNodes * 10;
  const walk = (n, depth) => {
    if (acc.length >= L.jsonLdMaxNodes || budget <= 0) { stats.truncated = true; return; }
    budget--;
    if (!n || typeof n !== 'object') return;
    if (seen.has(n)) { stats.cycles++; return; }
    seen.add(n);
    if (Array.isArray(n)) {
      if (depth >= L.jsonLdMaxDepth) { stats.tooDeep++; return; }
      for (let i = 0; i < n.length; i++) {
        if (acc.length >= L.jsonLdMaxNodes || budget <= 0) { stats.truncated = true; break; }
        walk(n[i], depth + 1);
      }
      return;
    }
    acc.push(n);
    let g;
    try { g = n['@graph']; } catch { return; } // getter hostil em objeto de memória
    if (g) {
      if (depth >= L.jsonLdMaxDepth) { stats.tooDeep++; return; }
      walk(g, depth + 1);
    }
  };
  walk(node, 0);
  return acc;
}

/**
 * Todos os nós JSON-LD da página, como o `nodes` de parseProductPage, com todos os tetos aplicados.
 * @returns {{ nodes: object[], stats: { blocks: number, tooLarge: number, tooMany: boolean, invalid: number, truncated: boolean, tooDeep: number, cycles: number } }}
 */
export function jsonLdNodes(html, limits = {}) {
  const L = parseLimits(limits);
  const { blocks, dropped } = extractJsonLdBlocks(html, L);
  const stats = { blocks: blocks.length, tooLarge: dropped.tooLarge, tooMany: dropped.tooMany, invalid: 0, truncated: false, tooDeep: 0, cycles: 0 };
  const nodes = [];
  for (let i = 0; i < blocks.length; i++) {
    if (nodes.length >= L.jsonLdMaxNodes) { stats.truncated = true; break; }
    let v;
    try { v = JSON.parse(blocks[i]); } catch { stats.invalid++; continue; } // JSON-LD inválido
    flattenLimited(v, nodes, { ...L, stats });
  }
  return { nodes, stats };
}

/**
 * Corta texto (título, SKU, EAN) em `maxChars` unidades sem partir um par substituto UTF-16 (emoji, CJK raro).
 * String dentro do limite volta idêntica; null/undefined, números e outros tipos voltam como vieram.
 */
export function clampText(value, maxChars) {
  if (typeof value !== 'string') return value;
  if (!(Number.isInteger(maxChars) && maxChars >= 0) || value.length <= maxChars) return value;
  let s = value.slice(0, maxChars);
  const last = s.charCodeAt(s.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) s = s.slice(0, -1); // metade alta de um par: descarta
  return s;
}
export const clampTitle = (value, limits = {}) => clampText(value, parseLimits(limits).titleMaxChars);
export const clampCode = (value, limits = {}) => clampText(value, parseLimits(limits).codeMaxChars);

const LS_VARIANTS = /LS\.variants\s*=\s*\[/g;
const WS = /\s/;

/**
 * Trecho cru de `LS.variants = [...];` seguido de quebra de linha (Nuvemshop), igual ao regex de jsonld.js
 * (o primeiro "];" cujo espaço em branco seguinte contém "\n"), mas com varredura limitada a nsVariantsMaxBytes:
 * trecho maior que o teto ou sem terminador dentro dele não é lido.
 * Só a primeira ocorrência importa: qualquer terminador depois de uma ocorrência posterior também está depois da
 * primeira, então o regex original sempre casa a partir da primeira (ou não casa).
 * @returns {string|null}
 */
export function extractLsVariantsRaw(html, limits = {}) {
  if (typeof html !== 'string') return null;
  const L = parseLimits(limits);
  const m = new RegExp(LS_VARIANTS.source, 'g').exec(html);
  if (!m) return null;
  const start = m.index + m[0].length - 1; // posição do "["
  // Bytes UTF-8 >= caracteres: terminador além desta janela já daria trecho acima do teto.
  const limit = Math.min(html.length, start + L.nsVariantsMaxBytes);
  for (let j = html.indexOf('];', start + 1); j >= 0 && j < limit; j = html.indexOf('];', j + 2)) {
    let nl = false;
    for (let k = j + 2; k < html.length && WS.test(html[k]); k++) if (html[k] === '\n') { nl = true; break; }
    if (!nl) continue;
    const raw = html.slice(start, j + 1);
    return bytes(raw) > L.nsVariantsMaxBytes ? null : raw;
  }
  return null;
}

/** Variações da Nuvemshop (array) ou null: trecho ausente, acima do teto, truncado ou com JSON inválido. */
export function extractLsVariants(html, limits = {}) {
  const raw = extractLsVariantsRaw(html, limits);
  const v = raw == null ? null : parseJsonSafe(raw);
  return Array.isArray(v) ? v : null;
}
