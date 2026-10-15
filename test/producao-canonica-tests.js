// Fonte canônica de produção (docs/producao-canonica.md, Fase 8): o documento acompanha o código.
// Estático, sem rede: confere que o domínio declarado bate com o SITE do código e dos smokes, que nenhum workflow
// publica na Vercel ou no Pages por fora do caminho documentado e que o vercel.json citado (região) é o real.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => fs.readFileSync(path.join(root, f), 'utf8');
const doc = read('docs/producao-canonica.md');
const { SITE } = await import('../api/_seo.mjs');
const { SITE: SMOKE_SITE } = await import('../tools/seo-public-smoke.mjs');
const vercel = JSON.parse(read('vercel.json'));

// 1) Domínio canônico do código = o do smoke = o citado no documento.
assert.equal(SMOKE_SITE, SITE, 'smoke e SEO usam o mesmo domínio');
assert.ok(doc.includes('`' + SITE + '`'), 'docs/producao-canonica.md precisa citar o SITE atual: ' + SITE);
assert.ok(read('robots.txt').includes(`Sitemap: ${SITE}/sitemap.xml`), 'robots.txt anuncia o sitemap no SITE');

// 2) Região e projeto citados existem no vercel.json.
for (const r of vercel.regions || []) assert.ok(doc.includes('`' + r + '`'), 'documento cita a região ' + r);
assert.match(doc, /projeto `tcg-price-hunter`/);

// 3) Nenhum workflow publica na Vercel nem usa deploy de Pages por workflow: o deploy real é a integração Git da Vercel
//    (documentada) e o caminho com gates é tools/release-run.mjs. Se isso mudar, o documento precisa mudar junto.
const wfDir = path.join(root, '.github/workflows');
for (const f of fs.readdirSync(wfDir).filter((x) => /\.ya?ml$/.test(x))) {
  const y = fs.readFileSync(path.join(wfDir, f), 'utf8');
  assert.doesNotMatch(y, /\bvercel\s+(deploy|--prod|promote|rollback)\b|amondnet\/vercel-action|actions\/deploy-pages|VERCEL_TOKEN/i, `${f}: deploy por workflow não documentado em docs/producao-canonica.md`);
}

// 4) O documento registra o estado e as decisões pendentes (não declara o critério como atendido).
assert.match(doc, /GitHub Pages[\s\S]*Não canônico/);
assert.match(doc, /\*\*não atendido\*\*/, 'critério "deploy só pelo merge" segue não atendido até decisão do proprietário');
assert.match(read('docs/checklist-release.md'), /Merge na `main` publica em produção/, 'checklist e documento descrevem o mesmo pipeline');

console.log('producao-canonica: documento coerente com SITE, vercel.json e workflows');
