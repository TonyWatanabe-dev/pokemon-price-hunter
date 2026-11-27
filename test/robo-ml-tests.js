// Robô local do ML: parser da busca, robots.txt, detecção de bloqueio e rodada (fixture SINTÉTICA, sem rede).
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { UA, listaDeBuscas, urlBusca, parseRobots, robotsPermite, lerBuscaML, itensValidos, detectarBloqueio, decodificarEntidades, rodar } from '../tools/captura/robo-ml.mjs';

const AGORA = '2026-11-27T12:00:00.000Z';
const HTML = `<html><body><ol class="ui-search-layout">
<li class="ui-search-layout__item"><div class="poly-card poly-card--grid-card">
  <a class="poly-component__title" href="https://produto.mercadolivre.com.br/MLB-4111222333-blister-pokemon-tcg-_JM?x=1">Blister Pok&eacute;mon TCG &amp; Cia</a>
  <span class="poly-component__seller">por LOJA TESTE</span>
  <s class="andes-money-amount andes-money-amount--previous andes-money-amount--cents-comma" aria-label="Antes: 1199 reais com 90 centavos"><span class="andes-money-amount__fraction">1.199</span><span class="andes-money-amount__cents">90</span></s>
  <div class="poly-price__current"><span class="andes-money-amount andes-money-amount--cents-superscript"><span class="andes-money-amount__currency-symbol">R$</span><span class="andes-money-amount__fraction">1.049</span><span class="andes-money-amount__cents">9</span></span></div>
  <span class="poly-component__shipping">Frete gr&aacute;tis</span>
</div></li>
<li class="ui-search-layout__item"><div class="poly-card">
  <a class="poly-component__title" href="https://click1.mercadolivre.com.br/mclics?url=https%3A%2F%2Fwww.mercadolivre.com.br%2Fp%3Fwid%3DMLB5555666%26x%3D1">Booster Copag</a>
  <div class="poly-price__current"><span class="andes-money-amount" aria-label="29 reais com 90 centavos"></span></div>
</div></li>
<li class="ui-search-layout__item"><div class="poly-card">
  <a class="poly-component__title" href="https://exemplo.test/sem-id">Cartão sem id</a>
  <div class="poly-price__current"><span class="andes-money-amount"><span class="andes-money-amount__fraction">10</span></span></div>
</div></li>
</ol></body></html>`;

// --- lerBuscaML
const todos = lerBuscaML(HTML, AGORA);
assert.equal(todos.length, 3);
const [a, b, c] = todos;
assert.equal(a.id, 'MLB4111222333');
assert.equal(a.titulo, 'Blister Pokémon TCG & Cia');
assert.equal(a.preco, 1049.9);
assert.equal(a.precoDe, 1199.9);
assert.equal(a.vendedor, 'LOJA TESTE');
assert.equal(a.freteGratis, true);
assert.equal(a.url, 'https://produto.mercadolivre.com.br/MLB-4111222333-_JM');
assert.equal(a.loja, 'mercadolivre');
assert.equal(a.capturadoEm, AGORA);
assert.equal(b.id, 'MLB5555666');
assert.equal(b.preco, 29.9);
assert.equal(b.precoDe, null);
assert.equal(b.vendedor, null);
assert.equal(b.freteGratis, false);
assert.equal(c.id, null);
assert.equal(c.url, null);
assert.equal(c.preco, 10);
assert.deepEqual(itensValidos(todos).map((i) => i.id), ['MLB4111222333', 'MLB5555666']);
assert.equal(lerBuscaML('<html>nada</html>', AGORA).length, 0);
assert.equal(decodificarEntidades('a&nbsp;b &#233; &#xE9; &zzz;'), 'a b é é &zzz;');

// só .poly-card, sem <li>
assert.equal(lerBuscaML('<div class="poly-card"><a class="poly-component__title" href="/MLB-1234567-x">T</a><span class="andes-money-amount"><span class="andes-money-amount__fraction">5</span></span></div>', AGORA)[0].id, 'MLB1234567');

// --- buscas
const buscas = listaDeBuscas();
assert.equal(buscas.length, 22);
assert.equal(urlBusca('pokemon-tcg-booster-box', 1), 'https://lista.mercadolivre.com.br/pokemon-tcg-booster-box');
assert.equal(urlBusca('pokemon-tcg-booster-box', 2), 'https://lista.mercadolivre.com.br/pokemon-tcg-booster-box_Desde_49_NoIndex_True');
assert.equal(UA, 'TCGPriceHunterBot/1.0 (+https://tcgpricehunter.com.br/bot)');

