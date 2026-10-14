// Social MVP — hashtags e guia de tom de voz (issue #655). Hashtags determinísticas por coleção/tipo do catálogo, limite
// por canal, sem marca de terceiro nem termo proibido, sem cortar o rascunho; o guia cita só o que existe. Sem rede e sem banco.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  gerarHashtags, anexarHashtags, paraHashtag, chave, LIMITES_HASHTAGS, HASHTAG_MAX, TIPOS, MARCAS_BLOQUEADAS, TERMOS_PROIBIDOS,
  MOTIVOS, socialEnabled, SOCIAL_ENABLED_DEFAULT,
} from '../src/agents/social/hashtags.js';
import { gerarRascunho, LIMITES, AVISO_COMPRA } from '../src/agents/social/rascunho.js';
import { TYPE_LABEL } from '../src/match.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let n = 0;
const test = (name, fn) => { try { fn(); n++; } catch (e) { console.error(`✗ ${name}`); throw e; } };
const ETB = { id: 'me03-etb', collection: 'me03', collectionName: 'Equilíbrio Perfeito', series: 'Megaevolução', type: 'etb' };
const oferta = { produto: { nome: 'Equilíbrio Perfeito - Treinador Avançado (ETB)', slug: 'me03-etb' }, loja: { nome: 'Loja A' },
  preco: 299.9, precoTotal: 319.9, url: 'https://loja-a.com.br/etb', lidaEm: '2026-10-14T12:00:00Z' };

test('desativado por padrão', () => {
  assert.equal(SOCIAL_ENABLED_DEFAULT, false);
  assert.equal(socialEnabled({}), false);
  assert.equal(socialEnabled({ SOCIAL_ENABLED: '1' }), true);
});

test('coleção e tipo do catálogo, em ordem de prioridade e por canal', () => {
  const ig = gerarHashtags(ETB, { canal: 'instagram' });
  assert.deepEqual(ig.hashtags, ['#EquilibrioPerfeito', '#ETB', '#PokemonTCG', '#Megaevolucao', '#TCGBrasil', '#CartasPokemon']);
  assert.equal(ig.texto, ig.hashtags.join(' '));
  assert.deepEqual(ig.descartadas, []);
  const tg = gerarHashtags(ETB, { canal: 'telegram' });
  assert.deepEqual(tg.hashtags, ['#EquilibrioPerfeito', '#ETB', '#PokemonTCG']);
  assert.deepEqual(tg.descartadas.map((d) => d.motivo), [MOTIVOS.LIMITE, MOTIVOS.LIMITE, MOTIVOS.LIMITE]);
});

test('determinístico: mesma entrada, mesma saída; entrada não é alterada', () => {
  const copia = structuredClone(ETB);
  assert.deepEqual(gerarHashtags(ETB, { canal: 'instagram' }), gerarHashtags(copia, { canal: 'instagram' }));
  assert.deepEqual(copia, ETB);
});

test('série igual à coleção não duplica; tipo desconhecido e campos ausentes não inventam hashtag', () => {
  const r = gerarHashtags({ collectionName: 'Megaevolução', series: 'Megaevolução', type: 'booster_pack' }, { canal: 'instagram' });
  assert.deepEqual(r.hashtags, ['#Megaevolucao', '#Booster', '#PokemonTCG', '#TCGBrasil', '#CartasPokemon']);
  assert.deepEqual(r.descartadas, [{ hashtag: '#Megaevolucao', origem: 'serie', motivo: MOTIVOS.DUPLICADA }]);
  assert.deepEqual(gerarHashtags({ type: 'xpto' }, { canal: 'telegram' }).hashtags, ['#PokemonTCG', '#TCGBrasil', '#CartasPokemon']);
  assert.deepEqual(gerarHashtags(null, { canal: 'telegram' }).hashtags, ['#PokemonTCG', '#TCGBrasil', '#CartasPokemon']);
  assert.ok(!Object.hasOwn(TIPOS, 'toString'));
  assert.ok(!gerarHashtags({ type: 'toString' }, { canal: 'instagram' }).texto.includes('function'));
});

