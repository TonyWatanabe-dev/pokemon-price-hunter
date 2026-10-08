// Segurança de deploy (lição do incidente da Fase 5.6): tudo que a função da Vercel importa precisa estar no bundle.
// Varre api/**: todo import relativo (estático ou dinâmico) tem de existir e não pode cair em pasta/arquivo do .vercelignore.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('..', import.meta.url).pathname);
const ignore = fs.readFileSync(path.join(root, '.vercelignore'), 'utf8').split('\n').map((l) => l.trim()).filter((l) => l && !l.startsWith('#'));
const toRe = (g) => new RegExp('^' + g.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '[^/]*') + (g.endsWith('/') ? '' : '$'));
const ignored = (rel) => ignore.some((g) => (g.endsWith('/') ? rel.startsWith(g) : toRe(g).test(rel) || toRe(g).test(path.basename(rel))));
const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : /\.m?js$/.test(e.name) ? [path.join(d, e.name)] : []));

const files = walk(path.join(root, 'api')); const seen = new Set(); const problems = [];
const visit = (f) => {
  if (seen.has(f)) return; seen.add(f);
  const src = fs.readFileSync(f, 'utf8');
  const specs = [...src.matchAll(/(?:import|export)\s[^'"]*?from\s+['"](\.{1,2}\/[^'"]+)['"]/g), ...src.matchAll(/import\(\s*['"](\.{1,2}\/[^'"]+)['"]\s*\)/g)].map((m) => m[1]);
  for (const s of specs) {
    const target = path.resolve(path.dirname(f), s); const rel = path.relative(root, target);
    if (!fs.existsSync(target)) problems.push(`${path.relative(root, f)} → ${s} (não existe)`);
    else if (rel.startsWith('..') || ignored(rel)) problems.push(`${path.relative(root, f)} → ${s} (fora do bundle: ${rel})`);
    else if (/\.m?js$/.test(target)) visit(target);
  }
};
for (const f of files) visit(f);
assert.deepEqual(problems, [], 'imports fora do bundle da Vercel:\n' + problems.join('\n'));
assert.ok(ignored('src/core/x.js') && ignored('tools/a.mjs') && !ignored('api/_lib/references.mjs'), 'leitura do .vercelignore');
console.log(`OK — segurança de deploy: ${seen.size} módulos da API, todos dentro do bundle`);
