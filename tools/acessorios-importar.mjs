// Importa as tabelas de acessórios que o dono leu no Chrome (links de afiliado gerados por ele) para
// config/afiliados/acessorios.json. Uso:
//   node tools/acessorios-importar.mjs --ml <txt> --amazon <txt> --shopee <txt> --saida config/afiliados/acessorios.json
// Cada linha: campos separados por " ; " (com ou sem cabeçalho). Nada é buscado na rede; preço e estoque ficam como o dono
// leu, com a data e a hora da leitura. Critérios (também em parse/validar, testados em test/acessorios-tests.js):
// - a categoria é a coluna "categoria" do dono (não a busca), conferida com api/_lib/acessorios.mjs quando ele reconhece;
// - duplicata (mesmo anúncio em duas buscas) entra uma vez;
// - fora: tamanho que não serve em carta Pokémon (toploader 4x6") e estampa de outra franquia (Lorcana, Magic, D&D).
import fs from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
import { classificarAcessorio } from '../api/_lib/acessorios.mjs';

export const CATEGORIAS = { sleeve: 'Sleeves', 'fichário': 'Fichários', toploader: 'Toploaders', playmat: 'Playmats', 'deck box': 'Deck boxes' };
const KIT = { sleeve: 'sleeve', 'fichário': 'fichario', toploader: 'toploader', playmat: 'playmat', 'deck box': 'deck_box' };
const norm = (s) => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
// Estampa/tema de outro jogo ou tamanho que não é de carta: não entra (motivo vai para o relatório).
export const FORA = [
  [/\b4 ?x ?6\b|4" ?x ?6"/, 'tamanho 4x6" (não é de carta)'],
  [/\blorcana sleeve|\btiana\b/, 'estampa Lorcana'],
  [/\bizzet\b|return to ravnica|john avon|ruined island/, 'estampa Magic'],
  [/\bdungeon\b|fire giant/, 'estampa D&D'],
];

