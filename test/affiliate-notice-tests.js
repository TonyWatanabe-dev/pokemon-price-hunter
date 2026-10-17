// Aviso de afiliado nos Termos (regra do dono de 17/10/2026, docs/afiliados.md): o aviso é GERAL e incondicional
// (não depende de o mapa do ML ter carregado), cita Mercado Livre, Amazon e Shopee, traz a frase do Programa de
// Associados da Amazon e explica o único efeito na ordem: o desempate. Sem rede e sem banco.
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

t('amazon.json com links => frase do Associado da Amazon nos Termos, incondicional', () => {
  if (!Array.isArray(doc.links) || !doc.links.length) return;
  assert.match(termos, /Como Associado da Amazon, o TCG Price Hunter recebe por compras qualificadas/);
});

t('aviso geral: Mercado Livre, Amazon e Shopee, sem condição, com a regra do desempate', () => {
  const m = termos.match(/<p>Alguns links para Mercado Livre, Amazon e Shopee são links de afiliado[^<]*<\/p>/);
  assert.ok(m, 'aviso geral ausente');
  assert.ok(!m[0].includes('${'), 'o aviso não pode depender de condição');
  assert.match(m[0], /Em empate de preço total, a oferta com o nosso link aparece primeiro; ela nunca passa na frente de uma oferta mais barata/);
  assert.ok(!termos.includes('${AFIL'), 'Termos não dependem do mapa carregado');
});
console.log('affiliate-notice-tests ok');
