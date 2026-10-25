#!/usr/bin/env python3
"""Artes 'vivas' do TCG Price Hunter: seção Social do design system (fundo de cor cheia, motivos próprios,
fichas de tipo, selo da marca, cartas com borda branca e sombra dura). Renderiza JPG com Playwright.
Uso: python3 vivo.py [prefixo...]"""
import sys, html
from pathlib import Path
from playwright.sync_api import sync_playwright

AQUI = Path(__file__).parent
REPO = Path('/home/claude/pokemon-price-hunter')
CARTAS = REPO / 'tmp-cartas'
FONTES = Path('/tmp/fontes/package/files')
LOGO = (REPO / 'assets/web/logo-v1.webp').as_uri()
SAIDA = AQUI / 'out_vivo'; SAIDA.mkdir(exist_ok=True)
CRED = 'Cartas © Pokémon/Nintendo/Creatures/GAME FREAK · dados TCGdex'

NAVY, Y, RED, BLUE, FIRE, GRASS, PSY, WHITE = '#131f49', '#ffcf33', '#c93d25', '#2c7be5', '#e0512b', '#2f9a55', '#8e4bd6', '#ffffff'
LIGHT = {Y, '#e2a500', '#c9ced8'}

def img(n): return (CARTAS / n).as_uri()
def ink(bg): return NAVY if bg in LIGHT else WHITE

def fontface():
    return ''.join(f"@font-face{{font-family:Rubik;font-weight:{w};src:url('{(FONTES / f'rubik-latin-{w}-normal.woff2').as_uri()}')}}" for w in (500, 700, 800, 900))

CSS = """
*{box-sizing:border-box}body{margin:0;font-family:Rubik,system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.art{position:relative;overflow:hidden}
.bar{position:absolute;left:0;top:0;right:0;height:18px;z-index:5}
.eb{position:absolute;left:72px;top:64px;display:flex;align-items:center;gap:14px;font-size:26px;font-weight:800;letter-spacing:3px;text-transform:uppercase;z-index:5}
.eb i{width:26px;height:26px;border-radius:7px;display:block}
.logo{position:absolute;right:72px;top:48px;width:200px;z-index:5}
.pg{position:absolute;right:72px;top:62px;font-size:26px;font-weight:900;z-index:5;padding:8px 18px;border-radius:999px}
h1{margin:0;font-weight:900;letter-spacing:-4px;position:absolute;z-index:4}
.hl{display:inline-block;padding:0 18px 6px;border-radius:22px;transform:rotate(-2deg);box-shadow:10px 10px 0 rgba(19,31,73,.9)}
.card{position:absolute;z-index:3;border-radius:22px;background:#fff;padding:10px;box-shadow:14px 16px 0 rgba(19,31,73,.85)}
.card img{display:block;width:100%;border-radius:14px}
.foot{position:absolute;left:72px;right:72px;bottom:52px;display:flex;align-items:center;justify-content:space-between;gap:24px;z-index:5}
.cred{font-size:18px;line-height:24px;font-weight:500;max-width:600px;opacity:.85}
.pill{font-size:30px;font-weight:900;padding:18px 34px;border-radius:999px;white-space:nowrap;box-shadow:8px 8px 0 rgba(19,31,73,.9)}
.ficha{position:absolute;z-index:5;display:flex;align-items:center;gap:12px;padding:12px 22px 12px 14px;border-radius:18px;font-size:24px;font-weight:900;letter-spacing:2px;white-space:nowrap;box-shadow:6px 6px 0 rgba(19,31,73,.9)}
.ficha b{width:44px;height:44px;border-radius:12px;display:grid;place-items:center}
.selo{position:absolute;z-index:6;width:190px;height:190px;border-radius:50%;background:#fff;display:grid;place-items:center;box-shadow:8px 8px 0 rgba(19,31,73,.9);text-align:center}
.selo span{font-size:19px;font-weight:900;letter-spacing:1px;color:#131f49;line-height:22px}
.mot{position:absolute;z-index:1;pointer-events:none}
.dots{position:absolute;z-index:1;width:520px;height:520px;border-radius:50%}
"""

def raio(cor, x, y, w, op, rot=0, flip=False):
    sx = -1 if flip else 1
    return (f'<svg class="mot" style="left:{x}px;top:{y}px;width:{w}px;opacity:{op};transform:rotate({rot}deg) scaleX({sx})" viewBox="0 0 520 900">'
            f'<polygon fill="{cor}" points="300,0 90,470 250,470 140,900 470,330 300,330 430,0"/></svg>')

def brilho(cor, x, y, s, rot=0):
    return (f'<svg class="mot" style="left:{x}px;top:{y}px;width:{s}px;z-index:6;transform:rotate({rot}deg)" viewBox="-50 -50 100 100">'
            f'<path fill="{cor}" d="M0,-50 C4,-10 10,-4 50,0 C10,4 4,10 0,50 C-4,10 -10,4 -50,0 C-10,-4 -4,-10 0,-50Z"/></svg>')

def aneis(cor, cx, cy, rs, op=.25):
    return ''.join(f'<div class="mot" style="left:{cx - r}px;top:{cy - r}px;width:{2 * r}px;height:{2 * r}px;border-radius:50%;border:4px solid {cor};opacity:{op}"></div>' for r in rs)

def dots(cor, x, y, op=.22):
    return f'<div class="dots" style="left:{x}px;top:{y}px;opacity:{op};background:radial-gradient({cor} 28%,transparent 30%) 0 0/26px 26px;-webkit-mask:radial-gradient(circle,#000 30%,transparent 70%)"></div>'

BOLT = '<svg viewBox="0 0 24 24" width="28"><polygon fill="{c}" points="14,1 4,14 11,14 9,23 20,9 13,9"/></svg>'
ICONES = {'raio': BOLT,
          'brilho': '<svg viewBox="-50 -50 100 100" width="28"><path fill="{c}" d="M0,-50 C4,-10 10,-4 50,0 C10,4 4,10 0,50 C-4,10 -10,4 -50,0 C-10,-4 -4,-10 0,-50Z"/></svg>',
          'lua': '<svg viewBox="0 0 24 24" width="26"><path fill="{c}" d="M15 2 A10 10 0 1 0 22 17 A8 8 0 1 1 15 2Z"/></svg>',
          'chama': '<svg viewBox="0 0 100 140" width="22"><path fill="{c}" d="M50 0 C60 30 90 45 90 85 C90 115 72 140 50 140 C28 140 10 115 10 85 C10 60 30 50 35 30 C42 45 45 55 50 60 C55 40 48 20 50 0Z"/></svg>',
          'alerta': '<svg viewBox="0 0 24 24" width="28"><path fill="{c}" d="M12 2 L23 21 L1 21Z"/></svg>'}
def ficha(txt, bg, x, y, rot=0, icon='raio'):
    c = ink(bg); icon = ICONES[icon].format(c=bg)
    return f'<div class="ficha" style="left:{x}px;top:{y}px;background:{bg};color:{c};transform:rotate({rot}deg)"><b style="background:{c}">{icon}</b>{txt}</div>'

def selo(x, y, rot=-10):
    return (f'<div class="selo" style="left:{x}px;top:{y}px;transform:rotate({rot}deg)"><div>'
            f'<img src="{LOGO}" style="width:140px;display:block;margin:0 auto 6px"><span>CAÇADO PELO<br>TCG PRICE HUNTER</span></div></div>')

def carta(n, x, y, w, rot=0, z=3):
    return f'<div class="card" style="left:{x}px;top:{y}px;width:{w}px;transform:rotate({rot}deg);z-index:{z}"><img src="{img(n)}"></div>'

def pagina(bg, corpo, eb='', eb_cor=NAVY, bar=NAVY, pg='', w=1080, h=1350):
    c = ink(bg)
    e = f'<div class="eb" style="color:{c}"><i style="background:{eb_cor}"></i>{eb}</div>' if eb else ''
    top = f'<div class="pg" style="background:{c};color:{bg}">{pg}</div>' if pg else f'<img class="logo" src="{LOGO}">'
    return (f'<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><style>{fontface()}{CSS}</style></head><body>'
            f'<div class="art" style="width:{w}px;height:{h}px;background:{bg};color:{c}"><div class="bar" style="background:{bar}"></div>{e}{top}{corpo}</div></body></html>')

def foot(bg, direita='Arrasta', cta=False, cred=CRED):
    c = ink(bg)
    pill_bg, pill_c = (NAVY, Y) if bg in LIGHT else (Y, NAVY)
    txt = 'Link na bio → grupo' if cta else f'{direita} →'
    return f'<div class="foot"><div class="cred" style="color:{c}">{cred}</div><div class="pill" style="background:{pill_bg};color:{pill_c}">{txt}</div></div>'

ARTES = {}
def feed(nome, h): ARTES[nome] = (h, 1080, 1350)

