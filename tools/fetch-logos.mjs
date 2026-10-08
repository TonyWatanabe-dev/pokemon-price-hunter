// Baixa os logos oficiais das coleções para conferência (não publica nada).
// EN: API pública pokemontcg.io (images.pokemontcg.io/<set>/logo.png).
// PT: tenta a página oficial da expansão em tcg.pokemon.com/pt-br; se vier proteção anti-robô, só registra e para.
import fs from 'node:fs';
const OUT = 'logos-out'; fs.mkdirSync(OUT + '/en', { recursive: true }); fs.mkdirSync(OUT + '/pt', { recursive: true });
const UA = 'PokeHunterBR/1.0 (comparador de precos; contato.tcgpricehunter@gmail.com)';
const report = [];
const get = async (u, bin) => { const r = await fetch(u, { headers: { 'user-agent': UA } }); return { ok: r.ok, status: r.status, type: r.headers.get('content-type') || '', body: bin ? Buffer.from(await r.arrayBuffer()) : await r.text() }; };
try {
  const r = await get('https://api.pokemontcg.io/v2/sets?orderBy=-releaseDate&pageSize=60');
  report.push(`pokemontcg.io: HTTP ${r.status}, ${r.body.length} bytes`);
  fs.writeFileSync(OUT + '/sets.json', r.body);
  const sets = JSON.parse(r.body).data || [];
  for (const s of sets) {
    if (!s.images?.logo) continue;
    try { const im = await get(s.images.logo, true); if (im.ok) fs.writeFileSync(`${OUT}/en/${s.id}.png`, im.body); report.push(`EN ${s.id} | ${s.name} | ${s.series} | ${s.releaseDate} | ${im.status}`); } catch (e) { report.push(`EN ${s.id} erro ${e.message}`); }
  }
} catch (e) { report.push('API pokemontcg.io falhou: ' + e.message); }
// TCGdex (base aberta): séries/coleções com logo em português (pt-br) e inglês.
for (const lang of ['pt-br', 'pt', 'en']) {
  try {
    const r = await get(`https://api.tcgdex.net/v2/${lang}/sets`);
    report.push(`TCGdex ${lang}: HTTP ${r.status}, ${r.body.length} bytes`);
    if (!r.ok) continue;
    const sets = JSON.parse(r.body);
    fs.writeFileSync(`${OUT}/tcgdex-${lang}.json`, JSON.stringify(sets, null, 1));
    fs.mkdirSync(`${OUT}/tcgdex-${lang}`, { recursive: true });
    const recent = sets.filter((s) => /^(sv|me)/i.test(s.id) || /30/.test(s.id));
    for (const s of recent) {
      if (!s.logo) { report.push(`  ${lang} ${s.id} | ${s.name} | sem logo`); continue; }
      try { const im = await get(s.logo + '.png', true); if (im.ok) fs.writeFileSync(`${OUT}/tcgdex-${lang}/${s.id}.png`, im.body); report.push(`  ${lang} ${s.id} | ${s.name} | ${im.status} | ${s.logo}`); } catch (e) { report.push(`  ${lang} ${s.id} erro ${e.message}`); }
    }
  } catch (e) { report.push(`TCGdex ${lang} falhou: ${e.message}`); }
}
const PT = (process.env.PT_SLUGS || '').split(/\s+/).filter(Boolean);
for (const slug of PT) {
  try {
    const r = await get(`https://tcg.pokemon.com/pt-br/expansions/${slug}/`);
    if (!r.ok || /_Incapsula_Resource|captcha/i.test(r.body)) { report.push(`PT ${slug} bloqueado (${r.status})`); continue; }
    fs.writeFileSync(`${OUT}/pt/${slug}.html`, r.body);
    const imgs = [...r.body.matchAll(/(?:src|srcset|content)="([^"]+?\.(?:png|webp|svg)[^"]*)"/gi)].map((m) => m[1]).filter((u) => /logo/i.test(u));
    report.push(`PT ${slug} ok, logos: ${imgs.slice(0, 5).join(' , ')}`);
    let i = 0; for (const u of [...new Set(imgs)].slice(0, 3)) { const abs = new URL(u.split(' ')[0], `https://tcg.pokemon.com/pt-br/expansions/${slug}/`).href; try { const im = await get(abs, true); if (im.ok) fs.writeFileSync(`${OUT}/pt/${slug}-${i++}${abs.match(/\.(png|webp|svg)/i)?.[0] || '.png'}`, im.body); } catch {} }
  } catch (e) { report.push(`PT ${slug} erro ${e.message}`); }
}
fs.writeFileSync(OUT + '/RELATORIO.txt', report.join('\n') + '\n');
console.log(report.join('\n'));
