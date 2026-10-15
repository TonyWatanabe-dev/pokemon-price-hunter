// Produtos com recorte ruim usam a foto original (#690): gerarCard devolve null sem baixar nem rodar o card.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { gerarCard, semRecorte } from '../tools/social-telegram-piloto.mjs';

const lista = JSON.parse(fs.readFileSync(new URL('../config/social-sem-recorte.json', import.meta.url), 'utf8')).produtos;
assert.ok(lista.includes('c30-colecao_poster'));
assert.equal(new Set(lista).size, lista.length, 'sem duplicatas');
assert.equal(semRecorte('c30-colecao_poster'), true);
assert.equal(semRecorte('me04-box36'), false);
let chamou = false;
const r = await gerarCard('https://x.test/f.jpg', '/tmp/nao-usado.jpg', async () => { chamou = true; throw new Error('não deveria baixar'); },
  () => { chamou = true; return { status: 1 }; }, 'c30-colecao_poster');
assert.equal(r, null); assert.equal(chamou, false);
console.log('social-sem-recorte-tests ok');