# ------------------------------------------------ 30 Pikachus, 30 ilustradores (Papo de binder, Dom 25/10)
PIKAS = [(23, 'Ken Sugimori'), (24, 'danciao'), (25, 'satoma'), (26, 'Takeshi Nakamura'), (27, 'Asako Ito'), (28, 'sowsow'),
         (29, 'James Turner'), (30, 'DOM'), (31, 'Atsushi Furusawa'), (32, 'Tomokazu Komiya'), (33, 'Narumi Sato'), (34, 'USGMEN'),
         (35, 'Susumu Maeya'), (36, 'OKACHEKE'), (37, 'Yuu Nishida'), (38, 'Tetsu Kayama'), (39, 'Teeziro'), (40, 'Shinji Kanda'),
         (41, 'Rianti Hidayat'), (42, 'Akira Komayama'), (43, 'OOYAMA'), (44, 'akagi'), (45, 'Naoyo Kimura'), (46, 'svlt'),
         (47, 'Atsuko Nishida'), (48, 'KIYOTAKA OSHIYAMA'), (49, 'Nurikabe'), (50, 'Shimaris Yukichi'), (51, 'nagimiso'), (52, 'Kazuki Minami')]

feed('V_30pika_1', pagina(Y, eb='Papo de binder', eb_cor=BLUE, bar=BLUE, corpo=
    raio(NAVY, -170, 380, 620, .10, -8) + raio(NAVY, 760, -120, 460, .08, 12, True) + dots(NAVY, 620, 760) +
    aneis(WHITE, 540, 930, (260, 340, 420), .45) +
    f'<h1 style="left:72px;top:150px;width:940px;font-size:118px;line-height:110px;color:{NAVY}">30 Pikachus.<br>'
    f'<span class="hl" style="background:{BLUE};color:#fff">30 artistas.</span></h1>'
    f'<p style="position:absolute;left:72px;top:430px;margin:0;font-size:34px;font-weight:800;color:{NAVY};z-index:4">Todos da Celebração de 30 Anos. Arrasta e acha o seu.</p>' +
    carta('30th-023.png', 70, 650, 330, -11, 3) + carta('30th-047.png', 680, 650, 330, 11, 3) + carta('30th-032.png', 375, 590, 340, 0, 4) +
    ficha('TIPO ELÉTRICO', NAVY, 72, 540, -3) + selo(830, 470, 10) +
    brilho(WHITE, 440, 470, 64) + brilho(NAVY, 960, 1060, 50, 15) + brilho(WHITE, 120, 1100, 44) + brilho(WHITE, 640, 520, 36) +
    foot(Y)))

