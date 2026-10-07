// Empacota tools/account.src.js (Firebase) em account.js, servido pelo próprio site (sem CDN externo).
// Uso: node tools/build-account.mjs <pasta node_modules com firebase e esbuild>
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const nm = process.argv[2];
if (!nm) { console.error('Informe a pasta node_modules.'); process.exit(1); }
const esbuild = createRequire(path.join(nm, 'x.js'))('esbuild');
await esbuild.build({ entryPoints: [path.join(root, 'tools/account.src.js')], bundle: true, format: 'esm', minify: true, target: 'es2020',
  outfile: path.join(root, 'account.js'), nodePaths: [nm], legalComments: 'none', logLevel: 'info' });
