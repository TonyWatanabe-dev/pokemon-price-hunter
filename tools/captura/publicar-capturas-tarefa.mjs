#!/usr/bin/env node
// Publicador local das capturas da extensão (27/11/2026). Tarefa agendada a cada 30 min no PC do dono, num CLONE DEDICADO do repo:
//   lê %USERPROFILE%\Downloads\tph-capturas\captura-*.json (env TPH_CAPTURAS_DIR sobrescreve) → arquivo "novo" = hash do conteúdo
//   diferente do último processado (tools/captura/auto/publicados.json) → branch capturas-extensao/<data-hora> a partir de
//   origin/main → tools/captura-importar.mjs por arquivo novo → commit da config de afiliados → push → PR único → merge.
// Marca como publicado só depois do merge (ou se a importação não gerou mudança). Falha → não marca; a próxima rodada tenta de novo.
// Log: tools/captura/auto/publicar.log. Uso: node tools/captura/publicar-capturas-tarefa.mjs
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { criarRun, criarGit, prepararBranch, mudouConfig, publicarMudancas, voltarParaMain, p2 } from './publicar-pr.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const NOMES = { mercadolivre: 'ML', shopee: 'Shopee', amazon: 'Amazon' };

export const pastaEntrada = (env = process.env) => env.TPH_CAPTURAS_DIR || path.join(env.USERPROFILE || os.homedir(), 'Downloads', 'tph-capturas');
export const hashDe = (conteudo) => crypto.createHash('sha256').update(conteudo).digest('hex');

export function lerEstado(arq) {
  try { const e = JSON.parse(fs.readFileSync(arq, 'utf8')); if (e && typeof e.arquivos === 'object') return e; } catch { /* sem estado ainda */ }
  return { arquivos: {} };
}

/** Arquivos captura-*.json da pasta cujo hash difere do último processado. */
export function arquivosNovos(dir, estado) {
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter((n) => /^captura-.+\.json$/.test(n)).sort().flatMap((nome) => {
    const arquivo = path.join(dir, nome);
    const hash = hashDe(fs.readFileSync(arquivo));
    return estado.arquivos[nome] === hash ? [] : [{ nome, arquivo, hash }];
  });
}

export function titulo(legivel, porLoja) {
  return `afiliados: capturas da extensão ${legivel} (ML ${porLoja.mercadolivre || 0}, Shopee ${porLoja.shopee || 0}, Amazon ${porLoja.amazon || 0})`;
}

/** Uma rodada. Dependências injetáveis (testes). Devolve o código de saída. */
export function rodar({
  dir = pastaEntrada(), autoDir = path.join(root, 'tools', 'captura', 'auto'), run = criarRun(root), agora = new Date(),
  log: logExterno = null,
} = {}) {
  const logFile = path.join(autoDir, 'publicar.log');
  const log = logExterno || ((msg) => {
    fs.mkdirSync(autoDir, { recursive: true });
    const linha = `${new Date().toISOString()} ${msg}`;
    fs.appendFileSync(logFile, linha + '\n');
    console.log(linha);
  });
  const git = criarGit(run);
  const estadoArq = path.join(autoDir, 'publicados.json');
  const salvarEstado = (estado) => { fs.mkdirSync(autoDir, { recursive: true }); fs.writeFileSync(estadoArq, JSON.stringify(estado, null, 1)); };

  const estado = lerEstado(estadoArq);
  const novos = arquivosNovos(dir, estado);
  if (!novos.length) { log('Nada novo em tph-capturas.'); return 0; }

  const validos = [];
  for (const n of novos) {
    try {
      const j = JSON.parse(fs.readFileSync(n.arquivo, 'utf8'));
      if (!j || !Array.isArray(j.itens) || !NOMES[j.loja]) throw new Error('formato inesperado');
      validos.push({ ...n, loja: j.loja, itens: j.itens.length });
    } catch (e) { log(`Arquivo ignorado (${n.nome}): ${e.message}`); }
  }
  if (!validos.length) return 0;

  const hora = `${agora.getFullYear()}${p2(agora.getMonth() + 1)}${p2(agora.getDate())}-${p2(agora.getHours())}${p2(agora.getMinutes())}`;
  const legivel = `${agora.getFullYear()}-${p2(agora.getMonth() + 1)}-${p2(agora.getDate())} ${p2(agora.getHours())}:${p2(agora.getMinutes())}`;
  const branch = `capturas-extensao/${hora}`;
  const porLoja = {};
  for (const v of validos) porLoja[v.loja] = (porLoja[v.loja] || 0) + v.itens;
  const marcar = () => { for (const v of validos) estado.arquivos[v.nome] = v.hash; salvarEstado(estado); };

  try {
    if (!prepararBranch({ git, log, branch })) return 1;
    log(`Rodada ${legivel}: ${validos.length} arquivo(s) novo(s) na branch ${branch}`);
    for (const v of validos) {
      const imp = run(process.execPath, [path.join('tools', 'captura-importar.mjs'), v.arquivo]);
      for (const l of imp.stdout.split(/\r?\n/).filter(Boolean).slice(-8)) log(`  importar ${v.nome}: ${l}`);
    }
    if (!mudouConfig(git)) {
      log('Importação sem mudança na config de afiliados; arquivos marcados como publicados.');
      marcar();
      return 0;
    }
    const t = titulo(legivel, porLoja);
    const corpo = `Capturas da extensão do Chrome (arquivos lidos de tph-capturas): ${validos.map((v) => `${v.nome} (${v.itens})`).join(', ')}.\n\nImportadas por tools/captura-importar.mjs; só entra o que casa com o catálogo e tem link do dono.\n\nGerado por tools/captura/publicar-capturas-tarefa.mjs.`;
    const r = publicarMudancas({ run, git, log, branch, titulo: t, corpo, esperarAuto: true });
    if (r.publicado) { marcar(); return 0; }
    return r.estado === 'checks-falharam' ? 1 : 0;
  } catch (e) {
    log(`ERRO: ${e.message}`);
    return 1;
  } finally {
    voltarParaMain({ git, log });
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) process.exit(rodar());
