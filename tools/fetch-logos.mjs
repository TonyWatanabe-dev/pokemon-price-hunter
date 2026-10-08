// Baixa os logos oficiais das coleções pela API pública do TCGdex (https://tcgdex.dev).
// Ordem: português do Brasil → português → inglês. Grava em logos/colecoes/<id>.png e a origem em fontes.json.
import fs from 'node:fs';
const catalog = JSON.parse(fs.readFileSync('config/catalog.json', 'utf8'));
const EN = { sv1: 'Scarlet & Violet', sv2: 'Paldea Evolved', sv3: 'Obsidian Flames', sv3_5: '151', sv4: 'Paradox Rift', sv4_5: 'Paldean Fates', sv5: 'Temporal Forces', sv6: 'Twilight Masquerade', sv6_5: 'Shrouded Fable', sv7: 'Stellar Crown', sv8: 'Surging Sparks', sv8_5: 'Prismatic Evolutions', sv9: 'Journey Together', sv10: 'Destined Rivals', sv10_5r: 'Black Bolt', sv10_5w: 'White Flare', me01: 'Mega Evolution', me02: 'Phantasmal Flames', me02_5: 'Ascended Heroes', me03: 'Perfect Order', me04: 'Chaos Rising', me05: 'Pitch Black', c30: '30th Celebration' };
const norm = (t) => String(t || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const UA = { 'user-agent': 'PokeHunterBR/1.0 (comparador de precos; logos de colecao)' };
async function sets(lang) { try { const r = await fetch(`https://api.tcgdex.net/v2/${lang}/sets`, { headers: UA }); if (!r.ok) return []; return await r.json(); } catch { return []; } }
const lists = {}; for (const l of ['pt-br', 'pt', 'en']) { lists[l] = await sets(l); console.log(l, lists[l].length, 'sets'); }
fs.mkdirSync('logos/colecoes', { recursive: true });
const fontes = {};
for (const c of catalog.collections) {
  const tries = [['pt-br', c.name], ['pt', c.name], ['en', EN[c.id]]];
  let done = false;
  for (const [lang, name] of tries) {
    if (!name) continue;
    const hit = (lists[lang] || []).find((s) => norm(s.name) === norm(name) && s.logo);
    if (!hit) continue;
    const url = hit.logo + '.png';
    const r = await fetch(url, { headers: UA }); if (!r.ok) continue;
    const buf = Buffer.from(await r.arrayBuffer()); if (buf.length < 500) continue;
    fs.writeFileSync(`logos/colecoes/${c.id}.png`, buf);
    fontes[c.id] = { nome: c.name, idioma: lang, set: hit.id, setNome: hit.name, url };
    console.log('OK', c.id, lang, hit.id, hit.name); done = true; break;
  }
  if (!done) console.log('SEM LOGO', c.id, c.name);
}
fs.writeFileSync('logos/colecoes/fontes.json', JSON.stringify(fontes, null, 2));
