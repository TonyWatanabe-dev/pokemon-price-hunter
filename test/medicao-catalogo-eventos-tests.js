// Catálogo de eventos de docs/medicao-comercial.md × eventos de analytics no código servido (index, entrar, ir, kit e os
// scripts que essas páginas carregam). Só leitura: não toca código nem rede. Evento novo ou removido no código sem
// atualizar o catálogo quebra aqui; "proposta" que passou a existir também (o doc precisa virar "existe").
import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (f) => fs.readFileSync(new URL(`../${f}`, import.meta.url), 'utf8');
const doc = read('docs/medicao-comercial.md');

// --- catálogo do documento -------------------------------------------------------------------------------------
const bloco = doc.match(/<!-- catalogo:inicio -->([\s\S]*?)<!-- catalogo:fim -->/);
assert.ok(bloco, 'doc tem o bloco do catálogo');
const ESTADOS = new Set(['existe', 'pr914', 'proposta']);
const linhas = bloco[1].split('\n').filter((l) => /^\|\s*`/.test(l));
const cat = linhas.map((l) => {
  const c = l.split('|').slice(1, -1).map((s) => s.trim());
  return { nome: c[0].replace(/`/g, ''), estado: c[1], arquivo: c[2], props: c[4] || '' };
});
assert.ok(cat.length >= 20, `catálogo com linhas (${cat.length})`);
for (const e of cat) {
  assert.match(e.nome, /^[a-z][a-z0-9_]*$/, `nome snake_case: ${e.nome}`);
  assert.ok(ESTADOS.has(e.estado), `estado válido para ${e.nome}: ${e.estado}`);
  assert.ok(e.arquivo, `arquivo informado para ${e.nome}`);
}
const chave = (n, f) => `${n}@${f}`;
const docPor = new Map(cat.map((e) => [chave(e.nome, e.arquivo), e]));
assert.equal(docPor.size, cat.length, 'sem linha duplicada (evento@arquivo)');

// --- eventos no código servido -----------------------------------------------------------------------------------
const PAGINAS = ['index.html', 'entrar.html', 'ir.html', 'kit.html'];
const arquivos = new Set(PAGINAS);
for (const p of PAGINAS) for (const m of read(p).matchAll(/src="\/(assets\/web\/[a-z0-9-]+\.js)"/g)) arquivos.add(m[1]);

const RE = [
  /\btrack\(\s*["']([a-z][a-z0-9_]*)["']/g,                                         // helper track("nome", …)
  /\bva\(\s*["']event["']\s*,\s*\{\s*name\s*:\s*["']([a-z][a-z0-9_]*)["']/g,        // va('event',{name:'nome'})
];
const codigo = new Map();   // chave → arquivo
for (const f of arquivos) {
  const src = read(f);
  for (const re of RE) for (const m of src.matchAll(re)) codigo.set(chave(m[1], f), f);
}
assert.ok(codigo.size >= 15, `eventos encontrados no código (${codigo.size})`);

// 1) todo evento do código está no catálogo como "existe" (ou "pr914", enquanto a PR do kit não entra)
for (const k of codigo.keys()) {
  const e = docPor.get(k);
  assert.ok(e, `evento do código fora do catálogo: ${k} (atualize docs/medicao-comercial.md §2)`);
  assert.notEqual(e.estado, 'proposta', `${k} já existe no código: marque "existe" no catálogo`);
}
// 2) todo "existe" do catálogo está no código, no arquivo indicado
for (const e of cat.filter((x) => x.estado === 'existe')) {
  assert.ok(codigo.has(chave(e.nome, e.arquivo)), `catálogo diz que ${e.nome} existe em ${e.arquivo}, mas o código não tem`);
}
// 3) "pr914" só pode estar no script do kit (presente ou não, conforme o merge da #914)
for (const e of cat.filter((x) => x.estado === 'pr914')) assert.match(e.arquivo, /^assets\/web\/kit-v\d+\.js$/, `${e.nome}: pr914 é do kit`);

// --- sem dado pessoal nas propriedades -----------------------------------------------------------------------------
// `q` do `search` é a exceção conhecida (texto livre) e está marcada no doc para troca; nenhuma outra pode entrar.
const PROIBIDAS = /`(q|email|e_mail|nome|name|cep|ip|ua|user_agent|uid|user|telefone|phone|cpf)`/;
for (const e of cat) {
  if (e.nome === 'search' && e.estado === 'existe') { assert.match(e.props, /texto livre/, 'search: q marcado como pendência'); continue; }
  assert.doesNotMatch(e.props, PROIBIDAS, `${e.nome}: propriedade com dado pessoal`);
}
assert.match(doc, /trocar `q` por `n`/, 'doc propõe tirar o texto livre do search');

// --- UTM padrão: valores no formato combinado ------------------------------------------------------------------
for (const m of doc.matchAll(/[?&]utm_(source|medium|campaign|content)=([^&\s`)]+)/g)) {
  if (m[2].startsWith('<')) continue;
  assert.match(m[2], /^[a-z0-9-]{1,40}$/, `utm_${m[1]}=${m[2]} fora do padrão`);
}

console.log(`medicao-catalogo-eventos: ok (${cat.length} linhas no catálogo, ${codigo.size} eventos no código, ${arquivos.size} arquivos)`);
