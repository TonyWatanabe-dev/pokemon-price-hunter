#!/usr/bin/env python3
"""Clipes de motion do TCG Price Hunter no estilo Social do design system (vivo.py): fundo de cor cheia, raios, anéis,
pontos, brilhos, selo 'Caçado pelo', sombra dura navy. Logo real em arquivo, só escala/rotação uniforme (nunca deforma).
Renderiza 1080x1920 a 30 fps com Playwright (animações CSS pausadas e posicionadas quadro a quadro) e codifica em H.264.
Uso: python3 motion.py [nome...]"""
import sys, subprocess, shutil
from pathlib import Path
from playwright.sync_api import sync_playwright
from vivo import fontface, CSS, raio, brilho, aneis, dots, selo, NAVY, Y, WHITE, BLUE, RED, GRASS, PSY, FIRE, LOGO

AQUI = Path(__file__).parent
SAIDA = AQUI / 'out_motion'; SAIDA.mkdir(exist_ok=True)
W, H, FPS = 1080, 1920, 30
def img(n): return (AQUI / 'produtos' / n).as_uri()
EASE = 'cubic-bezier(.2,.8,.2,1)'; BACK = 'cubic-bezier(.34,1.56,.64,1)'

KF = """
@keyframes pop{0%{transform:translate(-50%,-50%) scale(0) rotate(-12deg)}100%{transform:translate(-50%,-50%) scale(1) rotate(0)}}
@keyframes popr{0%{transform:scale(0) rotate(var(--r0,-20deg))}100%{transform:scale(1) rotate(var(--r,0deg))}}
@keyframes sobe{0%{transform:translateY(var(--dy,160px)) rotate(var(--r,0deg));opacity:0}100%{transform:translateY(0) rotate(var(--r,0deg));opacity:1}}
@keyframes entraE{0%{transform:translateX(-1400px) rotate(var(--r,0deg))}100%{transform:translateX(0) rotate(var(--r,0deg))}}
@keyframes entraD{0%{transform:translateX(1400px) rotate(var(--r,0deg))}100%{transform:translateX(0) rotate(var(--r,0deg))}}
@keyframes gira{to{transform:rotate(360deg)}}
@keyframes pulsa{0%,100%{transform:scale(1)}50%{transform:scale(1.06)}}
@keyframes onda{0%{transform:scale(.4);opacity:.7}100%{transform:scale(1.6);opacity:0}}
@keyframes pisca{0%,100%{transform:scale(0) rotate(0)}50%{transform:scale(1) rotate(45deg)}}
@keyframes flutua{0%,100%{transform:translateY(0) rotate(var(--r,0deg))}50%{transform:translateY(-26px) rotate(var(--r,0deg))}}
@keyframes carimbo{0%{transform:scale(3) rotate(-30deg);opacity:0}60%{transform:scale(.92) rotate(-8deg);opacity:1}100%{transform:scale(1) rotate(-10deg);opacity:1}}
@keyframes varre{0%{transform:translateX(-1600px) skewX(-18deg)}100%{transform:translateX(1700px) skewX(-18deg)}}
@keyframes cai{0%{transform:translateY(-1400px) rotate(var(--r0,0deg))}100%{transform:translateY(0) rotate(var(--r,0deg))}}
@keyframes risca{0%{width:0}100%{width:108%}}
@keyframes tremor{0%,100%{transform:translate(0,0)}20%{transform:translate(-14px,8px)}40%{transform:translate(12px,-10px)}60%{transform:translate(-8px,6px)}80%{transform:translate(6px,-4px)}}
@keyframes seta{0%,100%{transform:translate(-50%,0)}50%{transform:translate(-50%,40px)}}
.a{position:absolute}
.pill2{position:absolute;left:50%;font-weight:900;border-radius:999px;white-space:nowrap;box-shadow:10px 10px 0 rgba(19,31,73,.9)}
"""

def an(nome, dur, delay=0, ease=EASE, it=1, fill='both'):
    return f'animation:{nome} {dur}s {ease} {delay}s {it} {fill};'

def page(bg, corpo, bar=NAVY):
    return (f'<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>{fontface()}{CSS}{KF}</style></head><body>'
            f'<div class="art" style="width:{W}px;height:{H}px;background:{bg};color:{NAVY}">'
            f'<div class="bar" style="background:{bar}"></div>{corpo}</div></body></html>')