CORES = [BLUE, FIRE, GRASS, PSY, RED]
for g in range(5):
    bg = CORES[g]; grupo = PIKAS[g * 6:(g + 1) * 6]; cel = ''
    for j, (n, art) in enumerate(grupo):
        x = 72 + (j % 3) * 322; y = 175 + (j // 3) * 545; rot = (-3, 2, -2, 3, -2, 2)[j]
        cel += (f'<div style="position:absolute;left:{x}px;top:{y}px;width:290px;text-align:center;z-index:3">'
                f'<div class="card" style="position:relative;width:290px;transform:rotate({rot}deg)"><img src="{img(f"30th-{n:03d}.png")}"></div>'
                f'<div style="display:inline-block;margin-top:16px;font-size:22px;font-weight:900;background:{Y};color:{NAVY};padding:4px 14px;border-radius:999px">{n:03d}</div>'
                f'<div style="font-size:25px;line-height:29px;font-weight:800;margin-top:8px">{html.escape(art)}</div></div>')
    a, b = grupo[0][0], grupo[-1][0]
    feed(f'V_30pika_{g + 2}', pagina(bg, eb=f'Pikachu {a:03d} a {b:03d}', eb_cor=Y, bar=Y, pg=f'{g + 2}/7', corpo=
        raio(WHITE, -200, 300, 640, .10, -10) + raio(WHITE, 700, 700, 520, .08, 14, True) + dots(WHITE, 640, -120, .16) +
        cel + brilho(Y, 1000, 150, 46) + brilho(WHITE, 40, 1180, 40) + foot(bg)))

feed('V_30pika_7', pagina(Y, eb='Papo de binder', eb_cor=BLUE, bar=BLUE, pg='7/7', corpo=
    raio(NAVY, -160, 520, 600, .10, -6) + dots(NAVY, 640, 120) + aneis(WHITE, 540, 760, (250, 330), .5) +
    f'<h1 style="left:72px;top:150px;width:940px;font-size:110px;line-height:104px;color:{NAVY}">Qual mora no<br>'
    f'<span class="hl" style="background:{RED};color:#fff">seu binder?</span></h1>' +
    carta('30th-047.png', 150, 470, 370, -7) + carta('30th-023.png', 560, 490, 370, 7) +
    f'<div style="position:absolute;left:110px;right:110px;top:1035px;z-index:5;text-align:center;font-size:30px;line-height:40px;font-weight:800;background:#fff;color:{NAVY};padding:20px 26px;border-radius:26px;box-shadow:10px 10px 0 rgba(19,31,73,.9)">'
    f'O 047 é de Atsuko Nishida, que desenhou o Pikachu original. O 023 é de Ken Sugimori.</div>' +
    brilho(WHITE, 470, 430, 64) + brilho(NAVY, 940, 980, 46) + foot(Y, cta=True)))

# ================================================ Reskin da agenda (semanas 2 a 4) + carrosséis novos de abertura
PUX = AQUI / 'puxadas'      # recortes das fotos/frames das aberturas do dono (tmp-dragonite)
REC = AQUI / 'recortes'     # cartas sem PNG no disco, recortadas em alta das artes antigas
FOTOS = Path('/tmp/wt-coleta/tmp-dragonite/fotos')
B2, G2, F2, LIGHTN, DARK, FAIRY = '#1f63c4', '#237a42', '#c4431f', '#e2a500', '#2b2d42', '#e05aa0'
FIGHT2, METAL2, N1, N2, ORANGE, BLACK = '#a94c14', '#5d677c', '#140b2a', '#2a1550', '#ff8a3d', '#0b0b10'
LIGHT.update({FAIRY, ORANGE, LIGHTN, WHITE})
FONTE_LIGA = 'Liga Pokémon, preço médio NM, 23/10/2026'

def uri(p): return Path(p).as_uri()
def pos(x, y, z=4, extra=''): return f'position:absolute;left:{x}px;top:{y}px;z-index:{z};{extra}'
def texto(t, x, y, w, fs, lh, peso=800, cor=None, alinha='left', z=4, extra=''):
    c = f'color:{cor};' if cor else ''
    return f'<div style="{pos(x, y, z)}width:{w}px;font-size:{fs}px;line-height:{lh}px;font-weight:{peso};text-align:{alinha};{c}{extra}">{t}</div>'
def titulo(t, x, y, w, fs, lh, cor=None, alinha='left', ls=-4):
    c = f'color:{cor};' if cor else ''
    return f'<h1 style="left:{x}px;top:{y}px;width:{w}px;font-size:{fs}px;line-height:{lh}px;letter-spacing:{ls}px;text-align:{alinha};{c}">{t}</h1>'
def hl(t, bg, cor=None): return f'<span class="hl" style="background:{bg};color:{cor or ink(bg)}">{t}</span>'
def caixa(t, x, y, w, fs=30, lh=40, bg=WHITE, rot=0, alinha='left', pad='20px 26px', z=5, peso=800):
    return (f'<div style="{pos(x, y, z)}width:{w}px;background:{bg};color:{ink(bg)};font-size:{fs}px;line-height:{lh}px;font-weight:{peso};text-align:{alinha};'
            f'padding:{pad};border-radius:26px;box-shadow:10px 10px 0 rgba(19,31,73,.9);transform:rotate({rot}deg)">{t}</div>')
def foto(p, x, y, w, h, rot=0, z=3, obj='center'):
    return (f'<div class="card" style="left:{x}px;top:{y}px;width:{w}px;transform:rotate({rot}deg);z-index:{z}">'
            f'<img src="{uri(p)}" style="height:{h - 20}px;object-fit:cover;object-position:{obj}"></div>')
def produto(n, x, y, w, rot=0, z=3):
    return f'<img src="{img(n)}" style="{pos(x, y, z)}width:{w}px;transform:rotate({rot}deg);filter:drop-shadow(14px 16px 0 rgba(19,31,73,.85))">'
def lua(x, y, s, cor=Y, op=1):
    return (f'<svg class="mot" style="left:{x}px;top:{y}px;width:{s}px;opacity:{op};z-index:2" viewBox="0 0 100 100">'
            f'<path fill="{cor}" d="M62 4 A46 46 0 1 0 96 66 A36 36 0 1 1 62 4Z"/></svg>')
BAT = ('M100 34 L94 18 L88 30 C76 22 64 24 58 34 C48 20 28 16 4 26 C20 36 26 52 24 70 C36 58 52 60 60 72 '
       'C70 62 86 64 100 84 C114 64 130 62 140 72 C148 60 164 58 176 70 C174 52 180 36 196 26 C172 16 152 20 142 34 C136 24 124 22 112 30 L106 18Z')
def morcego(x, y, w, cor=WHITE, op=.18, rot=0):
    return f'<svg class="mot" style="left:{x}px;top:{y}px;width:{w}px;opacity:{op};transform:rotate({rot}deg)" viewBox="0 0 200 90"><path fill="{cor}" d="{BAT}"/></svg>'
def teia(x, y, s, cor=WHITE, op=.16, flip=False):
    import math
    raios = [i * 90 / 6 for i in range(7)]; linhas = ''
    for a in raios:
        linhas += f'<line x1="0" y1="0" x2="{100 * math.cos(math.radians(a)):.1f}" y2="{100 * math.sin(math.radians(a)):.1f}"/>'
    for r in (22, 42, 62, 82):
        pts = ' '.join(f'{r * math.cos(math.radians(a)):.1f},{r * math.sin(math.radians(a)):.1f}' for a in raios)
        linhas += f'<polyline fill="none" points="{pts}"/>'
    sx = -1 if flip else 1
    return (f'<svg class="mot" style="left:{x}px;top:{y}px;width:{s}px;opacity:{op};transform:scaleX({sx})" viewBox="0 0 100 100">'
            f'<g stroke="{cor}" stroke-width="1.6">{linhas}</g></svg>')
def chama(x, y, w, cor=ORANGE, op=.25, rot=0):
    return f'<svg class="mot" style="left:{x}px;top:{y}px;width:{w}px;opacity:{op};transform:rotate({rot}deg)" viewBox="0 0 100 140"><path fill="{cor}" d="M50 0 C60 30 90 45 90 85 C90 115 72 140 50 140 C28 140 10 115 10 85 C10 60 30 50 35 30 C42 45 45 55 50 60 C55 40 48 20 50 0Z"/></svg>'
def disco(cor, cx, cy, r, op=1): return f'<div class="mot" style="left:{cx - r}px;top:{cy - r}px;width:{2 * r}px;height:{2 * r}px;border-radius:50%;background:{cor};opacity:{op}"></div>'
def alerta(x, y, w, cor=WHITE, op=.14, rot=0):
    return (f'<svg class="mot" style="left:{x}px;top:{y}px;width:{w}px;opacity:{op};transform:rotate({rot}deg)" viewBox="0 0 120 108">'
            f'<path d="M60 6 L114 102 L6 102 Z" fill="{cor}" stroke="{cor}" stroke-width="10" stroke-linejoin="round"/></svg>')
def preco(valor, x, y, w, bg=Y, rot=-4, rotulo='Vale hoje', fonte=FONTE_LIGA, fs=92):
    r, c = valor.split(',') if ',' in valor else (valor, '')
    cc = f'<span style="font-size:{int(fs * .55)}px">,{c}</span>' if c else ''
    return (f'<div style="{pos(x, y, 6)}width:{w}px;background:{bg};color:{ink(bg)};padding:22px 28px 20px;border-radius:28px;'
            f'box-shadow:12px 12px 0 rgba(19,31,73,.92);transform:rotate({rot}deg)">'
            f'<div style="font-size:24px;font-weight:900;letter-spacing:2px;text-transform:uppercase">{rotulo}</div>'
            f'<div style="font-size:{fs}px;line-height:{int(fs * 1.02)}px;font-weight:900;letter-spacing:-3px;white-space:nowrap">{r}{cc}</div>'
            + (f'<div style="font-size:18px;line-height:23px;font-weight:700;margin-top:6px">{fonte}</div>' if fonte else '') + '</div>')
def larg_ficha(t): return 96 + int(len(t) * 17.5)
def fg(t, bg, x, y, rot=0, icon='brilho', z=1.45):
    return f'<div style="position:absolute;left:0;top:0;zoom:{z};z-index:5">' + ficha(t, bg, round(x / z), round(y / z), rot, icon) + '</div>'

def slide_carta(nome, bg, eb, pg, carta_, nm, meta, chips=(), desc='', mot='', eb_cor=Y, bar=Y, rot=-2, cta=False, cred=CRED, w=500, top=150, nm_fs=76, extra=''):
    h = int(w * 825 / 600) + 20; x = (1080 - w) // 2
    ch = ''
    for k, (t, cb, ic) in enumerate(chips):
        if k == 0: ch += ficha(t, cb, max(40, x - 70), top + h - 120, -4, ic)
        else: ch += ficha(t, cb, min(1080 - 30 - larg_ficha(t), x + w - 110), top + int(h * .42), 4, ic)
    y = top + h + 46
    corpo = (mot + carta(carta_, x, top, w, rot, 3) + ch +
             texto(nm, 60, y, 960, nm_fs, nm_fs + 4, 900, alinha='center', extra='letter-spacing:-2px') +
             texto(meta, 60, y + nm_fs + 16, 960, 27, 34, 700, alinha='center'))
    if desc: corpo += caixa(desc, 150, y + nm_fs + 70, 780, 29, 38, alinha='center', pad='16px 24px')
    feed(nome, pagina(bg, eb=eb, eb_cor=eb_cor, bar=bar, pg=pg, corpo=corpo + extra + foot(bg, cta=cta, cred=cred)))

# ------------------------------------------------ 1. Olha o traço · YOSHIROTTEN (Seg 26/10)
feed('V_yoshi_1', pagina(PSY, eb='Olha o traço', eb_cor=Y, bar=Y, corpo=
    raio(WHITE, -190, 560, 600, .10, -8) + raio(Y, 820, -100, 380, .14, 14, True) + dots(WHITE, 560, 640, .18) +
    aneis(Y, 700, 900, (240, 320, 400), .35) +
    titulo(f'YOSHI<br>{hl("ROTTEN", Y)}', 72, 140, 940, 150, 140) +
    texto('O artista que transformou Mewtwo e Mew em capa de disco futurista.', 72, 470, 720, 38, 48, 800) +
    carta('30th-158.png', 90, 650, 390, -9, 3) + carta('30th-157.png', 520, 610, 440, 6, 4) +
    ficha('FUTURISTIC RARE', Y, 72, 1080, -4, 'brilho') +
    brilho(Y, 470, 600, 60) + brilho(WHITE, 960, 560, 44, 15) + brilho(WHITE, 60, 600, 36) + foot(PSY)))
slide_carta('V_yoshi_2', NAVY, 'Olha o traço · YOSHIROTTEN', '2/4', '30th-157.png', 'Mewtwo ex', 'Futuristic Rare · Celebração de 30 Anos · 157',
    chips=[('TIPO PSÍQUICO', PSY, 'brilho')], desc='Cromo lilás, esferas de energia e brilho holográfico.', eb_cor=PSY, bar=PSY,
    mot=disco(PSY, 540, 520, 430) + aneis(Y, 540, 520, (470, 530), .5) + raio(Y, 760, 820, 380, .16, 12, True) + dots(WHITE, -120, 40, .14) +
        brilho(Y, 860, 200, 54) + brilho(WHITE, 150, 760, 40))
slide_carta('V_yoshi_3', FAIRY, 'Olha o traço · YOSHIROTTEN', '3/4', '30th-158.png', 'Mew ex', 'Futuristic Rare · Celebração de 30 Anos · 158',
    chips=[('TIPO PSÍQUICO', PSY, 'brilho')], desc='O par do Mewtwo: mesmo universo, mesma raridade.', eb_cor=NAVY, bar=NAVY, rot=2,
    mot=aneis(WHITE, 540, 500, (300, 380, 460), .45) + raio(NAVY, -170, 380, 560, .08, -10) + dots(NAVY, 620, 760, .16) +
        brilho(WHITE, 840, 180, 56) + brilho(NAVY, 170, 800, 40, 15))
feed('V_yoshi_4', pagina(Y, eb='Olha o traço · YOSHIROTTEN', eb_cor=PSY, bar=PSY, pg='4/4', corpo=
    raio(NAVY, -160, 620, 560, .09, -6) + dots(NAVY, 640, 80, .2) + aneis(WHITE, 790, 400, (200, 270), .55) +
    f'<div style="{pos(60, 110, 4)}font-size:500px;line-height:480px;font-weight:900;color:{PSY};letter-spacing:-20px;text-shadow:16px 16px 0 {NAVY}">2</div>' +
    carta('30th-157.png', 520, 190, 250, -8, 3) + carta('30th-158.png', 740, 230, 250, 8, 3) +
    titulo(f'Futuristic Rare na<br>{hl("coleção de 30 anos.", PSY, WHITE)}', 72, 660, 950, 82, 96, NAVY, ls=-3) +
    texto('Só duas cartas têm essa raridade, e as duas são dele. Qual farmou mais aura no seu binder?', 72, 900, 900, 36, 48, 800, NAVY) +
    brilho(WHITE, 470, 170, 60) + brilho(NAVY, 980, 560, 44) + brilho(WHITE, 920, 1010, 40) + foot(Y, cta=True)))

# ------------------------------------------------ 2 e 3. O que saiu (aberturas do dono, fotos próprias + valor na Liga)
def capa_abertura(nome, bg, eb, tit, foto1, foto2, chip, sub, mot, obj1='center', obj2='center'):
    feed(nome, pagina(bg, eb=eb, eb_cor=RED if bg == Y else Y, bar=RED if bg == Y else Y, corpo=mot +
        titulo(tit, 72, 140, 950, 96, 102, ls=-4) +
        texto(sub, 72, 488, 900, 32, 40, 800) +
        foto(foto1, 72, 610, 520, 570, -4, 3, obj1) + foto(foto2, 600, 660, 400, 500, 5, 4, obj2) +
        ficha(chip, NAVY if bg == Y else Y, 560, 1130, -3, 'brilho') + foot(bg)))

def slide_puxada(nome, bg, eb, pg, f, nm, meta, valor, chip, tag=None, obj='center', mot='', pbg=Y):
    corpo = (mot + titulo(nm, 72, 140, 950, 92, 96, ls=-3) + texto(meta, 72, 250, 950, 30, 38, 800) +
             foto(f, 72, 330, 560, 760, -3, 3, obj) +
             ficha(chip[0], chip[1], 660, 390, 3, chip[2]) +
             preco(valor, 610, 560, 400, WHITE if pbg == bg else pbg, 4))
    if tag: corpo += ficha(tag[0], tag[1], 650, 900, -4, 'brilho')
    feed(nome, pagina(bg, eb=eb, eb_cor=Y if bg != Y else RED, bar=Y if bg != Y else RED, pg=pg,
                      corpo=corpo + selo(860, 1010, 10) + foot(bg, cred=CRED + ' · foto da abertura')))

def fim_abertura(nome, bg, eb, pg, pago, total, fotos_, mot=''):
    th = ''.join(foto(p, 72 + i * (944 // len(fotos_)), 690, 944 // len(fotos_) - 28, 270, (-4, 3, -2, 4)[i % 4], 3, o) for i, (p, o) in enumerate(fotos_))
    feed(nome, pagina(bg, eb=eb, eb_cor=RED, bar=RED, pg=pg, corpo=mot +
        titulo(f'Valeu a pena?<br>{hl("A conta:", RED, WHITE)}', 72, 140, 950, 100, 112, NAVY) +
        preco(pago, 72, 410, 420, WHITE, -3, 'Paguei', '', 96) +
        preco(total, 560, 410, 450, NAVY, 3, 'Cartas na Liga', FONTE_LIGA, 96) +
        th + caixa('Vídeo completo no perfil', 230, 1020, 620, 40, 50, RED, 0, 'center', '22px 26px', 6, 900) +
        foot(bg, cta=True, cred=CRED + ' · preços: ' + FONTE_LIGA)))

EB_C = 'O que saiu · Combo 30 Anos'
capa_abertura('V_combo_1', Y, EB_C, f'Abri o Combo<br>de 30 Anos.<br>{hl("Valeu a pena?", RED, WHITE)}', FOTOS / 'F2_134928.jpg', FOTOS / 'F6_135121.jpg',
    'CELEBRAÇÃO DE 30 ANOS', '4 cartas que saíram, com o valor de cada uma na Liga.',
    raio(NAVY, -170, 520, 560, .09, -8) + raio(NAVY, 800, 260, 420, .08, 12, True) + dots(NAVY, 620, 700, .2) + aneis(WHITE, 540, 900, (300, 380, 460), .45) +
    brilho(WHITE, 560, 560, 56) + brilho(NAVY, 980, 600, 40) + brilho(WHITE, 40, 1160, 36), 'center 70%', 'center 40%')
COMBO = [('pikachu_ex', B2, 'Pikachu ex', '053/128 · Celebração de 30 Anos', 'R$ 23,02', ('TIPO ELÉTRICO', Y, 'raio'), None),
         ('meowth', DARK, 'Meowth de Alola', '139/128 · Ilustração Rara (IR)', 'R$ 57,80', ('TIPO ESCURIDÃO', PSY, 'lua'), ('A MAIS VALIOSA', RED)),
         ('umbreon_ex', PSY, 'Umbreon ex', '092/128 · Celebração de 30 Anos', 'R$ 21,69', ('TIPO ESCURIDÃO', DARK, 'lua'), None),
         ('buzzwole_gx', FIGHT2, 'Buzzwole GX', '57/111 · Cartas Clássicas', 'R$ 41,44', ('TIPO LUTADOR', Y, 'chama'), None)]
for k, (f, bg, nm, meta, v, chip, tag) in enumerate(COMBO, start=2):
    mot = (raio(WHITE, -180, 700, 560, .08, -10) + dots(WHITE, 620, 60, .14) + aneis(Y, 820, 760, (230, 300), .3) +
           brilho(Y, 980, 200, 46) + brilho(WHITE, 600, 1110, 36))
    slide_puxada(f'V_combo_{k}', bg, EB_C, f'{k}/6', PUX / f'{f}.jpg', nm, meta, v, chip, tag, mot=mot)
fim_abertura('V_combo_6', Y, EB_C, '6/6', 'R$ 240', 'R$ 143,95', [(PUX / f'{f}.jpg', 'center') for f in ('pikachu_ex', 'meowth', 'umbreon_ex', 'buzzwole_gx')],
    raio(NAVY, -160, 560, 560, .09, -6) + dots(NAVY, 640, 80, .2) + brilho(WHITE, 520, 380, 54) + brilho(NAVY, 980, 980, 40))

EB_D = 'O que saiu · Box Mega Dragonite'
capa_abertura('V_dragonite_1', F2, EB_D, f'Abri a Box<br>Mega Dragonite.<br>{hl("Valeu a pena?", Y, NAVY)}', FOTOS / 'F4_135011.jpg', FOTOS / 'F5_135041.jpg',
    'COLEÇÃO MEGA FORÇAS', '3 cartas que saíram, com o valor de cada uma na Liga.',
    raio(Y, -170, 520, 560, .14, -8) + chama(860, 220, 220, Y, .18, 12) + chama(-40, 1000, 200, Y, .14, -14) + dots(WHITE, 620, 700, .15) +
    aneis(Y, 540, 900, (300, 380, 460), .3) + brilho(Y, 560, 560, 56) + brilho(WHITE, 980, 600, 40), 'center 72%', 'center 55%')
DRAGO = [('dragonite_promo', G2, 'Mega Dragonite ex', 'Promo 091 · vem na box', 'R$ 41,80', ('TIPO DRAGÃO', '#a8801a', 'chama'), ('A MAIS VALIOSA', RED)),
         ('thievul', DARK, 'Thievul', '092/084 · Ilustração Rara (IR)', 'R$ 18,51', ('TIPO ESCURIDÃO', PSY, 'lua'), None),
         ('dragalge_ex', FAIRY, 'Mega Dragalge ex', '065/086 · Caos Ascendente', 'R$ 7,86', ('TIPO DRAGÃO', '#a8801a', 'chama'), None)]
for k, (f, bg, nm, meta, v, chip, tag) in enumerate(DRAGO, start=2):
    c = ink(bg)
    mot = (raio(c, -180, 700, 560, .08, -10) + dots(c, 620, 60, .14) + aneis(Y if c == WHITE else WHITE, 820, 760, (230, 300), .35) +
           brilho(Y if c == WHITE else WHITE, 980, 200, 46) + brilho(c, 600, 1110, 36))
    slide_puxada(f'V_dragonite_{k}', bg, EB_D, f'{k}/5', PUX / f'{f}.jpg', nm, meta, v, chip, tag, mot=mot)
fim_abertura('V_dragonite_5', Y, EB_D, '5/5', 'R$ 90', 'R$ 68,17', [(PUX / f'{f}.jpg', 'center') for f in ('dragonite_promo', 'thievul', 'dragalge_ex')],
    raio(NAVY, -160, 560, 560, .09, -6) + dots(NAVY, 640, 80, .2) + brilho(WHITE, 520, 380, 54) + brilho(NAVY, 980, 980, 40))

# ------------------------------------------------ 4. Deu lucro? (Qua 28/10)
feed('V_deulucro_1', pagina(G2, eb='Deu lucro?', eb_cor=Y, bar=Y, corpo=
    raio(Y, 780, 700, 420, .14, 12, True) + raio(WHITE, -200, 640, 520, .07, -10) + dots(WHITE, 560, 120, .15) +
    aneis(Y, 820, 620, (260, 340, 420), .3) +
    texto('MENOR PREÇO JÁ VISTO NO SITE', 72, 170, 900, 26, 32, 900, extra='letter-spacing:3px') +
    preco('R$ 114,99', 72, 220, 520, Y, -3, '8 boosters', '', 120) +
    titulo(f'Deu<br>{hl("lucro?", WHITE, NAVY)}', 72, 500, 520, 130, 136) +
    texto('Desafio Estratégico Equilíbrio Perfeito. Chuta antes de ver o vídeo.', 72, 800, 500, 34, 44, 800) +
    produto(str(AQUI / 'me03-desafio.png'), 600, 300, 420, 5, 3) +
    f'<div style="{pos(72, 960, 5)}display:flex;gap:24px;font-size:42px;font-weight:900">'
    f'<div style="background:{Y};color:{NAVY};padding:22px 40px;border-radius:999px;box-shadow:8px 8px 0 rgba(19,31,73,.9);transform:rotate(-3deg)">Lucro</div>'
    f'<div style="background:{RED};color:#fff;padding:22px 40px;border-radius:999px;box-shadow:8px 8px 0 rgba(19,31,73,.9);transform:rotate(2deg)">Prejuízo</div></div>' +
    ficha('COMENTA AÍ', WHITE, 640, 990, 4, 'brilho') +
    brilho(Y, 560, 260, 56) + brilho(WHITE, 990, 280, 40) + brilho(Y, 520, 1130, 36) +
    foot(G2, cta=True, cred='Preço: menor já registrado pelo tcgpricehunter.com.br · imagem de divulgação (Copag/Pokémon)')))

# ------------------------------------------------ 5. Tá na época · Halloween (Qui 29/10)
def noite(c1=Y, op=.16):
    return (lua(800, 70, 230, c1, .95) + morcego(640, 300, 170, WHITE, op, -12) + morcego(110, 1040, 140, WHITE, op, 10) + morcego(880, 980, 110, ORANGE, .35, -6) +
            teia(-10, 0, 330, WHITE, .14) + dots(ORANGE, 560, 680, .18))
feed('V_halloween_1', pagina(N1, eb='Tá na época · Halloween', eb_cor=ORANGE, bar=ORANGE, corpo=
    lua(800, 190, 220, Y) + morcego(640, 420, 160, WHITE, .2, -12) + morcego(900, 470, 110, ORANGE, .5, 8) + teia(-10, 0, 330, WHITE, .12) +
    dots(ORANGE, 560, 700, .2) + aneis(PSY, 540, 960, (300, 380, 460), .45) +
    titulo(f'6 cartas pra<br>{hl("assombrar", ORANGE, NAVY)}<br>o binder', 72, 150, 900, 108, 116) +
    carta('me02.5-284.png', 50, 680, 360, -11, 3) + carta(str(REC / 'asc-238-mimikyu.png'), 670, 680, 360, 11, 3) + carta('30th-137.png', 355, 620, 370, 0, 4) +
    ficha('TIPO PSÍQUICO', PSY, 72, 545, -3, 'brilho') + ficha('FANTASMA', ORANGE, 400, 540, 3, 'lua') +
    brilho(Y, 760, 580, 54) + brilho(WHITE, 980, 1130, 40) + brilho(ORANGE, 30, 1170, 40) + foot(N1)))
HW = [('me02.5-284.png', 'Mega Gengar ex', 'Heróis Excelsos · 284 · Ilustração Rara Especial · danciao', N2, ('TIPO ESCURIDÃO', DARK, 'lua')),
      (str(REC / 'asc-238-mimikyu.png'), 'Mimikyu da Equipe Rocket', 'Heróis Excelsos · 238 · Ilustração Rara · GOSSAN', ORANGE, ('TIPO PSÍQUICO', PSY, 'brilho')),
      (str(REC / 'asc-234-banette.png'), 'Banette', 'Heróis Excelsos · 234 · Ilustração Rara · YASHIRO Nanaco', N1, ('TIPO PSÍQUICO', PSY, 'brilho')),
      ('30th-137.png', 'Chandelure', '30 Anos · 137 · Ilustração Rara · YASHIRO Nanaco', PSY, ('TIPO PSÍQUICO', N1, 'brilho')),
      ('30th-136.png', 'Drifloon', '30 Anos · 136 · Ilustração Rara · Whisker', ORANGE, ('TIPO PSÍQUICO', PSY, 'brilho')),
      (str(REC / 'gourgeist-041.png'), 'Gourgeist ex', 'Caos Ascendente · 041 · Rara Dupla · 5ban Graphics', N2, ('TIPO PSÍQUICO', PSY, 'brilho'))]
for k, (f, nm, meta, bg, chip) in enumerate(HW, start=2):
    c = ink(bg); escuro = c == WHITE
    mot = ((disco(PSY, 540, 480, 360, .55) if bg in (N1, N2) else disco(WHITE, 540, 480, 360, .18)) +
           lua(50, 300, 160, Y if escuro else NAVY, .9 if escuro else .2) + teia(-10, 0, 280, c, .13) +
           morcego(80, 820, 150, ORANGE if escuro else NAVY, .4 if escuro else .14, 10) + morcego(860, 560, 130, c, .16, -10) +
           dots(c, 640, 760, .14) + brilho(Y if escuro else WHITE, 900, 380, 46) + brilho(ORANGE if escuro else NAVY, 150, 260, 36))
    slide_carta(f'V_halloween_{k}', bg, 'Tá na época · Halloween', f'{k}/7', f, nm, meta, chips=[chip, ('FANTASMA', NAVY if not escuro else ORANGE, 'lua')],
                eb_cor=ORANGE if escuro else NAVY, bar=ORANGE if escuro else NAVY, rot=(-2, 2)[k % 2], cta=k == 7, mot=mot,
                nm_fs=66 if len(nm) > 18 else 76, w=540)

# ------------------------------------------------ 6. Feliz Halloween (Sáb 31/10 · story 1080x1920 com espaço para a enquete nativa)
ARTES['V_felizhalloween_1'] = (pagina(N1, eb='Tá na época', eb_cor=ORANGE, bar=ORANGE, h=1920, corpo=
    '<style>.eb{top:250px}.logo{top:236px}</style>' +
    lua(700, 330, 330, Y) + morcego(560, 640, 190, WHITE, .2, -10) + morcego(880, 760, 130, ORANGE, .55, 8) + morcego(60, 1500, 160, WHITE, .16, 12) +
    teia(-10, 0, 420, WHITE, .14) + dots(ORANGE, 600, 1100, .18) + aneis(PSY, 540, 1080, (320, 400, 480), .45) +
    titulo(f'Feliz<br>Halloween!<br>{hl("Qual mora", ORANGE, NAVY)}<br>no seu binder?', 72, 360, 940, 108, 116) +
    carta('me02.5-284.png', 110, 880, 400, -7, 3) + carta(str(REC / 'asc-238-mimikyu.png'), 570, 900, 400, 7, 3) +
    ficha('MEGA GENGAR EX', ORANGE, 90, 1440, -3, 'lua') + ficha('MIMIKYU', Y, 690, 1460, 3, 'brilho') +
    f'<div style="{pos(140, 1560, 4)}width:800px;height:170px;border:4px dashed rgba(255,255,255,.35);border-radius:40px;display:grid;place-items:center;font-size:24px;font-weight:700;color:rgba(255,255,255,.75)">(cole a enquete nativa do Instagram aqui)</div>' +
    texto(CRED, 72, 1770, 936, 18, 24, 500, alinha='center', extra='opacity:.85') +
    brilho(Y, 520, 840, 56) + brilho(WHITE, 980, 1300, 40) + brilho(ORANGE, 60, 1300, 40)), 1080, 1920)

# ------------------------------------------------ 7a. Olha o traço · Yuka Morii (Seg 2/11)
EB_Y = 'Olha o traço · Yuka Morii'
feed('V_yuka_1', pagina(PSY, eb='Olha o traço', eb_cor=Y, bar=Y, corpo=
    raio(WHITE, -190, 620, 560, .09, -8) + raio(Y, 840, 900, 360, .14, 14, True) + dots(WHITE, 560, 80, .15) + aneis(Y, 780, 640, (260, 340, 420), .3) +
    titulo(f'Yuka<br>{hl("Morii", Y)}', 72, 140, 600, 150, 146) +
    texto(f'Pokémon de massinha. Cada carta é uma foto de verdade.', 72, 480, 450, 38, 48, 800) +
    carta('sm12-97.png', 550, 300, 460, 5, 4) + carta('sv03-097.png', 90, 720, 310, -8, 3) +
    ficha('FOTO DE VERDADE', Y, 560, 1010, -3, 'brilho') +
    brilho(Y, 500, 300, 56) + brilho(WHITE, 980, 230, 40) + brilho(WHITE, 470, 1120, 36) + foot(PSY)))
itens = [('1', 'Parece massinha, dá pra ver marca de dedo'), ('2', 'Tem sombra de verdade, como foto'), ('3', 'O fundo é um cenário montado')]
lista = ''.join(f'<div style="{pos(560, 230 + i * 250, 5)}width:450px;display:flex;gap:22px;align-items:flex-start">'
                f'<div style="flex:none;width:76px;height:76px;border-radius:20px;background:{PSY};color:#fff;font-size:48px;font-weight:900;display:grid;place-items:center;box-shadow:6px 6px 0 rgba(19,31,73,.9);transform:rotate({(-4, 3, -2)[i]}deg)">{n}</div>'
                f'<div style="font-size:36px;line-height:44px;font-weight:900;color:{NAVY}">{t}</div></div>' for i, (n, t) in enumerate(itens))
feed('V_yuka_2', pagina(Y, eb='Como reconhecer', eb_cor=PSY, bar=PSY, pg='2/6', corpo=
    raio(NAVY, -160, 700, 520, .08, -6) + dots(NAVY, 600, 780, .2) + aneis(WHITE, 300, 560, (300, 380), .5) +
    carta('sv03-081.png', 72, 220, 450, -3, 3) + lista + ficha('CLEFAIRY · OBSIDIANA EM CHAMAS', NAVY, 72, 950, -2, 'brilho') +
    brilho(WHITE, 500, 190, 56) + brilho(NAVY, 980, 1000, 40) + foot(Y)))
for k, (f, nm, col, bg, chip) in enumerate([('sm12-97.png', 'Mimikyu', 'Eclipse Cósmico · Yuka Morii', FAIRY, ('TIPO PSÍQUICO', PSY, 'brilho')),
                                            ('sv03-097.png', 'Sinistea', 'Obsidiana em Chamas · Yuka Morii', B2, ('TIPO PSÍQUICO', PSY, 'brilho')),
                                            ('sv08-138.png', 'Applin', 'Fagulhas Impetuosas · Yuka Morii', G2, ('TIPO DRAGÃO', '#a8801a', 'chama'))], start=3):
    c = ink(bg)
    mot = (aneis(Y if c == WHITE else WHITE, 540, 500, (320, 400, 480), .35) + raio(c, -180, 400, 540, .08, -10) + dots(c, 640, 760, .15) +
           brilho(Y if c == WHITE else WHITE, 880, 200, 54) + brilho(c, 150, 820, 38, 15))
    slide_carta(f'V_yuka_{k}', bg, EB_Y, f'{k}/6', f, nm, col, chips=[chip, ('MASSINHA', Y if c == WHITE else NAVY, 'brilho')],
                eb_cor=Y if c == WHITE else NAVY, bar=Y if c == WHITE else NAVY, rot=(-2, 2)[k % 2], mot=mot, w=540)
feed('V_yuka_6', pagina(PSY, eb=EB_Y, eb_cor=Y, bar=Y, pg='6/6', corpo=
    raio(WHITE, -160, 560, 560, .09, -6) + dots(WHITE, 640, 120, .15) + aneis(Y, 540, 760, (260, 340), .4) +
    titulo(f'Qual farmou<br>mais {hl("aura?", Y)}', 72, 140, 940, 110, 118) +
    carta('sm8-139.png', 120, 450, 400, -6, 3) + carta('sv07-102.png', 560, 470, 400, 6, 3) +
    caixa('Ralts (Trovões Perdidos) · Meltan (Coroa Estelar)', 110, 1050, 860, 30, 38, alinha='center', pad='18px 24px') +
    brilho(Y, 500, 420, 60) + brilho(WHITE, 960, 980, 44) + foot(PSY, cta=True)))

# ------------------------------------------------ 7b. Curiosidade · rodapé da carta (Qua 4/11)
def zoom_v(caixa_, y=650):
    esc = 916 / 190; x0, y0, x1, y1 = caixa_
    return (f'<div style="{pos(72, y, 5)}width:936px;height:260px;border-radius:26px;overflow:hidden;background:#000;border:10px solid #fff;box-shadow:14px 16px 0 rgba(19,31,73,.9)">'
            f'<img src="{img("me01-180.png")}" style="position:absolute;width:{600 * esc}px;left:{-20 * esc}px;top:{-748 * esc}px">'
            f'<div style="position:absolute;left:{(x0 - 20) * esc}px;top:{(y0 - 748) * esc}px;width:{(x1 - x0) * esc}px;height:{(y1 - y0) * esc}px;'
            f'border:7px solid {Y};border-radius:16px;box-shadow:0 0 0 2000px rgba(0,0,0,.45)"></div></div>')
feed('V_rodape_1', pagina(B2, eb='Curiosidade', eb_cor=Y, bar=Y, corpo=
    raio(WHITE, -190, 700, 540, .09, -8) + dots(WHITE, 560, 760, .15) + aneis(Y, 800, 560, (260, 340, 420), .3) +
    titulo(f'Sabe ler o<br>{hl("rodapé", Y)}<br>da carta?', 72, 150, 560, 104, 112) +
    texto('4 detalhes que dizem coleção, raridade e quem desenhou.', 72, 560, 470, 36, 46, 800) +
    carta('me01-180.png', 570, 240, 440, 4, 3) + ficha('4 DETALHES', Y, 72, 800, -3, 'brilho') +
    f'<div style="{pos(72, 900, 4)}width:470px;height:190px;border-radius:22px;overflow:hidden;border:8px solid #fff;box-shadow:10px 12px 0 rgba(19,31,73,.9);transform:rotate(-2deg)">'
    f'<img src="{img("me01-180.png")}" style="position:absolute;width:{600 * 2.4}px;left:{-20 * 2.4}px;top:{-748 * 2.4}px"></div>' +
    brilho(Y, 520, 230, 56) + brilho(WHITE, 980, 1000, 40) + foot(B2)))
CODIGO = [((94, 770, 162, 797), '180/132', 'Número da carta / total da coleção. Número maior que o total é carta secreta.'),
          ((32, 772, 96, 794), 'I · MEG PT', 'Letra do formato de jogo (I), sigla da coleção (MEG = Megaevolução) e idioma (PT).'),
          ((163, 770, 198, 796), '★★', 'Raridade. Duas estrelas douradas = SIR (Ilustração Rara Especial). Uma = IR (Ilustração Rara).'),
          ((30, 754, 152, 770), 'Ilust.', 'Quem desenhou. Aqui, Mitsuhiro Arita, o mesmo do Charizard de 1999.')]
for k, (cx, tit, txt) in enumerate(CODIGO, start=2):
    bg = (Y, B2)[k % 2]; c = ink(bg); ult = k == 5
    feed(f'V_rodape_{k}', pagina(bg, eb='Curiosidade · rodapé da carta', eb_cor=B2 if bg == Y else Y, bar=B2 if bg == Y else Y, pg=f'{k}/5', corpo=
        raio(c, -180, 820, 520, .08, -8) + dots(c, 640, 60, .16) + aneis(WHITE if bg == Y else Y, 900, 1120, (200, 270), .4) +
        titulo(hl(tit, B2 if bg == Y else Y), 72, 150, 940, 120, 140, ls=-3) +
        texto(txt, 72, 360, 920, 44, 56, 800) + zoom_v(cx) +
        carta('me01-180.png', 800, 950, 190, 6, 6) + fg(f'DETALHE {k - 1} DE 4', NAVY if bg == Y else Y, 72, 1000, -3, 'brilho') +
        brilho(WHITE if bg == Y else Y, 980, 300, 44) + foot(bg, cta=ult)))

# ------------------------------------------------ 7c. Lançamento · Reinado Delta (Qui 5/11)
CRED_RD = 'Imagens de divulgação do produto (Copag/Pokémon)'
def tri(x, y, w, cor, op, rot=0):
    return f'<svg class="mot" style="left:{x}px;top:{y}px;width:{w}px;opacity:{op};transform:rotate({rot}deg)" viewBox="0 0 600 540"><path d="M300 30 L570 510 L30 510 Z" fill="none" stroke="{cor}" stroke-width="48" stroke-linejoin="round"/></svg>'
EB_RD = 'Reinado Delta'
feed('V_delta_1', pagina(G2, eb='Lançamento · 6/11', eb_cor=Y, bar=Y, corpo=
    tri(200, 560, 680, Y, .16, -6) + raio(WHITE, 820, 120, 360, .08, 12, True) + dots(WHITE, -120, 760, .15) +
    titulo(f'Reinado Delta:<br>{hl("o que já", Y)}<br>{hl("sabemos", Y)}', 72, 150, 940, 104, 118) +
    produto('rd-etb-cut.png', 70, 650, 680, -4, 3) + produto('rd-blister1-cut.png', 760, 560, 250, 7, 4) +
    ficha('CHEGA 6/11', Y, 72, 1110, -3, 'raio') +
    brilho(Y, 700, 560, 56) + brilho(WHITE, 990, 1080, 40) + foot(G2, cred=CRED_RD)))
feed('V_delta_2', pagina(Y, eb=EB_RD, eb_cor=G2, bar=G2, pg='2/4', corpo=
    tri(-60, 700, 560, G2, .14, 8) + dots(NAVY, 640, 780, .18) + aneis(WHITE, 820, 520, (260, 340), .55) +
    f'<div style="{pos(60, 150, 4)}font-size:230px;line-height:230px;font-weight:900;color:{G2};letter-spacing:-10px;text-shadow:12px 12px 0 {NAVY}">6/11</div>' +
    texto('Chega ao Brasil na sexta. É a última coleção grande da fase Megaevolução.', 72, 440, 540, 44, 56, 900, NAVY) +
    produto('rd-blister1-cut.png', 650, 260, 360, 5, 3) +
    ficha('FASE MEGAEVOLUÇÃO', G2, 72, 900, -3, 'brilho') + ficha('LANÇAMENTO', NAVY, 72, 1000, 2, 'raio') +
    brilho(G2, 600, 230, 56) + brilho(WHITE, 980, 1000, 44) + foot(Y, cred=CRED_RD)))
feed('V_delta_3', pagina(G2, eb=EB_RD, eb_cor=Y, bar=Y, pg='3/4', corpo=
    tri(240, 520, 600, Y, .14) + raio(WHITE, -190, 300, 520, .08, -8) + dots(WHITE, 620, 40, .14) +
    titulo(hl('Mega Rayquaza ex', Y), 72, 150, 960, 92, 110, ls=-3) +
    texto('A carta mais esperada da coleção. O tema vem do Episódio Delta, dos jogos Ômega Rubi e Alfa Safira.', 72, 300, 920, 42, 54, 800) +
    f'<div class="card" style="left:300px;top:490px;width:470px;transform:rotate(-3deg);z-index:3"><img src="{uri(REC / "rayquaza_sar_jp.jpg")}"></div>' +
    ficha('A MAIS ESPERADA', RED, 640, 1000, 4, 'brilho') + ficha("VERSÃO JAPONESA · SAR", NAVY, 90, 600, -4, 'brilho') +
    brilho(Y, 980, 520, 50) + brilho(WHITE, 200, 1050, 40) + foot(G2, cred='Carta japonesa (M6, 110/076) © Pokémon/Nintendo/Creatures/GAME FREAK')))
passos = [('1', 'Compare com o preço da Copag'), ('2', 'Lançamento sobe de preço: não paga qualquer valor'), ('3', 'O grupo avisa quando aparecer barato')]
feed('V_delta_4', pagina(Y, eb='Reinado Delta · pré-venda', eb_cor=G2, bar=G2, pg='4/4', corpo=
    tri(560, 640, 520, G2, .12, 10) + dots(NAVY, -120, 600, .18) +
    titulo(f'Pré-venda<br>{hl("sem pagar caro", G2, WHITE)}', 72, 140, 940, 100, 112, NAVY) +
    ''.join(caixa(f'<span style="display:inline-grid;place-items:center;width:58px;height:58px;border-radius:16px;background:{G2};color:#fff;margin-right:18px;vertical-align:middle">{n}</span>{t}',
                  72, 400 + i * 135, 936, 34, 42, WHITE, (-1, 1, -1)[i], pad='16px 22px') for i, (n, t) in enumerate(passos)) +
    produto('rd-blister3-cut.png', 70, 870, 300, -5, 3) + produto('rd-combo-mox-cut.png', 410, 820, 230, 0, 3) + produto('rd-etb-cut.png', 680, 930, 330, 4, 3) +
    brilho(G2, 980, 820, 44) + foot(Y, cta=True, cred=CRED_RD)))

# ------------------------------------------------ 7d. Olha o traço · quiz (Seg 9/11)
QUIZ = [('30th-086.png', 'Koraidon', ['Mitsuhiro Arita', 'Yuka Morii', 'YOSHIROTTEN'], 0, FIGHT2, ('TIPO LUTADOR', Y, 'chama')),
        ('30th-128.png', 'Ultra Bola', ['Tomokazu Komiya', 'Yuka Morii', 'Atsuko Nishida'], 1, METAL2, ('TREINADOR · ITEM', Y, 'brilho')),
        ('30th-032.png', 'Pikachu 032', ['YOSHIROTTEN', 'Mitsuhiro Arita', 'Tomokazu Komiya'], 2, LIGHTN, ('TIPO ELÉTRICO', NAVY, 'raio')),
        ('30th-157.png', 'Mewtwo ex', ['YOSHIROTTEN', 'Atsuko Nishida', 'Yuka Morii'], 0, PSY, ('TIPO PSÍQUICO', Y, 'brilho')),
        ('30th-047.png', 'Pikachu 047', ['Tomokazu Komiya', 'Atsuko Nishida', 'Mitsuhiro Arita'], 1, B2, ('TIPO ELÉTRICO', Y, 'raio'))]
feed('V_quiz_1', pagina(PSY, eb='Olha o traço · quiz', eb_cor=Y, bar=Y, corpo=
    raio(WHITE, -170, 420, 600, .09, -8) + raio(Y, 780, -100, 420, .12, 12, True) + dots(WHITE, 620, 760, .15) + aneis(Y, 540, 960, (280, 360, 440), .35) +
    titulo(f'Adivinha o<br>artista<br>{hl("pelo traço", Y)}', 72, 140, 940, 112, 122) +
    texto('5 cartas. Resposta na última. Valendo aura.', 72, 540, 940, 36, 46, 800) +
    carta('30th-086.png', 80, 720, 300, -11, 3) + carta('30th-157.png', 700, 720, 300, 11, 3) + carta('30th-128.png', 390, 670, 310, 0, 4) +
    ficha('QUIZ', Y, 820, 600, 5, 'brilho') +
    brilho(Y, 440, 520, 60) + brilho(WHITE, 960, 1080, 44) + brilho(WHITE, 110, 1120, 40) + foot(PSY)))
for k, (f, nm, ops, _, bg, chip) in enumerate(QUIZ, start=2):
    c = ink(bg)
    op = ''.join(f'<div style="display:flex;gap:20px;align-items:center;background:#fff;color:{NAVY};border-radius:22px;padding:18px 22px;box-shadow:8px 8px 0 rgba(19,31,73,.9);transform:rotate({(-1.5, 1, -1)[i]}deg)">'
                 f'<span style="flex:none;width:60px;height:60px;border-radius:16px;background:{NAVY};color:{Y};font-size:34px;font-weight:900;display:grid;place-items:center">{"ABC"[i]}</span>'
                 f'<span style="font-size:33px;line-height:38px;font-weight:900">{o}</span></div>' for i, o in enumerate(ops))
    feed(f'V_quiz_{k}', pagina(bg, eb='Quem desenhou?', eb_cor=Y if c == WHITE else NAVY, bar=Y if c == WHITE else NAVY, pg=f'{k}/7', corpo=
        raio(c, -200, 700, 520, .08, -8) + dots(c, 640, 860, .15) + aneis(Y if c == WHITE else WHITE, 300, 520, (300, 380), .3) +
        carta(f, 60, 200, 470, -3, 3) + ficha(chip[0], chip[1], 60, 830, -3, chip[2]) +
        texto(nm, 580, 190, 440, 56, 60, 900, extra='letter-spacing:-2px') +
        f'<div style="{pos(580, 300, 5)}width:430px;display:flex;flex-direction:column;gap:26px">{op}</div>' +
        caixa('Comenta a letra: A, B ou C.', 72, 990, 936, 36, 44, NAVY if c == NAVY else (Y if c == WHITE else NAVY), 0, 'center', '20px 26px', 5, 900) +
        brilho(Y if c == WHITE else WHITE, 520, 170, 54) + brilho(c, 990, 860, 40) + foot(bg, 'Comenta a letra')))
resp = ''.join(f'<div style="{pos(72 + j * 190, 440, 4)}width:176px;text-align:center">'
               f'<div class="card" style="position:relative;width:176px;padding:7px;border-radius:16px;transform:rotate({(-4, 3, -2, 4, -3)[j]}deg)"><img src="{img(f)}" style="border-radius:10px"></div>'
               f'<div style="display:inline-block;margin-top:22px;font-size:40px;font-weight:900;background:{Y};color:{NAVY};width:62px;height:62px;line-height:62px;border-radius:16px;box-shadow:5px 5px 0 rgba(19,31,73,.9)">{"ABC"[cc]}</div>'
               f'<div style="font-size:24px;line-height:28px;font-weight:800;margin-top:12px">{ops[cc]}</div></div>'
               for j, (f, nm, ops, cc, _, _) in enumerate(QUIZ))
feed('V_quiz_7', pagina(B2, eb='Respostas', eb_cor=Y, bar=Y, pg='7/7', corpo=
    raio(WHITE, -170, 780, 520, .08, -8) + dots(WHITE, 640, 40, .15) + aneis(Y, 540, 620, (330, 410), .25) +
    titulo(f'Quantas você<br>{hl("acertou?", Y)}', 72, 140, 940, 110, 120) + resp +
    caixa('Conta nos comentários quantas você acertou.', 72, 960, 600, 36, 46, pad='22px 28px', rot=-2) + selo(800, 920, 10) +
    brilho(Y, 980, 360, 50) + brilho(WHITE, 60, 940, 40) + foot(B2, cta=True)))

# ------------------------------------------------ 7e. Top 5 · chase da Celebração de 30 Anos (Qua 11/11)
CH30 = [('30th-153.png', 'Sylveon ex', 'Ilustração Rara Especial · 153/128 · You Iribi', FAIRY, ('TIPO PSÍQUICO', PSY, 'brilho')),
        ('30th-154.png', 'Gengar ex', 'Ilustração Rara Especial · 154/128 · CHORISO', N2, ('TIPO ESCURIDÃO', DARK, 'lua')),
        ('30th-149.png', 'Pikachu ex', 'Ilustração Rara Especial · 149/128 · kantaro', LIGHTN, ('TIPO ELÉTRICO', NAVY, 'raio')),
        ('30th-158.png', 'Mew ex', 'Futuristic Rare · 158/128 · YOSHIROTTEN', B2, ('TIPO PSÍQUICO', PSY, 'brilho')),
        ('30th-157.png', 'Mewtwo ex', 'Futuristic Rare · 157/128 · YOSHIROTTEN', PSY, ('TIPO PSÍQUICO', NAVY, 'brilho'))]
feed('V_chase30_1', pagina(PSY, eb='Top 5 · Chase', eb_cor=Y, bar=Y, corpo=
    raio(WHITE, -170, 520, 600, .09, -8) + raio(Y, 800, -100, 400, .12, 12, True) + dots(WHITE, 620, 780, .15) + aneis(Y, 540, 980, (290, 370, 450), .35) +
    titulo(f'As 5 chase da<br>Celebração de<br>{hl("30 Anos", Y)}', 72, 140, 940, 100, 110) +
    texto('As mais raras da coleção. Qual falta no seu binder?', 72, 500, 940, 34, 44, 800) +
    carta('30th-153.png', 40, 720, 290, -14, 3) + carta('30th-149.png', 750, 720, 290, 14, 3) +
    carta('30th-154.png', 210, 680, 300, -6, 4) + carta('30th-158.png', 570, 680, 300, 6, 4) + carta('30th-157.png', 390, 640, 300, 0, 5) +
    ficha('TOP 5', Y, 72, 590, -3, 'brilho') +
    brilho(Y, 700, 600, 56) + brilho(WHITE, 980, 600, 40) + brilho(WHITE, 40, 1160, 36) + foot(PSY)))
for k, (f, nm, meta, bg, chip) in enumerate(CH30, start=2):
    c = ink(bg)
    mot = (aneis(Y if c == WHITE else WHITE, 540, 500, (320, 400, 480), .35) + raio(c, -180, 400, 540, .08, -10) + dots(c, 640, 760, .15) +
           brilho(Y if c == WHITE else WHITE, 880, 200, 54) + brilho(c, 150, 820, 38, 15))
    slide_carta(f'V_chase30_{k}', bg, 'Top 5 · Chase · 30 Anos', f'{k}/6', f, nm, meta, chips=[chip, (f'CHASE {k - 1} DE 5', RED, 'brilho')],
                eb_cor=Y if c == WHITE else NAVY, bar=Y if c == WHITE else NAVY, rot=(-2, 2)[k % 2], mot=mot, w=540, cta=k == 6)

# ------------------------------------------------ 7f. Alerta de golpe (Qui 12/11)
def alerta_cheio(x, y, w, cor=Y, rot=0):
    return (f'<svg style="{pos(x, y, 3)}width:{w}px;transform:rotate({rot}deg);filter:drop-shadow(14px 14px 0 rgba(19,31,73,.9))" viewBox="0 0 120 108">'
            f'<path d="M60 6 L114 102 L6 102 Z" fill="{cor}" stroke="{cor}" stroke-width="10" stroke-linejoin="round"/>'
            f'<rect x="54" y="36" width="12" height="38" rx="6" fill="{NAVY}"/><circle cx="60" cy="88" r="7" fill="{NAVY}"/></svg>')
feed('V_golpe_1', pagina(RED, eb='Alerta de golpe', eb_cor=Y, bar=Y, corpo=
    raio(WHITE, -190, 640, 560, .09, -8) + dots(WHITE, 600, 40, .15) + aneis(Y, 760, 940, (250, 330, 410), .3) +
    titulo(f'Preço bom<br>demais?<br>{hl("5 sinais", Y)}<br>de golpe', 72, 150, 940, 118, 124) +
    alerta_cheio(560, 650, 440, Y, 6) + fg('SALVA ESSE POST', WHITE, 72, 1060, -3, 'alerta') +
    brilho(Y, 520, 600, 56) + brilho(WHITE, 980, 560, 40) + foot(RED, cred='')))
SINAIS = [('Bem mais barato que na Copag', 'Lacrado novo não sai pela metade do preço.'),
          ('Loja sem CNPJ ou sem avaliação', 'Procura o CNPJ no rodapé do site e a loja no Reclame Aqui.'),
          ('Foto copiada de outro site', 'Se a loja não tem foto própria, pode nem ter o produto.'),
          ('Carta em outro idioma', 'Inglês ou japonês vendido como se fosse em português.'),
          ('Pix direto pra uma pessoa', 'Se der ruim, não tem como pedir o dinheiro de volta.')]
for k, (t, d) in enumerate(SINAIS, start=2):
    bg = (Y, RED)[k % 2]; c = ink(bg)
    feed(f'V_golpe_{k}', pagina(bg, eb='Alerta de golpe', eb_cor=RED if bg == Y else Y, bar=RED if bg == Y else Y, pg=f'{k}/7', corpo=
        alerta(600, 760, 520, c, .1, 8) + dots(c, -100, 760, .15) + raio(c, 800, 60, 300, .08, 12, True) +
        f'<div style="{pos(72, 150, 4)}width:250px;height:250px;border-radius:44px;background:{RED if bg == Y else Y};color:{WHITE if bg == Y else NAVY};font-size:210px;line-height:250px;font-weight:900;text-align:center;box-shadow:14px 14px 0 rgba(19,31,73,.92);transform:rotate(-5deg)">{k - 1}</div>' +
        titulo(t, 72, 480, 940, 100, 104, ls=-3) +
        caixa(d, 72, 760, 860, 40, 52, WHITE, -1, pad='24px 30px') +
        fg(f'SINAL {k - 1} DE 5', NAVY, 72, 1030, -2, 'alerta') + alerta_cheio(760, 960, 220, RED if bg == Y else Y, 8) +
        brilho(WHITE if bg == RED else RED, 400, 170, 50) + foot(bg, cred='')))
feed('V_golpe_7', pagina(Y, eb='Alerta de golpe', eb_cor=RED, bar=RED, pg='7/7', corpo=
    raio(NAVY, -170, 640, 540, .08, -8) + dots(NAVY, 640, 80, .18) + aneis(WHITE, 820, 980, (220, 300), .55) +
    titulo(f'No grupo, só entra<br>{hl("oferta conferida.", G2, WHITE)}', 72, 150, 950, 92, 108, NAVY, ls=-3) +
    texto('Salva esse post pra Black Friday.', 72, 400, 900, 40, 50, 900, NAVY) +
    fg('LOJA CHECADA', G2, 72, 540, -3) + fg('COMPARADO COM A COPAG', NAVY, 110, 700, 2) + fg('PRODUTO EM ESTOQUE', RED, 72, 860, -2) +
    selo(800, 980, 10) + brilho(RED, 620, 540, 50) + brilho(WHITE, 520, 1000, 44) + foot(Y, cta=True, cred='')))

# ------------------------------------------------ 7g. Esquenta Black Friday (Sex 13/11)
def pct(x, y, fs, cor, op): return f'<div class="mot" style="left:{x}px;top:{y}px;font-size:{fs}px;line-height:{fs}px;font-weight:900;color:{cor};opacity:{op}">%</div>'
feed('V_bf_1', pagina(BLACK, eb='Esquenta Black Friday', eb_cor=Y, bar=Y, corpo=
    pct(560, 640, 700, Y, .08) + raio(Y, -170, 620, 520, .14, -8) + raio(Y, 820, 200, 300, .12, 12, True) + dots(Y, 600, 40, .14) +
    f'<div style="{pos(60, 140, 4)}font-size:270px;line-height:260px;font-weight:900;letter-spacing:-12px;color:{Y};text-shadow:14px 14px 0 {RED}">27/11</div>' +
    titulo(f'O que cai {hl("de verdade", Y)} na Black Friday de Pokémon TCG?', 72, 470, 940, 94, 108, ls=-3) +
    fg('SALVA E COMPARA', Y, 72, 1050, -3, 'raio') +
    brilho(Y, 940, 150, 60) + brilho(WHITE, 980, 900, 40) + brilho(Y, 600, 1110, 36) + foot(BLACK, cred='')))
DICAS = [('Compare com o preço da Copag.', 'Tem loja que sobe o preço antes pra dar "desconto" depois.'),
         ('Lançamento acaba rápido.', 'Reinado Delta saiu em 6/11: se aparecer barato, não espera.'),
         ('Faça a lista agora.', 'Na sexta, é só conferir o que entrou no preço certo.')]
for k, (t, d) in enumerate(DICAS, start=2):
    bg = (Y, BLACK)[k % 2]; c = ink(bg)
    feed(f'V_bf_{k}', pagina(bg, eb='Esquenta Black Friday', eb_cor=BLACK if bg == Y else Y, bar=BLACK if bg == Y else Y, pg=f'{k}/5', corpo=
        pct(540, 640, 700, c if bg == Y else Y, .08) + raio(c if bg == Y else Y, 820, 120, 300, .12, 12, True) + dots(c, -120, 760, .15) +
        f'<div style="{pos(72, 150, 4)}width:240px;height:240px;border-radius:44px;background:{BLACK if bg == Y else Y};color:{Y if bg == Y else NAVY};font-size:200px;line-height:240px;font-weight:900;text-align:center;box-shadow:14px 14px 0 {RED};transform:rotate(-5deg)">{k - 1}</div>' +
        titulo(t, 72, 480, 940, 104, 108, ls=-3) +
        caixa(d, 72, 790, 860, 40, 52, WHITE, -1, pad='24px 30px') +
        fg(f'DICA {k - 1} DE 3', RED, 72, 1030, -2, 'raio') + brilho(RED, 400, 170, 50) + brilho(c, 980, 1050, 40) + foot(bg, cred='')))
feed('V_bf_5', pagina(BLACK, eb='Esquenta Black Friday', eb_cor=Y, bar=Y, pg='5/5', corpo=
    raio(Y, -170, 640, 540, .14, -8) + dots(Y, 640, 80, .14) + aneis(Y, 820, 960, (220, 300, 380), .3) +
    titulo(f'Alerta na hora,<br>{hl("direto no grupo.", Y)}', 72, 150, 950, 100, 116, ls=-3) +
    texto('O robô confere dezenas de lojas o tempo todo. Quando cair de verdade, você sabe primeiro.', 72, 440, 900, 42, 54, 800) +
    pct(560, 620, 700, Y, .08) + selo(800, 960, 10) + fg('DEZENAS DE LOJAS', Y, 72, 720, -3, 'raio') + fg('O TEMPO TODO', RED, 130, 880, 2, 'brilho') + fg('ALERTA NA HORA', WHITE, 72, 1040, -2, 'raio') +
    brilho(Y, 640, 760, 54) + brilho(WHITE, 500, 1080, 40) + foot(BLACK, cta=True, cred='')))


if __name__ == '__main__':
    so = set(sys.argv[1:])
    with sync_playwright() as p:
        b = p.chromium.launch(); pg = b.new_page(viewport={'width': 1080, 'height': 1350})
        (AQUI / 'html_vivo').mkdir(exist_ok=True)
        for nome, (h_, w, h) in ARTES.items():
            if so and not any(nome.startswith(s) for s in so): continue
            arq = AQUI / 'html_vivo' / f'{nome}.html'; arq.write_text(h_, encoding='utf-8')
            pg.set_viewport_size({'width': w, 'height': h}); pg.goto(arq.as_uri()); pg.wait_for_load_state('networkidle'); pg.evaluate('document.fonts.ready')
            pg.screenshot(path=str(SAIDA / f'{nome}.jpg'), type='jpeg', quality=92, clip={'x': 0, 'y': 0, 'width': w, 'height': h})
        b.close()
    print(len(ARTES), 'artes')