// --- robots.txt
const g1 = parseRobots('User-agent: ClaudeBot\nDisallow: /\n\nUser-agent: *\nDisallow: /search/bookmarks/\nDisallow: /jms/\n# c\nAllow: /jms/ok$\n');
assert.equal(robotsPermite(g1, 'ClaudeBot/1.0', '/pokemon-tcg-blister-unitario'), false);
assert.equal(robotsPermite(g1, UA, '/pokemon-tcg-blister-unitario'), true);
assert.equal(robotsPermite(g1, UA, '/search/bookmarks/x'), false);
assert.equal(robotsPermite(g1, UA, '/jms/ok'), true);
assert.equal(robotsPermite(g1, UA, '/jms/ok2'), false);
const g2 = parseRobots('User-agent: *\nDisallow: /\nUser-agent: TCGPriceHunterBot\nAllow: /pokemon-*\nDisallow: /pokemon-tcg-secreto');
assert.equal(robotsPermite(g2, UA, '/pokemon-tcg-blister-unitario_Desde_49_NoIndex_True'), true);
assert.equal(robotsPermite(g2, UA, '/pokemon-tcg-secreto'), false, 'regra mais longa vence');
assert.equal(robotsPermite(g2, 'Outro/1', '/pokemon-tcg-x'), false, 'grupo * aplica a outros');
assert.equal(robotsPermite(parseRobots('User-agent: *\nDisallow:\n'), UA, '/qualquer'), true, 'Disallow vazio libera');
assert.equal(robotsPermite(parseRobots('User-agent: *\nDisallow: /*.json$'), UA, '/a/b.json'), false);
assert.equal(robotsPermite(parseRobots('User-agent: *\nDisallow: /*.json$'), UA, '/a/b.json?x'), true);

// --- bloqueio
assert.match(detectarBloqueio({ status: 403, urlFinal: '', html: '', cartoes: 0 }), /403/);
assert.match(detectarBloqueio({ status: 200, urlFinal: 'https://www.mercadolivre.com/jms/mlb/lgz/login', html: '', cartoes: 5 }), /verificação/);
assert.match(detectarBloqueio({ status: 200, urlFinal: 'https://x/account-verification', html: '', cartoes: 5 }), /verificação/);
assert.match(detectarBloqueio({ status: 200, urlFinal: 'https://x/ok', html: '<div>captcha</div>', cartoes: 0 }), /captcha/);
assert.match(detectarBloqueio({ status: 200, urlFinal: 'https://x/ok', html: '<p>vazio</p>', cartoes: 0 }), /nenhum cartão/);
assert.equal(detectarBloqueio({ status: 200, urlFinal: 'https://lista.mercadolivre.com.br/x', html: HTML, cartoes: 3 }), null);

// --- rodada com rede simulada
const resp = (status, body, url) => ({ status, url, text: async () => body });
const robotsOk = 'User-agent: *\nDisallow: /search/bookmarks/\n';
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'robo-ml-'));
const pausas = [];
const sem = { pausa: async (ms) => { pausas.push(ms); }, log: () => {}, saidaDir: tmp };
const ok = await rodar({ ...sem, buscarFn: async (u) => (u.endsWith('/robots.txt') ? resp(200, robotsOk, u) : resp(200, HTML, u)) });
assert.equal(ok.codigo, 0);
assert.equal(ok.itens, 2, 'deduplicado por id');
assert.equal(pausas.length, 21);
assert.ok(pausas.every((ms) => ms >= 8000 && ms < 12000));
const saida = JSON.parse(fs.readFileSync(ok.arquivo, 'utf8'));
assert.equal(saida.versao, 1);
assert.equal(saida.loja, 'mercadolivre');
assert.equal(saida.origem, 'robo-local');
assert.match(path.basename(ok.arquivo), /^captura-mercadolivre-\d{4}-\d{2}-\d{2}-\d{2}-\d{2}\.json$/);

const semArquivos = fs.mkdtempSync(path.join(os.tmpdir(), 'robo-ml-'));
const vistos = [];
const bloq = await rodar({ ...sem, saidaDir: semArquivos, buscarFn: async (u) => { vistos.push(u); return u.endsWith('/robots.txt') ? resp(200, robotsOk, u) : vistos.length > 3 ? resp(403, 'x', u) : resp(200, HTML, u); } });
assert.equal(bloq.codigo, 2);
assert.equal(vistos.length, 4, 'para na primeira resposta ruim, sem nova tentativa');
assert.equal(bloq.itens, 2, 'o que foi lido antes do bloqueio é gravado');
assert.equal(fs.readdirSync(semArquivos).length, 1);
for (const f of fs.readdirSync(semArquivos)) fs.unlinkSync(path.join(semArquivos, f));

const semRobots = await rodar({ ...sem, buscarFn: async (u) => resp(500, '', u) });
assert.equal(semRobots.codigo, 1);

const bloqueadoPeloRobots = [];
const pulou = await rodar({ ...sem, saidaDir: semArquivos, buscarFn: async (u) => { bloqueadoPeloRobots.push(u); return u.endsWith('/robots.txt') ? resp(200, `User-agent: ${'TCGPriceHunterBot'}\nDisallow: /\n`, u) : resp(200, HTML, u); } });
assert.equal(pulou.codigo, 0);
assert.equal(bloqueadoPeloRobots.length, 1, 'só baixou o robots.txt');

console.log('robo-ml-tests: ok');
