// Social Media — modelos editoriais (issue #648): oferta do dia, queda de preço, reposição e comparação. Cada modelo
// exige seus dados e recusa sem eles (queda sem histórico etc.); o texto final vem de rascunho.js. Sem rede, sem banco.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MODELOS, IDS, MOTIVOS, REGRAS, verificarModelo, modelosElegiveis, gerarPost, socialEnabled, SOCIAL_ENABLED_DEFAULT } from '../src/agents/social/modelos.js';
import { gerarRascunho, LIMITES, CHAMADA_MAX } from '../src/agents/social/rascunho.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let n = 0;
function t(name, fn) { try { fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } }
const SITE = 'https://tcg-price-hunter.vercel.app';
const NOW = Date.parse('2026-10-13T18:00:00.000Z');
const oferta = (o = {}) => ({
  produto: { nome: 'Booster Box Evoluções Prismáticas', slug: 'evolucoes-prismaticas-booster-box' },
  loja: { nome: 'Loja Exemplo' }, preco: 899.9, precoTotal: 925.4,
  url: 'https://loja.exemplo.com.br/p/123', urlDestino: 'https://loja.exemplo.com.br/p/123', disclosure: false,
  lidaEm: '2026-10-13T17:05:00.000Z', emEstoque: true, ...o,
});
const dados = (o = {}, extra = {}) => ({
  oferta: oferta(o),
  historico: [{ preco: 999.9, em: '2026-10-01T12:00:00.000Z' }, { preco: 1099.9, em: '2026-09-20T12:00:00.000Z' }],
  reposicao: { indisponivelEm: '2026-10-10T12:00:00.000Z' },
  comparacao: { alternativas: [
    { loja: { nome: 'Outra Loja' }, preco: 949.9, precoTotal: 970 },
    { loja: { nome: 'Terceira' }, preco: 999, precoTotal: 1010 },
  ] },
  ...extra,
});
const ver = (id, d = dados(), now = NOW) => verificarModelo(id, d, { now });
const post = (id, d = dados(), opts = {}) => gerarPost(id, d, { canal: 'telegram', siteUrl: SITE, now: NOW, ...opts });
const nbsp = (s) => s.replace(/\u00a0/g, ' ');

t('desligado por padrão e catálogo com os quatro modelos, campos e regra', () => {
  assert.equal(SOCIAL_ENABLED_DEFAULT, false);
  assert.equal(!!socialEnabled({}), false);
  assert.equal(socialEnabled({ SOCIAL_ENABLED: '1' }), true);
  assert.deepEqual([...IDS], ['oferta-do-dia', 'queda-de-preco', 'reposicao', 'comparacao']);
  for (const id of IDS) {
    const m = MODELOS[id];
    assert.equal(m.id, id);
    assert.ok(m.titulo && m.regra, id);
    assert.ok(Object.isFrozen(m) && Object.isFrozen(m.campos));
    for (const c of ['oferta.produto.nome', 'oferta.produto.slug', 'oferta.loja.nome', 'oferta.preco', 'oferta.url', 'oferta.lidaEm']) assert.ok(m.campos.includes(c), `${id} sem ${c}`);
  }
  assert.ok(MODELOS['queda-de-preco'].campos.includes('historico'));
  assert.ok(MODELOS.reposicao.campos.includes('reposicao.indisponivelEm'));
  assert.ok(MODELOS.reposicao.campos.includes('oferta.emEstoque'));
  assert.ok(MODELOS.comparacao.campos.includes('comparacao.alternativas'));
  assert.ok(Object.isFrozen(MODELOS) && Object.isFrozen(REGRAS));
});

t('dados completos: os quatro modelos elegíveis e o texto final é o de rascunho.js com a chamada na 1ª linha', () => {
  const { elegiveis, recusados } = modelosElegiveis(dados(), { now: NOW });
  assert.deepEqual(elegiveis, [...IDS]);
  assert.deepEqual(recusados, []);
  for (const id of IDS) {
    const r = post(id);
    const v = ver(id);
    assert.equal(r.modelo, id);
    assert.deepEqual({ canal: r.canal, texto: r.texto, link: r.link, avisos: r.avisos },
      gerarRascunho(oferta(), { canal: 'telegram', siteUrl: SITE, chamada: v.chamada }));
    assert.equal(r.texto.split('\n')[0], nbsp(v.chamada));
    assert.equal(r.texto.split('\n')[1], 'Booster Box Evoluções Prismáticas');
  }
});

t('chamadas: oferta do dia, queda com preço anterior/data/percentual, reposição, comparação com base declarada', () => {
  assert.equal(post('oferta-do-dia').texto.split('\n')[0], 'Oferta do dia');
  const q = nbsp(post('queda-de-preco').texto.split('\n')[0]);
  assert.equal(q, 'Queda de preço: de R$ 999,90 em 01/10/2026 para R$ 899,90 (10% menos)');
  assert.equal(post('reposicao').texto.split('\n')[0], 'De volta ao estoque: estava indisponível em 10/10/2026');
  assert.equal(post('comparacao').texto.split('\n')[0], 'Comparação: menor total com frete entre 3 lojas comparadas');
  // Sem total em alguma loja: compara só o preço do produto e diz isso.
  const semTotal = dados({}, { comparacao: { alternativas: [{ loja: { nome: 'Outra Loja' }, preco: 949.9 }] } });
  assert.equal(post('comparacao', semTotal).texto.split('\n')[0], 'Comparação: menor preço (sem contar frete) entre 2 lojas comparadas');
});

