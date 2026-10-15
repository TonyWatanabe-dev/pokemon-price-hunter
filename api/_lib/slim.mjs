// Lote F (performance): a mesma casca do site, sem o CSS e o JS grandes inline. O index.html continua sendo a fonte
// editada (CLAUDE.md); esta transformação é determinística e roda em dois lugares que precisam concordar:
//   • build (tools/build-slim.mjs): grava public/assets/web/app-<hash>.css/.js e o public/app.html enxuto;
//   • api/pagina.mjs: aplica a mesma troca no HTML que serve (o nome sai do hash do conteúdo, então bate com o build).
// Nome com hash + Cache-Control immutable: o navegador baixa uma vez por versão. Se algo não casar, devolve o HTML
// original (nunca quebra a página).
import crypto from 'node:crypto';

const STYLE = /<style>\n([\s\S]*?)<\/style>/;
const MAIN = /<script>\n("use strict";[\s\S]*?)<\/script>/;
export const MIN_BYTES = 20 * 1024;
const hash = (s) => crypto.createHash('sha256').update(s).digest('hex').slice(0, 12);

/** html → { html, arquivos: [{ nome, tipo, conteudo }] }. Sem blocos grandes: html igual e nenhum arquivo. */
export function slim(html) {
  if (typeof html !== 'string') return { html, arquivos: [] };
  const arquivos = [];
  let out = html;
  const st = out.match(STYLE);
  if (st && st[1].length >= MIN_BYTES) {
    const nome = `app-${hash(st[1])}.css`;
    arquivos.push({ nome, tipo: 'text/css', conteudo: st[1] });
    out = out.replace(st[0], () => `<link rel="stylesheet" href="/assets/web/${nome}">`);
  }
  const sc = out.match(MAIN);
  if (sc && sc[1].length >= MIN_BYTES) {
    const nome = `app-${hash(sc[1])}.js`;
    arquivos.push({ nome, tipo: 'text/javascript', conteudo: sc[1] });
    out = out.replace(sc[0], () => `<script src="/assets/web/${nome}"></script>`);
  }
  return { html: out, arquivos };
}
