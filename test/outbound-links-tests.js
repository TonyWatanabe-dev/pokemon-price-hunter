// Issue #116 — links de saída: regressão de safeUrl, rel seguro em target="_blank" e nenhum parâmetro de tracking
// anexado a URLs de compra. Roda o código real de index.html e de tools/page.template.html (cada um separado:
// os dois arquivos ainda podem divergir, issue #98) e faz uma busca estática em src/, api/ e nas duas páginas.
// Sem rede e sem banco.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const PAGES = ['index.html', 'tools/page.template.html'];
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
let n = 0;
const t = (name, fn) => { try { fn(); } catch (e) { e.message = `${name}: ${e.message}`; throw e; } n++; };

// ------------------------------------------------------------------ 1. safeUrl (a função real de cada página)
const oneLine = (src, file, name) => {
  const m = src.match(new RegExp(`^const ${name}\\s*=.*$`, 'm'));
  assert.ok(m, `${file}: definição de ${name} não encontrada (mudou de forma? atualize o teste)`);
  return m[0];
};
const loadPage = (file) => {
  const src = read(file); const ctx = { String, RegExp };
  vm.createContext(ctx);
  vm.runInContext(`${oneLine(src, file, 'esc')}\n${oneLine(src, file, 'safeUrl')}\n;globalThis.__t={esc,safeUrl};`, ctx);
  return { src, ...ctx.__t };
};
// o que o navegador lê de volta num atributo escapado por esc()
const unesc = (s) => s.replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');

const KEEP = [ // URL externa http(s): sai exatamente igual (query e fragmento da loja preservados, nada anexado)
  'https://www.loja.com.br/produto/etb-caos-ascendente',
  'http://loja.com.br/p/123',
  'https://www.loja.com.br/p/etb?skuId=987&variant=azul&qty=1#avaliacoes',
  'https://produto.mercadolivre.com.br/MLB-123456789-booster-box-_JM#position=1&search_layout=grid',
  'HTTPS://LOJA.COM.BR/Caixa?Cor=Azul',
  'https://loja.com.br/busca?q=pok%C3%A9mon%20tcg&ordem=pre%C3%A7o',
  "https://loja.com.br/p?nome=o'brien&x=<y>&z=\"w\"",
  'https://loja.com.br:8443/p/1',
  'https://[2001:db8::1]/p',
];
const BLOCK = [ // tudo que não começa com http(s):// vira "#"
  'javascript:alert(1)', 'JaVaScRiPt:alert(1)', 'JAVASCRIPT:alert(document.cookie)', '  javascript:alert(1)', '\tjavascript:alert(1)',
  '\n javascript:alert(1)', "javascript:alert('https://loja.com.br')", 'javascript://https://loja.com.br/%0aalert(1)',
  'java\nscript:alert(1)', 'java\tscript:alert(1)', '&#106;avascript:alert(1)',
  'data:text/html,<script>alert(1)</script>', 'DATA:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==', ' data:image/svg+xml,<svg onload=alert(1)>',
  'vbscript:msgbox(1)', 'VbScRiPt:msgbox(1)', 'file:///etc/passwd', 'ftp://loja.com.br/x', 'mailto:a@b.c', 'blob:https://loja.com.br/uuid',
  '/produto/etb', 'produto/etb', './x', '../x', '?utm_source=x', '#topo', '//loja.com.br/p', '\\\\loja.com.br\\p',
  'loja.com.br/p', 'www.loja.com.br/p', 'https:loja.com.br', 'https:/loja.com.br', 'http//loja.com.br', 'https', 'hxxps://loja.com.br',
  '', '   ', '\n', null, undefined, 0, 123, false, true, NaN, {}, [], ['javascript:alert(1)'], { toString: () => 'javascript:alert(1)' },
];