t('queda de preço sem histórico é recusada (e gerarPost lança com motivo)', () => {
  for (const historico of [undefined, null, [], '']) {
    const r = ver('queda-de-preco', dados({}, { historico }));
    assert.equal(r.ok, false);
    assert.equal(r.motivo, MOTIVOS.FALTANDO);
    assert.deepEqual(r.faltando, ['historico']);
  }
  assert.throws(() => post('queda-de-preco', dados({}, { historico: [] })), (e) => e.code === 'MODELO_RECUSADO' && e.motivo === MOTIVOS.FALTANDO && /historico/.test(e.message));
  // Histórico só com pontos inválidos, posteriores à leitura ou fora da janela = sem histórico.
  for (const historico of [
    [{ preco: 'x', em: '2026-10-01T12:00:00.000Z' }, null, { preco: 999 }],
    [{ preco: 999, em: '2026-10-13T17:30:00.000Z' }],
    [{ preco: 999, em: '2026-08-01T12:00:00.000Z' }],
  ]) assert.equal(ver('queda-de-preco', dados({}, { historico })).motivo, MOTIVOS.SEM_HISTORICO);
});

t('queda de preço: compara com o ponto anterior MAIS RECENTE; subida, empate ou queda < 1% recusam', () => {
  // O ponto mais recente (900) vence o mais antigo e mais alto (1099,90): sem exagerar a queda.
  assert.equal(ver('queda-de-preco', dados({}, { historico: [{ preco: 1099.9, em: '2026-09-20T12:00:00.000Z' }, { preco: 900, em: '2026-10-12T12:00:00.000Z' }] })).motivo, MOTIVOS.SEM_QUEDA);
  for (const anterior of [899.9, 800, 905]) {
    assert.equal(ver('queda-de-preco', dados({}, { historico: [{ preco: anterior, em: '2026-10-12T12:00:00.000Z' }] })).motivo, MOTIVOS.SEM_QUEDA, String(anterior));
  }
  const ok = ver('queda-de-preco', dados({}, { historico: [{ preco: 910, em: '2026-10-12T12:00:00.000Z' }] }));
  assert.equal(ok.ok, true);
  assert.match(nbsp(ok.chamada), /\(1% menos\)$/);
  assert.equal(REGRAS.quedaMinima, 0.01);
});

t('reposição exige estoque confirmado agora e indisponibilidade ANTES da leitura', () => {
  assert.deepEqual(ver('reposicao', dados({ emEstoque: undefined })).faltando, ['oferta.emEstoque']);
  assert.equal(ver('reposicao', dados({ emEstoque: false })).motivo, MOTIVOS.SEM_ESTOQUE);
  assert.equal(ver('reposicao', dados({ emEstoque: 'true' })).motivo, MOTIVOS.SEM_ESTOQUE);
  assert.deepEqual(ver('reposicao', dados({}, { reposicao: undefined })).faltando, ['reposicao.indisponivelEm']);
  assert.equal(ver('reposicao', dados({}, { reposicao: { indisponivelEm: 'ontem' } })).motivo, MOTIVOS.SEM_INDISPONIBILIDADE);
  assert.equal(ver('reposicao', dados({}, { reposicao: { indisponivelEm: '2026-10-13T17:30:00.000Z' } })).motivo, MOTIVOS.SEM_INDISPONIBILIDADE);
});

t('comparação exige alternativa válida de OUTRA loja e oferta estritamente menor na mesma base', () => {
  assert.deepEqual(ver('comparacao', dados({}, { comparacao: { alternativas: [] } })).faltando, ['comparacao.alternativas']);
  assert.deepEqual(ver('comparacao', dados({}, { comparacao: undefined })).faltando, ['comparacao.alternativas']);
  const so = (alternativas) => ver('comparacao', dados({}, { comparacao: { alternativas } })).motivo;
  assert.equal(so([{ loja: { nome: ' loja exemplo ' }, preco: 999 }, { loja: { nome: 'Sem preço' } }, { preco: 999 }, null]), MOTIVOS.SEM_ALTERNATIVAS);
  assert.equal(so([{ loja: { nome: 'Outra' }, preco: 850, precoTotal: 990 }]), '');                // total: 925,40 < 990
  assert.equal(so([{ loja: { nome: 'Outra' }, preco: 900, precoTotal: 920 }]), MOTIVOS.NAO_E_MENOR); // preço maior, mas total 925,40 > 920
  assert.equal(so([{ loja: { nome: 'Outra' }, preco: 850 }]), MOTIVOS.NAO_E_MENOR);                   // sem total: só preço
  assert.equal(so([{ loja: { nome: 'Outra' }, preco: 900, precoTotal: 925.4 }]), MOTIVOS.NAO_E_MENOR); // empate não é "menor"
  // Frete da oferta desconhecido: base é o preço, mesmo com total nas alternativas.
  assert.match(ver('comparacao', dados({ precoTotal: null })).chamada, /sem contar frete/);
});

