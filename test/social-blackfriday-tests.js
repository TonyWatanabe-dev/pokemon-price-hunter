// Campanha Black Friday nos grupos (pedido do dono em 02/11/2026): prioridade, validade, legenda, arte e foto.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { candidatosCampanha, fotoDoAnuncio, lerCampanha } from '../src/agents/social/blackfriday.js';
import { candidatosWhatsApp } from '../tools/social-whatsapp.mjs';
import { gerarCard } from '../tools/social-telegram-piloto.mjs';
import { planejar, REGRAS_WHATSAPP } from '../src/agents/social/auto.js';
import { legendaWhatsApp } from '../src/agents/social/whatsapp.js';
import { parseAffiliates } from '../api/_lib/affiliates.mjs';

const CAP = '2026-11-02T19:00:00.000Z';
const NOW = Date.parse(CAP) + 2 * 3600e3;
const of = (item, desconto, blackFriday, preco = 50) => ({ item, titulo: `Oferta ${item}`, preco, desconto, blackFriday, link: `https://meli.la/${item.slice(3)}x` });
const camp = { capturedAt: CAP, ofertas: [of('MLB1000001', 30, false), of('MLB1000002', 10, true), of('MLB1000003', 50, true), of('MLB1000004', 0, true), of('MLB1000005', 60, false), of('MLB1000003', 99, true)] };

let n = 0; const t = (nome, fn) => { try { fn(); n++; } catch (e) { e.message = `[${nome}] ${e.message}`; throw e; } };
const ta = async (nome, fn) => { try { await fn(); n++; } catch (e) { e.message = `[${nome}] ${e.message}`; throw e; } };

t('Black Friday primeiro, maior desconto primeiro; sem desconto e repetido ficam de fora', () => {
  const r = candidatosCampanha(camp, { now: NOW });
  assert.deepEqual(r.map((c) => c.item.ofertaId), ['ml:MLB1000003', 'ml:MLB1000002', 'ml:MLB1000005', 'ml:MLB1000001']);
  assert.deepEqual(r.map((c) => c.tema), ['blackfriday', 'blackfriday', null, null]);
  assert.ok(r.every((c) => c.afiliado === true && c.loja === 'mercadolivre'));
});

t('validade de 24 h e kill switch', () => {
  assert.equal(candidatosCampanha(camp, { now: Date.parse(CAP) + 25 * 3600e3 }).length, 0);
  assert.equal(candidatosCampanha(camp, { now: Date.parse(CAP) - 3600e3 }).length, 0, 'leitura no futuro');
  assert.equal(candidatosCampanha(camp, { now: NOW, env: { SOCIAL_BLACKFRIDAY: '0' } }).length, 0);
  assert.equal(candidatosCampanha(null, { now: NOW }).length, 0);
  assert.equal(candidatosCampanha({ ...camp, validadeHoras: 48 }, { now: Date.parse(CAP) + 40 * 3600e3 }).length, 4, 'validade do arquivo');
  assert.equal(candidatosCampanha({ ...camp, validadeHoras: 500 }, { now: Date.parse(CAP) + 80 * 3600e3 }).length, 0, 'teto de 72 h');
  assert.equal(candidatosCampanha({ capturedAt: CAP, ofertas: [{ ...of('MLB1000009', 20, true), link: 'https://evil.example/x' }] }, { now: NOW }).length, 0, 'link fora do meli.la');
});

t('legenda: selo BF, preço, % do anúncio, data da leitura e link de afiliado', () => {
  const [bf] = candidatosCampanha(camp, { now: NOW });
  const w = legendaWhatsApp(bf.item.texto);
  assert.match(w, /BLACK FRIDAY/);
  assert.match(w, /R\$ 50,00/);
  assert.match(w, /50% OFF no anúncio/);
  assert.match(w, /Preço lido em 02\/11; pode ter mudado/);
  assert.match(w, /https:\/\/meli\.la\/1000003x/);
  const [, , outro] = candidatosCampanha(camp, { now: NOW });
  assert.doesNotMatch(outro.item.texto, /BLACK FRIDAY/);
});

