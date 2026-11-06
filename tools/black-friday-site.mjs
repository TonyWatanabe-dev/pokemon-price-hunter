#!/usr/bin/env node
// Seção Black Friday da Home (pedido do dono em 06/11/2026: "fazer uma sessão na home, black friday com destaque").
// Fonte única: config/social-black-friday.json — a mesma planilha do dono que alimenta a campanha do grupo
// (src/agents/social/blackfriday.js). Este gerador escreve assets/web/bf-vN.js (dados + render) e troca a tag no
// index.html: os arquivos de /assets/web/ são imutáveis no cache, então cada leitura nova ganha um N novo.
//
// Regras da seção:
//   • mostra o que o dono leu, como leu: preço do anúncio, "de" do próprio vendedor, "no Pix" quando for o caso, a data
//     da leitura e o aviso de que pode ter mudado e não inclui frete (frete desconhecido nunca vira zero);
//   • ordem: selo Black Friday primeiro, depois maior desconto do anúncio; não usa comissão nem o Opportunity Score e não
//     entra no ranking;
//   • some sozinha depois de validadeHoras (mesma validade do grupo, teto 72 h) a partir de capturedAt;
//   • só links de afiliado do dono das três lojas (mesmas regras de LINKS da campanha).
// Uso: node tools/black-friday-site.mjs [--check]   (--check: falha se o asset publicado não bate com o config)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { LINKS } from '../src/agents/social/blackfriday.js';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const CONFIG = path.join(RAIZ, 'config/social-black-friday.json');
const INDEX = path.join(RAIZ, 'index.html');
const PASTA = path.join(RAIZ, 'assets/web');
export const TAG = /<script src=\/assets\/web\/bf-v(\d+)\.js defer><\/script>/;
const NOME = { mercadolivre: 'Mercado Livre', shopee: 'Shopee', amazon: 'Amazon' };

/** Campanha → dados públicos da seção (só o que a Home mostra), na ordem de exibição. */
export function dadosSecao(campanha) {
  const horas = Number.isFinite(campanha?.validadeHoras) ? Math.min(Math.max(campanha.validadeHoras, 1), 72) : 24;
  const t = Date.parse(campanha?.capturedAt);
  if (!Number.isFinite(t) || !Array.isArray(campanha?.ofertas)) throw new Error('black-friday: campanha inválida');
  const ofertas = campanha.ofertas
    .filter((o) => o && NOME[o.loja] && LINKS[o.loja].test(o.link) && typeof o.titulo === 'string' && o.titulo.trim() && o.preco > 0)
    .map((o) => {
      const de = typeof o.de === 'number' && o.de > o.preco ? o.de : null;
      return { l: o.loja, t: o.titulo.trim(), p: o.preco, d: de, x: de ? Math.round((1 - o.preco / de) * 100) : 0, pix: o.pix === true, bf: o.blackFriday === true, obs: o.obs || null, u: o.link };
    })
    .sort((a, b) => (b.bf - a.bf) || (b.x - a.x) || (a.p - b.p));
  return { em: t, ate: t + horas * 3600e3, ofertas };
}

/** HTML da seção (puro; roda no navegador e no teste). Vazio fora da validade. */
export function render(d, now) {
  if (!d || !d.ofertas || !d.ofertas.length || now < d.em - 3e5 || now > d.ate) return '';
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const rs = (v) => 'R$ ' + v.toFixed(2).replace('.', ',').replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const lojas = { mercadolivre: 'Mercado Livre', shopee: 'Shopee', amazon: 'Amazon' };
  const quando = new Date(d.em).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo', day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }).replace(',', ' às');
  const card = (o, i) => `<li class="bf-c${i >= 10 ? ' bf-mais' : i >= 4 ? ' bf-m' : ''}"><div class="bf-top"><span class="bf-loja bf-${o.l}">${lojas[o.l]}</span>${o.bf ? '<span class="bf-selo">Black Friday</span>' : ''}${o.x >= 5 ? `<span class="bf-x">-${o.x}%</span>` : ''}</div>`
    + `<p class="bf-t">${esc(o.t)}</p><p class="bf-p">${o.d ? `<s>${rs(o.d)}</s> ` : ''}<b>${rs(o.p)}</b>${o.pix ? ' <small>no Pix</small>' : ''}</p>`
    + `${o.obs ? `<p class="bf-o">${esc(o.obs)}</p>` : ''}<a class="bf-b" href="${esc(o.u)}" target="_blank" rel="sponsored nofollow noopener">Ver na loja</a></li>`;
  const mais = d.ofertas.length > 10 ? `<button class="bf-ver" type="button" aria-expanded="false">Ver as ${d.ofertas.length} ofertas</button>` : '';
  return `<section class="bf" id="black-friday" aria-labelledby="bf-h"><div class="bf-in"><header class="bf-h"><p class="bf-k">Black Friday</p><h2 id="bf-h">As ofertas de Black Friday que valem a pena</h2>`
    + `<p class="bf-s">${d.ofertas.length} anúncios no Mercado Livre, na Shopee e na Amazon, lidos em ${quando}. Preço sem frete; pode ter mudado, confira na loja. O "de" é o do próprio anúncio.</p></header>`
    + `<ul class="bf-g">${d.ofertas.map(card).join('')}</ul>${mais}<p class="bf-n">Links de afiliado: a loja pode pagar comissão ao site, sem custo para você. A comissão não muda a ordem nem o ranking.</p></div></section>`;
}