const preco = (s) => { const m = String(s).match(/R\$\s*([\d.]+,\d{2})/g) || []; return m.map((x) => Number(x.replace(/[^\d,]/g, '').replace(',', '.'))); };
function data(s) { // "31/10/2026 12:57" ou "31/10/2026, 12:58:13" → ISO -03:00
  const m = String(s).match(/(\d{2})\/(\d{2})\/(\d{4}),?\s+(\d{2}):(\d{2})(?::(\d{2}))?/); if (!m) return null;
  return `${m[3]}-${m[2]}-${m[1]}T${m[4]}:${m[5]}:${m[6] || '00'}-03:00`;
}
const https = (u) => (/^https?:\/\//.test(u) ? u : `https://${u}`).replace(/^http:/, 'https:');

/** loja, texto → { itens, fora } (itens já sem duplicata) */
export function parse(loja, texto) {
  const itens = []; const fora = []; const vistos = new Set();
  for (const linha of String(texto).split(/\r?\n/)) {
    const c = linha.split(' ; ').map((x) => x.trim()); if (c.length < 11 || /^busca$/i.test(c[0])) continue;
    let r;
    if (loja === 'amazon') r = { busca: c[0], url: c[1], link: c[2], title: c[3], p: c[4], seller: c[5], fulfilledBy: c[6], marca: c[7], cat: c[8], qtd: c[9], estoque: c[10], quando: c[11] };
    else if (loja === 'shopee') r = { busca: c[0], url: c[1], link: c[2], title: c[3], p: c[4], variacao: c[5], seller: c[6], marca: c[7], cat: c[8], qtd: c[9], estoque: c[10], quando: c[11] };
    else r = { busca: c[0], url: c[1], link: c[2], title: c[3], p: c[4], seller: c[5], marca: c[6], cat: c[7], qtd: c[8], estoque: c[9], quando: c[10] };
    // Shopee: alguns títulos têm " | " e nenhum " ; ", então o split por " ; " já é seguro. Campo extra = erro de leitura.
    const id = loja === 'amazon' ? (r.url.match(/\/dp\/([A-Z0-9]{10})/) || [])[1]
      : loja === 'shopee' ? (r.url.match(/product\/(\d+\/\d+)/) || [])[1]
        : ((decodeURIComponent(r.url).match(/item_id[=:](MLB\d+)/) || [])[1] || (r.url.match(/MLB-?(\d+)/) ? `MLB${r.url.match(/MLB-?(\d+)/)[1]}` : null));
    const cat = norm(r.cat) === 'fichario' ? 'fichário' : r.cat.toLowerCase();
    const motivoFora = !id ? 'sem id do anúncio' : !CATEGORIAS[cat] ? `categoria ${r.cat}` : !/^https:\/\/(meli\.la|link\.amazon|s\.shopee\.com\.br)\//.test(r.link) ? 'link de afiliado ausente'
      : (FORA.find(([re]) => re.test(norm(r.title))) || [])[1];
    if (motivoFora) { fora.push({ loja, title: r.title, motivo: motivoFora }); continue; }
    if (vistos.has(id)) continue; vistos.add(id);
    const ps = preco(r.p);
    // Shopee: "R$ 92,11 (ou R$ 96,95)" = com cupom (destaque) e sem cupom; "R$ 29,90 (de R$ 45,90)" = preço atual e o riscado;
    // "R$ 65,99 a R$ 69,90 (conforme cor)" = faixa: guarda o menor como "a partir de".
    const ou = /\(ou R\$/.test(r.p); const faixa = /\d\s+a\s+R\$/.test(r.p);
    const item = { loja, id, categoria: cat, kit: KIT[cat], marca: r.marca.replace(/\s*\(.*\)$/, ''), title: r.title, qtd: r.qtd,
      price: ou ? ps[1] : ps[0], ...(ou ? { priceCupom: ps[0] } : {}), ...(faixa ? { aPartirDe: true } : {}),
      seller: r.seller, ...(r.fulfilledBy ? { fulfilledBy: r.fulfilledBy } : {}), estoque: r.estoque, url: https(r.link), capturedAt: data(r.quando) };
    if (!(item.price > 0) || !item.capturedAt) { fora.push({ loja, title: r.title, motivo: 'preço ou data ilegível' }); continue; }
    const cls = classificarAcessorio(r.title); item.confere = !cls ? null : cls.kit === item.kit || (cls.kit === 'paginas' && item.kit === 'fichario');
    itens.push(item);
  }
  return { itens, fora };
}

/** Regras que o site depende; devolve lista de problemas (vazia = ok). */
export function validar(j) {
  const erros = []; const ids = new Set();
  for (const i of j.itens || []) {
    const k = `${i.loja}:${i.id}`; if (ids.has(k)) erros.push(`duplicado ${k}`); ids.add(k);
    if (!CATEGORIAS[i.categoria]) erros.push(`${k}: categoria ${i.categoria}`);
    if (!(typeof i.price === 'number' && i.price > 0)) erros.push(`${k}: preço`);
    if (!/^https:\/\/(meli\.la|link\.amazon|s\.shopee\.com\.br)\/\S+$/.test(i.url || '')) erros.push(`${k}: url`);
    if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-03:00$/.test(i.capturedAt || '')) erros.push(`${k}: capturedAt`);
    if (i.confere === false) erros.push(`${k}: categoria do dono (${i.categoria}) diverge do classificador`);
    if (FORA.some(([re]) => re.test(norm(i.title)))) erros.push(`${k}: item fora do padrão`);
    if ('productId' in i || 'score' in i) erros.push(`${k}: acessório não liga a produto lacrado nem a nota`);
  }
  return erros;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : null; };
  // Sem caminho padrão: este arquivo só ESCREVE a lista (test/affiliate-isolation-tests.js proíbe ler a config de afiliados em tools/).
  const saida = arg('saida'); if (!saida) { console.error('use --saida <arquivo>'); process.exit(2); }
  const itens = []; const fora = [];
  for (const loja of ['mercadolivre', 'amazon', 'shopee']) {
    const f = arg(loja === 'mercadolivre' ? 'ml' : loja); if (!f) continue;
    const r = parse(loja, fs.readFileSync(f, 'utf8')); itens.push(...r.itens); fora.push(...r.fora);
  }
  const ordem = Object.keys(CATEGORIAS);
  itens.sort((a, b) => ordem.indexOf(a.categoria) - ordem.indexOf(b.categoria) || a.price - b.price);
  const datas = itens.map((i) => i.capturedAt).sort();
  const j = { program: 'acessorios', updatedAt: (datas.at(-1) || '').slice(0, 10),
    regras: 'Acessórios de carta (sleeve, fichário, toploader, playmat, deck box) com link de afiliado do dono, lidos por ele no Chrome. Lista curada, à parte do catálogo de lacrados: nunca entra em oferta, ranking, Opportunity Score ou alerta. O Monte seu kit usa o mais barato de cada categoria para completar o kit (frete a calcular). price = preço à vista sem cupom; priceCupom = valor com cupom que a Shopee destaca; aPartirDe = anúncio com faixa de preço por cor. Não é atualizado automaticamente; o site mostra a data e a hora da leitura. Fora: tamanho que não é de carta (4x6") e estampa de outra franquia. Gerado por tools/acessorios-importar.mjs.',
    origem: `Leitura do dono no Chrome em ${datas[0]?.slice(8, 10)}/${datas[0]?.slice(5, 7)}/${datas[0]?.slice(0, 4)} (${datas[0]?.slice(11, 16)}–${datas.at(-1)?.slice(11, 16)}).`,
    categorias: CATEGORIAS, itens };
  const erros = validar(j); if (erros.length) { console.error(erros.join('\n')); process.exit(1); }
  fs.writeFileSync(saida, JSON.stringify(j, null, 1) + '\n');
  const por = (k) => Object.entries(itens.reduce((m, i) => ({ ...m, [i[k]]: (m[i[k]] || 0) + 1 }), {})).map(([a, b]) => `${a} ${b}`).join(', ');
  console.log(`${itens.length} itens (${por('loja')}; ${por('categoria')}). Fora: ${fora.length}`);
  for (const f of fora) console.log(`  fora [${f.loja}] ${f.motivo}: ${f.title}`);
}