t('WhatsApp: BF na frente da fila do robô; a campanha não duplica anúncio do robô', () => {
  const robo = { offers: [], products: [] };
  const lista = candidatosWhatsApp(robo, { now: NOW, env: { SOCIAL_EXTERNAS: '0' }, campanha: camp });
  assert.deepEqual(lista.slice(0, 2).map((c) => c.item.ofertaId), ['ml:MLB1000003', 'ml:MLB1000002']);
  const p = planejar(lista, [], { now: Date.parse('2026-11-02T22:00:00Z'), regras: REGRAS_WHATSAPP });
  assert.equal(p.enviar[0].item.ofertaId, 'ml:MLB1000003', 'a primeira mensagem é a Black Friday de maior desconto');
});

t('config real: válida, só links meli.la, todas com afiliado no mapa do site', () => {
  const c = lerCampanha();
  assert.ok(c && Array.isArray(c.ofertas) && c.ofertas.length >= 200);
  assert.ok(c.ofertas.every((o) => /^MLB\d+$/.test(o.item) && /^https:\/\/meli\.la\/[A-Za-z0-9]+$/.test(o.link)));
  assert.equal(new Set(c.ofertas.map((o) => o.item)).size, c.ofertas.length, 'um registro por anúncio');
  const aff = parseAffiliates(JSON.parse(fs.readFileSync(new URL('../config/affiliates.json', import.meta.url), 'utf8')));
  assert.ok(c.ofertas.every((o) => aff.anuncios[o.item]), 'todo anúncio da campanha tem link de afiliado no site');
  assert.ok(candidatosCampanha(c, { now: Date.parse(c.capturedAt) + 3600e3 }).filter((x) => x.blackFriday).length >= 50);
});

await ta('foto do anúncio: og:image só de mlstatic', async () => {
  const pagina = (img) => async () => ({ ok: true, text: async () => `<meta property="og:image" content="${img}">` });
  assert.equal(await fotoDoAnuncio('MLB123456789', pagina('https://http2.mlstatic.com/D_NQ_NP_1-O.jpg')), 'https://http2.mlstatic.com/D_NQ_NP_1-O.jpg');
  assert.equal(await fotoDoAnuncio('MLB123456789', pagina('https://evil.example/a.jpg')), null);
  assert.equal(await fotoDoAnuncio('xx', pagina('https://http2.mlstatic.com/a.jpg')), null);
  assert.equal(await fotoDoAnuncio('MLB123456789', async () => { throw new Error('rede'); }), null);
});

await ta('card: gerarCard repassa --tema blackfriday ao script', async () => {
  let args = null;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bf-'));
  const saida = path.join(dir, 'c.jpg');
  const run = (_py, a) => { args = a; fs.writeFileSync(saida, 'x'); return { status: 0 }; };
  const fetchFn = async () => ({ ok: true, arrayBuffer: async () => new ArrayBuffer(4) });
  await gerarCard('https://http2.mlstatic.com/a.jpg', saida, fetchFn, run, null, dir, { tema: 'blackfriday' });
  assert.deepEqual(args.slice(-2), ['--tema', 'blackfriday']);
  await gerarCard('https://http2.mlstatic.com/a.jpg', saida, fetchFn, run, null, dir);
  assert.ok(!args.includes('--tema'), 'sem tema: card normal');
});

// Arte real (só quando há Python com Pillow): o tema gera JPEG 1080x1080, inclusive com foto sem fundo branco.
const py = spawnSync(process.env.SOCIAL_PYTHON || 'python3', ['-c', 'import PIL'], { encoding: 'utf8' });
if (py.status === 0) {
  t('social-card.py --tema blackfriday (recorte e moldura)', () => {
    const script = fileURLToPath(new URL('../tools/social-card.py', import.meta.url));
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bfcard-'));
    const amb = path.join(dir, 'amb.png');
    spawnSync(process.env.SOCIAL_PYTHON || 'python3', ['-c', `from PIL import Image; Image.new('RGB',(400,300),(90,140,200)).save(${JSON.stringify(amb)})`]);
    for (const foto of [fileURLToPath(new URL('../assets/social/produtos/c30-colecao_ex-greninja.webp', import.meta.url)), amb]) {
      const saida = path.join(dir, `${path.basename(foto)}.jpg`);
      const r = spawnSync(process.env.SOCIAL_PYTHON || 'python3', [script, '--foto', foto, '--saida', saida, '--tema', 'blackfriday'], { encoding: 'utf8' });
      assert.equal(r.status, 0, r.stderr);
      const b = fs.readFileSync(saida);
      assert.equal(b[0], 0xff); assert.equal(b[1], 0xd8);
    }
  });
}

console.log(`social-blackfriday: ${n} testes ok`);