t('oferta do dia: só leitura nas últimas 24 h; leitura no futuro ou inválida recusa todos', () => {
  assert.equal(ver('oferta-do-dia', dados({ lidaEm: '2026-10-12T17:00:00.000Z' })).motivo, MOTIVOS.VELHA);
  assert.equal(ver('oferta-do-dia', dados({ lidaEm: '2026-10-12T18:30:00.000Z' })).ok, true);
  for (const lidaEm of ['2026-10-13T19:00:00.000Z', 'ontem']) {
    const { elegiveis, recusados } = modelosElegiveis(dados({ lidaEm }), { now: NOW });
    assert.deepEqual(elegiveis, []);
    assert.ok(recusados.every((r) => r.motivo === MOTIVOS.LEITURA), lidaEm);
  }
  assert.deepEqual(ver('oferta-do-dia', dados({ lidaEm: undefined })).faltando, ['oferta.lidaEm']);
});

t('recusas gerais: modelo desconhecido, dados ausentes, preço inválido, relógio inválido', () => {
  for (const id of ['', 'promo', '__proto__', 'constructor', null, 1]) assert.equal(verificarModelo(id, dados(), { now: NOW }).motivo, MOTIVOS.MODELO);
  const vazio = ver('oferta-do-dia', null);
  assert.equal(vazio.motivo, MOTIVOS.FALTANDO);
  assert.equal(vazio.faltando.length, 6);
  assert.deepEqual(ver('oferta-do-dia', dados({ produto: { nome: '  ', slug: 'x' } })).faltando, ['oferta.produto.nome']);
  for (const preco of [0, -1, NaN, '899']) assert.equal(ver('oferta-do-dia', dados({ preco })).motivo, MOTIVOS.PRECO);
  assert.equal(ver('oferta-do-dia', dados(), NaN).motivo, MOTIVOS.RELOGIO);
  assert.throws(() => post('promo'), /modelo desconhecido/);
  // O que rascunho.js recusa continua recusado (ex.: URL sem https): o modelo não afrouxa nada.
  assert.throws(() => post('oferta-do-dia', dados({ url: 'http://loja.exemplo.com.br/p/1' })), /URL https/);
});

t('limite do canal e divulgação preservados com a chamada; nome enorme encolhe', () => {
  const d = dados({ produto: { nome: 'Coleção '.repeat(400), slug: 'colecao' }, disclosure: true });
  for (const canal of ['telegram', 'instagram']) for (const id of IDS) {
    const r = post(id, d, { canal });
    assert.ok(r.texto.length <= LIMITES[canal], `${id}/${canal}`);
    assert.ok(r.avisos.includes('nome do produto truncado'));
    assert.match(r.texto, /Link de afiliado/);
    assert.ok(ver(id, d).chamada.length <= CHAMADA_MAX);
  }
  // Sem chamada, rascunho.js segue igual ao de antes; chamada inválida é recusada.
  assert.equal(gerarRascunho(oferta(), { canal: 'telegram', siteUrl: SITE }).texto.split('\n')[0], 'Booster Box Evoluções Prismáticas');
  assert.throws(() => gerarRascunho(oferta(), { canal: 'telegram', siteUrl: SITE, chamada: 1 }), /chamada não é texto/);
  assert.throws(() => gerarRascunho(oferta(), { canal: 'telegram', siteUrl: SITE, chamada: '<b></b>' }), /chamada vazia/);
  assert.throws(() => gerarRascunho(oferta(), { canal: 'telegram', siteUrl: SITE, chamada: 'x'.repeat(CHAMADA_MAX + 1) }), /chamada excede/);
  assert.equal(gerarRascunho(oferta(), { canal: 'telegram', siteUrl: SITE, chamada: 'Oi <b>@x</b> https://a.b' }).texto.split('\n')[0], 'Oi x');
});

t('determinístico e sem mutar a entrada', () => {
  const d = dados();
  const antes = JSON.stringify(d);
  assert.deepEqual(post('queda-de-preco', d), post('queda-de-preco', d));
  modelosElegiveis(d, { now: NOW });
  assert.equal(JSON.stringify(d), antes);
});

t('isolamento: não importa rede, banco, afiliados nem publica', () => {
  const src = fs.readFileSync(path.join(root, 'src/agents/social/modelos.js'), 'utf8');
  const imports = [...src.matchAll(/^import .* from '([^']+)';/gm)].map((m) => m[1]);
  assert.deepEqual(imports.sort(), ['../../format.js', './rascunho.js']);
  assert.ok(!/\bfetch\s*\(|process\.env|require\(|import\(|affiliat/i.test(src.replace(/^\/\/.*$/gm, '')));
  assert.ok(!/api\.telegram\.org|graph\.facebook\.com|graph\.instagram\.com/.test(src));
});

console.log(`social-modelos: ${n} testes ok`);
