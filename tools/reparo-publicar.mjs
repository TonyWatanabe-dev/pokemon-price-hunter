// Publica o resultado de um dry-run de tools/reparo-dados.mjs sobre a pasta data/ do MESMO retrato (passo 5 de
// docs/reparo-dados.md). Só copia data/lowest.json e data/hist/<id>.json do MANIFEST; data/state.json nunca é copiado
// (é espelho para conferência; publicá-lo apagaria ofertas da rodada vigente). Antes de copiar, confere o sha256Antes de
// TODOS os arquivos contra o arquivo vigente: um só divergente aborta sem copiar nada (exit 2).
//
// Uso: node tools/reparo-publicar.mjs --saida <pasta do dry-run> --dados <pasta que contém data/> [--aplicar]
// Sem --aplicar: só confere e lista o que seria copiado.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const sha = (f) => crypto.createHash('sha256').update(fs.readFileSync(f)).digest('hex');
const PERMITIDO = /^data\/(lowest\.json|hist\/[a-z0-9_.-]+\.json)$/;

/** Plano de cópia a partir do MANIFEST; lança se algum arquivo divergir do retrato ou estiver fora da lista permitida. */
export function planejar(saida, dados) {
  const m = JSON.parse(fs.readFileSync(path.join(saida, 'proposto/MANIFEST.json'), 'utf8'));
  const itens = []; const erros = [];
  for (const a of m.arquivos || []) {
    if (a.arquivo === 'data/state.json') continue;
    if (!PERMITIDO.test(a.arquivo)) { erros.push(`fora da lista permitida: ${a.arquivo}`); continue; }
    const atual = path.join(dados, a.arquivo); const novo = path.join(saida, 'proposto', a.arquivo);
    if (!fs.existsSync(atual)) { erros.push(`ausente no retrato: ${a.arquivo}`); continue; }
    if (sha(atual) !== a.sha256Antes) { erros.push(`mudou desde o dry-run: ${a.arquivo}`); continue; }
    if (!fs.existsSync(novo) || sha(novo) !== a.sha256Depois) { erros.push(`proposto ausente ou diferente do MANIFEST: ${a.arquivo}`); continue; }
    itens.push({ arquivo: a.arquivo, de: novo, para: atual, antes: a.sha256Antes, depois: a.sha256Depois });
  }
  if (erros.length) { const e = new Error('ABORTA: ' + erros.join('; ')); e.erros = erros; throw e; }
  return itens;
}

export function aplicar(itens) { for (const i of itens) fs.copyFileSync(i.de, i.para); return itens.length; }

if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(new URL(import.meta.url).pathname)) {
  const arg = (k) => { const i = process.argv.indexOf(k); return i > 0 ? process.argv[i + 1] : null; };
  const saida = arg('--saida'); const dados = arg('--dados');
  if (!saida || !dados) { console.error('uso: node tools/reparo-publicar.mjs --saida <dry-run> --dados <pasta com data/> [--aplicar]'); process.exit(1); }
  let itens;
  try { itens = planejar(saida, dados); } catch (e) { console.error(e.message); process.exit(2); }
  for (const i of itens) console.log(`${i.arquivo} ${i.antes.slice(0, 12)} → ${i.depois.slice(0, 12)}`);
  if (process.argv.includes('--aplicar')) console.log(`aplicado: ${aplicar(itens)} arquivo(s)`);
  else console.log(`conferido (sem --aplicar): ${itens.length} arquivo(s) seriam copiados`);
}
