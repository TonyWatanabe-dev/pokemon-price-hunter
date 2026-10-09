// Fixture da 6C.2 (test/score-consistency-tests.js): o código de oppWhy ANTES da refatoração, copiado byte a byte de
// 2df9e86:index.html — recortes ["const BAND_UI=", "/* 6C.1 TCG Rarity System") + ["const pctPts=", "function oppCard(").
// Serve de referência fixa para provar que oppWhy = <details> + oppWhyBody não mudou a saída. Não editar: é histórico.
// ---- trecho original ----
const BAND_UI={excelente:["Excelente oportunidade","var(--ok)","Excelente"],boa:["Boa oportunidade","var(--ok)","Boa"],normal:["Oportunidade normal","var(--warn)","Normal"],baixa:["Oportunidade baixa","var(--bad)","Baixa"]};
/* nível de confiança: a palavra vem pronta da API (confidence_level); aqui só o texto da etiqueta */
const CONF_UI={alta:"Alta confiança","média":"Média confiança",baixa:"Baixa confiança"};
const pctPts=(v)=>Math.abs(v).toLocaleString("pt-BR",{minimumFractionDigits:1,maximumFractionDigits:1})+"%";   /* formata o % que a API mandou */
const refOfName=(k)=>k==="COPAG_OFFICIAL_CURRENT"?"do preço sugerido Copag":"da referência de mercado";
const refAtName=(k)=>k==="COPAG_OFFICIAL_CURRENT"?"No preço sugerido Copag":"Na referência de mercado";
const refShort=(k)=>k==="COPAG_OFFICIAL_CURRENT"?"Copag":"Mercado";
/* comparação com a referência atual: percentual, posição e valor vêm da API (reference_comparison) */
function oppCmp(rc){
  if(!rc?.available)return`<p class="opp-ref none">Sem referência atual</p>`;
  /* no cartão a frase é curta e o tipo da referência vem na 2ª linha; a frase completa fica no title e em "Por que esta nota?" */
  const full=(w)=>`${pctPts(rc.percentage_below)} ${w} ${refOfName(rc.reference_kind)}`;
  const shortRef=rc.reference_kind==="COPAG_OFFICIAL_CURRENT"?"do preço sugerido":"da referência";
  const head=rc.position==="below"?`<p class="opp-cmp" title="${full("abaixo")}"><b>−${pctPts(rc.percentage_below)}</b> abaixo ${shortRef}</p>`
    :rc.position==="above"?`<p class="opp-cmp up" title="${full("acima")}"><b>${pctPts(rc.percentage_below)}</b> acima ${shortRef}</p>`
    :`<p class="opp-cmp eq">${refAtName(rc.reference_kind)}</p>`;
  return head+`<p class="opp-ref">${refShort(rc.reference_kind)} · ${money(rc.reference_value)}</p>`;
}
/* contexto (não é alerta): etiquetas discretas; o texto completo da API fica no title e em "Por que esta nota?" */
function oppFlags(x,opt={}){
  const cr=x.current_reference||{};const w=(c)=>(x.warnings||[]).find((y)=>y.code===c);const out=[];
  /* aviso de marketplace: decidido pela referência ATUAL (o market_composition do topo pode descrever o mercado mesmo com Copag) */
  if(cr.kind==="MARKET_CURRENT"&&cr.market_composition==="MARKETPLACE_ONLY"){const t=w("MARKETPLACE_ONLY")?.text||"Referência de mercado formada só por vendedores de marketplace";
    out.push(`<span class="opp-tag" title="${esc(t)}">${ic("info")}Referência formada por marketplaces</span>`)}
  const dev=opt.mkOnly?null:w("MARKET_HIGHLY_DEVIATED_FROM_HISTORY");
  if(dev){const lb=/muito abaixo/.test(dev.text)?"Mercado abaixo do histórico":"Mercado acima do histórico";out.push(`<span class="opp-tag" title="${esc(dev.text)}">${ic("info")}${lb}</span>`)}
  return out.length?`<div class="opp-flags">${out.join("")}</div>`:"";
}
const confTxt=(x)=>x.confidence!=null?(CONF_UI[x.confidence_level]||"Confiança")+` (${Math.round(x.confidence*100)}%)`:"Não informada";
function oppWhy(x){
  const cr=x.current_reference||{};const rc=x.reference_comparison||{};const sign={"+":"opp-pos","-":"opp-neg","=":"opp-eq"};const bu=BAND_UI[x.opportunity_band];
  const refTxt=cr.kind&&cr.kind!=="NONE"?`${refShort(cr.kind)} · ${money(cr.price)}${cr.kind==="MARKET_CURRENT"&&cr.market_sources?` · ${cr.market_sources} fontes independentes`:""}`:"Sem referência atual";
  const cmpTxt=!rc.available?"Sem comparação":rc.position==="below"?`${pctPts(rc.percentage_below)} abaixo ${refOfName(rc.reference_kind)} (${money(rc.amount_below)} a menos)`:rc.position==="above"?`${pctPts(rc.percentage_below)} acima ${refOfName(rc.reference_kind)}`:refAtName(rc.reference_kind);
  const sec=(t,items)=>items?`<h4>${t}</h4><ul>${items}</ul>`:"";
  const hist=(x.historical_context||[]).map((h)=>`<li>${esc(h.label||"Histórico")} ${money(h.price)}${h.published_at?` (${esc(h.published_at)})`:""}</li>`).join("")
    +(x.community_reference?`<li>Referência comunitária ${money(x.community_reference.price)} (não é preço Copag)</li>`:"");
  return`<details class="opp-why"><summary>Por que esta nota?</summary><div class="why-in">
    ${x.opportunity_score!=null?`<div class="why-sum" style="--sc:${bu?.[1]||"var(--muted)"}"><b>${x.opportunity_score}</b><span>${esc(bu?.[0]||"Sem faixa")}<small>Opportunity Score</small></span></div>`:""}
    <dl class="why-kv"><dt>Preço</dt><dd>${money(x.price)}</dd><dt>Referência atual</dt><dd>${refTxt}</dd><dt>Comparação</dt><dd>${cmpTxt}</dd><dt>Confiança dos dados</dt><dd>${confTxt(x)}</dd></dl>
    ${sec("Contexto",(x.warnings||[]).map((r)=>`<li>${esc(r.text)}</li>`).join(""))}
    ${sec("Razões",(x.reasons||[]).map((r)=>`<li class="${sign[r.impact]||""}">${esc(r.text)}</li>`).join(""))}
    ${hist?`<h4>Histórico</h4><ul class="why-hist">${hist}</ul><p class="why-note">Contexto, não é preço atual.</p>`:""}
    ${x.updated_at?`<p class="opp-upd">Avaliado ${ago(x.updated_at)} · ${esc(x.engine_version||"")}</p>`:""}</div></details>`;
}
/* opt: best (selo "Melhor oferta"), rail (Home: cartão compacto na sequência, com #posição e sem o detalhe) */
