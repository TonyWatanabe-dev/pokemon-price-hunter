// Extensão de captura (27/11/2026): leitor compartilhado (DOM simulado, fixtures SINTÉTICAS), lote do dia do service worker,
// manifest/arquivos gerados e publicador local (git/gh simulados por injeção). Sem rede, sem jsdom, sem tocar no repo.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CAP = path.join(ROOT, 'tools', 'captura');
const EXT = path.join(CAP, 'extensao');
const norm = (s) => s.replace(/\r\n/g, '\n');
const carregar = (arq, exportar) => vm.runInNewContext(`${fs.readFileSync(arq, 'utf8')}\n;({${exportar}})`, {});
// Objetos vindos do vm têm outros protótipos: viaJson normaliza antes do deepEqual.
const viaJson = (x) => JSON.parse(JSON.stringify(x));
const AGORA ='2026-11-27T12:00:00.000Z';

// ---------------------------------------------------------------- leitor (DOM simulado)
const L = carregar(path.join(CAP, 'leitor.js'), 'lerPagina, itensValidos, lojaDoHost');
assert.equal(L.lojaDoHost('lista.mercadolivre.com.br'), 'mercadolivre');
assert.equal(L.lojaDoHost('shopee.com.br'), 'shopee');
assert.equal(L.lojaDoHost('www.amazon.com.br'), 'amazon');
assert.equal(L.lojaDoHost('exemplo.test'), null);
assert.deepEqual(viaJson(L.lerPagina({}, { hostname: 'exemplo.test' }, AGORA)), { loja: null, itens: [] });

// Elemento simulado: textContent + respostas por seletor (a chave é o seletor exato usado pelo leitor).
const el = (textContent, extra = {}) => ({
  textContent, attrs: extra.attrs || {}, sel: extra.sel || {}, innerText: extra.innerText, href: extra.href,
  querySelector(s) { return this.sel[s] || null; },
  querySelectorAll(s) { return this.lista?.[s] || []; },
  getAttribute(n) { return this.attrs[n] ?? null; },
  closest() { return null; },
});
const SEL_TITULO = '.poly-component__title, .ui-search-item__title, h2, h3';
const SEL_PRECO = '.poly-price__current .andes-money-amount, .ui-search-price__second-line .andes-money-amount, .andes-money-amount:not(.andes-money-amount--previous)';
const preco = (f, c) => el('', { sel: { '.andes-money-amount__fraction': el(f), ...(c ? { '.andes-money-amount__cents': el(c) } : {}) } });

// Mercado Livre
const cardML = el('Blister Pokémon TCG Frete grátis', {
  sel: { [SEL_TITULO]: el('Blister Pokémon TCG'), [SEL_PRECO]: preco('1.049', '9'), '.andes-money-amount--previous': preco('1.199', '90'), '.poly-component__seller, .ui-search-official-store-label': el('por LOJA TESTE') },
});
cardML.lista = { 'a[href]': [{ href: 'https://produto.mercadolivre.com.br/MLB-4111222333-blister-_JM?x=1' }] };
const cardSemId = el('Sem id', { sel: { [SEL_TITULO]: el('Sem id'), [SEL_PRECO]: preco('10') } });
cardSemId.lista = { 'a[href]': [{ href: 'https://exemplo.test/x' }] };
const docML = { querySelectorAll: () => [cardML, cardSemId] };
const ml = L.lerPagina(docML, { hostname: 'lista.mercadolivre.com.br', origin: 'https://lista.mercadolivre.com.br' }, AGORA);
assert.equal(ml.loja, 'mercadolivre');
assert.equal(ml.itens.length, 2);
assert.deepEqual(viaJson(ml.itens[0]), { loja: 'mercadolivre', id: 'MLB4111222333', titulo: 'Blister Pokémon TCG', preco: 1049.9, precoDe: 1199.9, vendedor: 'LOJA TESTE', freteGratis: true, url: 'https://produto.mercadolivre.com.br/MLB-4111222333-blister-_JM?x=1', capturadoEm: AGORA });
assert.equal(L.itensValidos(ml.itens).length, 1, 'cartão sem id não vale');