def wrap(html, estilo):  # anima um motivo do vivo.py sem mexer no transform interno dele
    return f'<div class="a" style="left:0;top:0;width:{W}px;height:{H}px;{estilo}">{html}</div>'

def faisca(cor, x, y, s, d):
    return f'<div class="a" style="left:{x}px;top:{y}px;z-index:7;{an("pisca", 1.2, d, "ease-in-out", "infinite")}">{brilho(cor, 0, 0, s)}</div>'

def fundo_vivo(bg, tinta, onda_cx=540, onda_cy=960):
    ondas = ''.join(f'<div class="a" style="left:{onda_cx - 420}px;top:{onda_cy - 420}px;width:840px;height:840px;border-radius:50%;'
                    f'border:6px solid {WHITE};z-index:1;{an("onda", 2.4, i * .8, "ease-out", "infinite")}"></div>' for i in range(3))
    return (wrap(raio(tinta, -200, 260, 700, .10, -8), an('entraE', .7, 0, EASE) + '--r:0deg') +
            wrap(raio(tinta, 640, 900, 620, .08, 12, True), an('entraD', .7, .08, EASE)) +
            wrap(dots(tinta, 600, 1240) + dots(tinta, -120, 60), an('flutua', 4, 0, 'ease-in-out', 'infinite')) + ondas)

CLIPES = {}
def clipe(nome, dur):
    def reg(f): CLIPES[nome] = (f, dur); return f
    return reg

@clipe('logo_stinger', 3.0)
def _():
    return page(Y, fundo_vivo(Y, NAVY) +
        f'<div class="a" style="left:540px;top:900px;width:760px;height:760px;z-index:2;border-radius:50%;background:{WHITE};'
        f'box-shadow:18px 18px 0 rgba(19,31,73,.9);{an("pop", .55, .15, BACK)}"></div>'
        f'<img src="{LOGO}" class="a" style="left:540px;top:900px;width:600px;height:auto;z-index:3;{an("pop", .6, .3, BACK)}">'
        f'<div class="a" style="left:0;right:0;top:1380px;text-align:center;z-index:4;font-size:88px;font-weight:900;letter-spacing:-3px;color:{NAVY};{an("sobe", .5, .8)}">'
        f'<span class="hl" style="background:{NAVY};color:{Y}">o caçador de ofertas</span></div>' +
        faisca(WHITE, 170, 520, 90, .5) + faisca(NAVY, 860, 600, 64, .9) + faisca(WHITE, 880, 1300, 80, .2) + faisca(NAVY, 140, 1500, 56, 1.1))

@clipe('selo_cacado', 3.5)
def _():
    return page(BLUE, fundo_vivo(BLUE, WHITE, 540, 860) +
        f'<div class="card" style="left:190px;top:420px;width:700px;--r:-4deg;--dy:220px;{an("sobe", .6, .1)}"><img src="{img("c30-colecao_premium.webp")}"></div>'
        f'<div class="a" style="left:600px;top:980px;z-index:8;{an("carimbo", .45, .9, "ease-out")}"><div style="transform:scale(1.9);transform-origin:0 0">{selo(0, 0, 0)}</div></div>'
        f'<div class="a" style="left:0;top:0;width:{W}px;height:{H}px;{an("tremor", .25, 1.2, "linear")}"></div>'
        f'<h1 style="left:72px;top:1430px;width:940px;font-size:96px;line-height:98px;color:#fff;{an("sobe", .5, 1.5)}">Preço<br>'
        f'<span class="hl" style="background:{Y};color:{NAVY}">conferido.</span></h1>' +
        faisca(Y, 120, 330, 80, .6) + faisca(WHITE, 900, 380, 60, 1.0) + faisca(Y, 930, 1000, 70, .3))

