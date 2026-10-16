// Testa o seletor e o nome de arquivo do tools/cartas-pt-imagens.py sem tocar a rede (--so-urls).
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const raiz = path.join(__dirname, '..');
const run = (args) => execFileSync('python3', ['-I', 'tools/cartas-pt-imagens.py', ...args, '--so-urls'], { cwd: raiz, encoding: 'utf8' });

const saida = run(['--lista', 'config/cartas/pautas/semana1.txt']);
const linhas = saida.trim().split('\n');
assert.equal(linhas.length, 16, 'pauta da semana 1 tem 16 cartas');
assert.ok(linhas.some((l) => l.startsWith('30th-137 Chandelure https://assets.tcgdex.net/pt/me/30th/137/high.webp')));
assert.ok(linhas.every((l) => /^https:\/\/assets\.tcgdex\.net\/pt\//.test(l.split(' ').pop())), 'URLs em português');

const pikachus = run(['--colecao', '30th', '--raridade', 'Pikachu Rare']).trim().split('\n');
assert.equal(pikachus.length, 30, '30 Pikachu Rare na Celebração de 30 Anos');

let falhou = false;
try { execFileSync('python3', ['-I', 'tools/cartas-pt-imagens.py', 'nao-existe', '--so-urls'], { cwd: raiz, stdio: 'pipe' }); } catch (e) { falhou = e.status === 2; }
assert.ok(falhou, 'id inexistente sai com código 2');

console.log('cartas-pt-imagens-tests: ok');
