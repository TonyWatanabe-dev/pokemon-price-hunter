// Regras do Firestore SEM emulador: analisador + avaliador próprio, em JS puro, do SUBCONJUNTO da linguagem usado em
// firebase/firestore.rules. Lê o arquivo, faz o parse (sintaxe e estrutura), e avalia os casos de
// firebase/test/casos.mjs contra ele — inclusive o controle negativo do workflow firestore-regras.yml e, com a regra
// M2 presente, a sensibilidade dela (tirar o hasAll reabre exatamente a lacuna).
//
// LIMITE (leia antes de confiar): este avaliador NÃO é o motor do Google. É uma reimplementação de um subconjunto
// (match aninhado com {var} e {var=**}, allow, function/let/return, && || ! == != < <= > >= + - * / % in is,
// literais, listas, map.keys/get/size, list.hasOnly/hasAll/size, string.matches, request.time.toMillis, math.abs),
// com erro de avaliação = negado e || / && tolerantes a erro como no Firestore. Não modela: list com consultas
// (o uid fica sem valor e nenhuma igualdade com ele é verdadeira), get()/exists() de outros documentos, limites de
// chamadas, tipos float/int exatos, Timestamp/Duration completos, merge com FieldValue, nem transações.
// Um construto novo nas regras que o analisador não conheça FAZ ESTE TESTE FALHAR (de propósito): estenda o
// avaliador ou confie só no CI. A prova de comportamento continua sendo o workflow firestore-regras.yml (emulador).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { CASOS, SEMENTE } from '../firebase/test/casos.mjs';

const REGRAS = fs.readFileSync(new URL('../firebase/firestore.rules', import.meta.url), 'utf8');

// ------------------------------------------------------------------ léxico
const PONT = ['==', '!=', '<=', '>=', '&&', '||', '{', '}', '(', ')', '[', ']', ',', ';', '.', '=', '<', '>', '!', '+', '-', '*', '/', '%', ':'];
function lexico(src) {
  const t = []; let i = 0;
  while (i < src.length) {
    const c = src[i];
    if (/\s/.test(c)) { i++; continue; }
    if (src.startsWith('//', i)) { while (i < src.length && src[i] !== '\n') i++; continue; }
    if (src.startsWith('/*', i)) { const f = src.indexOf('*/', i + 2); if (f < 0) throw new SyntaxError('comentário sem fim'); i = f + 2; continue; }
    if (c === "'" || c === '"') {
      let j = i + 1; let s = '';
      while (j < src.length && src[j] !== c) { if (src[j] === '\n') throw new SyntaxError('string sem fim'); if (src[j] === '\\') { s += src[j + 1]; j += 2; continue; } s += src[j++]; }
      if (j >= src.length) throw new SyntaxError('string sem fim');
      t.push({ k: 'str', v: s }); i = j + 1; continue;
    }
    if (/[0-9]/.test(c)) { const m = /^[0-9]+(\.[0-9]+)?/.exec(src.slice(i)); t.push({ k: 'num', v: Number(m[0]) }); i += m[0].length; continue; }
    if (/[A-Za-z_]/.test(c)) {
      const m = /^[A-Za-z_][A-Za-z0-9_]*/.exec(src.slice(i)); i += m[0].length;
      t.push({ k: 'id', v: m[0] });
      if (m[0] === 'match') { // caminho cru até o espaço antes do bloco: /users/{uid}, /{document=**}
        while (/\s/.test(src[i])) i++;
        const p = /^\/[^\s]*/.exec(src.slice(i)); if (!p) throw new SyntaxError('match sem caminho');
        t.push({ k: 'path', v: p[0] }); i += p[0].length;
      }
      continue;
    }
    const p = PONT.find((x) => src.startsWith(x, i));
    if (!p) throw new SyntaxError(`caractere inesperado ${JSON.stringify(c)} na posição ${i}`);
    t.push({ k: 'p', v: p }); i += p.length;
  }
  return t;
}

