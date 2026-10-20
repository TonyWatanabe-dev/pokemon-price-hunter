// Importados nos grupos (19/10/2026): mesmo grupo, legenda com bandeira e linha do idioma, sem comparação com a Copag.
import assert from 'node:assert/strict';
import { montarLegenda } from '../src/agents/social/legenda.js';
import { legendaWhatsApp } from '../src/agents/social/whatsapp.js';
const base = { titulo: 'Booster Box Surging Sparks', atual: 1190, loja: 'Loja', link: 'https://loja.test/p' };
const en = montarLegenda({ ...base, produtoId: 'sv8-box36-en' }).texto;
assert.match(en, /^🇺🇸 <b>Booster Box Surging Sparks<\/b>\n🌐 Idioma: Inglês\n\nPor <b>R\$ 1\.190,00<\/b> ✅/);
assert.doesNotMatch(en, /Copag/);
assert.match(montarLegenda({ ...base, produtoId: 'jp33-box30-ja' }).texto, /^🇯🇵 .*\n🌐 Idioma: Japonês/);
assert.match(montarLegenda({ ...base, produtoId: 'cn5-box30-zh' }).texto, /^🇨🇳 .*\n🌐 Idioma: Chinês/);
assert.match(montarLegenda({ ...base, produtoId: 'jp33-box30-ko' }).texto, /^🇰🇷 .*\n🌐 Idioma: Coreano/);
const pt = montarLegenda({ ...base, produtoId: 'sv8-box36' }).texto;
assert.match(pt, /^🇧🇷 <b>/); assert.doesNotMatch(pt, /Idioma/);
assert.match(legendaWhatsApp(en), /^🇺🇸 \*Booster Box Surging Sparks\*\n🌐 Idioma: Inglês/);
console.log('social-importados-tests ok');
// nome do avulso importado: "Box Pokémon - ...", nunca "avulsos - ..."
{
  const { describeProduct } = await import('../src/match.js');
  const p = describeProduct({ collections: [], products: [] }, 'avulsos', 'colecao_premium', null, 'mega-zygarde', 'en');
  assert.match(p.name, /^Box Pokémon - /); assert.doesNotMatch(p.name, /avulsos/);
}
