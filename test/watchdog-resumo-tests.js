// Vigia, resumo do job (observabilidade T6, lacuna 8): com GITHUB_STEP_SUMMARY, main() acrescenta
// "### Vigia: <status>" e os motivos ao arquivo; caminho inválido é ignorado sem derrubar o Vigia. Canais simulados.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let n = 0; const t = async (name, fn) => { try { await fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'wd-resumo-'));
const iso = (base, min) => new Date(Date.parse(base) + min * 6e4).toISOString();
const NOW = '2026-10-09T12:00:00.000Z';
let k = 0;
async function load(argv) {
  const saved = process.argv; process.argv = [saved[0], saved[1], ...argv];
  try { return await import(pathToFileURL(path.join(root, 'tools/watchdog.mjs')).href + '?resumo=' + (++k)); } finally { process.argv = saved; }
}
const w = (f, o) => fs.writeFileSync(path.join(tmp, f), typeof o === 'string' ? o : JSON.stringify(o));
const ledger = path.join(tmp, 'ledger.json');
const files = ['--state', path.join(tmp, 'state.json'), '--meta', path.join(tmp, 'meta.json'), '--runs', path.join(tmp, 'runs.json'), '--ledger', ledger, '--now', NOW];
const calls = [];
const fetchImpl = async (url, init) => { calls.push(url); return { ok: true, status: 200 }; };
const ENV = { NTFY_TOPIC: 'topico-secreto', NTFY_SERVER: 'http://ntfy.invalid/' };
// meta ilegível = degradado com motivo meta_ilegivel; texto do motivo vem do próprio evaluate
w('state.json', { generatedAt: iso(NOW, -10) }); w('meta.json', '{"ops": [truncado');
w('runs.json', Array.from({ length: 3 }, (_, i) => ({ status: 'completed', conclusion: 'success', createdAt: iso(NOW, -15 * i - 7), updatedAt: iso(NOW, -15 * i) })));

await t('1. resumo gravado: cabeçalho com o status, motivo, aviso entregue; conteúdo anterior preservado', async () => {
  const sum = path.join(tmp, 'summary.md'); fs.writeFileSync(sum, 'antes\n');
  const r = await (await load(files)).main({ env: { ...ENV, GITHUB_STEP_SUMMARY: sum }, fetchImpl, log: () => {} });
  assert.equal(r.status, 'degradado'); assert.deepEqual(r.reasons, ['meta_ilegivel']); assert.equal(r.delivered, true);
  const md = fs.readFileSync(sum, 'utf8');
  assert.ok(md.startsWith('antes\n'), 'acrescenta, não sobrescreve');
  assert.match(md, /^### Vigia: degradado$/m);
  const motivo = md.split('\n').find((l) => /^- /.test(l) && /ileg/i.test(l));
  assert.ok(motivo, 'linha do motivo meta_ilegivel no resumo:\n' + md);
  assert.match(md, /^- Aviso: falha \(entregue\)$/m);
  assert.ok(!md.includes('topico-secreto'), 'resumo sem segredo');
});

await t('2. sem aviso novo: resumo diz "nenhum"; sem GITHUB_STEP_SUMMARY nada é escrito', async () => {
  const sum = path.join(tmp, 'summary2.md');
  const r = await (await load(files)).main({ env: { ...ENV, GITHUB_STEP_SUMMARY: sum }, fetchImpl, log: () => {} });
  assert.equal(r.notify, null, 'já avisado: deduplicado');
  const md = fs.readFileSync(sum, 'utf8');
  assert.match(md, /^### Vigia: degradado$/m); assert.match(md, /^- Aviso: nenhum$/m);
  const before = fs.readdirSync(tmp).sort();
  await (await load(files)).main({ env: ENV, fetchImpl, log: () => {} });
  assert.deepEqual(fs.readdirSync(tmp).sort(), before);
});

await t('3. caminho inválido (pasta inexistente ou diretório) não derruba o Vigia e o livro continua gravado', async () => {
  for (const bad of [path.join(tmp, 'nao-existe', 'sub', 'summary.md'), tmp]) {
    fs.rmSync(ledger, { force: true });
    const r = await (await load(files)).main({ env: { ...ENV, GITHUB_STEP_SUMMARY: bad }, fetchImpl, log: () => {} });
    assert.equal(r.status, 'degradado'); assert.equal(r.delivered, true);
    assert.equal(JSON.parse(fs.readFileSync(ledger, 'utf8')).notifiedStatus, 'degradado');
  }
  assert.equal(fs.existsSync(path.join(tmp, 'nao-existe')), false);
});

fs.rmSync(tmp, { recursive: true, force: true });
console.log(`✓ Vigia GITHUB_STEP_SUMMARY: ${n} grupos passaram`);