// ------------------------------------------------------------------ sintaxe
const METODOS = new Set(['read', 'write', 'get', 'list', 'create', 'update', 'delete']);
function analisar(src) {
  const t = lexico(src); let i = 0;
  const ver = (k, v) => t[i] && t[i].k === k && (v === undefined || t[i].v === v);
  const exige = (k, v) => { if (!ver(k, v)) throw new SyntaxError(`esperado ${v ?? k}, veio ${t[i] ? JSON.stringify(t[i].v) : 'fim'} (token ${i})`); return t[i++]; };
  exige('id', 'rules_version'); exige('p', '='); const versao = exige('str').v; exige('p', ';');
  exige('id', 'service'); exige('id', 'cloud'); exige('p', '.'); exige('id', 'firestore'); exige('p', '{');
  const blocos = [];
  while (!ver('p', '}')) blocos.push(bloco());
  exige('p', '}');
  if (i !== t.length) throw new SyntaxError('conteúdo depois do service');
  return { versao, blocos };

  function bloco() {
    exige('id', 'match'); const caminho = exige('path').v; exige('p', '{');
    const b = { caminho, allows: [], funcoes: {}, filhos: [] };
    while (!ver('p', '}')) {
      if (ver('id', 'match')) b.filhos.push(bloco());
      else if (ver('id', 'allow')) {
        i++; const metodos = [];
        do { const m = exige('id').v; if (!METODOS.has(m)) throw new SyntaxError(`método desconhecido: ${m}`); metodos.push(m); } while (ver('p', ',') && ++i);
        let cond = { tipo: 'lit', v: true };
        if (ver('p', ':')) { i++; exige('id', 'if'); cond = expr(); }
        exige('p', ';'); b.allows.push({ metodos, cond });
      } else if (ver('id', 'function')) {
        i++; const nome = exige('id').v; exige('p', '('); const params = [];
        while (!ver('p', ')')) { params.push(exige('id').v); if (ver('p', ',')) i++; }
        exige('p', ')'); exige('p', '{'); const lets = [];
        while (ver('id', 'let')) { i++; const n = exige('id').v; exige('p', '='); lets.push([n, expr()]); exige('p', ';'); }
        exige('id', 'return'); const corpo = expr(); if (ver('p', ';')) i++; exige('p', '}');
        if (b.funcoes[nome]) throw new SyntaxError(`função repetida: ${nome}`);
        b.funcoes[nome] = { params, lets, corpo };
      } else throw new SyntaxError(`inesperado no bloco ${caminho}: ${JSON.stringify(t[i]?.v)}`);
    }
    exige('p', '}');
    return b;
  }
  function bin(prox, ops) {
    return () => { let e = prox(); while (t[i] && (t[i].k === 'p' || t[i].k === 'id') && ops.includes(t[i].v)) { const op = t[i++].v; e = { tipo: 'bin', op, a: e, b: prox() }; } return e; };
  }
  function expr() { return ou(); }
  function ou() { return bin(e2, ['||'])(); }
  function e2() { return bin(e3, ['&&'])(); }
  function e3() { return bin(e4, ['==', '!=', '<', '<=', '>', '>=', 'in', 'is'])(); }
  function e4() { return bin(e5, ['+', '-'])(); }
  function e5() { return bin(unario, ['*', '/', '%'])(); }
  function unario() { if (ver('p', '!') || ver('p', '-')) { const op = t[i++].v; return { tipo: 'un', op, a: unario() }; } return posfixo(); }
  function posfixo() {
    let e = primario();
    for (;;) {
      if (ver('p', '.')) { i++; e = { tipo: 'campo', a: e, nome: exige('id').v }; }
      else if (ver('p', '(')) { i++; const args = []; while (!ver('p', ')')) { args.push(expr()); if (ver('p', ',')) i++; } i++; e = { tipo: 'chama', f: e, args }; }
      else if (ver('p', '[')) { i++; const idx = expr(); exige('p', ']'); e = { tipo: 'indice', a: e, idx }; }
      else return e;
    }
  }
  function primario() {
    if (ver('p', '(')) { i++; const e = expr(); exige('p', ')'); return e; }
    if (ver('p', '[')) { i++; const itens = []; while (!ver('p', ']')) { itens.push(expr()); if (ver('p', ',')) i++; } i++; return { tipo: 'lista', itens }; }
    if (ver('str') || ver('num')) return { tipo: 'lit', v: t[i++].v };
    if (ver('id')) {
      const v = t[i++].v;
      if (v === 'true' || v === 'false') return { tipo: 'lit', v: v === 'true' };
      if (v === 'null') return { tipo: 'lit', v: null };
      return { tipo: 'nome', v };
    }
    throw new SyntaxError(`expressão inesperada: ${JSON.stringify(t[i]?.v)}`);
  }
}

