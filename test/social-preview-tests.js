// Social MVP — prévia local (issue #637): tools/social-preview.mjs ponta a ponta com state.json de fixture
// (elegível, stale, sem horário, duplicada), gate SOCIAL_ENABLED / --dry-run, kill switch, disclosure e escrita
// restrita à pasta de saída. Sem rede, banco, secrets nem process.env real.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { gerarPrevia, paraMarkdown, lerArgs, main, SAIDAS, ARQUIVOS } from '../tools/social-preview.mjs';
import { MOTIVOS } from '../src/agents/social/elegiveis.js';
import { DISCLOSURE } from '../src/agents/social/rascunho.js';
import { deJson } from '../src/agents/social/fila.js';
import { parseAffiliates } from '../api/_lib/affiliates.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const tool = path.join(root, 'tools/social-preview.mjs');
let n = 0;
function t(name, fn) { try { fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } }

const NOW = '2026-10-14T12:00:00.000Z';
const lida = new Date(Date.parse(NOW) - 10 * 60e3).toISOString();
const velha = new Date(Date.parse(NOW) - 3 * 3600e3).toISOString();
const oferta = (id, productId, storeId, price, extra = {}) => ({
  id, productId, storeId, storeName: `Loja ${storeId}`, url: `https://${storeId}.com.br/p/${id}`, price, total: price + 20,
  shippingKnown: true, stock: 'IN_STOCK', stale: false, anomalous: false, source_timestamp: lida, ...extra,
});
const STATE = {
  generatedAt: lida,
  products: [
    { id: 'me02-blister4', collectionName: 'Fogo Fantasmagórico', typeLabel: 'Blister Quádruplo', type: 'blister_4', name: 'Fogo Fantasmagórico - Blister Quádruplo', offerCount: 3 },
    { id: 'sv7-booster', collectionName: 'Coroa Estelar', typeLabel: 'Booster unitário', type: 'booster', name: 'Coroa Estelar - Booster unitário', offerCount: 1 },
  ],
  offers: [
    oferta('elegivel', 'me02-blister4', 'lojaa', 50.35),
    oferta('sem-frete', 'sv7-booster', 'lojab', 11.9, { shippingKnown: false, total: 11.9 }),
    oferta('stale', 'me02-blister4', 'lojac', 45, { stale: true }),
    oferta('velha', 'me02-blister4', 'lojad', 44, { source_timestamp: velha }),
    oferta('sem-horario', 'me02-blister4', 'lojae', 43, { source_timestamp: null }),
    oferta('duplicada', 'me02-blister4', 'lojaa', 50.35, { url: 'https://lojaa.com.br/p/outra', total: 90.35 }),   // mesma chave, frete maior
  ],
};

function tmp() { return fs.mkdtempSync(path.join(os.tmpdir(), 'social-preview-')); }
function rodar(args, env = {}) {
  return spawnSync(process.execPath, [tool, ...args], { cwd: root, encoding: 'utf8', env: { PATH: process.env.PATH, ...env } });
}
function comState(fn) {
  const dir = tmp();
  const arq = path.join(dir, 'state.json');
  fs.writeFileSync(arq, JSON.stringify(STATE));
  try { fn(dir, arq); } finally { fs.rmSync(dir, { recursive: true, force: true }); }
}