// Amazon
const cardAz = el('Booster Pokémon Frete GRÁTIS', {
  attrs: { 'data-asin': 'B0ABCDEF12' },
  sel: { 'h2 span, h2': el('Booster Pokémon TCG'), '.a-price:not(.a-text-price) .a-offscreen': el('R$ 29,90'), '.a-price.a-text-price .a-offscreen': el('R$ 39,90') },
});
const docAz = { querySelectorAll: () => [cardAz, el('x', { attrs: {} })] };
const az = L.lerPagina(docAz, { hostname: 'www.amazon.com.br', origin: 'https://www.amazon.com.br' }, AGORA);
assert.equal(az.itens.length, 1, 'card sem ASIN é ignorado');
assert.deepEqual(viaJson(az.itens[0]), { loja: 'amazon', id: 'B0ABCDEF12', titulo: 'Booster Pokémon TCG', preco: 29.9, precoDe: 39.9, vendedor: null, freteGratis: true, url: 'https://www.amazon.com.br/dp/B0ABCDEF12', capturadoEm: AGORA });

// Shopee
const docSh = { querySelectorAll: () => [
  { href: 'https://shopee.com.br/Blister-Pokemon-i.111.222?sp=1', innerText: 'Blister Pokémon TCG Triplo\nR$ 89,90\n1,2mil vendidos\nFrete grátis' },
  { href: 'https://shopee.com.br/Blister-Pokemon-i.111.222?sp=2', innerText: 'repetido' },
  { href: 'https://shopee.com.br/Outro-i.333.444', innerText: 'Box Pokémon\nR$ 100,00 - R$ 150,00' },
  { href: 'https://shopee.com.br/categoria', innerText: 'não é produto' },
] };
const sh = L.lerPagina(docSh, { hostname: 'shopee.com.br', origin: 'https://shopee.com.br' }, AGORA);
assert.equal(sh.itens.length, 2, 'dedupe por id e links que não são produto ficam de fora');
assert.deepEqual(viaJson(sh.itens[0]), { loja: 'shopee', id: '111/222', titulo: 'Blister Pokémon TCG Triplo', preco: 89.9, precoDe: null, vendedor: null, freteGratis: true, url: 'https://shopee.com.br/Blister-Pokemon-i.111.222', capturadoEm: AGORA });
assert.equal(sh.itens[1].titulo, 'Box Pokémon / várias opções');
assert.equal(sh.itens[1].preco, 100);
assert.equal(sh.itens[1].precoDe, 150);