for (const file of PAGES) {
  const { esc, safeUrl } = loadPage(file);
  t(`${file}: URL http(s) externa preservada`, () => {
    for (const u of KEEP) {
      assert.equal(safeUrl(u), u, `${file}: ${u} mudou`);
      assert.equal(unesc(esc(safeUrl(u))), u, `${file}: o href final (esc(safeUrl(u))) não devolve a URL da loja: ${u}`);
    }
  });
  t(`${file}: espaços nas pontas são só aparados`, () => {
    assert.equal(safeUrl('  https://loja.com.br/p?a=1#b  '), 'https://loja.com.br/p?a=1#b');
    assert.equal(safeUrl('\nhttp://loja.com.br/p\t'), 'http://loja.com.br/p');
  });
  t(`${file}: esquemas perigosos, relativas e vazias viram "#"`, () => {
    for (const u of BLOCK) assert.equal(safeUrl(u), '#', `${file}: ${JSON.stringify(String(u))} deveria virar "#"`);
  });
  t(`${file}: saída é sempre "#" ou http(s)://`, () => {
    for (const u of [...KEEP, ...BLOCK]) { const out = safeUrl(u); assert.ok(out === '#' || /^https?:\/\//i.test(out), `${file}: ${out}`); }
  });
  t(`${file}: não anexa nada a URL que já traga parâmetros da própria loja`, () => {
    const u = 'https://loja.com.br/p?ref=loja-interna&tag=etb#x'; // vieram da loja: o site não acrescenta nem tira
    assert.equal(safeUrl(u), u);
  });
}

// ------------------------------------------------------------------ 2. target="_blank" sempre com rel contendo noopener
// Acha o fim da tag pulando ${...} (os templates usam crases), para não cortar a tag num ">" de uma expressão.
const tagAround = (src, i) => {
  const start = src.lastIndexOf('<', i); let depth = 0;
  for (let j = i; j < src.length; j++) {
    if (src[j] === '$' && src[j + 1] === '{') { depth++; j++; } else if (src[j] === '{' && depth) depth++;
    else if (src[j] === '}' && depth) depth--; else if (src[j] === '>' && !depth) return src.slice(start, j + 1);
  }
  assert.fail(`tag sem fim na posição ${i}`);
};
const BLANK = /target\s*=\s*(["']?)_blank\1/gi;
for (const file of PAGES) {
  const src = read(file);
  t(`${file}: todo target="_blank" tem rel com noopener`, () => {
    const tags = [...src.matchAll(BLANK)].map((m) => tagAround(src, m.index));
    assert.ok(tags.length >= 10, `${file}: só ${tags.length} target="_blank" (a busca parou de achar os links?)`);
    for (const tag of tags) {
      assert.match(tag, /^<a\b/i, `${file}: target="_blank" fora de <a>: ${tag}`);
      const rel = tag.match(/\brel\s*=\s*"([^"]*)"|\brel\s*=\s*'([^']*)'/i);
      assert.ok(rel, `${file}: sem rel: ${tag}`);
      assert.ok((rel[1] ?? rel[2]).toLowerCase().split(/\s+/).includes('noopener'), `${file}: rel sem noopener: ${tag}`);
    }
  });
  t(`${file}: link externo em nova aba passa por safeUrl sem nada anexado; interno é caminho fixo do site`, () => {
    for (const m of src.matchAll(BLANK)) {
      const tag = tagAround(src, m.index); const href = tag.match(/\bhref="([^"]*)"/)?.[1];
      assert.ok(href != null, `${file}: sem href: ${tag}`);
      assert.ok(/^\$\{esc\(safeUrl\([\w.?]+\)\)\}$/.test(href) || /^\/[a-z0-9/-]*$/.test(href), `${file}: href fora do padrão: ${href}`);
    }
  });
  t(`${file}: nenhuma nova aba aberta por script sem noopener`, () => {
    for (const m of src.matchAll(/window\.open\s*\(([^)]*)\)/g)) assert.match(m[1], /noopener/, `${file}: ${m[0]}`);
  });
}

// ------------------------------------------------------------------ 3. nenhum parâmetro de tracking/afiliado anexado
const NAMES = 'utm_[a-z0-9_]*|gclid|gbraid|wbraid|fbclid|msclkid|dclid|yclid|igshid|mc_cid|mc_eid|ref|ref_src|referrer|tag|aff|aff_id|affid|affiliate|affiliate_id|afiliado|partner|partner_id|cmpid|campaign|irclickid|clickid|subid|sub_id';
const RULES = [
  // ?utm_source=  &tag=  "ref=  — par nome=valor de tracking montado num literal (URL, string ou template)
  { id: 'query-literal', re: new RegExp(`[?&'"\`](?:${NAMES})=`, 'i') },
  // url.searchParams.set('utm_source', …) / .append('tag', …)
  { id: 'searchParams', re: new RegExp(`searchParams\\s*\\.\\s*(?:set|append)\\s*\\(\\s*['"\`](?:${NAMES})['"\`]`, 'i') },
  // new URLSearchParams({ utm_source: … }) / { gclid: … }
  { id: 'objeto-params', re: /(?:^|[{,\s])['"]?(?:utm_[a-z0-9_]+|gclid|fbclid|msclkid)['"]?\s*:/i },
  // variável/campo de link de afiliado: affiliateUrl, affiliate_tag, afiliadoLink…
  { id: 'id-afiliado', re: /(?:affiliate|afiliad[oa])[_-]?(?:url|link|tag|id|code|codigo|param)/i },
];
// Exceções justificadas (arquivo + trecho exato + motivo). Hoje vazia: os únicos "afiliado" no código são o aviso legal
// ("não é afiliado à Nintendo…"), comentários ("sem afiliado") e a categoria de revisão 'affiliate_missing' — nenhum
// deles casa com as regras acima, que só pegam montagem de URL/parâmetro.
const ALLOW = [];
const scan = (text) => {
  const hits = [];
  text.split('\n').forEach((line, i) => { for (const r of RULES) if (r.re.test(line)) hits.push({ line: i + 1, rule: r.id, text: line.trim().slice(0, 160) }); });
  return hits;
};
const walk = (dir) => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((d) => {
  const rel = `${dir}/${d.name}`; if (d.isDirectory()) return walk(rel);
  return /\.(m?js|cjs|html)$/.test(d.name) ? [rel] : [];
});

t('detector acha montagem de tracking (controle positivo)', () => {
  const bad = [
    'return url + "?utm_source=hunter&utm_medium=site";', 'href="${esc(safeUrl(o.url))}&tag=hunter-20"', "const u = o.url + '&ref=tcg';",
    "u.searchParams.set('utm_campaign', 'x');", 'url.searchParams.append("tag", AMZ);', 'new URLSearchParams({ utm_source: "x" })',
    'const affiliateUrl = buildLink(o);', 'p.afiliado_link', '`${u}?gclid=${id}`', "x + 'fbclid=1'",
  ];
  for (const s of bad) assert.ok(scan(s).length, `não detectou: ${s}`);
  const ok = [ // falsos positivos que não podem disparar
    '<a href="/termos" target="_blank" rel="noopener">', 'O TCG Price Hunter não é afiliado à Nintendo', "'affiliate_missing'",
    'const TRACKING = /^(utm_[a-z0-9_]+|gclid|fbclid|ref|tag)$/i;', "url.searchParams.delete('utm_source')", 'const href="/produto/"+slug;',
    'data-ref="x" data-tag="y"', 'fetch(`/api/v1/oportunidades?ordem=score&limite=15`)',
  ];
  for (const s of ok) assert.deepEqual(scan(s), [], `falso positivo: ${s}`);
});

t('src/, api/ e as páginas não anexam parâmetros de tracking a URLs', () => {
  const files = [...walk('src'), ...walk('api'), ...PAGES];
  assert.ok(files.length > 20 && files.includes('src/run.js') && files.some((f) => f.startsWith('api/')), `arquivos varridos: ${files.length}`);
  const found = [];
  for (const f of files) for (const h of scan(read(f))) if (!ALLOW.some((a) => a.file === f && h.text.includes(a.snippet))) found.push(`${f}:${h.line} [${h.rule}] ${h.text}`);
  assert.deepEqual(found, [], `parâmetro de tracking/afiliado anexado (se for falso positivo, justifique em ALLOW):\n${found.join('\n')}`);
  for (const a of ALLOW) assert.ok(scan(read(a.file)).some((h) => h.text.includes(a.snippet)), `exceção sem uso: ${a.file} ${a.snippet}`);
});

console.log(`✓ Links de saída (#116): ${n} grupos passaram (safeUrl real de ${PAGES.length} páginas, rel noopener, sem tracking)`);
