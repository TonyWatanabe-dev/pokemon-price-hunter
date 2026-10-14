// Social Media MVP — prévia local para aprovação humana (issue #637; escopo da #631/#560). Contrato em docs/social-media.md.
// Junta os módulos de src/agents/social/: state.json → ofertas elegíveis → rascunhos por canal → fila sugerida → preview.md
// e preview.json. Só lê o state.json local e config/affiliates.json: sem rede, banco, secrets ou publicação. Grava somente
// preview.md e preview.json dentro da pasta de saída. Desligado por padrão: sem SOCIAL_ENABLED=1|true sai com código 2,
// a menos que --dry-run seja passado explicitamente. Afiliado não entra na seleção nem na ordem (selecionarElegiveis).
//
// Uso: node tools/social-preview.mjs [--state caminho] [--canal telegram|instagram] [--saida dir] [--dry-run]
//                                    [--limite N] [--now ISO]
//   --state   state.json local (padrão: data/state.json do repositório)
//   --canal   um canal só (padrão: telegram e instagram)
//   --saida   pasta onde ficam preview.md e preview.json (padrão: <tmp>/tcg-social-preview)
//   --limite  máximo de ofertas elegíveis na prévia (padrão: 10)
//   --now     horário de referência para frescor e calendário (padrão: PREVIA_NOW ou agora). Não use para "fazer passar".
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { offerFreshness } from '../api/_lib/freshness.mjs';
import { slugs, SITE } from '../api/_seo.mjs';
import { selecionarElegiveis, chaveDedupe, exigeDisclosure } from '../src/agents/social/elegiveis.js';
import { gerarRascunho, CANAIS, DISCLOSURE } from '../src/agents/social/rascunho.js';
import { enfileirar, aprovar, agendar, habilitado, validarFila, filaVazia } from '../src/agents/social/fila.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const VERSAO = 1;
export const LIMITE_PADRAO = 10;
export const STATE_PADRAO = path.join(ROOT, 'data/state.json');
export const SAIDA_PADRAO = path.join(os.tmpdir(), 'tcg-social-preview');
export const ARQUIVOS = Object.freeze(['preview.md', 'preview.json']);
export const SAIDAS = Object.freeze({ OK: 0, ERRO: 1, DESLIGADO: 2 });

const isObj = (o) => !!o && typeof o === 'object' && !Array.isArray(o);
const iso = (ms) => new Date(ms).toISOString();
// Só as variáveis do kill switch saem do ambiente: nada de token, chave ou outra variável sensível entra na prévia.
const envSocial = (env = {}) => ({ SOCIAL_ENABLED: env.SOCIAL_ENABLED, SOCIAL_PAUSA: env.SOCIAL_PAUSA });

/** argv (sem node e script) → opções. Lança em argumento desconhecido ou valor inválido. */
export function lerArgs(argv) {
  const o = { state: STATE_PADRAO, canais: [...CANAIS], saida: SAIDA_PADRAO, dryRun: false, limite: LIMITE_PADRAO, now: undefined };
  const valor = (i, nome) => { const v = argv[i + 1]; if (v === undefined || v.startsWith('--')) throw new Error(`${nome} exige um valor`); return v; };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--dry-run') o.dryRun = true;
    else if (a === '--state') o.state = valor(i++, a);
    else if (a === '--saida') o.saida = valor(i++, a);
    else if (a === '--canal') {
      const c = valor(i++, a);
      if (!CANAIS.includes(c)) throw new Error(`canal desconhecido: ${c} (use ${CANAIS.join(' ou ')})`);
      o.canais = [c];
    } else if (a === '--limite') {
      const n = Number(valor(i++, a));
      if (!Number.isInteger(n) || n < 1) throw new Error('--limite deve ser inteiro >= 1');
      o.limite = n;
    } else if (a === '--now') o.now = valor(i++, a);
    else throw new Error(`argumento desconhecido: ${a}`);
  }
  return o;
}

function instante(now) {
  const ms = now === undefined ? Date.now() : now instanceof Date ? now.getTime() : typeof now === 'number' ? now : Date.parse(now);
  if (!Number.isFinite(ms)) throw new Error('horário de referência (--now / PREVIA_NOW) inválido');
  return ms;
}

// Oferta do state.json (ou da API) → entrada de gerarRascunho. O link do post é a página do produto no site (slug de
// api/_seo.mjs, o mesmo do site); o total só entra com frete conhecido, senão "frete a calcular". Nada de link montado.
function entradaRascunho(o, produto, slug, disclosure) {
  return {
    produto: { nome: produto?.name, slug }, loja: { nome: o.storeName ?? o.store?.name },
    preco: o.price, precoTotal: o.shippingKnown === true ? (o.total ?? null) : null,
    url: o.url, disclosure, lidaEm: o.source_timestamp ?? o.last_seen_at,
  };
}