// ---------------------------------------------------------------- lote do dia (service worker)
const B = carregar(path.join(EXT, 'lote.js'), 'LOJAS, acumular, total, montarArquivo, nomeArquivo, aGravar, esperaGravacao, marcarGravado, urlDados, itemValido, dia, loteVazio');
const it = (id, preco, extra = {}) => ({ loja: 'mercadolivre', id, titulo: 'Blister ' + id, preco, capturadoEm: AGORA, ...extra });
const DIA = '2026-11-27';
assert.equal(B.dia(new Date(2026, 10, 7)), '2026-11-07');
let lote = B.loteVazio(DIA);
lote = B.acumular(lote, 'mercadolivre', [it('MLB1', 10), it('MLB2', 20), { id: 'MLB3', titulo: '', preco: 5 }, it('MLB4', 0)], DIA);
assert.equal(B.total(lote, 'mercadolivre'), 2, 'inválidos (sem título, preço 0) ficam de fora');
lote = B.acumular(lote, 'mercadolivre', [it('MLB1', 9), it('MLB5', 50)], DIA);
assert.equal(B.total(lote, 'mercadolivre'), 3, 'dedupe por id');
assert.equal(lote.lojas.mercadolivre.itens.MLB1.preco, 9, 'o último vence');
assert.equal(B.total(lote, 'shopee'), 0);
assert.equal(B.acumular(lote, 'outra', [it('X', 1)], DIA), lote, 'loja desconhecida é ignorada');
const antes = B.acumular(B.loteVazio(DIA), 'amazon', [it('B0A', 5, { loja: 'amazon' })], DIA);
assert.equal(B.total(B.acumular(antes, 'amazon', [it('B0B', 6, { loja: 'amazon' })], '2026-11-28'), 'amazon'), 1, 'dia novo recomeça o lote');
assert.deepEqual(viaJson(B.montarArquivo(lote, 'mercadolivre')), { versao: 1, loja: 'mercadolivre', origem: 'extensao', itens: viaJson(Object.values(lote.lojas.mercadolivre.itens)) });
assert.equal(B.nomeArquivo('shopee', DIA), 'tph-capturas/captura-shopee-2026-11-27.json');
assert.equal(JSON.parse(decodeURIComponent(B.urlDados({ a: 'ç' }).split(',')[1])).a, 'ç');
assert.ok(B.urlDados({}).startsWith('data:application/json'));
// janela de 30 s por loja
assert.equal(B.aGravar(lote, 'mercadolivre', 1000), true, 'nunca gravou: grava');
assert.equal(B.aGravar(lote, 'shopee', 1000), false, 'loja sem itens: nada a gravar');
let gravado = B.marcarGravado(lote, 'mercadolivre', 1000);
assert.equal(B.aGravar(gravado, 'mercadolivre', 5000), false, 'sem mudança pendente');
gravado = B.acumular(gravado, 'mercadolivre', [it('MLB9', 1)], DIA);
assert.equal(B.aGravar(gravado, 'mercadolivre', 20000), false, 'dentro dos 30 s agrupa');
assert.equal(B.esperaGravacao(gravado, 'mercadolivre', 20000), 11000);
assert.equal(B.aGravar(gravado, 'mercadolivre', 31000), true);
assert.equal(B.aGravar(B.acumular(gravado, 'mercadolivre', [it('MLB9', 1)], DIA), 'mercadolivre', 31000), true);
const idem = B.marcarGravado(gravado, 'mercadolivre', 31000);
assert.equal(B.acumular(idem, 'mercadolivre', [it('MLB9', 1)], DIA).lojas.mercadolivre.sujo, false, 'mesmo item não suja o lote');

