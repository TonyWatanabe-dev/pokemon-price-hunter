// Community Manager — privacidade nas mensagens da comunidade (issue #659). Dados 100% sintéticos: telefone, e-mail,
// CPF e chaves Pix são mascarados antes de log/auditoria, o original não sobra em lugar nenhum do resultado,
// texto comum é preservado e o módulo é puro (sem rede, banco, env nem fs).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  mascararMensagem, mascararTexto, mascararClassificacao, MARCAS, TEXTO_MAX, SOCIAL_ENABLED_DEFAULT,
} from '../src/agents/social/privacidade.js';
import { classificarMensagem } from '../src/agents/social/moderacao.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let n = 0;
const test = (name, fn) => { try { fn(); n++; } catch (e) { console.error(`✗ ${name}`); throw e; } };
const digitos = (s) => s.replace(/\D/g, '');
// Nem o valor nem a sequência de dígitos dele podem sobrar no texto mascarado.
const semVazar = (entrada, segredo, tipo) => {
  const r = mascararMensagem(entrada);
  assert.ok(!r.texto.includes(segredo), `vazou ${JSON.stringify(segredo)} em ${JSON.stringify(r.texto)}`);
  const d = digitos(segredo);
  if (d.length >= 8) assert.ok(!digitos(r.texto).includes(d), `vazaram os dígitos de ${segredo}: ${r.texto}`);
  if (tipo) assert.ok(r.mascarados[tipo] >= 1 && r.texto.includes(MARCAS[tipo]), `${entrada} devia marcar ${tipo}: ${JSON.stringify(r)}`);
  return r;
};

test('entrada vazia ou não-string vira texto vazio, sem lançar', () => {
  const zero = { telefone: 0, email: 0, cpf: 0, pix: 0 };
  for (const t of ['', undefined, null, 42, {}, [], true]) assert.deepEqual(mascararMensagem(t), { texto: '', mascarados: zero });
  for (const o of [null, 'x', [], 7, { max: -1 }, { max: 'a' }]) assert.doesNotThrow(() => mascararMensagem('(11) 98765-4321', o));
  assert.equal(mascararTexto(null), '');
});

test('telefone em vários formatos', () => {
  for (const [t, s] of [
    ['me chama no (11) 98765-4321', '(11) 98765-4321'],
    ['zap 11 98765 4321', '11 98765 4321'],
    ['fixo 11 3333-4444', '11 3333-4444'],
    ['+55 21 99876-5432 só whats', '+55 21 99876-5432'],
    ['+5521998765432', '5521998765432'],
    ['liga 5511987654321', '5511987654321'],
    ['celular 98765-4321', '98765-4321'],
    ['tel:11.98765.4321', '11.98765.4321'],
  ]) semVazar(t, s, 'telefone');
});

test('e-mail, inclusive com acento e sinal de mais', () => {
  semVazar('manda pra fulano.teste+tcg@exemplo.test agora', 'fulano.teste+tcg@exemplo.test', 'email');
  semVazar('contato: joão_silva@exemplo.com.br', 'joão_silva@exemplo.com.br', 'email');
});

test('CPF formatado e só com dígitos', () => {
  semVazar('meu cpf 123.456.789-09 tá certo?', '123.456.789-09', 'cpf');
  semVazar('cpf 12345678909', '12345678909', 'cpf');
});

test('chave Pix: aleatória, CNPJ, CPF, e-mail e telefone usados como chave', () => {
  semVazar('chave aleatória 123e4567-e89b-12d3-a456-426614174000', '123e4567-e89b-12d3-a456-426614174000', 'pix');
  semVazar('chave 123e4567e89b12d3a456426614174000 ok', '123e4567e89b12d3a456426614174000', 'pix');
  semVazar('minha chave pix é 10.368.321/0001-05', '10.368.321/0001-05', 'pix');
  semVazar('Chave Pix: 10368321000105', '10368321000105', 'pix');
  semVazar('pix: fulano@exemplo.test', 'fulano@exemplo.test', 'pix');
  semVazar('chave do pix = 11987654321', '11987654321', 'pix');
  semVazar('a chave de pix e 123.456.789-09', '123.456.789-09', 'pix');
});

