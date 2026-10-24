// Social Media — "Top 3" e "Top 10 do site" para os grupos (WhatsApp e Telegram), pedido do dono em 24/10/2026.
// Puro (sem rede nem I/O): resposta de GET /api/v1/oportunidades (ordem do Opportunity Score, a mesma do pódio do site)
// → itens, legendas e o HTML das artes no estilo Social do design system (cor cheia, motivos, selo, estouros de desconto).
// Regras: só o link do site (nada de link de produto), números exatamente os da API, desconto arredondado para BAIXO
// (nunca exagera), data/hora dos preços sempre na arte e na legenda, fotos reais (acervo revisado ou foto da loja).

export const SITE = 'www.tcgpricehunter.com.br';
export const TIPOS = Object.freeze({ top3: 3, top10: 10 });

const NAVY = '#131f49', Y = '#ffcf33', WHITE = '#ffffff', BLUE = '#2c7be5', RED = '#c93d25', MUTED = '#556079', OK = '#0B7148', OK_BG = '#DAF2E5';
const SH = 'rgba(19,31,73,.92)';

export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
export const brl = (v) => 'R$ ' + Number(v).toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
export const pctBaixo = (v) => Math.floor(Number(v));
const pct1 = (v) => (Math.floor(Number(v) * 10) / 10).toFixed(1).replace('.', ',') + '%';   // para baixo: nunca exagera

/** Nome curto do produto: parte depois de "Coleção - ", com os rótulos longos encurtados. */
export function nomeCurto(p) {
  const base = String(p?.name || '').split(' - ').slice(1).join(' - ') || p?.type_label || '';
  return base.replace('Treinador Avançado (ETB)', 'ETB').replace(/^Box Pokémon ex /, 'Box ex ');
}
const tipoArte = (p) => String(p?.name || '').split(' - ').slice(1).join(' - ').replace(/^Box Pokémon ex /, 'Box ex ') || p?.type_label || '';

/** Palavra do formato para a frase "de blister a R$ X a ETB a R$ Y". */
export function formato(p) {
  const t = String(p?.type || '');
  if (t.startsWith('blister')) return 'blister';
  if (t === 'etb') return 'ETB';
  if (t.startsWith('colecao')) return 'box';
  if (t === 'booster') return 'booster';
  if (/^box\d/.test(t)) return 'booster box';
  if (t.startsWith('lata') || t.startsWith('minilata')) return 'lata';
  if (t.startsWith('deck') || t === 'desafio') return 'deck';
  return String(p?.type_label || 'produto').toLowerCase();
}

/** Hora dos preços em Brasília: "24/10 às 16h56". */
export function quando(iso) {
  const d = new Date(iso); if (!Number.isFinite(d.getTime())) return null;
  const f = (o) => new Intl.DateTimeFormat('pt-BR', { timeZone: 'America/Sao_Paulo', ...o }).format(d);
  return `${f({ day: '2-digit' })}/${f({ month: '2-digit' })} às ${f({ hour: '2-digit', hourCycle: 'h23' })}h${f({ minute: '2-digit' }).padStart(2, '0')}`;
}

