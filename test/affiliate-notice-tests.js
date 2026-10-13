// Aviso de afiliado: sempre que config/afiliados/amazon.json tem links, o texto de Termos do index.html
// diz que os links "Ver na Amazon" são de afiliado. O Mercado Livre só é citado de forma condicional
// ("Alguns links ... quando ativados"), dentro de uma expressão que depende de AFIL. Sem rede e sem banco.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const read = (rel) => fs.readFileSync(path.join(ROOT, rel), 'utf8');
const t = (name, fn) => { try { fn(); } catch (e) { e.message = `${name}: ${e.message}`; throw e; } };

const doc = JSON.parse(read('config/afiliados/amazon.json'));
const html = read('index.html');
const termos = html.split('\n').find((l) => l.includes('4. Compras são feitas com as lojas')) || '';

t('termos existem no index.html', () => assert.ok(termos, 'seção 4 dos Termos não encontrada'));

t('amazon.json com links => aviso de afiliado da Amazon nos Termos, incondicional', () => {
  if (!Array.isArray(doc.links) || !doc.links.length) return;
  const m = termos.match(/<p>Os links "Ver na Amazon" são de afiliado[^<]*<\/p>/);
  assert.ok(m, 'aviso da Amazon ausente');
  assert.match(m[0], /Associado da Amazon/);
  assert.ok(!m[0].includes('${'), 'o aviso da Amazon não pode depender de condição');
});

t('Mercado Livre só aparece como afiliado de forma condicional', () => {
  const ml = [...termos.matchAll(/Mercado Livre são links de afiliado/g)];
  assert.equal(ml.length, 1);
  const antes = termos.slice(0, ml[0].index);
  const cond = antes.lastIndexOf('${AFIL.geral||Object.keys(AFIL.anuncios).length?"');
  assert.ok(cond > -1 && !antes.slice(cond).includes('"":'), 'menção ao ML deve ficar dentro da condição AFIL');
  const fora = termos.replace(/\$\{AFIL[\s\S]*?:""\}/, '');
  assert.ok(!/Mercado Livre são links de afiliado/.test(fora), 'ML citado fora da condição');
});
console.log('affiliate-notice-tests ok');