@clipe('abaixo_sugerido', 3.5)
def _():
    burst = ''.join(f'<polygon points="0,-1 .1,-.3 .7,-.7 .3,-.1 1,0 .3,.1 .7,.7 .1,.3 0,1 -.1,.3 -.7,.7 -.3,.1 -1,0 -.3,-.1 -.7,-.7 -.1,-.3" fill="{RED}" transform="rotate({k*11})"/>' for k in range(2))
    return page(Y, fundo_vivo(Y, NAVY, 540, 820) +
        f'<div class="card" style="left:240px;top:330px;width:600px;--r:3deg;--r0:-30deg;{an("cai", .6, .05, BACK)}"><img src="{img("c30-etb.webp")}"></div>'
        f'<div class="a" style="left:0;right:0;text-align:center;top:1180px;z-index:6;font-size:88px;font-weight:900;letter-spacing:-3px;color:{NAVY};{an("sobe", .4, .6)}">'
        f'<span style="position:relative;display:inline-block;opacity:.55">preço cheio<i style="position:absolute;left:-4%;top:52%;height:12px;background:{RED};border-radius:6px;{an("risca", .35, 1.0)}"></i></span></div>'
        f'<div class="a" style="left:0;right:0;top:1340px;text-align:center;z-index:6;font-size:112px;font-weight:900;letter-spacing:-4px;--dy:120px;{an("sobe", .45, 1.35, BACK)}">'
        f'<span class="hl" style="background:{RED};color:#fff">abaixo do<br>sugerido</span></div>'
        f'<svg class="a" viewBox="-1 -1 2 2" style="left:770px;top:250px;width:280px;z-index:7;--r:12deg;--r0:-90deg;{an("popr", .5, .4, BACK)}">{burst}'
        f'<text x="0" y=".1" text-anchor="middle" font-family="Rubik" font-weight="900" font-size=".24" fill="#fff">OFERTA</text></svg>' +
        faisca(WHITE, 130, 300, 70, .8) + faisca(NAVY, 900, 1100, 60, 1.2))

@clipe('transicao_raio', 1.0)
def _():
    return page('transparent', f'<div class="a" style="left:0;top:-200px;width:1500px;height:2400px;z-index:9;background:{NAVY};{an("varre", .9, 0, "cubic-bezier(.6,0,.4,1)")}">'
        f'<div style="position:absolute;left:1500px;top:0;width:180px;height:100%;background:{Y}"></div>'
        f'<div style="position:absolute;left:-150px;top:0;width:150px;height:100%;background:{BLUE}"></div></div>', bar='transparent')

@clipe('cta_grupo', 4.0)
def _():
    return page(NAVY, fundo_vivo(NAVY, Y, 540, 900) +
        f'<img src="{LOGO}" class="a" style="left:540px;top:330px;width:380px;z-index:4;{an("pop", .5, .05, BACK)}">'
        f'<h1 style="left:72px;top:560px;width:940px;text-align:center;font-size:120px;line-height:118px;color:#fff;{an("sobe", .5, .35)}">Ofertas no<br>'
        f'<span class="hl" style="background:{Y};color:{NAVY}">seu celular.</span></h1>'
        f'<div class="a" style="left:0;right:0;top:1010px;text-align:center;z-index:5"><div style="display:inline-block;{an("sobe", .45, .8, BACK)}">'
        f'<div style="font-size:62px;font-weight:900;padding:30px 60px;border-radius:999px;background:{GRASS};color:#fff;box-shadow:10px 10px 0 rgba(0,0,0,.35);{an("pulsa", .9, 1.3, "ease-in-out", "infinite")}">Entra no grupo grátis</div></div></div>'
        f'<svg class="a" viewBox="0 0 100 130" style="left:540px;top:1230px;width:150px;z-index:5;transform:translateX(-50%);{an("seta", .8, 1.2, "ease-in-out", "infinite")}">'
        f'<polygon points="30,0 70,0 70,70 100,70 50,130 0,70 30,70" fill="{Y}" stroke="#fff" stroke-width="6"/></svg>'
        f'<div class="a" style="left:0;right:0;top:1560px;text-align:center;z-index:5;font-size:52px;font-weight:900;color:{Y};letter-spacing:-1px;{an("sobe", .45, 1.1)}">www.tcgpricehunter.com.br</div>'
        f'<div class="a" style="left:0;right:0;top:1650px;text-align:center;z-index:5;font-size:30px;font-weight:700;color:#fff;opacity:.8;{an("sobe", .45, 1.25)}">link na bio</div>' +
        faisca(Y, 120, 260, 80, .5) + faisca(WHITE, 900, 300, 60, .9) + faisca(Y, 900, 1400, 70, .2) + faisca(WHITE, 110, 1450, 56, 1.1))

