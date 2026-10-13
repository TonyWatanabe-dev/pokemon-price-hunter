// CLI da rodada (src/run.js executado como processo): falha forçada sem --loop sai com código 1 e imprime
// "Falha na rodada", sem segredo no texto. Diretórios temporários, sem rede e sem produção.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hunter-cli-'));
try {
  const SEGREDO = 'segredo-cli-teste-9f8e7d6c5b4a';
  const cfg = path.join(tmp, 'config'); const data = path.join(tmp, 'data');
  fs.mkdirSync(cfg, { recursive: true }); fs.mkdirSync(data, { recursive: true });
  fs.writeFileSync(path.join(cfg, 'catalog.json'), `{ JSON inválido ${SEGREDO}`); // força a falha ao carregar o catálogo
  const env = { ...process.env, HUNTER_CONFIG_DIR: cfg, HUNTER_DATA_DIR: data, HUNTER_TIPS: '0', HUNTER_DOMAIN_DELAY_MS: '0',
    DATABASE_URL: `postgres://u:${SEGREDO}@127.0.0.1:1/x`, TELEGRAM_BOT_TOKEN: SEGREDO };
  delete env.HUNTER_INTERVAL_MIN;
  const r = spawnSync(process.execPath, [path.join(root, 'src/run.js')], { env, encoding: 'utf8', timeout: 60000 });
  assert.equal(r.status, 1, `sem --loop, a falha sai com código 1 (saiu ${r.status}): ${r.stderr}`);
  const out = `${r.stdout}\n${r.stderr}`;
  assert.match(out, /Falha na rodada/, 'imprime "Falha na rodada"');
  assert.ok(!out.includes(SEGREDO), 'nenhum segredo no texto de saída');
  console.log('run-cli-tests ok');
} finally {
  fs.rmSync(tmp, { recursive: true, force: true });
}
