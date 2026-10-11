// #82 — acessibilidade do fluxo de compra (busca, resultados, detalhe), conferida pelo código.
// Não há harness de navegador: os testes leem index.html e tools/page.template.html e rodam trechos reais num sandbox.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

let n = 0; const t = (name, fn) => { try { fn(); n++; } catch (e) { e.message = `${name}: ${e.message}`; throw e; } };
const anchors = (s) => [...s.matchAll(/<a\b[^>]*>[\s\S]*?<\/a>/g)].map((m) => m[0]);

for (const file of ['../index.html', '../tools/page.template.html']) {
  const html = fs.readFileSync(new URL(file, import.meta.url), 'utf8');
  const cut = (a, b) => { const i = html.indexOf(a); const j = html.indexOf(b, i); assert.ok(i > 0 && j > i, `${file}: trecho ${a}`); return html.slice(i, j); };

  // ---------------------------------------------------------------- base (já estava certo; protege contra regressão)
  t(`${file}: viewport permite zoom e html tem idioma`, () => {
    const vp = html.match(/<meta name="viewport" content="([^"]*)"/); assert.ok(vp, 'meta viewport');
    assert.match(vp[1], /width=device-width/); assert.doesNotMatch(vp[1], /user-scalable\s*=\s*no|maximum-scale\s*=\s*1(\.0)?\b/, 'zoom bloqueado');
    assert.match(html, /<html lang="pt-BR">/);
  });
  t(`${file}: imagens com alt, sem tabindex positivo, links em nova aba com rel=noopener`, () => {
    assert.equal((html.match(/<img(?![^>]*\balt=)[^>]*>/g) || []).length, 0, 'img sem alt');
    assert.equal((html.match(/tabindex="[1-9]/g) || []).length, 0, 'tabindex positivo muda a ordem de foco');
    for (const a of html.match(/<a\b[^>]*target="_blank"[^>]*>/g) || []) assert.match(a, /rel="noopener/, `sem rel=noopener: ${a.slice(0, 80)}`);
  });
  t(`${file}: há foco visível global`, () => assert.match(html, /:focus-visible\{outline:3px solid/));

  // ---------------------------------------------------------------- "Ver oferta": nome distinguível e aviso de nova aba
  const offerLinks = anchors(html).filter((a) => /Ver oferta/.test(a) && /target="_blank"/.test(a));
  t(`${file}: links "Ver oferta" dizem a loja e que abrem em nova aba`, () => {
    assert.ok(offerLinks.length >= 3, `links Ver oferta esperados (${offerLinks.length})`);
    for (const a of offerLinks) {
      assert.match(a, /<span class="sr">[^<]*\(abre em nova aba\)<\/span>/, `sem aviso de nova aba: ${a.slice(0, 90)}`);
      assert.match(a, /na \$\{esc\((o\.storeName|best\.storeName|st\.name\|\|"")\)\}/,`nome do link não diz a loja: ${a.slice(0, 90)}`);
      assert.match(a, />Ver oferta/, 'texto visível continua começando por "Ver oferta" (rótulo no nome, WCAG 2.5.3)');
    }
  });

  // ---------------------------------------------------------------- Reclame Aqui: aria-label contém o texto visível
  t(`${file}: selo Reclame Aqui tem o texto visível no nome acessível (todos os status)`, () => {
    const code = cut('const RA_ST=', 'function ');
    const fnStart = html.indexOf('function raBadge('); assert.ok(fnStart > 0, 'raBadge');
    const fnCode = html.slice(fnStart, html.indexOf('\n}', fnStart) + 2);
    const ctx = { esc: (s) => String(s), safeUrl: (u) => u, S: { reputation: { consultadoEm: '2026-10-01', lojas: {} } } };
    vm.createContext(ctx); vm.runInContext(code + '\n' + fnCode + '\nglobalThis.raBadge=raBadge;globalThis.RA_ST=RA_ST;', ctx);
    let checked = 0;
    for (const st of Object.keys(ctx.RA_ST)) for (const nota of [null, 8.5]) for (const full of [false, true]) {
      if (st === 'NAO_ENCONTRADA' && nota != null) { checked++; continue; }   // loja sem cadastro não tem nota
      ctx.S.reputation.lojas = { loja: { status: st, nota, respondidas: null, url: 'https://www.reclameaqui.com.br/empresa/loja/' } };
      const out = ctx.raBadge({ storeId: 'loja', storeName: 'Loja' }, full);
      const label = (out.match(/aria-label="([^"]*)"/) || [])[1]; assert.ok(label, `${st}: sem aria-label`);
      const chunks = [...out.matchAll(/<(span|b|em)>([^<]*)<\/\1>/g)].map((m) => m[2].trim()).filter(Boolean);
      assert.ok(chunks.length, `${st}: selo sem texto visível`);
      for (const c of chunks) assert.ok(label.toLowerCase().includes(c.toLowerCase()), `${st}/${nota}/${full}: aria-label "${label}" não contém o texto visível "${c}"`);
      checked++;
    }
    assert.equal(checked, Object.keys(ctx.RA_ST).length * 4);
    // a loja sem cadastro continua dizendo que não foi encontrada (nada de nota inventada)
    ctx.S.reputation.lojas = {}; assert.match(ctx.raBadge({ storeId: 'x', storeName: 'Loja' }, false), /Não encontramos esta loja no Reclame Aqui/);
  });

  // ---------------------------------------------------------------- autocomplete da busca: aria-expanded acompanha a lista visível
  t(`${file}: autocomplete marca aria-expanded="true" sempre que mostra a lista`, () => {
    const ac = cut('function acRender(input){', '\n}');
    const shows = ac.split('box.hidden=false').length - 1; assert.ok(shows >= 3, 'ramos que mostram a lista');
    const synced = (ac.match(/box\.hidden=false;input\.setAttribute\("aria-expanded","true"\)/g) || []).length;
    assert.equal(synced, shows, 'algum ramo (carregando / nada encontrado) mostra a lista sem aria-expanded="true"');
  });
}
console.log(`✓ Acessibilidade do fluxo de compra (#82): ${n} grupos passaram`);
