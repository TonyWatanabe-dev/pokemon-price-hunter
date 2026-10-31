// tools/reparo-publicar.mjs e .github/workflows/reparo-dados.yml: só copia lowest.json e hist/ do MANIFEST, nunca
// state.json; um sha256 divergente aborta tudo; o workflow roda no grupo "hunter", só por disparo manual, e só publica
// com aplicar + confirmar=APLICAR. Sem rede, sem git.
import assert from 'node:assert/strict';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { planejar, aplicar } from '../tools/reparo-publicar.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');
let n = 0; const t = (nome, fn) => { try { fn(); n++; } catch (e) { e.message = `[${nome}] ${e.message}`; throw e; } };

function montar({ extra = [], mexer = null } = {}) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'reparo-pub-'));
  const dados = path.join(tmp, 'dados'); const saida = path.join(tmp, 'saida');
  const arquivos = { 'data/lowest.json': ['{"a":1}', '{"a":2}'], 'data/hist/x.json': ['[1,2]', '[1]'], 'data/state.json': ['{"offers":{"o":1}}', '{"offers":{}}'], ...Object.fromEntries(extra) };
  const manifest = [];
  for (const [f, [antes, depois]] of Object.entries(arquivos)) {
    for (const [base, txt] of [[dados, antes], [path.join(saida, 'proposto'), depois]]) { fs.mkdirSync(path.dirname(path.join(base, f)), { recursive: true }); fs.writeFileSync(path.join(base, f), txt); }
    manifest.push({ arquivo: f, sha256Antes: sha(antes), sha256Depois: sha(depois) });
  }
  fs.writeFileSync(path.join(saida, 'proposto/MANIFEST.json'), JSON.stringify({ arquivos: manifest }));
  if (mexer) mexer(dados);
  return { dados, saida, ler: (f) => fs.readFileSync(path.join(dados, f), 'utf8') };
}

t('copia lowest e hist; state.json nunca', () => {
  const { dados, saida, ler } = montar();
  const itens = planejar(saida, dados);
  assert.deepEqual(itens.map((i) => i.arquivo).sort(), ['data/hist/x.json', 'data/lowest.json']);
  assert.equal(aplicar(itens), 2);
  assert.equal(ler('data/lowest.json'), '{"a":2}'); assert.equal(ler('data/hist/x.json'), '[1]');
  assert.equal(ler('data/state.json'), '{"offers":{"o":1}}', 'state.json da rodada vigente intacto');
});

t('um arquivo mudado desde o dry-run aborta sem copiar nada', () => {
  const { dados, saida, ler } = montar({ mexer: (d) => fs.writeFileSync(path.join(d, 'data/hist/x.json'), '[1,2,3]') });
  assert.throws(() => planejar(saida, dados), /ABORTA: mudou desde o dry-run: data\/hist\/x\.json/);
  assert.equal(ler('data/lowest.json'), '{"a":1}', 'nem o arquivo que batia foi copiado');
});

t('arquivo fora da lista permitida (ex.: offers.json) aborta', () => {
  const { dados, saida } = montar({ extra: [['data/offers.json', ['{}', '{"x":1}']]] });
  assert.throws(() => planejar(saida, dados), /fora da lista permitida: data\/offers\.json/);
});

t('proposto diferente do MANIFEST aborta', () => {
  const { dados, saida } = montar();
  fs.writeFileSync(path.join(saida, 'proposto/data/lowest.json'), '{"a":3}');
  assert.throws(() => planejar(saida, dados), /proposto ausente ou diferente do MANIFEST: data\/lowest\.json/);
});

t('workflow: manual, grupo hunter, publica só com APLICAR, etiqueta antes, ferramenta de conferência', () => {
  const y = fs.readFileSync(path.join(root, '.github/workflows/reparo-dados.yml'), 'utf8');
  assert.match(y, /^on:\n  workflow_dispatch:/m); assert.doesNotMatch(y, /^\s+(schedule|push|pull_request):/m);
  assert.match(y, /concurrency:\n  group: hunter\n  cancel-in-progress: false/);
  assert.match(y, /if: inputs\.aplicar && inputs\.confirmar == 'APLICAR'/);
  const passo = y.slice(y.indexOf('Etiquetar, conferir e publicar'));
  const ordem = ['git tag', 'reparo-publicar.mjs --saida "$RUNNER_TEMP/saida" --dados . --aplicar', 'tools/push-data.sh'].map((s) => passo.indexOf(s));
  assert.ok(ordem.every((i) => i > 0) && ordem[0] < ordem[1] && ordem[1] < ordem[2], 'etiqueta → confere/copia → publica');
  const codigo = y.split('\n').filter((l) => !/^\s*#/.test(l)).join('\n');
  assert.doesNotMatch(codigo, /state\.json/, 'o workflow não manipula state.json');
  assert.doesNotMatch(codigo, /DATABASE_URL|secrets\./, 'não toca o banco nem usa secrets');
  assert.match(y, /if: github\.ref == 'refs\/heads\/main'/);
});

t('relatório anterior versionado é o do dry-run pré-integração (sha256 98bede1a…)', () => {
  const f = path.join(root, 'tools/reparo-dados/anterior-2026-10-25.json');
  assert.equal(sha(fs.readFileSync(f)).slice(0, 8), '98bede1a');
});

console.log(`✓ reparo-publicar: ${n} grupos passaram`);