@clipe('fundo_loop', 6.0)
def _():
    aneis_g = f'<div class="a" style="left:0;top:0;width:{W}px;height:{H}px;transform-origin:540px 960px;{an("gira", 24, 0, "linear", "infinite")}">{aneis(WHITE, 540, 960, (300, 420, 540, 660), .35)}</div>'
    return page(Y, wrap(raio(NAVY, -200, 260, 700, .10, -8) + raio(NAVY, 640, 900, 620, .08, 12, True), '') + aneis_g +
        wrap(dots(NAVY, 600, 1240) + dots(NAVY, -120, 60), an('flutua', 6, 0, 'ease-in-out', 'infinite')) +
        ''.join(faisca(c, x, y, s, d) for c, x, y, s, d in [(WHITE, 160, 400, 80, 0), (NAVY, 860, 560, 60, .7), (WHITE, 820, 1380, 90, 1.4),
                                                             (NAVY, 180, 1500, 56, 2.1), (WHITE, 520, 220, 50, 2.8), (NAVY, 520, 1720, 64, 3.5)]))

ALFA = {'transicao_raio', 'transicao_aneis', 'sticker_hit', 'sticker_rara', 'sticker_oferta', 'tarja_site', 'confete'}
T = 'transparent'

def burst_svg(cor, txt, fs=.30, pontas=16, sub=''):
    pts = ' '.join(f'{(1 if k % 2 == 0 else .72) * __import__("math").cos(k * 3.14159 / pontas):.3f},{(1 if k % 2 == 0 else .72) * __import__("math").sin(k * 3.14159 / pontas):.3f}' for k in range(2 * pontas))
    s2 = f'<text x="0" y=".36" text-anchor="middle" font-family="Rubik" font-weight="800" font-size=".12" fill="#fff" letter-spacing=".01">{sub}</text>' if sub else ''
    return (f'<svg viewBox="-1.1 -1.1 2.3 2.3" style="width:100%;overflow:visible"><polygon points="{pts}" fill="{NAVY}" transform="translate(.07 .07)"/>'
            f'<polygon points="{pts}" fill="{cor}" stroke="#fff" stroke-width=".05"/>'
            f'<text x="0" y="{.1 if not sub else .06}" text-anchor="middle" font-family="Rubik" font-weight="900" font-size="{fs}" fill="#fff">{txt}</text>{s2}</svg>')

def sticker(cor, txt, sub=''):
    return page(T, f'<div class="a" style="left:240px;top:660px;width:600px;z-index:5;--r0:-40deg;--r:-8deg;{an("popr", .45, .05, BACK)}">'
                   f'<div style="{an("pulsa", .7, .6, "ease-in-out", "infinite")}">{burst_svg(cor, txt, sub=sub)}</div></div>' +
                   faisca(WHITE, 200, 600, 90, .3) + faisca(Y, 840, 680, 70, .5) + faisca(WHITE, 820, 1240, 80, .1), bar=T)

@clipe('sticker_hit', 2.0)
def _(): return sticker(RED, 'HIT!')
@clipe('sticker_rara', 2.0)
def _(): return sticker(PSY, 'RARA!', '')
@clipe('sticker_oferta', 2.0)
def _(): return sticker(GRASS, 'OFERTA', 'CAÇADA PELO SITE')

@clipe('transicao_aneis', 1.0)
def _():
    an_ = ''.join(f'<div class="a" style="left:540px;top:960px;width:0;height:0;z-index:{9 - i};border-radius:50%;background:{c};'
                  f'{an("expande", .8, i * .08, "cubic-bezier(.6,0,.4,1)")}"></div>' for i, c in enumerate((Y, BLUE, NAVY)))
    return page(T, '<style>@keyframes expande{0%{width:0;height:0;margin:0;opacity:1}55%{width:2400px;height:2400px;margin:-1200px 0 0 -1200px;opacity:1}100%{width:2400px;height:2400px;margin:-1200px 0 0 -1200px;opacity:0}}</style>' + an_, bar=T)

@clipe('tarja_site', 4.0)
def _():
    return page(T, f'<div class="a" style="left:0;right:0;top:1500px;text-align:center;z-index:5"><div style="display:inline-block;--dy:220px;{an("sobe", .45, .1, BACK)}">'
        f'<div style="display:flex;align-items:center;gap:22px;padding:22px 40px 22px 22px;border-radius:30px;background:{WHITE};box-shadow:12px 12px 0 rgba(19,31,73,.9)">'
        f'<img src="{LOGO}" style="width:200px"><div style="text-align:left"><div style="font-size:26px;font-weight:800;letter-spacing:2px;color:#556079">PREÇO COMPARADO EM</div>'
        f'<div style="font-size:50px;font-weight:900;letter-spacing:-1.5px;color:{NAVY}">tcgpricehunter.com.br</div></div></div></div></div>', bar=T)