test('vários dados na mesma mensagem: conta por tipo e não guarda o original', () => {
  const r = mascararMensagem('Fulano, (11) 98765-4321, fulano@exemplo.test, cpf 123.456.789-09, chave pix: 10.368.321/0001-05');
  assert.deepEqual(r.mascarados, { telefone: 1, email: 1, cpf: 1, pix: 1 });
  assert.equal(r.texto, `Fulano, ${MARCAS.telefone}, ${MARCAS.email}, cpf ${MARCAS.cpf}, chave pix: ${MARCAS.pix}`);
  assert.deepEqual(Object.keys(r).sort(), ['mascarados', 'texto'], 'resultado só tem texto mascarado e contagens');
  const tudo = JSON.stringify(r);
  for (const s of ['98765', 'fulano@', '123.456', '0001-05']) assert.ok(!tudo.includes(s), `vazou ${s}`);
});

test('unicode: largura total e invisíveis não escapam da máscara', () => {
  semVazar('zap １１ ９８７６５-４３２１', '98765', 'telefone');
  semVazar('ful​ano@exem​plo.test', 'exemplo.test', 'email');
  semVazar('cpf 123.⁠456.789-09', '456', 'cpf');
});

test('reusa src/redact.js: segredos e CEP também somem', () => {
  semVazar('token=abc123-segredo-fake', 'abc123-segredo-fake');
  semVazar('Authorization: Bearer abcDEF1234567890fake', 'abcDEF1234567890fake');
  semVazar('cep 01001-000', '01001-000');
});

test('texto comum é preservado', () => {
  for (const t of [
    'Bom dia! Alguém sabe se a ETB de Fogo Fantasmagórico volta ao estoque?',
    'EAN 7896048202047, CNPJ 10.368.321/0001-05, R$ 1.299,90 em 13/10/2026, carta 191/191.',
    'o site aceita pix? manda pix pra loja oficial',
    'Achei a ETB por R$ 349,90 em https://www.copagloja.com.br/etb-x — valeu!',
    'booster 36 unidades, 2026, coleção SV10',
  ]) assert.equal(mascararTexto(t), t, t);
});

test('limite de tamanho', () => {
  assert.equal(mascararTexto('x'.repeat(5000)).length, TEXTO_MAX + 1);
  assert.equal(mascararTexto('y'.repeat(50), { max: 10 }), 'y'.repeat(10) + '…');
  const longo = mascararTexto('a '.repeat(30000) + '(11) 98765-4321');
  assert.ok(!longo.includes('98765'));
});

test('mascararClassificacao tira o telefone do trecho do classificador sem mudar regra/nível', () => {
  const original = classificarMensagem('me chama no zap (11) 98765-4321 ou fulano@exemplo.test');
  assert.ok(JSON.stringify(original).includes('98765'), 'pré-condição: o classificador devolve o telefone no trecho');
  const m = mascararClassificacao(original);
  assert.equal(m.nivel, original.nivel);
  assert.deepEqual(m.motivos.map((x) => x.regra), original.motivos.map((x) => x.regra));
  assert.ok(!JSON.stringify(m).includes('98765'));
  assert.ok(m.motivos.some((x) => x.trecho === MARCAS.telefone));
  assert.ok(JSON.stringify(original).includes('98765'), 'não altera o objeto recebido');
  for (const r of [null, undefined, 'x', [], { motivos: 'x' }]) assert.deepEqual(mascararClassificacao(r), { nivel: 'ok', motivos: [] });
  assert.deepEqual(mascararClassificacao({ nivel: 'suspeito', motivos: [null, { regra: 'r' }] }).motivos, [{ regra: 'r', trecho: '' }]);
});

test('módulo puro e desligado por padrão: sem rede, banco, fs, env nem publicação', () => {
  assert.equal(SOCIAL_ENABLED_DEFAULT, false);
  const src = fs.readFileSync(path.join(root, 'src/agents/social/privacidade.js'), 'utf8');
  const imports = [...src.matchAll(/^import .* from '([^']+)';/gm)].map((m) => m[1]);
  assert.deepEqual(imports, ['../../redact.js']);
  for (const proibido of [/process\.env/, /\bfetch\(/, /node:(?:fs|http|https|net|child_process)/, /\bpg\b|DATABASE_URL/]) {
    assert.ok(!proibido.test(src.replace(/^\/\/.*$/gm, '')), `não devia usar ${proibido}`);
  }
});

console.log(`social-privacidade-tests: ok (${n} testes)`);