/** Prévia pura (sem I/O): devolve o objeto gravado em preview.json. `env` só é usado para SOCIAL_PAUSA; quem chama já
 *  passou pelo gate de SOCIAL_ENABLED (ou pediu --dry-run). Horário sugerido = "se aprovado agora": o calendário roda
 *  numa cópia com os itens aprovados; a fila devolvida continua toda em `rascunho`, à espera da decisão humana. */
export function gerarPrevia(state, { canais = [...CANAIS], now, limite = LIMITE_PADRAO, siteUrl = SITE, env = {}, modo = 'dry-run', affiliates } = {}) {
  if (!isObj(state) || !Array.isArray(state.offers)) throw new Error('state.json inválido: esperado objeto com "offers" (lista)');
  const t = instante(now);
  const produtos = Array.isArray(state.products) ? state.products.filter((p) => isObj(p) && typeof p.id === 'string') : [];
  const P = new Map(produtos.map((p) => [p.id, p]));
  const { of: slugDe } = slugs(produtos);
  const { elegiveis, recusadas } = selecionarElegiveis(state.offers, { now: t, limite });

  const itens = []; const erros = [];
  let fila = filaVazia();
  for (const o of elegiveis) {
    const chave = chaveDedupe(o);
    const disclosure = exigeDisclosure(o.url, affiliates);   // undefined = config/affiliates.json
    const at = o.source_timestamp ?? o.last_seen_at;
    const fr = offerFreshness(at, t);
    const motivo = `elegível: em estoque, ativa, não anômala, preço > 0, URL https e frescor ${fr.status} (lida há ${fr.ageMin} min)`;
    for (const canal of canais) {
      let r;
      try { r = gerarRascunho(entradaRascunho(o, P.get(o.productId), slugDe[o.productId], disclosure), { canal, siteUrl }); }
      catch (e) { erros.push({ ofertaId: o.id ?? null, canal, chaveDedupe: chave, erro: String(e.message || e) }); continue; }
      // Falha fechada: destino de afiliado sem a frase de divulgação no texto não vira rascunho.
      if (disclosure && !r.texto.includes(DISCLOSURE)) { erros.push({ ofertaId: o.id ?? null, canal, chaveDedupe: chave, erro: 'disclosure de afiliado ausente no texto' }); continue; }
      const q = enfileirar(fila, { canal, chaveDedupe: chave, texto: r.texto }, { now: t });
      if (q.status === 'duplicado') { erros.push({ ofertaId: o.id ?? null, canal, chaveDedupe: chave, erro: 'duplicado na fila' }); continue; }
      fila = q.fila;
      itens.push({
        id: q.item.id, canal, ofertaId: o.id ?? null, produtoId: o.productId ?? null, chaveDedupe: chave,
        elegibilidade: motivo, lidaEm: at, disclosure, 
        horarioSugerido: null, agenda: null, texto: r.texto, link: r.link, avisos: r.avisos,
      });
    }
  }

  // Calendário: cópia aprovada só para sugerir horário. O gate já foi aplicado; aqui vale o kill switch SOCIAL_PAUSA.
  // Aprova e agenda um item por vez, na ordem da seleção (menor total primeiro): a fila desempata pelo id, não pelo preço.
  let sim = fila;
  const agenda = {};
  const envAgenda = { SOCIAL_ENABLED: '1', SOCIAL_PAUSA: env.SOCIAL_PAUSA };
  for (const canal of canais) {
    const st = agenda[canal] = { status: agendar(sim, { canal, now: t, env: envAgenda }).status, sugestoes: 0, semVaga: 0 };
    for (const it of itens.filter((x) => x.canal === canal)) {
      if (st.status === 'ok') {
        const ag = agendar(aprovar(sim, it.id, { now: t }).fila, { canal, now: t, env: envAgenda });
        sim = ag.fila;
        it.horarioSugerido = ag.sugestoes[0]?.quando ?? null;
      }
      it.agenda = it.horarioSugerido ? 'sugerido' : st.status === 'pausado' ? 'canal pausado (SOCIAL_PAUSA)' : 'sem vaga na janela';
      st[it.horarioSugerido ? 'sugestoes' : 'semVaga']++;
    }
  }
  const porMotivo = {};
  for (const r of recusadas) porMotivo[r.motivo] = (porMotivo[r.motivo] || 0) + 1;

  return {
    versao: VERSAO, modo, geradoEm: iso(t), naoPublicado: true,
    fonte: { stateGeradoEm: typeof state.generatedAt === 'string' ? state.generatedAt : null, ofertas: state.offers.length },
    canais: [...canais], limite, agenda,
    resumo: { elegiveis: elegiveis.length, rascunhos: itens.length, erros: erros.length, recusadas: recusadas.length, porMotivo },
    itens: canais.flatMap((c) => itens.filter((x) => x.canal === c)),   // por canal, na ordem da seleção (= ordem dos horários)
    erros, recusadas,
    fila: validarFila(fila),
  };
}

