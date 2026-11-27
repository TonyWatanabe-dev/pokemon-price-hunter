#!/usr/bin/env node
// Gera os arquivos da extensão do Chrome a partir das fontes compartilhadas:
//   tools/captura/leitor.js       → extensao/leitor.js   (cópia: a mesma leitura do favorito)
//   tools/captura/content-cola.js → extensao/content.js  (cola do content script)
//   robo-ml.mjs (buscas do ML) + buscas da Shopee/Amazon abaixo → extensao/buscas.js (links do popup)
// Uso: node tools/captura/build-extensao.mjs   (os arquivos gerados ficam versionados; o teste confere que estão em dia)
import fs from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { listaDeBuscas } from './robo-ml.mjs';

const dir = fileURLToPath(new URL('.', import.meta.url));
const AVISO = '// GERADO por tools/captura/build-extensao.mjs — não edite aqui; edite a fonte e rode o build.\n';

// Mesmos termos das buscas públicas do ML (pokemon-tcg-…), em texto de busca para a Shopee e a Amazon.
export const TERMOS = Object.freeze([
  'pokemon tcg blister', 'pokemon tcg booster', 'pokemon tcg treinador avançado',
  'pokemon tcg box coleção', 'pokemon tcg escuridão absoluta', 'pokemon tcg booster box',
]);

export function buscasDaExtensao() {
  const ml = listaDeBuscas().map((b) => ({ rotulo: b.slug.replace(/^pokemon-tcg-?/, '').replace(/-/g, ' ') || 'pokemon tcg', pagina: b.pagina, url: b.url }));
  const shopee = TERMOS.map((t) => ({ rotulo: t.replace(/^pokemon tcg ?/, '') || 'pokemon tcg', pagina: 1, url: 'https://shopee.com.br/search?keyword=' + encodeURIComponent(t) }));
  const amazon = TERMOS.map((t) => ({ rotulo: t.replace(/^pokemon tcg ?/, '') || 'pokemon tcg', pagina: 1, url: 'https://www.amazon.com.br/s?k=' + encodeURIComponent(t).replace(/%20/g, '+') }));
  return { mercadolivre: ml, shopee, amazon };
}

export function gerarArquivos() {
  const le = (n) => fs.readFileSync(new URL(n, import.meta.url), 'utf8');
  return {
    'leitor.js': AVISO + le('./leitor.js'),
    'content.js': AVISO + le('./content-cola.js'),
    'buscas.js': AVISO + 'const BUSCAS = ' + JSON.stringify(buscasDaExtensao(), null, 1) + ';\n',
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  fs.mkdirSync(dir + 'extensao', { recursive: true });
  for (const [nome, conteudo] of Object.entries(gerarArquivos())) {
    fs.writeFileSync(dir + 'extensao/' + nome, conteudo);
    console.log('extensao/' + nome);
  }
}