@clipe('confete', 3.0)
def _():
    import random; random.seed(7); c = ''
    for k in range(70):
        x = random.randint(0, 1060); d = random.uniform(0, 1.2); r0 = random.randint(-180, 180); cor = random.choice((Y, BLUE, RED, GRASS, WHITE, NAVY))
        w = random.randint(18, 34)
        c += (f'<div class="a" style="left:{x}px;top:0;width:{w}px;height:{int(w * .55)}px;border-radius:4px;background:{cor};z-index:5;'
              f'--r0:{r0}deg;--r:{r0 + random.choice((-1, 1)) * random.randint(200, 540)}deg;{an("chuva", random.uniform(1.6, 2.4), d, "cubic-bezier(.3,.1,.6,1)")}"></div>')
    return page(T, '<style>@keyframes chuva{0%{transform:translateY(-80px) rotate(var(--r0))}100%{transform:translateY(2050px) rotate(var(--r))}}</style>' + c, bar=T)

@clipe('abrindo_agora', 3.0)
def _():
    return page(RED, fundo_vivo(RED, WHITE) +
        f'<div class="a" style="left:0;right:0;top:640px;text-align:center;z-index:4;font-size:84px;font-weight:900;letter-spacing:3px;color:{Y};{an("sobe", .4, .05)}">ABRINDO</div>'
        f'<div class="a" style="left:0;right:0;top:760px;text-align:center;z-index:4;font-size:230px;line-height:1;font-weight:900;letter-spacing:-10px;color:#fff;--dy:300px;{an("sobe", .5, .25, BACK)}">'
        f'<span style="display:inline-block;{an("pulsa", .6, .9, "ease-in-out", "infinite")}">AGORA</span></div>'
        f'<div class="a" style="left:0;right:0;top:1090px;text-align:center;z-index:4;{an("sobe", .4, .6)}"><span class="hl" style="background:{NAVY};color:{Y};font-size:66px;font-weight:900">vem hit?</span></div>' +
        faisca(Y, 150, 420, 90, .4) + faisca(WHITE, 870, 500, 70, .8) + faisca(Y, 860, 1350, 80, .2) + faisca(WHITE, 140, 1400, 60, 1.0))

@clipe('vale_a_pena', 3.0)
def _():
    return page(BLUE, fundo_vivo(BLUE, WHITE) +
        f'<h1 style="left:0;right:0;top:720px;text-align:center;font-size:150px;line-height:150px;color:#fff;{an("sobe", .45, .1, BACK)}">Vale a<br>'
        f'<span class="hl" style="background:{Y};color:{NAVY}">pena?</span></h1>'
        f'<div class="a" style="left:780px;top:560px;width:220px;z-index:6;--r0:-60deg;--r:14deg;{an("popr", .4, .6, BACK)}">{burst_svg(RED, "?", .9)}</div>' +
        faisca(Y, 150, 450, 80, .3) + faisca(WHITE, 160, 1350, 70, .8) + faisca(Y, 880, 1300, 60, .5))

@clipe('siga_perfil', 3.5)
def _():
    return page(Y, fundo_vivo(Y, NAVY) +
        f'<img src="{LOGO}" class="a" style="left:540px;top:620px;width:460px;z-index:4;{an("pop", .5, .05, BACK)}">'
        f'<div class="a" style="left:0;right:0;top:860px;text-align:center;z-index:4;font-size:120px;font-weight:900;letter-spacing:-4px;color:{NAVY};{an("sobe", .45, .4)}">Segue a gente</div>'
        f'<div class="a" style="left:0;right:0;top:1030px;text-align:center;z-index:4;{an("sobe", .45, .6, BACK)}"><span class="hl" style="background:{NAVY};color:{Y};font-size:72px;font-weight:900">@tcgpricehunter151</span></div>'
        f'<div class="a" style="left:0;right:0;top:1200px;text-align:center;z-index:4;font-size:40px;font-weight:800;color:{NAVY};{an("sobe", .4, .9)}">oferta conferida todo dia</div>' +
        faisca(WHITE, 160, 450, 90, .5) + faisca(NAVY, 880, 520, 60, .9) + faisca(WHITE, 880, 1400, 80, .2))

