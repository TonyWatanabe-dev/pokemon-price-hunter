// Base de cartas em português (tools/cartas-pt-gerar.py + src/cartas-pt.js): gerador sobre uma árvore mínima no
// formato do TCGdex, filtro do TCG Pocket, e o módulo de consulta sobre o arquivo real do repositório.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { carregarCartas, carregarArtistas, cartasDaColecao, cartasDoArtista, cartasDoPokemon, cartasPorRaridade, credito } from '../src/cartas-pt.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
let n = 0;
const t = async (name, fn) => { try { await fn(); n++; } catch (e) { console.error('✗ ' + name); throw e; } };

await t('1. gerador: árvore mínima → só cartas com nome pt, Pocket fora, imagem pt, índice de artistas', () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'tcgdex-'));
  const w = (p, s) => { fs.mkdirSync(path.dirname(path.join(tmp, p)), { recursive: true }); fs.writeFileSync(path.join(tmp, p), s); };
  const serie = (id, nome) => `import { Serie } from '../interfaces'\n\nconst serie: Serie = {\n\tid: "${id}",\n\tname: {\n\t\ten: "${nome}",\n\t\tpt: "${nome}"\n\t}\n}\n\nexport default serie\n`;
  const set = (id, nome, data) => `import { Set } from '../../interfaces'\nimport serie from '../Mega Evolution'\n\nconst set: Set = {\n\tid: "${id}",\n\tname: {\n\t\ten: "${nome}",\n\t\tpt: "${nome} PT"\n\t},\n\tserie: serie,\n\treleaseDate: "${data}",\n}\n\nexport default set\n`;
  const carta = (nome, pt, art, rar, dex, cameos) => `import { Card } from "../../../interfaces"\nimport Set from "../X"\n\nconst card: Card = {\n\tset: Set,\n\n\tname: {\n\t\ten: "${nome}",\n\t\tfr: "${nome}"${pt ? `,\n\t\tpt: "${pt}"` : ''}\n\t},\n\n\tillustrator: "${art}",\n\trarity: "${rar}",\n\tcategory: "Pokemon",\n\tdexId: [${dex}],\n${cameos ? `\n\tcameoDexIds: [${cameos}],\n` : ''}\n\thp: 70,\n\ttypes: ["Lightning"],\n\tstage: "Basic",\n}\n\nexport default card\n`;
  w('data/Mega Evolution.ts', serie('me', 'Mega Evolution'));
  w('data/Mega Evolution/Demo.ts', set('demo', 'Demo', '2026-09-16'));
  w('data/Mega Evolution/Demo/001.ts', carta('Pikachu', 'Pikachu', 'Ken Sugimori', 'Pikachu Rare', 25, '150, 151'));
  w('data/Mega Evolution/Demo/002.ts', carta('Mewtwo ex', 'Mewtwo ex', 'YOSHIROTTEN', 'Futuristic Rare', 150, ''));
  w('data/Mega Evolution/Demo/003.ts', carta('Only English', '', 'Alguém', 'Common', 1, ''));
  w('data/Pocket.ts', serie('tcgp', 'Pokémon TCG Pocket'));
  w('data/Pocket/App.ts', set('a1', 'App', '2024-10-30').replace("'../Mega Evolution'", "'../Pocket'"));
  w('data/Pocket/App/001.ts', carta('Bulbasaur', 'Bulbasaur', 'X', 'One Diamond', 1, ''));
  const out = path.join(tmp, 'out');
  const r = spawnSync('python3', [path.join(root, 'tools/cartas-pt-gerar.py'), '--fonte', path.join(tmp, 'data'), '--saida', out, '--csv'], { encoding: 'utf8' });
  assert.equal(r.status, 0, r.stderr);
  const base = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(out, 'cartas-pt.json.gz'))).toString('utf8'));
  assert.equal(base.total, 2, 'só as duas com nome pt; a do Pocket e a só-inglês ficam fora');
  const pika = base.cartas.find((c) => c.id === 'demo-001');
  assert.equal(pika.nome, 'Pikachu'); assert.equal(pika.colecaoNome, 'Demo PT'); assert.equal(pika.ilustrador, 'Ken Sugimori');
  assert.deepEqual(pika.cameos, [150, 151]); assert.deepEqual(pika.tipos, ['Lightning']); assert.equal(pika.hp, 70);
  assert.equal(pika.imagem, 'https://assets.tcgdex.net/pt/me/demo/001/high.webp'); assert.equal(pika.imagemEn, 'https://assets.tcgdex.net/en/me/demo/001/high.webp');
  const art = JSON.parse(fs.readFileSync(path.join(out, 'artistas-pt.json'), 'utf8'));
  assert.deepEqual(art.artistas.map((a) => a.nome), ['Ken Sugimori', 'YOSHIROTTEN']);
  assert.match(fs.readFileSync(path.join(out, 'cartas-pt.csv'), 'utf8'), /^id,colecao,colecaoNome,numero,nome/);
  assert.equal(spawnSync('python3', [path.join(root, 'tools/cartas-pt-gerar.py')], { encoding: 'utf8' }).status, 2, 'sem fonte: código 2');
});

await t('2. arquivo real: >14 mil cartas físicas, 30 Anos presente com Pikachu Rare, consultas do módulo', () => {
  const base = carregarCartas();
  assert.ok(base.total > 14000 && base.total === base.cartas.length, String(base.total));
  assert.ok(!base.cartas.some((c) => c.serie === 'tcgp'), 'Pocket fora');
  assert.ok(base.cartas.every((c) => c.nome && c.colecao && c.numero && /^https:\/\/assets\.tcgdex\.net\/pt\//.test(c.imagem)));
  const c30 = cartasDaColecao('30th', base);
  assert.ok(c30.length >= 150, String(c30.length));
  assert.equal(c30[0].colecaoNome, 'Celebração de 30 Anos');
  assert.ok(cartasPorRaridade('Pikachu Rare', base).length >= 30);
  const yr = cartasDoArtista('yoshirotten', base).filter((c) => c.colecao === '30th');
  assert.ok(yr.some((c) => c.nomeEn === 'Mewtwo ex') && yr.some((c) => c.nomeEn === 'Mew ex'));
  assert.ok(cartasDoPokemon(150, base).length > 20, 'Mewtwo em muitas cartas (protagonista ou participação)');
  const art = carregarArtistas();
  assert.ok(art.total > 300 && art.artistas[0].cartas > 1000, '5ban Graphics lidera');
  assert.match(credito(yr[0]), /^Ilustração: YOSHIROTTEN · Celebração de 30 Anos \d+ · © Pokémon/);
});

console.log(`cartas-pt: ${n} grupos ok`);