const bloco = (s) => '```text\n' + String(s).replace(/```/g, '`​``') + '\n```';

/** preview.json → Markdown para a revisão humana. */
export function paraMarkdown(p) {
  const L = [
    '# Prévia Social Media — rascunhos para aprovação humana', '',
    `> **Nada foi publicado.** Prévia local gerada em ${p.geradoEm} (modo \`${p.modo}\`). Aprovar ou rejeitar é decisão humana`,
    '> registrada com `decidir` (src/agents/social/aprovacao.js); ver docs/social-media.md.', '',
    `- state.json: gerado em ${p.fonte.stateGeradoEm ?? 'desconhecido'}, ${p.fonte.ofertas} ofertas`,
    `- Elegíveis: ${p.resumo.elegiveis} (limite ${p.limite}) · rascunhos: ${p.resumo.rascunhos} · erros: ${p.resumo.erros} · recusadas: ${p.resumo.recusadas}`,
    `- Canais: ${p.canais.map((c) => `${c} (${p.agenda[c]?.status ?? '-'})`).join(', ')}`, '',
  ];
  const motivos = Object.entries(p.resumo.porMotivo).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (motivos.length) L.push('## Recusadas por motivo', '', '| Motivo | Ofertas |', '|---|---|', ...motivos.map(([m, n]) => `| ${m} | ${n} |`), '');
  for (const canal of p.canais) {
    const its = p.itens.filter((x) => x.canal === canal);
    L.push(`## Fila sugerida — ${canal}`, '');
    if (!its.length) { L.push('_Nenhum rascunho._', ''); continue; }
    its.forEach((it, i) => {
      L.push(`### ${i + 1}. ${it.horarioSugerido ?? it.agenda}`, '',
        `- Chave de dedupe: \`${it.chaveDedupe}\``,
        `- Item da fila: \`${it.id}\` (estado: rascunho)`,
        `- Motivo: ${it.elegibilidade}`,
        `- Horário sugerido (se aprovado): ${it.horarioSugerido ?? it.agenda}`,
        `- Disclosure de afiliado: ${it.disclosure ? 'exigida (frase incluída no texto)' : 'não exigida'}`,
        `- Link do post: ${it.link}`,
        `- Avisos: ${it.avisos.length ? it.avisos.join('; ') : 'nenhum'}`, '', bloco(it.texto), '');
    });
  }
  if (p.erros.length) L.push('## Erros (sem rascunho)', '', ...p.erros.map((e) => `- ${e.canal} · \`${e.chaveDedupe}\`: ${e.erro}`), '');
  return L.join('\n');
}

/** CLI. Devolve o código de saída; `io` permite testar sem tocar no console real. */
export function main(argv = process.argv.slice(2), env = process.env, io = { log: console.log, error: console.error }) {
  let o;
  try { o = lerArgs(argv); } catch (e) { io.error(`social-preview: ${e.message}`); return SAIDAS.ERRO; }
  const social = envSocial(env);
  const ligado = habilitado(social);
  if (!ligado && !o.dryRun) {
    io.error('social-preview: desligado (SOCIAL_ENABLED ausente ou diferente de 1/true). Use --dry-run para só gerar a prévia.');
    return SAIDAS.DESLIGADO;
  }
  try {
    const state = JSON.parse(fs.readFileSync(o.state, 'utf8'));
    const p = gerarPrevia(state, { canais: o.canais, now: o.now ?? env.PREVIA_NOW, limite: o.limite, env: social, modo: ligado ? 'habilitado' : 'dry-run' });
    fs.mkdirSync(o.saida, { recursive: true });
    fs.writeFileSync(path.join(o.saida, 'preview.json'), JSON.stringify(p, null, 2) + '\n');
    fs.writeFileSync(path.join(o.saida, 'preview.md'), paraMarkdown(p));
    io.log(`social-preview: ${p.resumo.rascunhos} rascunho(s), ${p.resumo.recusadas} recusada(s), ${p.resumo.erros} erro(s) → ${o.saida} (nada publicado)`);
    return SAIDAS.OK;
  } catch (e) {
    io.error(`social-preview: ${e.message}`);
    return SAIDAS.ERRO;
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) process.exitCode = main();