// ------------------------------------------------------------------ avaliação
class ErroRegra extends Error {}
const falha = (m) => { throw new ErroRegra(m); };
const ehMapa = (x) => x !== null && typeof x === 'object' && !Array.isArray(x) && !(x instanceof Instante);
class Instante { constructor(ms) { this.ms = ms; } }
const SEM_VALOR = Symbol('sem valor (list)');
const DOC_LISTA = '\u0000doc-de-list'; // segmento de documento de uma consulta list: a variável do match fica SEM_VALOR
function igual(a, b) {
  if (a === SEM_VALOR || b === SEM_VALOR) return false;
  if (Array.isArray(a) && Array.isArray(b)) return a.length === b.length && a.every((x, k) => igual(x, b[k]));
  if (ehMapa(a) && ehMapa(b)) { const ka = Object.keys(a).sort(); const kb = Object.keys(b).sort(); return igual(ka, kb) && ka.every((k) => igual(a[k], b[k])); }
  return a === b;
}
const TIPOS = { string: (x) => typeof x === 'string', int: (x) => Number.isInteger(x), float: (x) => typeof x === 'number', number: (x) => typeof x === 'number', bool: (x) => typeof x === 'boolean', map: ehMapa, list: Array.isArray, timestamp: (x) => x instanceof Instante };

function metodo(alvo, nome, args) {
  if (ehMapa(alvo)) {
    if (nome === 'keys') return Object.keys(alvo);
    if (nome === 'size') return Object.keys(alvo).length;
    if (nome === 'get') return Object.hasOwn(alvo, args[0]) ? alvo[args[0]] : args[1];
  }
  if (Array.isArray(alvo)) {
    if (nome === 'size') return alvo.length;
    if (nome === 'hasOnly') return alvo.every((x) => args[0].some((y) => igual(x, y)));
    if (nome === 'hasAll') return args[0].every((y) => alvo.some((x) => igual(x, y)));
    if (nome === 'hasAny') return args[0].some((y) => alvo.some((x) => igual(x, y)));
  }
  if (typeof alvo === 'string') {
    if (nome === 'matches') return new RegExp(`^(?:${args[0]})$`).test(alvo);
    if (nome === 'size') return alvo.length;
  }
  if (alvo instanceof Instante && nome === 'toMillis') return alvo.ms;
  return falha(`método ${nome} indisponível`);
}

