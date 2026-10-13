// Afiliado isolado do ranking: nenhum arquivo de src/, api/_lib/ (exceto affiliates.mjs) ou tools/ lê a
// configuração de afiliados (config/afiliados*, config/affiliates*, amazon.json) nem monta "tag=". Falha se uma
// leitura for acrescentada, por exemplo, em api/_lib/offer-rank.mjs. Comentários são ignorados. Sem rede e sem banco.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const EXT = /\.(?:m?js|cjs)$/;
const PROIBIDOS = [
  [/config\/(?:afiliados|affiliates)/i, 'leitura de config/afiliados* ou config/affiliates*'],
  [/amazon\.json/i, 'leitura de amazon.json'],
  [/afiliados-amazon/i, 'leitura da cópia pública afiliados-amazon'],
  [/\btag=/, 'montagem de tag='],
];
const EXCECOES = new Set(['api/_lib/affiliates.mjs']);

const listar = (dir) => fs.readdirSync(path.join(ROOT, dir), { withFileTypes: true }).flatMap((e) => {
  const rel = `${dir}/${e.name}`;
  if (e.isDirectory()) return listar(rel);
  return EXT.test(e.name) ? [rel] : [];
});
const semComentarios = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:\\'"`])\/\/.*$/gm, '$1');

const arquivos = ['src', 'api/_lib', 'tools'].flatMap(listar).filter((f) => !EXCECOES.has(f));
assert.ok(arquivos.length > 20, 'varredura deve cobrir src/, api/_lib/ e tools/');
assert.ok(arquivos.includes('api/_lib/offer-rank.mjs'), 'offer-rank.mjs precisa estar na varredura');
assert.ok(fs.existsSync(path.join(ROOT, 'api/_lib/affiliates.mjs')), 'affiliates.mjs é o único ponto de afiliados');

const violacoes = [];
for (const f of arquivos) {
  const codigo = semComentarios(fs.readFileSync(path.join(ROOT, f), 'utf8'));
  for (const [re, motivo] of PROIBIDOS) if (re.test(codigo)) violacoes.push(`${f}: ${motivo}`);
}
assert.deepEqual(violacoes, [], `afiliado fora do ranking violado:\n${violacoes.join('\n')}`);

// O detector precisa pegar o caso que o teste promete pegar.
const exemplo = semComentarios("import fs from 'node:fs';\nfs.readFileSync('config/afiliados/amazon.json'); // x");
assert.ok(PROIBIDOS.some(([re]) => re.test(exemplo)), 'detector deve acusar leitura acrescentada');
assert.ok(!PROIBIDOS.some(([re]) => re.test(semComentarios('// config/afiliados/amazon.json tag=x'))), 'comentário é ignorado');

console.log(`✓ Afiliado isolado do ranking: ${arquivos.length} arquivos sem leitura de afiliados nem tag=`);