t('ponta a ponta: elegível vira rascunho; stale, sem horário, velha e duplicada ficam de fora com motivo', () => {
  const p = gerarPrevia(STATE, { now: NOW });
  assert.equal(p.naoPublicado, true);
  assert.deepEqual(p.canais, ['telegram', 'instagram']);
  assert.equal(p.resumo.elegiveis, 2);
  assert.equal(p.resumo.rascunhos, 4, 'duas ofertas × dois canais');
  assert.deepEqual(p.erros, []);
  const motivos = Object.fromEntries(p.recusadas.map((r) => [r.id, r.motivo]));
  assert.deepEqual(motivos, { stale: MOTIVOS.PENDENTE, velha: MOTIVOS.FRESCOR, 'sem-horario': MOTIVOS.SEM_HORARIO, duplicada: MOTIVOS.DUPLICADA });
  assert.deepEqual(p.resumo.porMotivo, { [MOTIVOS.PENDENTE]: 1, [MOTIVOS.FRESCOR]: 1, [MOTIVOS.SEM_HORARIO]: 1, [MOTIVOS.DUPLICADA]: 1 });

  const tg = p.itens.filter((x) => x.canal === 'telegram');
  const a = tg.find((x) => x.ofertaId === 'elegivel');
  assert.equal(a.chaveDedupe, 'me02-blister4|lojaa|5035');
  assert.match(a.elegibilidade, /^elegível: .*frescor atual \(lida há 10 min\)/);
  assert.equal(a.link, 'https://tcgpricehunter.com.br/produto/fogo-fantasmagorico-blister-quadruplo');
  assert.match(a.texto, /total com frete R\$\s70,35/);
  assert.equal(a.disclosure, false);
  assert.doesNotMatch(a.texto, /afiliado/i);
  const b = tg.find((x) => x.ofertaId === 'sem-frete');
  assert.match(b.texto, /R\$\s11,90 em Loja lojab \(frete a calcular\)/);
  assert.ok(b.avisos.some((x) => /frete desconhecido/.test(x)));
  const ig = p.itens.find((x) => x.canal === 'instagram' && x.ofertaId === 'elegivel');
  assert.match(ig.texto, /Link para a página do produto na bio\./);
  assert.doesNotMatch(ig.texto, /https?:\/\//, 'Instagram sem link clicável no corpo');
});

t('fila sugerida: itens ficam em rascunho; horário sugerido respeita intervalo e nunca é passado', () => {
  const p = gerarPrevia(STATE, { now: NOW });
  const fila = deJson(JSON.stringify(p.fila));
  assert.equal(fila.itens.length, 4);
  assert.ok(fila.itens.every((x) => x.estado === 'rascunho' && x.agendadoPara === null), 'a prévia não aprova nem agenda de verdade');
  for (const canal of p.canais) {
    assert.equal(p.agenda[canal].status, 'ok');
    const hs = p.itens.filter((x) => x.canal === canal).map((x) => Date.parse(x.horarioSugerido));
    assert.equal(hs.length, 2);
    assert.ok(hs.every((h) => h >= Date.parse(NOW)));
    assert.ok(hs[1] - hs[0] >= 120 * 60e3, 'intervalo mínimo da fila (PADROES.intervaloMin)');
  }
  assert.ok(p.itens.every((x) => p.fila.itens.some((f) => f.id === x.id && f.texto === x.texto)));
});

t('kill switch: canal pausado não recebe horário', () => {
  const p = gerarPrevia(STATE, { now: NOW, env: { SOCIAL_PAUSA: 'telegram' } });
  assert.equal(p.agenda.telegram.status, 'pausado');
  assert.equal(p.agenda.instagram.status, 'ok');
  for (const it of p.itens.filter((x) => x.canal === 'telegram')) { assert.equal(it.horarioSugerido, null); assert.match(it.agenda, /pausado/); }
  assert.ok(p.itens.filter((x) => x.canal === 'instagram').every((x) => x.horarioSugerido));
  const todos = gerarPrevia(STATE, { now: NOW, env: { SOCIAL_PAUSA: 'todos' } });
  assert.ok(todos.itens.every((x) => x.horarioSugerido === null));
});

t('disclosure: destino de afiliado (api/_lib/affiliates.mjs) leva a frase obrigatória; afiliado não muda a ordem', () => {
  const ml = 'https://produto.mercadolivre.com.br/MLB-1234567890-blister-_JM';
  const cfg = parseAffiliates({ mercadolivre: { anuncios: { MLB1234567890: 'https://meli.la/abc' } } });
  const state = { ...STATE, offers: [oferta('barata', 'sv7-booster', 'lojab', 10), oferta('ml', 'me02-blister4', 'mercadolivre', 60, { url: ml })] };
  const p = gerarPrevia(state, { now: NOW, canais: ['telegram'], affiliates: cfg });
  assert.deepEqual(p.itens.map((x) => x.ofertaId), ['barata', 'ml']);
  assert.ok(p.itens[0].horarioSugerido < p.itens[1].horarioSugerido, 'horário segue a ordem de preço, não o afiliado');
  const ml1 = p.itens.find((x) => x.ofertaId === 'ml');
  assert.equal(ml1.disclosure, true);
  assert.ok(ml1.texto.includes(DISCLOSURE));
  assert.ok(!ml1.texto.includes('meli.la'), 'o link de afiliado não é montado no texto');
  assert.equal(p.itens.find((x) => x.ofertaId === 'barata').disclosure, false);
  assert.match(paraMarkdown(p), /Disclosure de afiliado: exigida/);
});

t('limite, canal único e entradas inválidas', () => {
  const p = gerarPrevia(STATE, { now: NOW, limite: 1, canais: ['instagram'] });
  assert.equal(p.itens.length, 1);
  assert.equal(p.itens[0].canal, 'instagram');
  assert.throws(() => gerarPrevia({}, { now: NOW }), /state\.json inválido/);
  assert.throws(() => gerarPrevia(STATE, { now: 'ontem' }), /inválido/);
  assert.deepEqual(lerArgs(['--canal', 'telegram', '--dry-run']).canais, ['telegram']);
  assert.throws(() => lerArgs(['--canal', 'whatsapp']), /canal desconhecido/);
  assert.throws(() => lerArgs(['--limite', '0']), /--limite/);
  assert.throws(() => lerArgs(['--saida']), /exige um valor/);
  assert.throws(() => lerArgs(['--publicar']), /argumento desconhecido/);
});

t('markdown: cada rascunho com motivo, horário, disclosure, dedupe e aviso de que nada foi publicado', () => {
  const md = paraMarkdown(gerarPrevia(STATE, { now: NOW }));
  assert.match(md, /\*\*Nada foi publicado\.\*\*/);
  assert.match(md, /## Fila sugerida — telegram/);
  assert.match(md, /## Fila sugerida — instagram/);
  assert.match(md, /Chave de dedupe: `me02-blister4\|lojaa\|5035`/);
  assert.match(md, /Horário sugerido \(se aprovado\): 2026-10-14T12:00:00\.000Z/);
  assert.match(md, /Disclosure de afiliado: não exigida/);
  assert.match(md, /\| oferta pendente\/stale \| 1 \|/);
  const injetado = paraMarkdown(gerarPrevia({ ...STATE, products: [{ ...STATE.products[0], name: 'X ``` [link](https://mal.example) <b>' }, STATE.products[1]] }, { now: NOW }));
  assert.equal((injetado.match(/^```/gm) || []).length % 2, 0, 'cercas de código balanceadas');
  assert.doesNotMatch(injetado, /mal\.example|<b>/);
});

t('CLI: sem SOCIAL_ENABLED sai com código 2 e não grava nada', () => comState((dir, arq) => {
  const saida = path.join(dir, 'out');
  for (const env of [{}, { SOCIAL_ENABLED: '0' }, { SOCIAL_ENABLED: 'sim' }]) {
    const r = rodar(['--state', arq, '--saida', saida, '--now', NOW], env);
    assert.equal(r.status, SAIDAS.DESLIGADO, r.stderr);
    assert.match(r.stderr, /desligado/);
    assert.equal(fs.existsSync(saida), false);
  }
}));

t('CLI: --dry-run gera preview.md e preview.json só na pasta de saída', () => comState((dir, arq) => {
  const saida = path.join(dir, 'out');
  const antes = fs.readdirSync(dir).sort();
  const r = rodar(['--state', arq, '--saida', saida, '--dry-run'], { PREVIA_NOW: NOW });
  assert.equal(r.status, SAIDAS.OK, r.stderr);
  assert.match(r.stdout, /4 rascunho\(s\), 4 recusada\(s\), 0 erro\(s\).*nada publicado/);
  assert.deepEqual(fs.readdirSync(saida).sort(), [...ARQUIVOS].sort());
  assert.deepEqual(fs.readdirSync(dir).filter((f) => f !== 'out').sort(), antes, 'nada gravado fora da saída');
  const json = JSON.parse(fs.readFileSync(path.join(saida, 'preview.json'), 'utf8'));
  assert.equal(json.modo, 'dry-run');
  assert.equal(json.geradoEm, NOW);
  assert.equal(json.itens.length, 4);
  for (const it of json.itens) for (const k of ['texto', 'elegibilidade', 'horarioSugerido', 'disclosure', 'chaveDedupe']) assert.ok(k in it, k);
  assert.equal(fs.readFileSync(path.join(saida, 'preview.md'), 'utf8'), paraMarkdown(json));
}));

t('CLI: SOCIAL_ENABLED=true (ou 1) dispensa --dry-run; mesma entrada, mesma saída', () => comState((dir, arq) => {
  const out = (v) => {
    const saida = path.join(dir, `out-${v}`);
    const r = rodar(['--state', arq, '--saida', saida, '--now', NOW, '--canal', 'telegram'], { SOCIAL_ENABLED: v });
    assert.equal(r.status, SAIDAS.OK, r.stderr);
    return fs.readFileSync(path.join(saida, 'preview.json'), 'utf8');
  };
  const a = out('true'); const b = out('1');
  assert.equal(a, b);
  assert.equal(JSON.parse(a).modo, 'habilitado');
  assert.deepEqual(JSON.parse(a).canais, ['telegram']);
}));

t('CLI: state ausente, JSON corrompido ou argumento inválido saem com código 1', () => comState((dir, arq) => {
  assert.equal(rodar(['--state', path.join(dir, 'nao-existe.json'), '--saida', path.join(dir, 'o1'), '--dry-run']).status, SAIDAS.ERRO);
  fs.writeFileSync(arq, '{ corrompido');
  assert.equal(rodar(['--state', arq, '--saida', path.join(dir, 'o2'), '--dry-run']).status, SAIDAS.ERRO);
  assert.equal(rodar(['--canal', 'whatsapp', '--dry-run']).status, SAIDAS.ERRO);
  const logs = []; const io = { log: (m) => logs.push(m), error: (m) => logs.push(m) };
  assert.equal(main(['--dry-run', '--state', arq], {}, io), SAIDAS.ERRO);
  assert.match(logs.join('\n'), /social-preview:/);
}));

t('a ferramenta não publica, não acessa rede e só lê SOCIAL_ENABLED / SOCIAL_PAUSA / PREVIA_NOW do ambiente', () => {
  const src = fs.readFileSync(tool, 'utf8');
  assert.doesNotMatch(src, /\bfetch\(|https?\.request|node:https?|node:net|child_process|sendMessage|api\.telegram\.org|graph\.facebook\.com/);
  const envs = new Set([...src.matchAll(/env\.([A-Z_]+)/g)].map((m) => m[1]));
  assert.deepEqual([...envs].sort(), ['PREVIA_NOW', 'SOCIAL_ENABLED', 'SOCIAL_PAUSA']);
});

t('docs/social-media.md cita a ferramenta, o kill switch, o que fica fora do MVP e a checklist da #560', () => {
  const doc = fs.readFileSync(path.join(root, 'docs/social-media.md'), 'utf8');
  for (const s of ['tools/social-preview.mjs', '--dry-run', 'SOCIAL_ENABLED', 'SOCIAL_PAUSA', 'preview.md', 'preview.json', '#560', 'Fora do MVP']) assert.ok(doc.includes(s), s);
  const citados = [...doc.matchAll(/`((?:src|api|config|docs|test|tools)\/[^`*\s]+)`/g)].map((m) => m[1]);
  for (const c of citados) assert.ok(fs.existsSync(path.join(root, c)), `caminho inexistente: ${c}`);
});

console.log(`social-preview-tests: ${n} ok`);