function avaliar(e, amb) {
  switch (e.tipo) {
    case 'lit': return e.v;
    case 'lista': return e.itens.map((x) => avaliar(x, amb));
    case 'nome': if (Object.hasOwn(amb.vars, e.v)) return amb.vars[e.v]; return falha(`nome indefinido: ${e.v}`);
    case 'campo': {
      if (e.a.tipo === 'nome' && e.a.v === 'math' && !Object.hasOwn(amb.vars, 'math')) return { __math: e.nome };
      const a = avaliar(e.a, amb);
      if (ehMapa(a) && Object.hasOwn(a, e.nome)) return a[e.nome];
      return falha(`campo ausente: ${e.nome}`);
    }
    case 'indice': { const a = avaliar(e.a, amb); const k = avaliar(e.idx, amb); if (a != null && Object.hasOwn(a, k)) return a[k]; return falha('índice ausente'); }
    case 'chama': {
      const args = e.args.map((x) => avaliar(x, amb));
      if (e.f.tipo === 'nome') {
        const fn = amb.funcoes[e.f.v]; if (!fn) return falha(`função indefinida: ${e.f.v}`);
        if (fn.params.length !== args.length) return falha(`aridade de ${e.f.v}`);
        if ((amb.prof || 0) > 20) return falha('recursão');
        const vars = { ...amb.vars }; fn.params.forEach((p, k) => { vars[p] = args[k]; });
        const sub = { ...amb, vars, prof: (amb.prof || 0) + 1 };
        for (const [n, x] of fn.lets) sub.vars = { ...sub.vars, [n]: avaliar(x, sub) };
        return avaliar(fn.corpo, sub);
      }
      if (e.f.tipo === 'campo') {
        if (e.f.a.tipo === 'nome' && e.f.a.v === 'math' && !Object.hasOwn(amb.vars, 'math')) {
          if (e.f.nome === 'abs' && typeof args[0] === 'number') return Math.abs(args[0]);
          return falha(`math.${e.f.nome}`);
        }
        return metodo(avaliar(e.f.a, amb), e.f.nome, args);
      }
      return falha('chamada inválida');
    }
    case 'un': {
      const a = avaliar(e.a, amb);
      if (e.op === '!') return typeof a === 'boolean' ? !a : falha('! em não booleano');
      return typeof a === 'number' ? -a : falha('- em não número');
    }
    case 'bin': {
      if (e.op === '||' || e.op === '&&') {
        const curto = e.op === '||'; // || : true vence erro; && : false vence erro
        let a; let erroA = null;
        try { a = avaliar(e.a, amb); if (typeof a !== 'boolean') falha(`${e.op} em não booleano`); } catch (x) { if (!(x instanceof ErroRegra)) throw x; erroA = x; }
        if (!erroA && a === curto) return curto;
        const b = avaliar(e.b, amb); if (typeof b !== 'boolean') falha(`${e.op} em não booleano`);
        if (erroA) { if (b === curto) return curto; throw erroA; }
        return b;
      }
      if (e.op === 'is') { const a = avaliar(e.a, amb); const tipo = e.b.tipo === 'nome' ? e.b.v : falha('is sem tipo'); if (!TIPOS[tipo]) falha(`tipo desconhecido: ${tipo}`); return TIPOS[tipo](a); }
      const a = avaliar(e.a, amb); const b = avaliar(e.b, amb);
      switch (e.op) {
        case '==': return igual(a, b);
        case '!=': return !igual(a, b);
        case 'in': if (Array.isArray(b)) return b.some((x) => igual(x, a)); if (ehMapa(b)) return Object.hasOwn(b, a); return falha('in sem lista/mapa');
      }
      if (typeof a !== 'number' || typeof b !== 'number') return falha(`${e.op} em não número`);
      switch (e.op) {
        case '<': return a < b; case '<=': return a <= b; case '>': return a > b; case '>=': return a >= b;
        case '+': return a + b; case '-': return a - b; case '*': return a * b; case '/': return b === 0 ? falha('divisão por zero') : a / b; case '%': return a % b;
      }
      return falha(`operador ${e.op}`);
    }
  }
  return falha(`nó desconhecido ${e.tipo}`);
}

// Casa um caminho (segmentos) com um padrão de match; devolve as variáveis e o resto, ou null.
function casar(padrao, segs) {
  const ps = padrao.split('/').filter(Boolean); const vars = {};
  for (let k = 0; k < ps.length; k++) {
    const m = /^\{(\w+)(=\*\*)?\}$/.exec(ps[k]);
    if (m && m[2]) { if (k !== ps.length - 1) throw new SyntaxError(`{${m[1]}=**} só no fim: ${padrao}`); const r = segs.slice(k); vars[m[1]] = r.includes(DOC_LISTA) ? SEM_VALOR : r.join('/'); return { vars, resto: [] }; }
    if (k >= segs.length) return null;
    if (m) vars[m[1]] = segs[k] === DOC_LISTA ? SEM_VALOR : segs[k]; else if (ps[k] !== segs[k]) return null;
  }
  return { vars, resto: segs.slice(ps.length) };
}

// Coleta os allow (com funções visíveis e variáveis) de todos os blocos que casam EXATAMENTE com o documento.
function regrasDoCaminho(arv, segs) {
  const achadas = [];
  const visita = (b, resto, vars, funcoes) => {
    const c = casar(b.caminho, resto); if (!c) return;
    const v = { ...vars, ...c.vars }; const f = { ...funcoes, ...b.funcoes };
    if (c.resto.length === 0) for (const a of b.allows) achadas.push({ ...a, vars: v, funcoes: f });
    for (const filho of b.filhos) visita(filho, c.resto, v, f);
  };
  for (const b of arv.blocos) visita(b, segs, {}, {});
  return achadas;
}