// ---------------------------------------------------------------- manifest e arquivos gerados
const man = JSON.parse(fs.readFileSync(path.join(EXT, 'manifest.json'), 'utf8'));
assert.equal(man.manifest_version, 3);
assert.equal(man.name, 'TCG Price Hunter – Captura');
assert.deepEqual(man.permissions, ['storage', 'downloads']);
assert.deepEqual(man.host_permissions, ['https://lista.mercadolivre.com.br/*', 'https://www.mercadolivre.com.br/*', 'https://shopee.com.br/*', 'https://www.amazon.com.br/*']);
for (const f of ['background.js', 'popup.html', 'popup.js', 'popup.css', 'lote.js', ...man.content_scripts[0].js]) assert.ok(fs.existsSync(path.join(EXT, f)), `falta ${f}`);
const { gerarArquivos, buscasDaExtensao } = await import('../tools/captura/build-extensao.mjs');
for (const [nome, conteudo] of Object.entries(gerarArquivos())) assert.equal(norm(fs.readFileSync(path.join(EXT, nome), 'utf8')), norm(conteudo), `extensao/${nome} desatualizado: rode node tools/captura/build-extensao.mjs`);
const bs = buscasDaExtensao();
assert.deepEqual([bs.mercadolivre.length, bs.shopee.length, bs.amazon.length], [22, 6, 6], '11 buscas do ML com pág. 2, 6 da Shopee, 6 da Amazon');
assert.ok(bs.mercadolivre.every((b) => b.url.startsWith('https://lista.mercadolivre.com.br/')));
assert.ok(bs.amazon.every((b) => b.url.startsWith('https://www.amazon.com.br/s?k=')) && bs.shopee.every((b) => b.url.startsWith('https://shopee.com.br/search?keyword=')));
// buscas feitas (✓ no popup)
const K = vm.runInNewContext(`${fs.readFileSync(path.join(EXT, 'lote.js'), 'utf8')}\n;({chaveBusca, marcarBusca, estadoBusca, VALIDADE_BUSCA_MS})`, { URL });
assert.equal(K.chaveBusca('https://lista.mercadolivre.com.br/pokemon-tcg-blister-duplo#D[A:x]'), 'mercadolivre:/pokemon-tcg-blister-duplo');
assert.notEqual(K.chaveBusca('https://lista.mercadolivre.com.br/pokemon-tcg-blister-duplo_Desde_49_NoIndex_True'), K.chaveBusca('https://lista.mercadolivre.com.br/pokemon-tcg-blister-duplo'), 'pág. 2 é outra busca');
assert.equal(K.chaveBusca('https://shopee.com.br/search?keyword=pokemon%20tcg%20blister&page=0'), K.chaveBusca('https://shopee.com.br/search?keyword=Pokemon+TCG+blister'));
assert.equal(K.chaveBusca('https://www.amazon.com.br/s?k=pokemon+tcg+blister&ref=nb'), 'amazon:pokemon tcg blister');
assert.equal(K.chaveBusca('https://www.amazon.com.br/dp/B0X'), null);
const T0 = Date.UTC(2026, 10, 27, 18);
let bus = K.marcarBusca({}, 'https://www.amazon.com.br/s?k=pokemon+tcg+blister', 12, T0);
assert.deepEqual(viaJson(K.estadoBusca(bus, 'https://www.amazon.com.br/s?k=pokemon+tcg+blister', T0 + 1000)), { feita: true, em: T0, n: 12 });
bus = K.marcarBusca(bus, 'https://www.amazon.com.br/s?k=pokemon+tcg+blister', 5, T0 + 2000);
assert.equal(bus['amazon:pokemon tcg blister'].n, 12, 'guarda o maior número lido na mesma janela');
assert.equal(K.estadoBusca(bus, 'https://www.amazon.com.br/s?k=pokemon+tcg+blister', T0 + K.VALIDADE_BUSCA_MS + 5000).feita, false, 'vence em 48 h');
assert.deepEqual(K.marcarBusca(bus, 'https://www.amazon.com.br/s?k=x', 0, T0), bus, 'página sem ofertas não marca');