/** Resposta da API → { itens, quando } ou { erro }. Falha fechada: sem dados frescos ou com menos itens que o pedido, não posta. */
export const IDADE_MAX_H = 6;   // ranking mais velho que isso não vira post
export function itensDaApi(resp, tipo, now = Date.now()) {
  const n = TIPOS[tipo]; if (!n) return { erro: `tipo inválido: ${tipo}` };
  const data = Array.isArray(resp?.data) ? resp.data : null;
  if (!data) return { erro: 'resposta da API sem lista de oportunidades' };
  const fr = resp?.meta?.freshness?.status;
  if (fr !== 'atual' && fr !== 'atrasado') return { erro: `dados sem frescor suficiente (${fr ?? 'sem informação'})` };
  const t = Date.parse(resp?.meta?.updated_at ?? '');
  if (!Number.isFinite(t) || now - t > IDADE_MAX_H * 3600e3) return { erro: `ranking com mais de ${IDADE_MAX_H} h ou sem data` };
  const bons = data.filter((x) => x?.product?.id && Number.isFinite(Number(x?.price)) && x?.stock === 'in_stock');
  if (bons.length < n) return { erro: `só ${bons.length} oportunidades válidas para um ${tipo}` };
  const q = quando(resp.meta.updated_at);
  if (!q) return { erro: 'sem data dos preços' };
  const itens = bons.slice(0, n).map((x) => {
    const rc = x.reference_comparison || {};
    const abaixo = rc.available === true && rc.position === 'below' && Number(rc.percentage_below) >= 1;
    return {
      id: x.product.id, colecao: x.product.collection?.name || '', colecaoCodigo: x.product.collection?.code || String(x.product.id).split('-')[0],
      nome: nomeCurto(x.product), tipoArte: tipoArte(x.product), formato: formato(x.product), imagem: x.product.image || x.offer?.image || null,
      preco: Number(x.price), pix: x.offer?.price_kind === 'pix', freteGratis: x.shipping === 'free', loja: x.store?.name || '',
      score: x.opportunity_score ?? null, copag: rc.reference_kind === 'COPAG_OFFICIAL_CURRENT',
      ref: abaixo ? Number(rc.reference_value) : null, pct: abaixo ? Number(rc.percentage_below) : null,
    };
  });
  return { itens, quando: q };
}

const abaixoTxt = (i, completo) => (i.pct == null ? '' : `, ${pctBaixo(i.pct)}% abaixo${completo ? (i.copag ? ' do sugerido Copag' : ' da referência de mercado') : ''}`);

/** Legenda no formato do WhatsApp (*negrito*, _itálico_). Sempre só o link do site. */
export function legenda(tipo, { itens, quando: q }) {
  const rodape = `_Preços de ${q}. Podem mudar a qualquer momento._`;
  if (tipo === 'top3') {
    const med = ['🥇', '🥈', '🥉'];
    const linhas = itens.slice(0, 3).map((i, k) => {
      const completo = k === 0 || i.copag !== itens[0].copag;
      return `${med[k]} *${i.nome} ${i.colecao}*: ${brl(i.preco)}${i.pix ? ' no Pix' : ''}${abaixoTxt(i, completo)}`;
    });
    return ['🏆 *TOP 3 DO SITE AGORA*', '', 'O robô passou o pente fino nas lojas e estes três saíram na frente:', '', ...linhas, '',
      'Loja, frete e histórico de preço de cada um no site 👇', SITE, '', rodape].join('\n');
  }
  const lista = itens.slice(0, 10);
  const min = lista.reduce((a, b) => (b.preco < a.preco ? b : a)); const max = lista.reduce((a, b) => (b.preco > a.preco ? b : a));
  return ['📋 *TOP 10 DO SITE: AS MELHORES OFERTAS AGORA*', '',
    `De ${min.formato} a ${brl(min.preco)} a ${max.formato} a ${brl(max.preco)}: tudo lacrado, em português e com estoque confirmado.`, '',
    'Quer saber qual loja tem, quanto fica o frete e se o preço já foi mais baixo? Tá tudo no site, grátis e sem cadastro 👇', SITE, '', rodape].join('\n');
}

/** Legenda do WhatsApp → HTML do Telegram (parse_mode HTML). */
export function legendaTelegram(txt) {
  return esc(txt).replace(/\*([^*\n]+)\*/g, '<b>$1</b>').replace(/(^|\s)_([^_\n]+)_(?=\s|$)/g, '$1<i>$2</i>');
}