const CSS = `.bf{margin:28px 0;border-radius:20px;background:#0B0B0F;color:#F4F4F6;--bfy:#FFCF33;overflow:hidden}
.bf-in{padding:28px 20px}@media(min-width:760px){.bf-in{padding:36px 32px}}
.bf-k{display:inline-block;margin:0 0 10px;padding:4px 10px;border-radius:999px;background:var(--bfy);color:#231C00;font-weight:800;font-size:.78rem;letter-spacing:.08em;text-transform:uppercase}
.bf-h h2{margin:0;font-size:clamp(1.4rem,3.4vw,2rem);line-height:1.15;color:#fff}.bf-s{margin:8px 0 0;color:rgb(244 244 246/.72);max-width:62ch;font-size:.92rem}
.bf-g{list-style:none;margin:20px 0 0;padding:0;display:grid;gap:12px;grid-template-columns:repeat(auto-fill,minmax(210px,1fr))}
.bf-c{display:flex;flex-direction:column;gap:6px;padding:14px;border-radius:14px;background:#17171F;border:1px solid rgb(255 255 255/.08)}
.bf.bf-fechado .bf-mais{display:none}@media(max-width:600px){.bf.bf-fechado .bf-m{display:none}}
.bf-top{display:flex;flex-wrap:wrap;gap:6px;align-items:center}.bf-loja,.bf-selo,.bf-x{font-size:.72rem;font-weight:700;padding:2px 8px;border-radius:999px}
.bf-loja{background:rgb(255 255 255/.1);color:#fff}.bf-mercadolivre{background:#FFE600;color:#2D3277}.bf-shopee{background:#EE4D2D;color:#fff}.bf-amazon{background:#232F3E;color:#FF9900}
.bf-selo{background:#fff;color:#0B0B0F}.bf-x{background:#4CD49A;color:#0B2A1E;margin-left:auto}
.bf-t{margin:4px 0 0;font-weight:600;line-height:1.3;color:#fff}.bf-p{margin:auto 0 0;font-size:1.25rem;color:var(--bfy)}.bf-p s{font-size:.85rem;color:rgb(244 244 246/.55)}.bf-p small{font-size:.75rem;color:#fff;white-space:nowrap}
.bf-o{margin:0;font-size:.78rem;color:rgb(244 244 246/.65)}
.bf-b{display:block;text-align:center;margin-top:6px;padding:9px 12px;border-radius:10px;background:var(--bfy);color:#231C00;font-weight:800;text-decoration:none}.bf-b:hover{filter:brightness(1.08)}
.bf-b:focus-visible,.bf-ver:focus-visible{outline:3px solid #fff;outline-offset:2px}
.bf-ver{display:block;margin:16px auto 0;padding:10px 18px;border-radius:999px;border:1px solid rgb(255 255 255/.25);background:transparent;color:#fff;font-weight:700;cursor:pointer}
.bf-n{margin:16px 0 0;font-size:.75rem;color:rgb(244 244 246/.55)}`;

/** Conteúdo do asset: dados + render + montagem depois do palco da Home (o index re-renderiza #view a cada navegação). */
export function asset(d) {
  return `/* Black Friday na Home — gerado por tools/black-friday-site.mjs a partir de config/social-black-friday.json. Não editar. */
(()=>{"use strict";const D=${JSON.stringify(d)};const render=${render.toString()};
const st=document.createElement("style");st.textContent=${JSON.stringify(CSS)};document.head.appendChild(st);
const por=()=>{const v=document.getElementById("view");if(!v)return;const palco=v.querySelector(":scope>.stage");if(!palco||v.querySelector("#black-friday"))return;
const h=render(D,Date.now());if(!h)return;palco.insertAdjacentHTML("afterend",h);const s=v.querySelector("#black-friday");const b=s.querySelector(".bf-ver");
if(b){s.classList.add("bf-fechado");b.addEventListener("click",()=>{const f=s.classList.toggle("bf-fechado");b.setAttribute("aria-expanded",String(!f));b.textContent=f?"Ver as "+D.ofertas.length+" ofertas":"Mostrar menos"})}};
const ini=()=>{const v=document.getElementById("view");if(!v)return;por();new MutationObserver(por).observe(v,{childList:true})};
document.readyState==="loading"?document.addEventListener("DOMContentLoaded",ini):ini()})();
`;
}

function main() {
  const check = process.argv.includes('--check');
  const campanha = JSON.parse(fs.readFileSync(CONFIG, 'utf8'));
  const novo = asset(dadosSecao(campanha));
  const html = fs.readFileSync(INDEX, 'utf8'); const m = html.match(TAG);
  const atual = m && fs.existsSync(path.join(PASTA, `bf-v${m[1]}.js`)) ? fs.readFileSync(path.join(PASTA, `bf-v${m[1]}.js`), 'utf8') : null;
  if (atual === novo) { console.log(`bf-v${m[1]}.js em dia`); return; }
  if (check) { console.error('assets/web/bf-v*.js desatualizado: rode node tools/black-friday-site.mjs'); process.exit(1); }
  const n = m ? Number(m[1]) + 1 : 1; const tag = `<script src=/assets/web/bf-v${n}.js defer></script>`;
  fs.writeFileSync(path.join(PASTA, `bf-v${n}.js`), novo);
  fs.writeFileSync(INDEX, m ? html.replace(TAG, tag) : html.replace('</body>', `${tag}</body>`));
  console.log(`assets/web/bf-v${n}.js escrito; index.html aponta para ele`);
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