// a extensão não faz requisição nem abre páginas sozinha
for (const f of ['background.js', 'popup.js', 'content.js', 'leitor.js', 'lote.js']) {
  let src = fs.readFileSync(path.join(EXT, f), 'utf8').replace(/\/\/.*$/gm, '');
  // Única exceção: o botão do popup abre as buscas pendentes em abas, e só no clique do dono (bt.onclick).
  if (f === 'popup.js') {
    const usos = src.match(/chrome\.tabs\.\w+/g) || [];
    assert.deepEqual([...new Set(usos)], ['chrome.tabs.create'], 'popup só usa chrome.tabs.create');
    const clique = src.indexOf('bt.onclick');
    assert.ok(clique > 0 && src.indexOf('chrome.tabs.create') > clique, 'abas só abrem dentro do clique do dono');
    src = src.replace(/chrome\.tabs\.create/g, '');
  }
  assert.ok(!/\bfetch\s*\(|XMLHttpRequest|WebSocket|chrome\.tabs\.|window\.open|\.click\(\)|scrollTo|scrollBy|chrome\.cookies/.test(src), `${f} não pode fazer requisição, navegar, rolar ou clicar`);
}
// o favorito continua gerando JavaScript válido com o leitor embutido
const { gerarFavorito } = await import('../tools/captura/build.mjs');
const fav = decodeURIComponent(gerarFavorito().replace(/^javascript:/, ''));
new vm.Script(fav);
assert.ok(fav.includes('function lerPagina') && fav.includes('tph_captura_v1'));

// ---------------------------------------------------------------- publicador (git/gh simulados)
const P = await import('../tools/captura/publicar-capturas-tarefa.mjs');
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tph-pub-'));
const dir = path.join(tmp, 'tph-capturas');
const autoDir = path.join(tmp, 'auto');
fs.mkdirSync(dir);
const gravar = (nome, loja, n, rotulo = '') => fs.writeFileSync(path.join(dir, nome), JSON.stringify({ versao: 1, loja, origem: 'extensao', itens: Array.from({ length: n }, (_, i) => it('MLB' + i + rotulo, 10 + i)) }));
assert.equal(P.pastaEntrada({ TPH_CAPTURAS_DIR: 'x' }), 'x');
assert.equal(P.pastaEntrada({ USERPROFILE: 'C:\\U' }), path.join('C:\\U', 'Downloads', 'tph-capturas'));
assert.deepEqual(P.arquivosNovos(path.join(tmp, 'inexistente'), { arquivos: {} }), []);

// simulador: registra chamadas; `cfg` controla o que o git/gh respondem
function simular(cfg = {}) {
  const chamadas = [];
  const run = (cmd, args) => {
    chamadas.push([cmd, ...args].join(' '));
    const a = args.join(' ');
    const ok = (stdout = '') => ({ status: 0, stdout, stderr: '' });
    if (cmd === 'git' && a === 'status --porcelain') return ok(cfg.suja ? ' M x' : '');
    if (cmd === 'git' && a.startsWith('status --porcelain config')) return ok(cfg.mudou === false ? '' : ' M config/x.json');
    if (cmd === 'gh' && a.startsWith('pr create')) return ok('https://github.com/o/r/pull/7\n');
    if (cmd === 'gh' && a.includes('--auto')) return { status: cfg.semAuto ? 1 : 0, stdout: '', stderr: 'auto-merge is not allowed' };
    if (cmd === 'gh' && a.startsWith('pr checks')) return { status: cfg.checksVermelho ? 1 : 0, stdout: '', stderr: '' };
    if (cmd === 'gh' && a.startsWith('pr view')) return ok(cfg.estado || 'MERGED');
    if (cmd === 'git' && a.startsWith('checkout -B')) { if (cfg.falhaCheckout) throw new Error('checkout falhou'); }
    if (cmd !== 'git' && cmd !== 'gh') { if (cfg.falhaImportar) throw new Error('importar falhou'); return ok('importado\n'); }
    return ok();
  };
  return { run, chamadas };
}
const estadoDe = () => JSON.parse(fs.readFileSync(path.join(autoDir, 'publicados.json'), 'utf8'));
const mudo = () => {};
const quando = new Date(2026, 10, 27, 14, 30);

// nada novo → sai 0, 1 linha de log, nenhuma chamada git/gh
{
  const s = simular(); const logs = [];
  assert.equal(P.rodar({ dir, autoDir, run: s.run, agora: quando, log: (m) => logs.push(m) }), 0);
  assert.equal(s.chamadas.length, 0);
  assert.equal(logs.length, 1);
}
// arquivo novo → importa, PR com título explícito, merge por squash (sem auto), marca como publicado
gravar('captura-mercadolivre-2026-11-27.json', 'mercadolivre', 3);
gravar('captura-shopee-2026-11-27.json', 'shopee', 2);
fs.writeFileSync(path.join(dir, 'ignorado.json'), '{}');
fs.writeFileSync(path.join(dir, 'captura-amazon-2026-11-27.json'), 'não é json');
{
  const s = simular({ semAuto: true });
  assert.equal(P.rodar({ dir, autoDir, run: s.run, agora: quando, log: mudo }), 0);
  const c = s.chamadas.join('\n');
  assert.equal(s.chamadas.filter((x) => x.startsWith(process.execPath) && x.includes('captura-importar.mjs')).length, 2, 'importa cada arquivo novo válido');
  assert.equal((c.match(/gh pr create/g) || []).length, 1, 'um único PR por rodada');
  assert.ok(c.includes('checkout -B capturas-extensao/20261127-1430 origin/main'));
  assert.ok(c.includes('--title afiliados: capturas da extensão 2026-11-27 14:30 (ML 3, Shopee 2, Amazon 0)'));
  assert.ok(c.includes('--base main --head capturas-extensao/20261127-1430') && !c.includes('--fill'));
  assert.ok(c.includes('pr checks https://github.com/o/r/pull/7 --watch --fail-fast') && c.includes('pr merge https://github.com/o/r/pull/7 --squash --delete-branch'));
  assert.ok(c.trim().endsWith('git checkout main'));
  assert.deepEqual(Object.keys(estadoDe().arquivos).sort(), ['captura-mercadolivre-2026-11-27.json', 'captura-shopee-2026-11-27.json']);
}
// mesmo conteúdo → nada novo; conteúdo alterado → novo (detecção por hash)
{
  const s = simular();
  assert.equal(P.rodar({ dir, autoDir, run: s.run, agora: quando, log: mudo }), 0);
  assert.equal(s.chamadas.length, 0, 'hash igual não reprocessa');
  gravar('captura-shopee-2026-11-27.json', 'shopee', 4);
  assert.deepEqual(P.arquivosNovos(dir, P.lerEstado(path.join(autoDir, 'publicados.json'))).map((n) => n.nome), ['captura-amazon-2026-11-27.json', 'captura-shopee-2026-11-27.json']);
}
// auto-merge disponível e concluído → marca; ainda pendente → não marca
{
  const s = simular({ estado: 'OPEN' });
  assert.equal(P.rodar({ dir, autoDir, run: s.run, agora: quando, log: mudo }), 0);
  assert.ok(s.chamadas.some((c) => c.includes('--auto')));
  assert.notEqual(estadoDe().arquivos['captura-shopee-2026-11-27.json'], undefined);
  const antes = estadoDe().arquivos['captura-shopee-2026-11-27.json'];
  assert.equal(antes === P.hashDe(fs.readFileSync(path.join(dir, 'captura-shopee-2026-11-27.json'))), false, 'PR em aberto: não marca');
  const s2 = simular({ estado: 'MERGED' });
  assert.equal(P.rodar({ dir, autoDir, run: s2.run, agora: quando, log: mudo }), 0);
  assert.equal(estadoDe().arquivos['captura-shopee-2026-11-27.json'], P.hashDe(fs.readFileSync(path.join(dir, 'captura-shopee-2026-11-27.json'))), 'merge confirmado: marca');
}
// importação sem mudança → marca sem PR; falhas → não marca e volta para a main
{
  gravar('captura-shopee-2026-11-27.json', 'shopee', 5);
  const sem = simular({ mudou: false });
  assert.equal(P.rodar({ dir, autoDir, run: sem.run, agora: quando, log: mudo }), 0);
  assert.ok(!sem.chamadas.some((c) => c.startsWith('gh ')), 'sem mudança: sem PR');
  assert.equal(estadoDe().arquivos['captura-shopee-2026-11-27.json'], P.hashDe(fs.readFileSync(path.join(dir, 'captura-shopee-2026-11-27.json'))));

  gravar('captura-shopee-2026-11-27.json', 'shopee', 6);
  const hashNovo = P.hashDe(fs.readFileSync(path.join(dir, 'captura-shopee-2026-11-27.json')));
  for (const cfg of [{ falhaImportar: true }, { checksVermelho: true, semAuto: true }, { suja: true }, { falhaCheckout: true }]) {
    const f = simular(cfg);
    assert.equal(P.rodar({ dir, autoDir, run: f.run, agora: quando, log: mudo }), 1, JSON.stringify(cfg));
    assert.notEqual(estadoDe().arquivos['captura-shopee-2026-11-27.json'], hashNovo, `${JSON.stringify(cfg)}: falha não marca como publicado`);
    assert.ok(f.chamadas.at(-1) === 'git checkout main', `${JSON.stringify(cfg)}: volta para a main`);
    assert.ok(!f.chamadas.some((c) => /--force|push -f|reset --hard|clean/.test(c)));
  }
}
fs.rmSync(tmp, { recursive: true, force: true });
console.log('captura-extensao-tests: ok');