// ------------------------------------------------------------------------------------------ artes (HTML 1080x1350)
const CSS = `*{box-sizing:border-box}body{margin:0;font-family:Rubik,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.art{position:relative;overflow:hidden;width:1080px;height:1350px}.bar{position:absolute;left:0;top:0;right:0;height:18px;z-index:5}
.eb{position:absolute;left:72px;top:64px;display:flex;align-items:center;gap:14px;font-size:26px;font-weight:800;letter-spacing:3px;text-transform:uppercase;z-index:5}
.eb i{width:26px;height:26px;border-radius:7px;display:block}
h1{margin:0;font-weight:900;letter-spacing:-4px;position:absolute;z-index:4}
.hl{display:inline-block;padding:0 18px 6px;border-radius:22px}
.pill{position:absolute;right:60px;bottom:44px;z-index:9;font-size:28px;font-weight:900;padding:18px 34px;border-radius:999px;white-space:nowrap;box-shadow:8px 8px 0 ${SH}}
.cred{position:absolute;left:60px;bottom:40px;font-size:17px;line-height:22px;font-weight:600;z-index:9;opacity:.85}
.mot{position:absolute;z-index:1;pointer-events:none}.dots{position:absolute;z-index:1;width:520px;height:520px;border-radius:50%}
.selo{position:absolute;z-index:6;width:190px;height:190px;border-radius:50%;background:#fff;display:grid;place-items:center;box-shadow:8px 8px 0 ${SH};text-align:center}
.selo span{font-size:19px;font-weight:900;letter-spacing:1px;color:${NAVY};line-height:22px}
.c{position:absolute;z-index:3;background:#fff;border-radius:30px;color:${NAVY};box-shadow:14px 16px 0 ${SH}}
.pop{position:absolute;z-index:5;object-fit:contain;filter:saturate(1.15) contrast(1.06) drop-shadow(0 3px 2px rgba(19,31,73,.35)) drop-shadow(0 24px 26px rgba(19,31,73,.42))}
.halo{position:absolute;z-index:4;border-radius:50%;background:radial-gradient(circle,rgba(255,255,255,.95) 0,rgba(255,255,255,.55) 38%,rgba(255,255,255,0) 70%)}
.chao{position:absolute;z-index:4;border-radius:50%;background:radial-gradient(ellipse,rgba(19,31,73,.38) 0,rgba(19,31,73,0) 70%)}
.col{font-size:20px;font-weight:800;letter-spacing:2px;text-transform:uppercase;color:${MUTED};white-space:nowrap}
.nm{font-weight:900;letter-spacing:-.8px;line-height:1.05}.pr{font-weight:900;letter-spacing:-2.5px;font-variant-numeric:tabular-nums;line-height:1}
.mu{color:${MUTED};font-weight:600}
.rank{position:absolute;z-index:7;border-radius:50%;display:grid;place-items:center;font-weight:900;box-shadow:7px 7px 0 ${SH}}
.burst{position:absolute;z-index:8;display:grid;place-items:center}.burst svg{position:absolute;inset:0;width:100%;height:100%;filter:drop-shadow(7px 7px 0 ${SH})}
.burst b{position:relative;font-weight:900;color:#fff;text-align:center;line-height:.9;letter-spacing:-1px}.burst b small{display:block;font-size:.36em;letter-spacing:1px;margin-top:4px}`;

const raio = (cor, x, y, w, op, rot = 0, flip = false) => `<svg class="mot" style="left:${x}px;top:${y}px;width:${w}px;opacity:${op};transform:rotate(${rot}deg) scaleX(${flip ? -1 : 1})" viewBox="0 0 520 900"><polygon fill="${cor}" points="300,0 90,470 250,470 140,900 470,330 300,330 430,0"/></svg>`;
const brilho = (cor, x, y, s, rot = 0) => `<svg class="mot" style="left:${x}px;top:${y}px;width:${s}px;z-index:6;transform:rotate(${rot}deg)" viewBox="-50 -50 100 100"><path fill="${cor}" d="M0,-50 C4,-10 10,-4 50,0 C10,4 4,10 0,50 C-4,10 -10,4 -50,0 C-10,-4 -4,-10 0,-50Z"/></svg>`;
const aneis = (cor, cx, cy, rs, op) => rs.map((r) => `<div class="mot" style="left:${cx - r}px;top:${cy - r}px;width:${2 * r}px;height:${2 * r}px;border-radius:50%;border:4px solid ${cor};opacity:${op}"></div>`).join('');
const dots = (cor, x, y, op) => `<div class="dots" style="left:${x}px;top:${y}px;opacity:${op};background:radial-gradient(${cor} 28%,transparent 30%) 0 0/26px 26px;-webkit-mask:radial-gradient(circle,#000 30%,transparent 70%)"></div>`;
const estrela = (n = 18) => Array.from({ length: 2 * n }, (_, k) => { const r = k % 2 ? 40 : 50; const a = Math.PI * k / n; return `${(50 + r * Math.cos(a)).toFixed(1)},${(50 + r * Math.sin(a)).toFixed(1)}`; }).join(' ');