const copia = (x) => JSON.parse(JSON.stringify(x));
function fundir(base, novo) { // set com merge: mapas fundem em profundidade; o resto substitui
  const r = copia(base);
  for (const [k, v] of Object.entries(novo)) r[k] = ehMapa(v) && ehMapa(r[k]) ? fundir(r[k], v) : copia(v);
  return r;
}

const AGORA_REGRAS = Date.now(); // request.time: casos.mjs também lê Date.now() ao carregar (mesma máquina)
/** Decide um caso { quem, op, caminho, dados } contra a árvore de regras: 'permitido' | 'negado'. */
function decidir(arv, c, semente = SEMENTE) {
  const lista = c.op === 'list';
  const segs = ['databases', '(default)', 'documents', ...c.caminho.split('/'), ...(lista ? [DOC_LISTA] : [])];
  const atual = lista ? null : semente[c.caminho] ?? null;
  let metodo; let novo = null;
  switch (c.op) {
    case 'get': metodo = 'get'; break;
    case 'list': metodo = 'list'; break;
    case 'delete': metodo = 'delete'; break;
    case 'set': metodo = atual ? 'update' : 'create'; novo = copia(c.dados); break;
    case 'merge': metodo = atual ? 'update' : 'create'; novo = fundir(atual || {}, c.dados); break;
    case 'update': if (!atual) return 'negado'; metodo = 'update'; novo = { ...copia(atual), ...copia(c.dados) }; break;
    default: throw new Error(`op desconhecida: ${c.op}`);
  }
  const grupo = { get: 'read', list: 'read', create: 'write', update: 'write', delete: 'write' }[metodo];
  const request = { auth: c.quem === 'anon' ? null : { uid: c.quem }, time: new Instante(AGORA_REGRAS), method: metodo };
  if (novo) request.resource = { data: novo };
  const resource = atual ? { data: copia(atual) } : null;
  for (const a of regrasDoCaminho(arv, segs)) {
    if (!a.metodos.includes(metodo) && !a.metodos.includes(grupo)) continue;
    const vars = { ...a.vars, request, resource };
    try { if (avaliar(a.cond, { vars, funcoes: a.funcoes }) === true) return 'permitido'; } catch (x) { if (!(x instanceof ErroRegra)) throw x; }
  }
  return 'negado';
}

// ------------------------------------------------------------------ testes
let n = 0; const t = (nome, fn) => { try { fn(); n++; } catch (e) { console.error('✗ ' + nome); throw e; } };
const divergentes = (src) => { const arv = analisar(src); return CASOS.filter((c) => decidir(arv, c) !== c.esperado).map((c) => c.id).sort(); };
const OWN = 'request.auth != null && request.auth.uid == uid';

t('1. sintaxe e estrutura: rules_version 2, um service, users/{uid} dentro de /databases/{database}/documents, resto negado', () => {
  const arv = analisar(REGRAS);
  assert.equal(arv.versao, '2');
  assert.equal(arv.blocos.length, 1); assert.equal(arv.blocos[0].caminho, '/databases/{database}/documents');
  const filhos = arv.blocos[0].filhos.map((b) => b.caminho);
  assert.deepEqual(filhos, ['/users/{uid}', '/{document=**}']);
  const users = arv.blocos[0].filhos[0];
  for (const f of users.allows) assert.notDeepEqual(f.cond, { tipo: 'lit', v: true }, 'allow sem condição em users/{uid}');
  const resto = arv.blocos[0].filhos[1];
  assert.deepEqual(resto.allows.map((a) => [a.metodos, a.cond]), [[['read', 'write'], { tipo: 'lit', v: false }]]);
  // toda função chamada existe no escopo
  const chamadas = new Set(); const anda = (e) => { if (!e || typeof e !== 'object') return; if (e.tipo === 'chama' && e.f.tipo === 'nome') chamadas.add(e.f.v); Object.values(e).forEach((x) => (Array.isArray(x) ? x.forEach(anda) : anda(x))); };
  users.allows.forEach((a) => anda(a.cond)); Object.values(users.funcoes).forEach((f) => { anda(f.corpo); f.lets.forEach(([, x]) => anda(x)); });
  for (const c of chamadas) assert.ok(users.funcoes[c], `função ${c} chamada e não definida`);
});