def tema(bg, tinta, titulo, destaque, hl_bg, hl_c, sub, motivo=''):
    return page(bg, fundo_vivo(bg, tinta) + motivo +
        f'<h1 style="left:0;right:0;top:700px;text-align:center;font-size:150px;line-height:150px;color:{"#fff" if bg != Y else NAVY};{an("sobe", .45, .15, BACK)}">{titulo}<br>'
        f'<span class="hl" style="background:{hl_bg};color:{hl_c}">{destaque}</span></h1>'
        f'<div class="a" style="left:0;right:0;top:1120px;text-align:center;z-index:4;font-size:48px;font-weight:800;color:{"#fff" if bg != Y else NAVY};{an("sobe", .4, .7)}">{sub}</div>'
        f'<img src="{LOGO}" class="a" style="left:540px;top:1460px;width:300px;z-index:4;{an("pop", .45, .9, BACK)}">' +
        faisca(hl_bg, 150, 440, 90, .3) + faisca(WHITE, 880, 520, 60, .8) + faisca(hl_bg, 870, 1330, 80, .5))

ABOBORA = '<svg viewBox="0 0 100 100" style="width:100%"><rect x="46" y="4" width="8" height="18" rx="3" fill="#2f9a55"/><ellipse cx="50" cy="60" rx="46" ry="36" fill="#e0512b" stroke="#131f49" stroke-width="4"/><path d="M50 26 C40 40 40 80 50 96 M50 26 C60 40 60 80 50 96" fill="none" stroke="#131f49" stroke-width="3"/><polygon points="28,52 38,52 33,44" fill="#131f49"/><polygon points="62,52 72,52 67,44" fill="#131f49"/><path d="M30 70 Q50 84 70 70 L64 72 L58 78 L50 72 L42 78 L36 72Z" fill="#131f49"/></svg>'

@clipe('tema_halloween', 3.5)
def _():
    mot = ''.join(f'<div class="a" style="left:{x}px;top:{y}px;width:{w}px;z-index:3;--r:{r}deg;{an("flutua", 2.4, d, "ease-in-out", "infinite")}">{ABOBORA}</div>'
                  for x, y, w, r, d in ((90, 330, 170, -12, 0), (830, 380, 150, 10, .6), (820, 1300, 190, -6, .3)))
    return tema('#3b1f5e', FIRE, 'Ofertas de', 'Halloween', FIRE, '#fff', 'preço conferido, sem susto', mot)

@clipe('tema_black_friday', 3.5)
def _():
    return tema(NAVY, Y, 'BLACK', 'FRIDAY', Y, NAVY, 'só oferta real, comparada no site')

@clipe('tema_natal', 3.5)
def _():
    return tema(RED, WHITE, 'Presente de', 'Natal', GRASS, '#fff', 'TCG pelo melhor preço')

def render(nome):
    f, dur = CLIPES[nome]
    html = AQUI / 'html' / f'M_{nome}.html'; html.parent.mkdir(exist_ok=True); html.write_text(f())
    tmp = SAIDA / f'_{nome}'; shutil.rmtree(tmp, ignore_errors=True); tmp.mkdir()
    with sync_playwright() as p:
        b = p.chromium.launch(); pg = b.new_page(viewport={'width': W, 'height': H})
        pg.goto(html.as_uri()); pg.wait_for_load_state('networkidle'); pg.evaluate('document.fonts.ready')
        pg.evaluate('document.getAnimations().forEach(a => a.pause())')
        for i in range(round(dur * FPS)):
            pg.evaluate(f'document.getAnimations().forEach(a => a.currentTime = {i * 1000 / FPS})')
            pg.screenshot(path=str(tmp / f'{i:04d}.png'), omit_background=(nome in ALFA))
        b.close()
    if nome in ALFA:  # com canal alfa para sobrepor no corte
        subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-framerate', str(FPS), '-i', str(tmp / '%04d.png'),
                        '-c:v', 'prores_ks', '-profile:v', '4444', '-pix_fmt', 'yuva444p10le', str(SAIDA / f'M_{nome}.mov')], check=True)
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-framerate', str(FPS), '-i', str(tmp / '%04d.png'),
                    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-crf', '18', '-movflags', '+faststart', str(SAIDA / f'M_{nome}.mp4')], check=True)
    n = round(dur * FPS)
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', str(SAIDA / f'M_{nome}.mp4'), '-vf',
                    f"select='eq(n\\,{int(n*.25)})+eq(n\\,{int(n*.55)})+eq(n\\,{n-2})',scale=270:-1,tile=3x1", '-frames:v', '1', '-vsync', '0',
                    str(SAIDA / f'P_{nome}.jpg')], check=True)
    shutil.rmtree(tmp)
    print('ok', nome)

if __name__ == '__main__':
    for n in sys.argv[1:] or CLIPES: render(n)