/** Artes do tipo pedido. a = { fonte, logo, foto(item) → URL } (caminhos file:// ou https resolvidos por quem chama). */
export function arteHtml(tipo, { itens, quando: q }, a) {
  const selo = (x, y, rot) => `<div class="selo" style="left:${x}px;top:${y}px;transform:rotate(${rot}deg)"><div><img src="${esc(a.logo)}" style="width:140px;display:block;margin:0 auto 6px"><span>CAÇADO PELO<br>TCG PRICE HUNTER</span></div></div>`;
  const burst = (i, x, y, s, rot, fs) => (i.pct == null ? '' : `<div class="burst" style="left:${x}px;top:${y}px;width:${s}px;height:${s}px;transform:rotate(${rot}deg)"><svg viewBox="0 0 100 100"><polygon fill="${RED}" points="${estrela()}"/></svg><b style="font-size:${fs}px">−${pctBaixo(i.pct)}%<small>${i.copag ? 'DO SUGERIDO' : 'DO MERCADO'}</small></b></div>`);
  const rank = (n, x, y, s, bg, c, rot) => `<div class="rank" style="left:${x}px;top:${y}px;width:${s}px;height:${s}px;background:${bg};color:${c};font-size:${s * 0.56}px;transform:rotate(${rot}deg)">${n}</div>`;
  const tag = (t, bg, c, fs) => `<span style="display:inline-block;padding:6px 14px;border-radius:10px;background:${bg};color:${c};font-size:${fs}px;font-weight:900;letter-spacing:1px">${t}</span>`;
  const pix = (i, fs) => (i.pix ? tag('NO PIX', Y, NAVY, fs) : i.freteGratis ? tag('FRETE GRÁTIS', OK_BG, OK, fs) : '');
  const anel = (sc, s, fs) => `<div style="width:${s}px;height:${s}px;border-radius:50%;flex:none;display:grid;place-items:center;background:conic-gradient(${OK} ${sc ?? 0}%,#D3DAE7 0)"><div style="width:${s - 16}px;height:${s - 16}px;border-radius:50%;background:#fff;display:grid;place-items:center;font-size:${fs}px;font-weight:900;color:${NAVY}">${sc ?? '-'}</div></div>`;
  const ref = (i) => (i.ref == null ? '' : `${i.copag ? 'Sugerido Copag' : 'Ref. de mercado'} ${brl(i.ref)}`);
  const hl = (t, bg, c) => `<span class="hl" style="background:${bg};color:${c};transform:rotate(-2deg);box-shadow:10px 10px 0 ${SH}">${t}</span>`;
  const cred = (c, w) => `<div class="cred" style="width:${w}px;color:${c}">Preços de ${esc(q)}, na ordem do Opportunity Score. Podem mudar: confira na loja.</div>`;
  const pagina = (bg, corpo) => `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>@font-face{font-family:Rubik;font-weight:300 900;src:url('${esc(a.fonte)}') format('woff2')}${CSS}</style></head><body>`
    + `<div class="art" style="background:${bg};color:${bg === Y ? NAVY : WHITE}"><div class="bar" style="background:${bg === Y ? NAVY : Y}"></div>${corpo}</div></body></html>`;
  const f = (i) => esc(a.foto(i));

  if (tipo === 'top3') {
    const [p1, p2, p3] = itens;
    let corpo = raio(NAVY, -190, 560, 640, 0.09, -8) + raio(WHITE, 760, 140, 420, 0.35, 12, true) + dots(NAVY, 640, 900, 0.16) + aneis(WHITE, 300, 620, [300, 390], 0.5)
      + `<div class="eb" style="color:${NAVY}"><i style="background:${BLUE}"></i>Top 3 do site</div>` + selo(838, 34, 10)
      + `<h1 style="left:72px;top:118px;width:760px;font-size:96px;line-height:98px;color:${NAVY}">As 3 melhores<br>${hl('ofertas agora.', BLUE, WHITE)}</h1>`
      + `<div class="c" style="left:72px;top:400px;width:936px;height:400px;transform:rotate(-1.5deg);outline:6px solid ${NAVY};outline-offset:-6px"><div style="position:absolute;left:400px;top:46px;right:40px">`
      + `<div class="col">${esc(p1.colecao)}</div><div class="nm" style="font-size:44px;margin:6px 0 16px">${esc(p1.tipoArte)}</div>`
      + `<div class="pr" style="font-size:88px">${brl(p1.preco)}</div>`
      + `<div style="display:flex;align-items:center;gap:12px;margin-top:14px">${pix(p1, 22)}<span class="mu" style="font-size:22px">${ref(p1)}</span></div>`
      + `<div style="display:flex;align-items:center;gap:16px;margin-top:22px">${anel(p1.score, 84, 30)}<div class="mu" style="font-size:22px;line-height:30px">nota ${p1.score ?? '-'}/100<br>na <b style="color:${NAVY}">${esc(p1.loja)}</b></div></div></div></div>`
      + `<div class="halo" style="left:-10px;top:330px;width:500px;height:480px"></div><div class="chao" style="left:70px;top:770px;width:340px;height:56px"></div>`
      + `<img class="pop" src="${f(p1)}" style="left:44px;top:346px;width:390px;height:460px;transform:rotate(-3deg)">`
      + rank(1, 40, 360, 128, NAVY, Y, -10) + burst(p1, 870, 330, 190, 12, 56);
    const peq = (i, n, x, rot) => `<div class="c" style="left:${x}px;top:930px;width:450px;height:285px;transform:rotate(${rot}deg)"><div style="position:absolute;left:26px;top:96px;right:22px">`
      + `<div class="col" style="font-size:16px">${esc(i.colecao)}</div><div class="nm" style="font-size:28px;margin:4px 0 10px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(i.tipoArte)}</div>`
      + `<div style="display:flex;align-items:center;gap:10px"><span class="pr" style="font-size:52px">${brl(i.preco)}</span>${pix(i, 16)}</div>`
      + `<div class="mu" style="font-size:18px;margin-top:10px">nota ${i.score ?? '-'} · ${esc(i.loja)}</div></div></div>`
      + `<div class="halo" style="left:${x + 85}px;top:806px;width:300px;height:240px"></div><img class="pop" src="${f(i)}" style="left:${x + 105}px;top:826px;width:260px;height:200px;transform:rotate(${rot}deg)">`
      + rank(n, x - 14, 896, 92, WHITE, NAVY, rot * 4) + burst(i, x + 330, 860, 140, rot > 0 ? 10 : -10, 40);
    corpo += peq(p2, 2, 72, -2) + peq(p3, 3, 558, 2) + brilho(WHITE, 620, 380, 60) + brilho(NAVY, 40, 1240, 40, 12) + brilho(WHITE, 520, 860, 40)
      + cred(NAVY, 400) + `<div class="pill" style="background:${NAVY};color:${Y}">${SITE}</div>`;
    return pagina(Y, corpo);
  }
  let linhas = '';
  itens.slice(0, 10).forEach((i, k) => {
    const d = k < 3; const y = 364 + k * 86; const rot = d ? [-1, 0.8, -0.6][k] : 0;
    linhas += `<div style="position:absolute;left:${d ? 60 : 72}px;top:${y}px;width:${d ? 960 : 936}px;height:78px;z-index:${d ? 6 - k : 3};display:flex;align-items:center;gap:16px;background:${d ? Y : WHITE};border-radius:18px;color:${NAVY};padding-right:20px;box-shadow:7px 7px 0 ${SH};transform:rotate(${rot}deg)">`
      + `<div style="width:78px;height:78px;flex:none;display:grid;place-items:center;font-size:36px;font-weight:900;border-radius:18px 0 0 18px;background:${NAVY};color:${d ? Y : WHITE}">${k + 1}</div>`
      + `<div style="width:72px;height:72px;flex:none;border-radius:14px;background:#fff;display:grid;place-items:center;box-shadow:inset 0 0 0 2px rgba(19,31,73,.08)"><img src="${f(i)}" style="width:66px;height:66px;object-fit:contain;filter:saturate(1.15) contrast(1.06) drop-shadow(0 3px 3px rgba(19,31,73,.3))"></div>`
      + `<div style="flex:1;min-width:0"><div style="font-size:15px;font-weight:800;letter-spacing:1.5px;text-transform:uppercase;color:${NAVY};opacity:.7;white-space:nowrap">${esc(i.colecao)}</div>`
      + `<div style="font-size:24px;font-weight:900;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(i.tipoArte)}</div></div>`
      + (i.pct == null ? '' : `<span style="flex:none;padding:6px 12px;border-radius:12px;background:${RED};color:#fff;font-size:22px;font-weight:900">−${pct1(i.pct)}</span>`)
      + `<span class="pr" style="font-size:34px;letter-spacing:-1px;flex:none;width:186px;text-align:right">${brl(i.preco)}</span></div>`;
  });
  const corpo = raio(Y, -200, 520, 620, 0.16, -8) + raio(WHITE, 780, 120, 400, 0.12, 12, true) + dots(WHITE, 620, 980, 0.14) + aneis(WHITE, 860, 300, [220, 300], 0.18)
    + `<div class="eb" style="color:${WHITE}"><i style="background:${Y}"></i>Top 10 do site</div>` + selo(838, 34, 10)
    + `<h1 style="left:72px;top:118px;width:760px;font-size:96px;line-height:98px;color:#fff">As 10 melhores<br>${hl('ofertas agora.', Y, NAVY)}</h1>`
    + linhas + brilho(Y, 1000, 352, 56, 10) + brilho(WHITE, 30, 640, 40) + cred(WHITE, 400) + `<div class="pill" style="background:${Y};color:${NAVY}">${SITE}</div>`;
  return pagina(BLUE, corpo);
}

/** Horários (Brasília) dos posts e o tipo de cada um. */
export const HORARIOS = Object.freeze({ 9: 'top3', 13: 'top3', 19: 'top3', 21: 'top10' });
/** Rodada agendada → { tipo, chave } do horário em vigor. O cron do GitHub às vezes atrasa ou pula a execução, então o
 *  workflow tem tentativas de reserva até ~1h depois; a chave ("2026-10-24:19") faz só a 1ª tentativa que chegar postar. */
export function slotAgora(now = Date.now()) {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(now)).map((x) => [x.type, x.value]));
  const h = Number(p.hour);
  const s = Object.keys(HORARIOS).map(Number).filter((x) => x <= h && h - x <= 1).pop();
  return s == null ? null : { tipo: HORARIOS[s], chave: `${p.year}-${p.month}-${p.day}:${String(s).padStart(2, '0')}` };
}
/** Tipo da rodada agendada pela hora de Brasília: 21h é Top 10; o resto, Top 3. */
export function tipoDaHora(now = Date.now()) {
  const h = Number(new Date(now).toLocaleString('en-US', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hourCycle: 'h23' }));
  return h >= 20 || h < 2 ? 'top10' : 'top3';
}