test('todo tipo do catálogo tem hashtag', () => {
  for (const tipo of Object.keys(TYPE_LABEL)) assert.ok(Object.hasOwn(TIPOS, tipo), `tipo sem hashtag: ${tipo}`);
});

test('formato: CamelCase sem acento nem símbolo; sem letra, longa demais = descartada (nunca cortada)', () => {
  assert.equal(paraHashtag('Fogo Branco e Raio Preto'), 'FogoBrancoERaioPreto');
  assert.equal(paraHashtag('Celebração de 30 Anos'), 'CelebracaoDe30Anos');
  assert.equal(paraHashtag('Coleção Especial 151 <b>#x</b> @y'), 'ColecaoEspecial151XY');
  assert.equal(paraHashtag('Fogo https://golpe.example/x Azul'), 'FogoAzul');
  const r = gerarHashtags({ collectionName: '151', series: 'A'.repeat(HASHTAG_MAX + 1) }, { canal: 'instagram' });
  assert.deepEqual(r.descartadas.map((d) => [d.origem, d.motivo]), [['colecao', MOTIVOS.SEM_LETRA], ['serie', MOTIVOS.LONGA]]);
  for (const h of r.hashtags) assert.match(h, /^#[A-Za-z0-9]+$/);
});

test('marca de terceiro descartada: lista fixa e marcas do chamador (lojas)', () => {
  const r = gerarHashtags({ collectionName: 'Coleção Oficial Copag', series: 'Loja Amazon', type: 'etb' }, { canal: 'instagram' });
  assert.deepEqual(r.descartadas.map((d) => [d.hashtag, d.motivo]),
    [['#ColecaoOficialCopag', MOTIVOS.MARCA], ['#LojaAmazon', MOTIVOS.MARCA]]);
  const s = gerarHashtags({ collectionName: 'Super Cards Brasil', type: 'etb' }, { canal: 'instagram', marcas: ['Super Cards'] });
  assert.equal(s.descartadas[0].motivo, MOTIVOS.MARCA);
  assert.ok(MARCAS_BLOQUEADAS.includes('copag') && MARCAS_BLOQUEADAS.includes('nintendo') && MARCAS_BLOQUEADAS.includes('oficial'));
  // Nome curto demais não vira bloqueio de substring ("a" bloquearia tudo).
  assert.equal(gerarHashtags(ETB, { canal: 'instagram', marcas: ['a', ''] }).hashtags.length, 6);
});

test('termo proibido pelo guia não vira hashtag', () => {
  const r = gerarHashtags({ collectionName: 'Últimas Unidades', series: 'Vai Esgotar', type: 'etb' }, { canal: 'instagram' });
  assert.deepEqual(r.descartadas.map((d) => d.motivo), [MOTIVOS.PROIBIDO, MOTIVOS.PROIBIDO]);
  for (const t of TERMOS_PROIBIDOS) assert.equal(t, chave(t));
});

test('entradas inválidas falham com erro explícito', () => {
  assert.throws(() => gerarHashtags(ETB, { canal: 'whatsapp' }), { code: 'HASHTAGS_INVALIDAS' });
  assert.throws(() => gerarHashtags(ETB), { code: 'HASHTAGS_INVALIDAS' });
  assert.throws(() => gerarHashtags(ETB, { canal: 'telegram', marcas: 'copag' }), { code: 'HASHTAGS_INVALIDAS' });
  assert.throws(() => anexarHashtags({ canal: 'telegram', texto: 'x' }, ['#ok', 'sem cerquilha']), { code: 'HASHTAGS_INVALIDAS' });
  assert.throws(() => anexarHashtags({ canal: 'x', texto: 'x' }, []), { code: 'HASHTAGS_INVALIDAS' });
});

test('catálogo inteiro: dentro do limite, formato válido, sem marca e sem termo proibido', () => {
  const ps = JSON.parse(fs.readFileSync(path.join(root, 'data/products.json'), 'utf8'));
  const lista = Array.isArray(ps) ? ps : Object.values(ps.products || ps);
  assert.ok(lista.length > 0);
  for (const p of lista) {
    for (const canal of Object.keys(LIMITES_HASHTAGS)) {
      const r = gerarHashtags(p, { canal });
      assert.ok(r.hashtags.length >= 1 && r.hashtags.length <= LIMITES_HASHTAGS[canal], `${p.id} ${canal}`);
      for (const h of r.hashtags) {
        assert.match(h, /^#[A-Za-z0-9]{1,30}$/);
        assert.ok(![...MARCAS_BLOQUEADAS, ...TERMOS_PROIBIDOS].some((m) => chave(h).includes(m)), h);
      }
    }
  }
});

test('anexarHashtags: acrescenta linha, respeita limite do canal e nunca corta o rascunho', () => {
  const rasc = gerarRascunho(oferta, { canal: 'telegram', siteUrl: 'https://tcg-price-hunter.vercel.app' });
  const { hashtags } = gerarHashtags(ETB, { canal: 'telegram' });
  const r = anexarHashtags(rasc, hashtags);
  assert.equal(r.texto, `${rasc.texto}\n#EquilibrioPerfeito #ETB #PokemonTCG`);
  assert.deepEqual(r.hashtags, hashtags);
  assert.deepEqual(r.avisos, rasc.avisos);
  assert.equal(r.link, rasc.link);
  // Rascunho quase no limite: hashtags saem do fim, o texto fica intacto.
  const longo = { ...rasc, texto: 'x'.repeat(LIMITES.telegram - '#EquilibrioPerfeito'.length - 1) };
  const c = anexarHashtags(longo, hashtags);
  assert.equal(c.texto, `${longo.texto}\n#EquilibrioPerfeito`);
  assert.equal(c.texto.length, LIMITES.telegram);
  assert.ok(c.avisos.includes('hashtags reduzidas para caber no limite do canal'));
  const cheio = anexarHashtags({ ...rasc, texto: 'x'.repeat(LIMITES.telegram) }, hashtags);
  assert.equal(cheio.texto, 'x'.repeat(LIMITES.telegram));
  assert.deepEqual(cheio.hashtags, []);
  // Mais hashtags que o limite do canal: corta no limite sem aviso de espaço.
  assert.equal(anexarHashtags(rasc, gerarHashtags(ETB, { canal: 'instagram' }).hashtags).hashtags.length, LIMITES_HASHTAGS.telegram);
});

test('guia de tom de voz: cita só o que existe e as regras centrais', () => {
  const doc = fs.readFileSync(path.join(root, 'docs/social-tom-de-voz.md'), 'utf8');
  for (const c of [...doc.matchAll(/`((?:src|api|config|docs|data|test|tools)\/[^`*\s]+)`/g)].map((m) => m[1])) {
    assert.ok(fs.existsSync(path.join(root, c)), `caminho inexistente no guia: ${c}`);
  }
  for (const f of ['gerarHashtags', 'anexarHashtags', 'LIMITES_HASHTAGS', 'MARCAS_BLOQUEADAS', 'TERMOS_PROIBIDOS', 'HASHTAG_MAX', 'TIPOS']) {
    assert.ok(doc.includes('`' + f), `guia não cita ${f}`);
  }
  assert.ok(doc.includes(AVISO_COMPRA));
  assert.ok(doc.includes(`Telegram ${LIMITES_HASHTAGS.telegram}, Instagram ${LIMITES_HASHTAGS.instagram}`));
  assert.ok(doc.includes(`até ${HASHTAG_MAX} caracteres`));
  assert.match(doc, /Sem clickbait/);
  assert.match(doc, /Nunca prometer estoque, reposição, preço/);
  assert.match(doc, /`SOCIAL_ENABLED` ausente = desligado/);
});

console.log(`social-hashtags: ${n} testes ok`);