t('2. o analisador recusa regras quebradas (sensibilidade)', () => {
  const quebras = [
    ['sem ;', REGRAS.replace(/(allow read, delete: if [^;]*);/, '$1')],
    ['chave a menos', REGRAS.slice(0, REGRAS.lastIndexOf('}'))],
    ['método inventado', REGRAS.replace('allow read, delete:', 'allow read, apagar:')],
    ['string sem fim', REGRAS.replace("'createdAt'", "'createdAt")],
    ['operador inválido', REGRAS.replace('<= 200', '=< 200')],
  ];
  for (const [nome, src] of quebras) { assert.notEqual(src, REGRAS, `${nome}: mutação não alterou o texto`); assert.throws(() => analisar(src), SyntaxError, nome); }
  // função usada e não definida: parse passa, avaliação nega tudo o que depende dela
  const semFuncao = REGRAS.replace('function pedidoOk()', 'function pedidoOkX()');
  assert.ok(divergentes(semFuncao).length > 0, 'remover função deveria mudar decisões');
});

t('3. todos os casos de firebase/test/casos.mjs decidem como esperado (avaliador local)', () => {
  const arv = analisar(REGRAS);
  const erros = CASOS.filter((c) => decidir(arv, c) !== c.esperado).map((c) => `${c.id} (esperado ${c.esperado})`);
  assert.deepEqual(erros, []);
});

t('4. controle negativo do workflow: sem a checagem de dono divergem exatamente os casos outro-usuario', () => {
  assert.ok(REGRAS.includes(OWN));
  const afrouxadas = REGRAS.split(OWN).join('request.auth != null');
  const esperadas = CASOS.filter((c) => c.grupo === 'outro-usuario').map((c) => c.id).sort();
  assert.deepEqual(divergentes(afrouxadas), esperadas);
});

const M2 = /allow create:[^;]*keys\(\)\.hasAll\(\['createdAt',\s*'termsAt'\]\)/.test(REGRAS);
t('5. regra M2: tirar o hasAll reabre exatamente a lacuna (criação parcial), se a M2 estiver nas regras', () => {
  if (!M2) return;
  const lacuna = CASOS.filter((c) => c.grupo === 'criacao' && c.esperado === 'negado').map((c) => c.id);
  const semM2 = REGRAS.replace(/\s*&& request\.resource\.data\.keys\(\)\.hasAll\(\['createdAt','termsAt'\]\)/, '');
  assert.notEqual(semM2, REGRAS);
  const div = divergentes(semM2);
  assert.ok(div.length >= 5 && div.every((id) => lacuna.includes(id)), `divergiram ${div.join(' ')}`);
  for (const id of ['m2-cria-parcial-favorito', 'm2-cria-parcial-alerta', 'm2-cria-sem-termsAt', 'm2-cria-sem-createdAt', 'm2-cria-vazio']) assert.ok(div.includes(id), `${id} deveria divergir sem a M2`);
});

t('6. semântica básica do avaliador (|| e && tolerantes a erro, merge profundo, update sem documento)', () => {
  const amb = { vars: { m: { a: 1 } }, funcoes: {} };
  const e = (s) => analisar(`rules_version = '2'; service cloud.firestore { match /x { allow read: if ${s}; } }`).blocos[0].allows[0].cond;
  assert.equal(avaliar(e('m.z == 1 || true'), amb), true);
  assert.equal(avaliar(e('m.z == 1 && false'), amb), false);
  assert.throws(() => avaliar(e('m.z == 1 || false'), amb), ErroRegra);
  assert.equal(avaliar(e("'a' in m && m.keys().hasOnly(['a']) && !('b' in m)"), amb), true);
  assert.deepEqual(fundir({ t: { a: 1, b: 2 }, x: 1 }, { t: { a: 9 } }), { t: { a: 9, b: 2 }, x: 1 });
  const arv = analisar(REGRAS);
  assert.equal(decidir(arv, { quem: 'novo', op: 'update', caminho: 'users/novo', dados: { name: 'x' } }), 'negado');
});

console.log(`firestore-regras-avaliador-tests: ${n} grupos ok; ${CASOS.length} casos avaliados localmente; regra M2 ${M2 ? 'presente' : 'ausente'} (avaliador próprio, NÃO é o emulador: ver limite no cabeçalho)`);
