// Base de cartas em português (config/cartas/, gerada por tools/cartas-pt-gerar.py a partir do TCGdex).
// Leitura só local, sem rede: o JSON vem gzipado no repositório. Uso editorial (Aura, rankings, temáticos) e, no
// futuro, cruzamento com preços de carta avulsa. Imagens © Pokémon/Nintendo/Creatures/GAME FREAK: todo uso leva crédito.
import fs from 'node:fs';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';

const ARQ = fileURLToPath(new URL('../config/cartas/cartas-pt.json.gz', import.meta.url));
const ART = fileURLToPath(new URL('../config/cartas/artistas-pt.json', import.meta.url));
let cache = null;

const norm = (s) => String(s ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();

/** Carrega (e guarda em memória) a base: { geradoEm, total, cartas[] }. */
export function carregarCartas(arquivo = ARQ) {
  if (cache && arquivo === ARQ) return cache;
  const d = JSON.parse(zlib.gunzipSync(fs.readFileSync(arquivo)).toString('utf8'));
  if (arquivo === ARQ) cache = d;
  return d;
}

/** Índice ilustrador → { nome, cartas, ids }. */
export function carregarArtistas(arquivo = ART) {
  return JSON.parse(fs.readFileSync(arquivo, 'utf8'));
}

/** Cartas de uma coleção (id TCGdex, ex.: '30th', 'me04'), na ordem do número. */
export function cartasDaColecao(colecao, base = carregarCartas()) {
  return base.cartas.filter((c) => c.colecao === colecao);
}

/** Cartas de um ilustrador (busca sem acento/caixa; 'arita' acha 'Mitsuhiro Arita'). */
export function cartasDoArtista(nome, base = carregarCartas()) {
  const n = norm(nome);
  return base.cartas.filter((c) => c.ilustrador && norm(c.ilustrador).includes(n));
}

/** Cartas em que um Pokémon aparece: como protagonista (dexId) ou de participação (cameos). */
export function cartasDoPokemon(dexId, base = carregarCartas()) {
  const id = Number(dexId);
  return base.cartas.filter((c) => c.dexId.includes(id) || c.cameos.includes(id));
}

/** Cartas por raridade (comparação sem caixa: 'illustration rare' = 'Illustration rare'). */
export function cartasPorRaridade(raridade, base = carregarCartas()) {
  const r = norm(raridade);
  return base.cartas.filter((c) => norm(c.raridade) === r);
}

/** Crédito obrigatório do post. */
export const credito = (c) => `Ilustração: ${c.ilustrador || 'não informado'} · ${c.colecaoNome} ${c.numero} · © Pokémon/Nintendo/Creatures/GAME FREAK`;
