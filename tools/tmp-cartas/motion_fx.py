#!/usr/bin/env python3
"""motion_fx — motion graphics kinéticos para os vídeos 9:16 de abertura de packs (TCG Price Hunter).

Funções puras: cada efeito recebe o tempo local t (segundos desde o início do efeito) e devolve um quadro
RGBA 1080x1920 (transparente onde não há gráfico) para o ffmpeg sobrepor ao vídeo. Determinístico
(partículas semeadas), sprites estáticos em cache, transforms bilineares. Só PIL + numpy.

Todas aceitam `canvas=` (um RGBA 1080x1920 já existente) para empilhar vários efeitos num único quadro
sem composições extras; sem canvas, criam um quadro vazio.

    hook(lines, color, t, dur=3.2)                      ganchos no topo (pílulas + palavras que batem)
    price_slam(pago, outras, t, dur=5.0)                preço riscado -> PAGUEI com contagem -> selo ECONOMIA
    hit_reveal(name, type_label, type_hex, t, dur=2.8)  revelação do hit (flash, sunburst, chip elástico, holo)
    zoom_punch(t, dur=None) -> float                    curva de zoom para aplicar no vídeo durante o hit
    punch_shake(t) -> (dx, dy)                          tremida de câmera opcional para o impacto
    brick(gif_frames, t, dur=2.0)                       pack ruim: pílula vermelha + figurinha GIF + farelos
    end_card(cfg, t)                                    fechamento em cor cheia (opaco, abre em íris)
    transition_whip(t, dur=0.36)                        wipe diagonal para jump cuts (cobre tudo em dur/2)
    counter_badge(i, n, t)                              selo "PACK 3/6" que gira o número a cada troca
    sticker_frames(path)                                quadros do GIF como figurinha (borda branca, sombra dura)
    brl(v)                                              "R$ 240", "R$ 1.240", "R$ 240,50"
"""
import math, os, random
from functools import lru_cache
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageChops

AQUI = os.path.dirname(os.path.abspath(__file__))
W, H, FPS = 1080, 1920, 30
SAFE_TOP, SAFE_BOTTOM, MARGIN = 250, 1620, 72
SS = 2  # supersample dos sprites estáticos

NAVY, WHITE, YELLOW = (19, 31, 73), (255, 255, 255), (255, 207, 51)
RED, GREEN = (201, 61, 37), (11, 113, 72)
SHADOW = (0, 0, 0, 125)
TYPE_COLORS = {
    'lightning': '#e2a500', 'fire': '#e0512b', 'water': '#2c7be5', 'grass': '#2f9a55', 'psychic': '#8e4bd6',
    'metal': '#6e7a90', 'fighting': '#c25a1c', 'darkness': '#2b2d42', 'dragon': '#a8801a', 'fairy': '#e05aa0',
    'colorless': '#c9ced8'}


# ============================================================ cor / contraste
def rgb(c):
    if isinstance(c, str):
        h = c.lstrip('#'); return tuple(int(h[i:i + 2], 16) for i in (0, 2, 4))
    return tuple(int(v) for v in c[:3])

def luminance(c):
    """Luminância relativa WCAG 2.x."""
    def ch(v):
        v /= 255.0
        return v / 12.92 if v <= 0.04045 else ((v + 0.055) / 1.055) ** 2.4
    r, g, b = rgb(c)
    return 0.2126 * ch(r) + 0.7152 * ch(g) + 0.0722 * ch(b)

def contrast(a, b):
    la, lb = luminance(a), luminance(b)
    return (max(la, lb) + 0.05) / (min(la, lb) + 0.05)

def mix(a, b, k):
    a, b = rgb(a), rgb(b)
    return tuple(int(round(a[i] + (b[i] - a[i]) * k)) for i in range(3))

def ink_on(bg):
    """Navy ou branco, o que contrastar mais com o fundo."""
    return NAVY if contrast(NAVY, bg) >= contrast(WHITE, bg) else WHITE

@lru_cache(maxsize=256)
def _fit_fill(bg, min_ratio):
    for ink in sorted((NAVY, WHITE), key=lambda i: -contrast(i, bg)):
        if contrast(ink, bg) >= min_ratio: return bg, ink
    best = None
    for k in np.arange(0.01, 1.0, 0.01):  # escurece (mantém o matiz) p/ tinta branca
        d = tuple(int(v * (1 - k)) for v in bg)
        if contrast(WHITE, d) >= min_ratio: best = (k, d, WHITE); break
    for k in np.arange(0.01, 1.0, 0.01):  # clareia p/ tinta navy
        l = mix(bg, WHITE, k)
        if contrast(NAVY, l) >= min_ratio:
            if best is None or k < best[0]: best = (k, l, NAVY)
            break
    return best[1], best[2]

def fit_fill(bg, min_ratio=4.5):
    """(fundo_ajustado, tinta) com contraste >= min_ratio, mexendo o mínimo no fundo."""
    return _fit_fill(rgb(bg), float(min_ratio))


# ============================================================ easing
def clamp01(x): return 0.0 if x <= 0 else 1.0 if x >= 1 else x
def lerp(a, b, k): return a + (b - a) * k
def seg(t, a, b): return clamp01((t - a) / (b - a)) if b > a else float(t >= a)
def ease_out_cubic(x): x = clamp01(x); return 1 - (1 - x) ** 3
def ease_in_cubic(x): x = clamp01(x); return x ** 3
def ease_in_quad(x): x = clamp01(x); return x * x
def ease_in_out_cubic(x):
    x = clamp01(x); return 4 * x ** 3 if x < 0.5 else 1 - (-2 * x + 2) ** 3 / 2
def ease_out_expo(x): x = clamp01(x); return 1.0 if x >= 1 else 1 - 2 ** (-10 * x)
def ease_in_expo(x): x = clamp01(x); return 0.0 if x <= 0 else 2 ** (10 * x - 10)
def ease_out_back(x, s=1.70158):
    x = clamp01(x); c3 = s + 1; return 1 + c3 * (x - 1) ** 3 + s * (x - 1) ** 2
def ease_in_back(x, s=1.70158):
    x = clamp01(x); return (s + 1) * x ** 3 - s * x ** 2
def ease_out_elastic(x, period=0.32):
    x = clamp01(x)
    if x in (0.0, 1.0): return x
    return 2 ** (-10 * x) * math.sin((x - period / 4) * 2 * math.pi / period) + 1
def ease_out_bounce(x):
    x = clamp01(x); n, d = 7.5625, 2.75
    if x < 1 / d: return n * x * x
    if x < 2 / d: x -= 1.5 / d; return n * x * x + 0.75
    if x < 2.5 / d: x -= 2.25 / d; return n * x * x + 0.9375
    x -= 2.625 / d; return n * x * x + 0.984375
def damp(t, freq, decay):
    """Oscilação amortecida que começa em t=0 (0 antes)."""
    return 0.0 if t < 0 else math.sin(2 * math.pi * freq * t) * math.exp(-decay * t)
def smoothstep(e0, e1, x):
    x = clamp01((x - e0) / (e1 - e0)) if e1 != e0 else float(x >= e0); return x * x * (3 - 2 * x)


# ============================================================ texto
@lru_cache(maxsize=64)
def font(weight, size):
    return ImageFont.truetype(os.path.join(AQUI, f'rubik{weight}.ttf'), int(size))

def text_w(txt, f, track=0):
    return sum(f.getlength(ch) for ch in txt) + track * max(len(txt) - 1, 0)

def _cap(f):
    """(topo, base) da caixa-alta — centraliza pelo 'H' para acentos não deslocarem o texto."""
    b = f.getbbox('H'); return b[1], b[3]

def _draw_text(d, x, y, txt, f, fill, track=0):
    for ch in txt:
        d.text((x, y), ch, font=f, fill=fill); x += f.getlength(ch) + track
    return x

def brl(v):
    """Formato BRL: R$ 240 / R$ 1.240 / R$ 240,50."""
    v = float(v)
    if abs(v - round(v)) < 0.005:
        return 'R$ ' + f'{int(round(v)):,}'.replace(',', '.')
    return 'R$ ' + f'{v:,.2f}'.replace(',', 'X').replace('.', ',').replace('X', '.')


# ============================================================ sprites / composição
def blank(): return Image.new('RGBA', (W, H), (0, 0, 0, 0))

def _down(im):  # supersample -> 1x
    return im.resize((max(1, im.width // SS), max(1, im.height // SS)), Image.LANCZOS)

_LUTS = {}
def _fade(im, a):
    q = int(round(clamp01(a) * 64))
    lut = _LUTS.get(q)
    if lut is None: lut = _LUTS[q] = [int(v * q / 64) for v in range(256)]
    r, g, b, al = im.split()
    return Image.merge('RGBA', (r, g, b, al.point(lut)))

def _xform(im, sx, sy, rot):
    """Escala não-uniforme + rotação (graus, anti-horário) em torno do centro. Alfa pré-multiplicado."""
    p = im.convert('RGBa')
    if min(sx, sy) < 0.7:  # reduções grandes: resize filtrado primeiro (sem serrilhado), depois só gira
        p = p.resize((max(1, int(round(p.width * sx))), max(1, int(round(p.height * sy)))), Image.BILINEAR)
        sx = sy = 1.0
        if abs(rot) < 0.05: return p.convert('RGBA')
    w, h = p.size; th = math.radians(rot); c, s = math.cos(th), math.sin(th)
    xs = [(-w / 2) * sx, (w / 2) * sx]; ys = [(-h / 2) * sy, (h / 2) * sy]
    px = [c * x + s * y for x in xs for y in ys]; py = [-s * x + c * y for x in xs for y in ys]
    Wo = int(math.ceil(max(px) - min(px))) + 2; Ho = int(math.ceil(max(py) - min(py))) + 2
    a, b = c / sx, -s / sx; d_, e = s / sy, c / sy
    cx0 = -a * Wo / 2 - b * Ho / 2 + w / 2; cy0 = -d_ * Wo / 2 - e * Ho / 2 + h / 2
    return p.transform((Wo, Ho), Image.AFFINE, (a, b, cx0, d_, e, cy0), Image.BILINEAR).convert('RGBA')

def _paste(c, im, x, y):
    x, y = int(round(x)), int(round(y))
    x0, y0 = max(0, x), max(0, y); x1, y1 = min(c.width, x + im.width), min(c.height, y + im.height)
    if x1 <= x0 or y1 <= y0: return
    if (x0, y0, x1, y1) != (x, y, x + im.width, y + im.height):
        im = im.crop((x0 - x, y0 - y, x1 - x, y1 - y))
    if c.mode == 'RGBA': c.alpha_composite(im, (x0, y0))
    else: c.paste(im, (x0, y0), im)

def put(c, im, cx, cy, a=1.0, sx=1.0, sy=None, rot=0.0):
    """Cola `im` centrado em (cx, cy) com alfa, escala (sx, sy) e rotação."""
    sy = sx if sy is None else sy
    if a <= 0.004 or sx <= 0.01 or sy <= 0.01: return
    out = im if (abs(sx - 1) < 2e-3 and abs(sy - 1) < 2e-3 and abs(rot) < 0.05) else _xform(im, sx, sy, rot)
    if a < 0.996: out = _fade(out, a)
    _paste(c, out, cx - out.width / 2, cy - out.height / 2)

def _rotv(dx, dy, rot, s=1.0, sy=None):
    """Posição de um ponto local (dx, dy) após escala+rotação do pai (mesma convenção de _xform)."""
    sy = s if sy is None else sy; th = math.radians(rot); c, sn = math.cos(th), math.sin(th)
    x, y = dx * s, dy * sy
    return c * x + sn * y, -sn * x + c * y

def _canvas(canvas):
    return (blank(), True) if canvas is None else (canvas, False)


# ---------------------------------------------------------------- formas
def _sparkle_pts(cx, cy, r, k=0.12, n=7):
    """Brilho de 4 pontas com lados côncavos (curvas quadráticas)."""
    tips = [(cx, cy - r), (cx + r, cy), (cx, cy + r), (cx - r, cy)]
    pts = []
    for i in range(4):
        a, b = tips[i], tips[(i + 1) % 4]
        ctl = (cx + (a[0] + b[0] - 2 * cx) * k, cy + (a[1] + b[1] - 2 * cy) * k)
        for j in range(n):
            u = j / n
            pts.append(((1 - u) ** 2 * a[0] + 2 * (1 - u) * u * ctl[0] + u * u * b[0],
                        (1 - u) ** 2 * a[1] + 2 * (1 - u) * u * ctl[1] + u * u * b[1]))
    return pts

@lru_cache(maxsize=512)
def sparkle(r, color=WHITE, alpha=255):
    r = max(2, int(r)); s = (2 * r + 6) * SS; im = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    ImageDraw.Draw(im).polygon(_sparkle_pts(s / 2, s / 2, r * SS), fill=tuple(color) + (alpha,))
    return _down(im)

BOLT = [(300, 0), (90, 470), (250, 470), (140, 900), (470, 330), (300, 330), (430, 0)]

@lru_cache(maxsize=32)
def bolt(color, alpha, esc=1.0, flip=False):
    w, h = int(520 * esc), int(900 * esc)
    im = Image.new('RGBA', (w * SS, h * SS), (0, 0, 0, 0))
    pts = [((520 - x) if flip else x, y) for x, y in BOLT]
    ImageDraw.Draw(im).polygon([(x * esc * SS, y * esc * SS) for x, y in pts], fill=tuple(color) + (alpha,))
    return _down(im)

def _star_pts(cx, cy, ro, ri, n, phase=0.0):
    pts = []
    for i in range(2 * n):
        r = ro if i % 2 == 0 else ri; a = phase + math.pi * i / n
        pts.append((cx + r * math.cos(a), cy + r * math.sin(a)))
    return pts


# ---------------------------------------------------------------- pílulas
M_PAD = 16  # margem do sprite (sombra dura cabe dentro e o centro do sprite = centro da pílula)

def _pill_geom(txt, size, weight, pad, track):
    f = font(weight, size * SS); top, bot = _cap(f)
    tw = text_w(txt, f, track * SS)
    w = int(tw / SS + 2 * pad[0]); h = int((bot - top) / SS + 2 * pad[1])
    return f, top, bot, tw, w, h

@lru_cache(maxsize=512)
def pill(txt, size, fill, ink, weight=900, pad=(34, 18), border=None, track=-1, shadow=True, radius=None,
         text=True, bw=6):
    """Pílula de figurinha: cantos redondos, sombra dura deslocada, borda branca opcional."""
    f, top, bot, tw, w, h = _pill_geom(txt, size, weight, pad, track)
    m = M_PAD; im = Image.new('RGBA', ((w + 2 * m) * SS, (h + 2 * m) * SS), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    r = (radius if radius is not None else h / 2) * SS
    if shadow: d.rounded_rectangle(((m + 7) * SS, (m + 9) * SS, (m + w + 7) * SS, (m + h + 9) * SS), r, fill=SHADOW)
    d.rounded_rectangle((m * SS, m * SS, (m + w) * SS, (m + h) * SS), r, fill=tuple(fill),
                        outline=WHITE if border else None, width=bw * SS if border else 0)
    if text:
        _draw_text(d, (m + w / 2) * SS - tw / 2, (m + h / 2) * SS - (top + bot) / 2, txt, f, tuple(ink), track * SS)
    return _down(im)

@lru_cache(maxsize=512)
def text_sprite(txt, size, ink, weight=900, track=-1, shadow=None, off=(6, 8)):
    """Texto solto (sombra dura opcional). Centro do sprite = centro da caixa de avanço x caixa-alta;
    margem esquerda = 14 + off[0] px."""
    f = font(weight, size * SS); top, bot = _cap(f); tw = text_w(txt, f, track * SS)
    bb = f.getbbox('ÉÇÃgj'); asc, desc = bb[1], bb[3]
    ox, oy = ((off[0] * SS, off[1] * SS) if shadow else (0, 0)); m = 14 * SS; mid = (top + bot) / 2
    half = max(mid - asc, desc - mid) + m + oy
    im = Image.new('RGBA', (int(tw + 2 * (m + ox)), int(2 * half)), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    x0, y0 = m + ox, half - mid
    if shadow: _draw_text(d, x0 + ox, y0 + oy, txt, f, tuple(shadow), track * SS)
    _draw_text(d, x0, y0, txt, f, tuple(ink), track * SS)
    return _down(im)


# ============================================================ partículas
@lru_cache(maxsize=256)
def _burst_particles(seed, n, spread=(0, 2 * math.pi), speed=(900, 1900), r=(12, 30), life=(0.55, 0.95),
                     colors=(WHITE, YELLOW), origin_box=(0, 0)):
    rnd = random.Random(seed); out = []
    for i in range(n):
        a = lerp(spread[0], spread[1], (i + rnd.random() * 0.8) / n)
        out.append(dict(a=a, v=rnd.uniform(*speed), r=rnd.uniform(*r), life=rnd.uniform(*life),
                        spin=rnd.uniform(-260, 260), col=colors[i % len(colors)],
                        ox=rnd.uniform(-1, 1) * origin_box[0], oy=rnd.uniform(-1, 1) * origin_box[1]))
    return out

def _draw_burst(c, parts, cx, cy, lt, drag=4.2, grav=420.0, a=1.0):
    """Partículas analíticas (arrasto exponencial + gravidade): acesso aleatório em t, sem estado."""
    if lt < 0: return
    for p in parts:
        if lt > p['life']: continue
        k = (1 - math.exp(-drag * lt)) / drag; u = lt / p['life']
        x = cx + p['ox'] + math.cos(p['a']) * p['v'] * k
        y = cy + p['oy'] + math.sin(p['a']) * p['v'] * k + 0.5 * grav * lt * lt
        rr = p['r'] * min(1, lt / 0.05) * (1 - u) ** 0.8
        if rr < 2: continue
        put(c, sparkle(int(rr), p['col']), x, y, a * (1 - smoothstep(0.7, 1, u)), rot=p['spin'] * lt)


# ============================================================ 1. GANCHO
@lru_cache(maxsize=32)
def _hook_parts(lines, color):
    color = rgb(color); size = 66
    fills = []
    for i in range(len(lines)):
        fills.append((WHITE, NAVY) if i == 0 else fit_fill(color))
    while True:  # cabe nas margens laterais
        ws = [_pill_geom(l, size, 900, (34, 18), -1)[4] for l in lines]
        if max(ws) <= W - 2 * MARGIN or size <= 36: break
        size -= 2
    out = []
    for i, l in enumerate(lines):
        fill, ink = fills[i]
        bg = pill(l, size, fill, ink, text=False)
        full = pill(l, size, fill, ink)
        f, top, bot, tw, w, h = _pill_geom(l, size, 900, (34, 18), -1)
        # palavras: sprites sem sombra + deslocamento relativo ao centro da pílula
        words, x = [], -tw / SS / 2; fs = font(900, size)
        sp = fs.getlength(' ') - 1
        for wd in l.split(' '):
            ww = text_w(wd, fs, -1)
            spr = text_sprite(wd, size, ink, track=-1, off=(0, 0))
            words.append((spr, x + ww / 2, 0.0)); x += ww + sp - 1
        rest = (-2.5, 2.0, -1.5, 2.5)[i % 4]
        out.append(dict(bg=bg, full=full, words=words, w=w, h=h, rest=rest,
                        rest_img=_xform(full, 1, 1, rest), dirn=(-1, 1)[i % 2]))
    return tuple(out)

def hook(lines, color, t, dur=3.2, cy=None, seed=1, canvas=None):
    """Ganchos no topo: cada pílula entra girando com overshoot, as palavras batem uma a uma (slam de
    escala + squash no impacto, tremida da pílula), brilhos estouram no fim da linha, flutua de leve
    e sai com squash + whip lateral alternado."""
    c, _ = _canvas(canvas)
    if t < 0 or t > dur: return c
    parts = _hook_parts(tuple(lines), rgb(color))
    gap = 22; total = sum(p['h'] for p in parts) + gap * (len(parts) - 1)
    y = (cy - total / 2) if cy is not None else SAFE_TOP + 12
    n = len(parts)
    for i, p in enumerate(parts):
        lcy = y + p['h'] / 2; y += p['h'] + gap
        t0 = i * 0.36; lt = t - t0
        if lt < 0: continue
        # entrada
        e = ease_out_back(seg(lt, 0, 0.3), 2.0)
        s = max(0.01, e)
        rot = lerp(14 * p['dirn'], p['rest'], ease_out_cubic(seg(lt, 0, 0.38)))
        x = W / 2 + p['dirn'] * -160 * (1 - ease_out_expo(seg(lt, 0, 0.3)))
        a = seg(lt, 0, 0.06)
        # palavras e impactos
        tw0 = [0.1 + j * 0.065 for j in range(len(p['words']))]
        shx = shy = 0.0
        for j, tj in enumerate(tw0):
            ti = lt - tj - 0.15
            shx += 7 * damp(ti, 11, 13); shy += 5 * damp(ti, 9, 13)
        x += shx; ly = lcy + shy
        # flutuação depois de assentar
        ly += 4 * math.sin(2.1 * t + i * 1.3) * seg(lt, 0.5, 0.9)
        # saída: squash + whip lateral (com antecipação do ease_in_back)
        te = dur - 0.34 + 0.05 * i; ex = seg(t, te, te + max(0.16, 0.3 - 0.05 * i))
        sxm, sym = 1.0, 1.0
        if ex > 0:
            k = ease_in_back(ex, 1.6); x += p['dirn'] * 1250 * k
            sxm = 1 + 0.55 * ease_in_cubic(ex); sym = 1 - 0.5 * ease_in_cubic(ex)
            a *= 1 - smoothstep(0.75, 1, ex)
            if ex > 0.25:  # rastro (motion blur fake)
                put(c, p['full'], x - p['dirn'] * 90 * ex, ly, a * 0.3, s * sxm * 1.1, s * sym, p['rest'])
        last_land = tw0[-1] + 0.15
        settled = lt > last_land + 0.3 and lt > 0.4
        if settled:
            if ex <= 0: put(c, p['rest_img'], x, ly, a)
            else: put(c, p['full'], x, ly, a, s * sxm, s * sym, rot)
        else:
            put(c, p['bg'], x, ly, a, s * sxm, s * sym, rot)
            for j, (spr, dx, dy) in enumerate(p['words']):
                wl = lt - tw0[j]
                if wl < 0: continue
                k = seg(wl, 0, 0.14); ws = 1.9 - 0.9 * ease_in_quad(k)
                sq = 0.2 * damp(wl - 0.14, 5, 11) if k >= 1 else 0.0
                ox, oy = _rotv(dx, dy, rot, s)
                wa = a * seg(wl, 0, 0.05)
                if k < 1:  # fantasma do frame anterior = borrão de movimento
                    put(c, spr, x + ox * 1.02, ly + oy, wa * 0.3, s * (ws + 0.25), None, rot)
                put(c, spr, x + ox, ly + oy, wa, s * ws * (1 + sq), s * ws * (1 - sq), rot)
        # brilhos quando a última palavra bate
        if ex <= 0:
            parts_b = _burst_particles(seed * 31 + i, 9, speed=(900, 1400), r=(20, 36), life=(0.45, 0.75),
                                       colors=(YELLOW, WHITE), origin_box=(p['w'] * 0.42, p['h'] * 0.3))
            _draw_burst(c, parts_b, x, ly, lt - last_land, drag=5.5, grav=250)
    return c


# ============================================================ 2. PREÇO
def _tab_digits_w(f):
    return max(f.getlength(ch) for ch in '0123456789')

@lru_cache(maxsize=8)
def _price_static(pago, outras):
    pago_s, outras_s = brl(pago), brl(outras)
    o_txt = f'OUTRAS LOJAS {outras_s}'
    outras_img = pill(o_txt, 46, WHITE, RED, weight=800, pad=(30, 16))
    o_geom = _pill_geom(o_txt, 46, 800, (30, 16), -1)
    # PAGUEI: largura fixa com dígitos tabulares (contagem sem tremer)
    size = 64; f = font(900, size * SS); dw = _tab_digits_w(f)
    lab = 'PAGUEI R$ '
    def layout_w(v):
        s = brl(v)[3:]
        return text_w(lab, f, -SS) + sum(dw if ch.isdigit() else f.getlength(ch) for ch in s)
    tw = max(layout_w(pago), layout_w(outras))
    top, bot = _cap(f); padx, pady = 38, 22
    pw = int(tw / SS + 2 * padx); ph = int((bot - top) / SS + 2 * pady)
    ring = Image.new('RGBA', ((pw + 2 * M_PAD) * SS, (ph + 2 * M_PAD) * SS), (0, 0, 0, 0))
    ImageDraw.Draw(ring).rounded_rectangle((M_PAD * SS, M_PAD * SS, (M_PAD + pw) * SS, (M_PAD + ph) * SS),
                                           ph / 2 * SS, outline=WHITE, width=7 * SS)
    # selo ECONOMIA (estrela verde com borda branca)
    eco = outras - pago; R = 128
    s = (2 * R + 40) * SS; star = Image.new('RGBA', (s, s), (0, 0, 0, 0)); d = ImageDraw.Draw(star); cc = s / 2
    d.polygon(_star_pts(cc + 8 * SS, cc + 10 * SS, R * SS, R * 0.82 * SS, 16), fill=SHADOW)
    d.polygon(_star_pts(cc, cc, R * SS, R * 0.82 * SS, 16), fill=WHITE)
    d.polygon(_star_pts(cc, cc, (R - 11) * SS, (R * 0.82 - 10) * SS, 16), fill=GREEN)
    star = _down(star)
    txt = Image.new('RGBA', (2 * R * SS, 2 * R * SS), (0, 0, 0, 0)); d = ImageDraw.Draw(txt)
    f1 = font(800, 30 * SS); f2 = font(900, (54 if eco < 1000 else 44) * SS)
    for ff, st, yy in ((f1, 'ECONOMIA', -0.36), (f2, brl(eco), 0.30)):
        t0, b0 = _cap(ff); ww = text_w(st, ff, -SS)
        _draw_text(d, R * SS - ww / 2, R * SS + yy * R * SS - (t0 + b0) / 2, st, ff, WHITE, -SS)
    txt = _down(txt)
    return dict(outras=outras_img, ow=o_geom[4], oh=o_geom[5], o_tw=o_geom[3] / SS, pw=pw, ph=ph,
                f=f, dw=dw, tw=tw, top=top, bot=bot, ring=_down(ring), star=star, star_txt=txt, R=R)

@lru_cache(maxsize=64)
def _outras_struck(pago, outras, q):
    """Pílula OUTRAS LOJAS com o risco desenhado até q/24 (cache por passo)."""
    st = _price_static(pago, outras); im = st['outras'].copy()
    if q <= 0: return im
    d = ImageDraw.Draw(im); m = M_PAD; x0 = m + 18; x1 = m + st['ow'] - 18
    yc = m + st['oh'] / 2; L = (x1 - x0) * q / 24
    d.line((x0, yc + 7, x0 + L, yc + 7 - 12 * L / (x1 - x0)), fill=RED, width=10)
    return im

@lru_cache(maxsize=512)
def _pago_pill(pago, outras, v):
    st = _price_static(pago, outras); f = st['f']; pw, ph = st['pw'], st['ph']; m = M_PAD
    im = Image.new('RGBA', ((pw + 2 * m) * SS, (ph + 2 * m) * SS), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    d.rounded_rectangle(((m + 7) * SS, (m + 9) * SS, (m + pw + 7) * SS, (m + ph + 9) * SS), ph / 2 * SS, fill=SHADOW)
    d.rounded_rectangle((m * SS, m * SS, (m + pw) * SS, (m + ph) * SS), ph / 2 * SS, fill=YELLOW)
    lab = 'PAGUEI R$ '; num = brl(v)[3:]
    tw = text_w(lab, f, -SS) + sum(st['dw'] if ch.isdigit() else f.getlength(ch) for ch in num)
    x = (m + pw / 2) * SS - tw / 2; y = (m + ph / 2) * SS - (st['top'] + st['bot']) / 2
    x = _draw_text(d, x, y, lab, f, NAVY, -SS)
    for ch in num:  # dígitos centralizados em casas de largura fixa
        cw = st['dw'] if ch.isdigit() else f.getlength(ch)
        d.text((x + (cw - f.getlength(ch)) / 2, y), ch, font=f, fill=NAVY); x += cw
    return _down(im)

def price_slam(pago, outras, t, dur=5.0, cy=1250, seed=2, canvas=None):
    """OUTRAS LOJAS entra, risco vermelho corre com tremida, PAGUEI bate de cima (escala 2.6 -> 1 com
    rastro, squash, onda de choque, brilhos) contando de `outras` até `pago`; selo ECONOMIA estoura
    girado com elástico e fica girando devagar. Sai encolhendo em cascata."""
    c, _ = _canvas(canvas)
    if t < 0 or t > dur: return c
    st = _price_static(pago, outras)
    oy, py = cy - 82, cy + 44
    # tremida de grupo no impacto do PAGUEI
    T_IMP = 0.78; gy = 12 * damp(t - T_IMP, 9, 11); gx = 5 * damp(t - T_IMP, 13, 11)
    ex = lambda k: seg(t, dur - 0.34 + 0.06 * k, dur - 0.34 + 0.06 * k + 0.22)
    # --- OUTRAS LOJAS
    lt = t
    s = ease_out_back(seg(lt, 0, 0.28), 2.2); rot = lerp(7, -2.5, ease_out_cubic(seg(lt, 0, 0.32)))
    shake = 18 * damp(lt - 0.5, 8, 8); rot += 2.5 * damp(lt - 0.5, 8, 8)
    dim = 1 - 0.12 * seg(lt, 0.8, 1.0); sdim = 1 - 0.06 * ease_out_cubic(seg(lt, 0.8, 1.1))
    e2 = ex(2); so = s * sdim * (1 - ease_in_back(e2, 2.0))
    q = int(round(24 * ease_out_expo(seg(lt, 0.32, 0.52))))
    put(c, _outras_struck(pago, outras, q), W / 2 - 40 * (1 - ease_out_expo(seg(lt, 0, 0.28))) + shake + gx,
        oy + gy * 0.6, seg(lt, 0, 0.05) * dim * (1 - smoothstep(0.6, 1, e2)), so, None, rot)
    # --- PAGUEI
    lt = t - 0.62
    if lt >= 0:
        k = seg(lt, 0, 0.16); sc = 2.6 - 1.6 * ease_in_quad(k)
        sq = 0.16 * damp(lt - 0.16, 4.5, 9) if k >= 1 else 0.0
        e1 = ex(1); sc *= (1 - ease_in_back(e1, 2.0))
        v = round(lerp(outras, pago, ease_out_expo(seg(lt, 0.12, 0.85))), 2)
        v = int(round(v)) if abs(pago - round(pago)) < 0.005 and abs(outras - round(outras)) < 0.005 else v
        img = _pago_pill(pago, outras, v); rot = lerp(-6, 1.5, ease_out_cubic(seg(lt, 0, 0.3)))
        a = seg(lt, 0, 0.05) * (1 - smoothstep(0.6, 1, e1))
        if k < 1: put(c, img, W / 2 + gx, py + gy, a * 0.28, sc * 1.22, None, rot)
        put(c, img, W / 2 + gx, py + gy, a, sc * (1 + sq), sc * (1 - sq), rot)
        # onda de choque (contorno da pílula expandindo)
        rl = lt - 0.16
        if 0 <= rl < 0.42:
            u = rl / 0.42; put(c, st['ring'], W / 2, py, (1 - u) ** 1.5 * 0.9, 1 + 0.5 * ease_out_cubic(u), 1 + 0.9 * ease_out_cubic(u), rot)
        parts = _burst_particles(seed, 10, speed=(900, 1500), r=(12, 26), life=(0.4, 0.7), colors=(YELLOW, WHITE),
                                 origin_box=(st['pw'] * 0.4, st['ph'] * 0.3))
        _draw_burst(c, parts, W / 2, py, lt - 0.16, drag=6, grav=300)
    # --- ECONOMIA
    lt = t - 1.4
    if lt >= 0 and outras > pago:
        R = st['R']; bx = min(W - MARGIN - R + 18, W / 2 + st['pw'] / 2 - 40); by = py + st['ph'] / 2 + R - 22
        e0 = ex(0); s = ease_out_elastic(seg(lt, 0, 0.75), 0.36) * (1 - ease_in_back(e0, 2.0))
        s *= 1 + 0.035 * math.sin(2 * math.pi * 1.6 * lt) * seg(lt, 0.7, 1.0)
        rot = lerp(-70, 11, ease_out_cubic(seg(lt, 0, 0.5)))
        a = seg(lt, 0, 0.04) * (1 - smoothstep(0.6, 1, e0))
        put(c, st['star'], bx, by, a, s, None, rot - 24 * lt)
        put(c, st['star_txt'], bx, by, a, s, None, rot)
        parts = _burst_particles(seed + 7, 7, speed=(700, 1100), r=(10, 22), life=(0.35, 0.6), colors=(WHITE, YELLOW))
        _draw_burst(c, parts, bx, by, lt - 0.08, drag=6, grav=200)
    return c


# ============================================================ 3. HIT
@lru_cache(maxsize=16)
def _chip(name, type_label, col):
    fill, ink = fit_fill(col)
    s1, s2 = 88, 34
    while True:
        f1, f2 = font(900, s1 * SS), font(800, s2 * SS)
        w = int(max(text_w(name, f1, -2 * SS), text_w(type_label, f2, 3 * SS) + 90 * SS) / SS + 130)
        if w <= W - 2 * MARGIN or s1 <= 48: break
        s1 -= 4
    w = max(w, 520); h = 228; m = M_PAD; bw = 8; r = 40
    im = Image.new('RGBA', ((w + 2 * m) * SS, (h + 2 * m) * SS), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    d.rounded_rectangle(((m + 11) * SS, (m + 13) * SS, (m + w + 11) * SS, (m + h + 13) * SS), r * SS, fill=(0, 0, 0, 140))
    d.rounded_rectangle((m * SS, m * SS, (m + w) * SS, (m + h) * SS), r * SS, fill=fill, outline=WHITE, width=bw * SS)
    cx = (m + w / 2) * SS
    t2, b2 = _cap(f2); tw2 = text_w(type_label, f2, 3 * SS); y2 = (m + 62) * SS
    _draw_text(d, cx - tw2 / 2, y2 - (t2 + b2) / 2, type_label, f2, ink, 3 * SS)
    for sgn in (-1, 1):  # ✦ desenhado ao lado do rótulo do tipo
        d.polygon(_sparkle_pts(cx + sgn * (tw2 / 2 + 34 * SS), y2, 15 * SS), fill=ink)
    t1, b1 = _cap(f1); tw1 = text_w(name, f1, -2 * SS)
    _draw_text(d, cx - tw1 / 2, (m + 146) * SS - (t1 + b1) / 2, name, f1, ink, -2 * SS)
    chip = _down(im)
    mask = Image.new('L', chip.size, 0)
    ImageDraw.Draw(mask).rounded_rectangle((m + bw, m + bw, m + w - bw, m + h - bw), r - bw, fill=255)
    return dict(img=chip, mask=np.asarray(mask, np.float32) / 255.0, w=w, h=h, fill=fill, ink=ink)

def _shimmer(img, mask, p, strength=0.85, width=0.075):
    """Faixa holográfica diagonal (arco-íris + branco) atravessando o sprite; p em [0,1]."""
    a = np.asarray(img).astype(np.float32); hh, ww = mask.shape
    yy, xx = np.mgrid[0:hh, 0:ww].astype(np.float32)
    u = (xx + 0.45 * yy) / (ww + 0.45 * hh); pos = lerp(-0.2, 1.2, p)
    band = np.exp(-((u - pos) / width) ** 2) * mask * strength
    hue = (u * 2.2 + p) % 1.0  # arco-íris suave em 3 senoides defasadas
    holo = np.stack([0.5 + 0.5 * np.cos(2 * np.pi * (hue + o)) for o in (0, 1 / 3, 2 / 3)], -1) * 255
    tgt = holo * 0.45 + 255 * 0.55
    a[..., :3] += (tgt - a[..., :3]) * band[..., None]
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), 'RGBA')

RS = 6.0  # px por nível do mapa radial (L 0..255 -> 0..1530 px)

@lru_cache(maxsize=4)
def _polar(cx, cy, rows):
    yy, xx = np.mgrid[0:rows, 0:W].astype(np.float32)
    dx, dy = xx - cx, yy - cy
    ang = (np.arctan2(dy, dx) / (2 * np.pi)) % 1.0; r = np.hypot(dx, dy)
    A = Image.fromarray(((ang * 256).astype(np.int32) % 256).astype(np.uint8), "L")
    Af = Image.fromarray(((ang * 768) % 256).astype(np.uint8), 'L')
    R = Image.fromarray(np.clip(r / RS, 0, 255).astype(np.uint8), 'L')
    fall = [int(255 * (1 - smoothstep(220, 820, l * RS))) for l in range(256)]
    side = np.minimum(xx, W - xx)  # speed lines só nas laterais e acima do chip: miolo (carta) limpo
    edge = np.maximum(1 - np.clip((side - 140) / 200, 0, 1), 1 - np.clip((yy - cy - 40) / 220, 0, 1))
    return A, Af, R, R.point(fall), Image.fromarray((edge * 255).astype(np.uint8), 'L')

@lru_cache(maxsize=8)
def _solid(color, rows):
    return Image.new('RGB', (W, rows), tuple(color))

def _ray_lut(n, rot, duty, amp):
    b = (np.arange(256)[:, None] + (np.arange(4)[None, :] + 0.5) / 4) / 256
    cov = (((b * n + rot) % 1.0) < duty).mean(1)
    return [int(v) for v in np.clip(cov * amp, 0, 255)]

def hit_reveal(name, type_label, type_hex, t, dur=2.8, cy=372, seed=3, canvas=None):
    """Revelação do hit: flash branco->cor do tipo, sunburst girando na cor do tipo (some antes da área
    da carta), speed lines piscando nas bordas, onda de choque, chip com pop elástico + rastro, faixa
    holográfica atravessando o chip, explosão de brilhos e balanço contínuo. Use zoom_punch(t) no vídeo."""
    c, empty = _canvas(canvas)
    if t < 0 or t > dur: return c
    col = rgb(type_hex); ch = _chip(name, type_label, col)
    fi = int(t * FPS + 1e-6)
    ex = seg(t, dur - 0.3, dur)  # saída
    # --- flash de tela cheia
    if t < 0.22:
        fc = WHITE if t < 0.034 else col
        fa = 0.75 if t < 0.034 else 0.6 * (1 - ease_out_cubic(seg(t, 0.034, 0.22)))
        flash = Image.new('RGBA', (W, H), fc + (int(255 * fa),))
        if empty: c = flash; empty = False
        else: c.alpha_composite(flash)
    # --- camada radial (raios cor do tipo + speed lines + onda de choque brancas), via LUT
    rows = min(H, int(cy + 980))
    A, Af, R, FALL, EDGE = _polar(W // 2, int(cy), rows)
    ra = 150 * ease_out_cubic(seg(t, 0, 0.1)) * lerp(1.0, 0.62, ease_out_cubic(seg(t, 0.3, 1.2))) * (1 - ex)
    rays = ImageChops.multiply(A.point(_ray_lut(14, 0.05 + t * 0.11, 0.46, ra)), FALL)
    whites = []
    la = 0.85 * (1 - ease_in_cubic(seg(t, 0.15, 0.75)))
    if la > 0.01:  # speed lines: padrão aleatório por quadro (pisca como anime)
        rng = np.random.default_rng(seed * 100003 + fi)
        lut = list(((rng.random(256) < 0.18) * 255 * la).astype(int))
        rin = lerp(520, 380, ease_out_cubic(seg(t, 0, 0.5)))
        rl = [int(255 * smoothstep(rin, rin + 140, l * RS)) for l in range(256)]
        whites.append(ImageChops.multiply(ImageChops.multiply(Af.point(lut), R.point(rl)), EDGE))
    for k, (t0, d0, th, am) in enumerate(((0.05, 0.5, 26, 0.95), (0.16, 0.55, 12, 0.7))):
        u = seg(t, t0, t0 + d0)
        if 0 < u < 1:
            rr = lerp(150, 1050, ease_out_cubic(u)); thk = lerp(th, 4, u); am2 = am * (1 - u) ** 1.3
            whites.append(R.point([int(255 * am2 * clamp01(1 - abs(l * RS - rr) / max(thk / 2, RS * 0.75)))
                                   for l in range(256)]))
    if whites:
        wa = whites[0]
        for w_ in whites[1:]: wa = ImageChops.lighter(wa, w_)
        rgbm = Image.composite(_solid(WHITE, rows), _solid(col, rows), wa)
        al = ImageChops.lighter(rays, wa)
    else:
        rgbm, al = _solid(col, rows), rays
    layer = Image.merge('RGBA', (*rgbm.split(), al))
    if empty: c.paste(layer, (0, 0)); empty = False
    else: c.alpha_composite(layer, (0, 0))
    # --- chip
    lt = t - 0.04
    if lt >= 0:
        e = ease_out_elastic(seg(lt, 0, 0.75), 0.38)
        s = max(0.01, e) * (1 + 0.012 * math.sin(2 * math.pi * 1.3 * t)) * (1 - ease_in_back(ex, 2.2))
        rot = -14 * (1 - ease_out_cubic(seg(lt, 0, 0.45))) + 1.6 * math.sin(2 * math.pi * 0.9 * t) * seg(lt, 0.3, 0.8)
        yb = cy - 6 * math.sin(2 * math.pi * 0.7 * t) * seg(lt, 0.4, 0.9)
        img = ch['img']
        for (a0, a1) in ((0.36, 0.86), (1.55, 2.0)):  # faixa holo
            if a0 <= t <= a1 and a1 < dur - 0.25: img = _shimmer(img, ch['mask'], seg(t, a0, a1))
        a = seg(lt, 0, 0.04) * (1 - smoothstep(0.7, 1, ex))
        if lt < 0.12: put(c, img, W / 2, yb, a * 0.3, s * 1.25, None, rot - 4)
        put(c, img, W / 2, yb, a, s, None, rot)
        # brilhos orbitando
        oa = seg(lt, 0.3, 0.6) * (1 - ex)
        if oa > 0:
            for k in range(4):
                ang = k * math.pi / 2 + 0.6 + 0.9 * t
                rr = 18 + 10 * (k % 2) + 6 * math.sin(5 * t + k)
                put(c, sparkle(int(rr), WHITE if k % 2 else YELLOW), W / 2 + math.cos(ang) * (ch['w'] / 2 + 46),
                    yb + math.sin(ang) * (ch['h'] / 2 + 52), oa)
        # explosão de brilhos
        light = mix(col, WHITE, 0.55)
        parts = _burst_particles(seed, 22, speed=(1300, 2500), r=(14, 36), life=(0.6, 1.05), colors=(WHITE, YELLOW, light),
                                 origin_box=(ch['w'] * 0.35, ch['h'] * 0.25))
        _draw_burst(c, parts, W / 2, cy, lt - 0.04, drag=3.6, grav=650)
    return c

def zoom_punch(t, dur=None, peak=1.08, rest=1.02):
    """Escala sugerida para o VÍDEO no hit: 1.0 -> 1.08 em 0.1 s (expo) -> 1.02 até 0.6 s; se `dur`,
    volta a 1.0 nos últimos 0.3 s."""
    if t <= 0: return 1.0
    if t < 0.1: s = lerp(1.0, peak, ease_out_expo(t / 0.1))
    else: s = lerp(peak, rest, ease_out_cubic(seg(t, 0.1, 0.6)))
    if dur is not None: s = lerp(s, 1.0, ease_in_out_cubic(seg(t, dur - 0.3, dur)))
    return s

def punch_shake(t, amp=14.0, seed=0):
    """Tremida de câmera (dx, dy) em px para o impacto (dura ~0.35 s)."""
    ph = seed * 1.7
    return (amp * damp(t, 13, 10) * math.cos(ph), amp * 0.8 * damp(t, 17, 10) * math.cos(ph + 1.1))


# ============================================================ 4. BRICK
def sticker_frames(path=None, width=528):
    """Quadros do GIF de reação como figurinha (borda branca, cantos redondos, sombra dura)."""
    path = path or os.path.join(AQUI, 'midia', 'pikachu_triste.gif')
    g = Image.open(path); out = []
    try:
        while True:
            q = g.convert('RGB'); hgt = int(q.height * width / q.width); q = q.resize((width, hgt), Image.LANCZOS)
            m, b = M_PAD, 12
            fig = Image.new('RGBA', (width + 2 * b + 2 * m + 10, hgt + 2 * b + 2 * m + 12), (0, 0, 0, 0)); d = ImageDraw.Draw(fig)
            d.rounded_rectangle((m + 10, m + 12, m + width + 2 * b + 10, m + hgt + 2 * b + 12), 32, fill=(0, 0, 0, 140))
            d.rounded_rectangle((m, m, m + width + 2 * b, m + hgt + 2 * b), 32, fill=WHITE)
            mk = Image.new('L', q.size, 0); ImageDraw.Draw(mk).rounded_rectangle((0, 0, width, hgt), 22, fill=255)
            fig.paste(q, (m + b, m + b), mk); out.append(fig); g.seek(g.tell() + 1)
    except EOFError: pass
    return out

@lru_cache(maxsize=16)
def _crumb(seed, size, grey):
    rnd = random.Random(seed); n = rnd.randint(5, 7); s = size * 2 + 8
    im = Image.new('RGBA', (s * SS, s * SS), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    pts = [(s / 2 + math.cos(2 * math.pi * i / n + rnd.uniform(-0.3, 0.3)) * size * rnd.uniform(0.6, 1.0),
            s / 2 + math.sin(2 * math.pi * i / n + rnd.uniform(-0.3, 0.3)) * size * rnd.uniform(0.6, 1.0)) for i in range(n)]
    d.polygon([(x * SS + 3 * SS, y * SS + 4 * SS) for x, y in pts], fill=(0, 0, 0, 110))
    d.polygon([(x * SS, y * SS) for x, y in pts], fill=(grey, grey, grey + 6, 255))
    return _down(im)

@lru_cache(maxsize=32)
def _crumbs(seed, n, xw):
    rnd = random.Random(seed)
    return [dict(x=rnd.uniform(-xw, xw), vx=rnd.uniform(-240, 240), vy=rnd.uniform(-520, -160), sz=rnd.randint(12, 26),
                 spin=rnd.uniform(-540, 540), g=rnd.choice((112, 132, 150, 170)), k=i) for i in range(n)]

def _draw_crumbs(c, cr, ox, oy, lt, a=1.0, grav=2600, seed=0):
    if lt < 0: return
    for p in cr:
        x = ox + p['x'] + p['vx'] * lt; y = oy + p['vy'] * lt + 0.5 * grav * lt * lt
        if y > H + 40: continue
        put(c, _crumb(seed * 50 + p['k'], p['sz'], p['g']), x, y, a * (1 - smoothstep(0.9, 1.4, lt)), rot=p['spin'] * lt)

T_FALL, HOPS, SQUASH = 0.3, ((150, 0.24), (46, 0.13), (12, 0.07)), (0.2, 0.1, 0.05, 0.02)

def _drop(lt, y0, y1):
    """Queda acelerada + quiques de altura fixa (não depende da distância), e squash nos impactos."""
    imps = [T_FALL]
    for _, d in HOPS: imps.append(imps[-1] + d)
    sq = sum(am * math.exp(-((lt - ti) / 0.03) ** 2) for ti, am in zip(imps, SQUASH))
    if lt < T_FALL: return lerp(y0, y1, ease_in_quad(lt / T_FALL)), sq
    tt = lt - T_FALL
    for h, d in HOPS:
        if tt < d: u = tt / d; return y1 - h * 4 * u * (1 - u), sq
        tt -= d
    return y1, sq

def brick(gif_frames, t, dur=2.0, cy_pill=860, cy_gif=1185, seed=4, canvas=None):
    """Pack ruim: 'NEM TODO PACK É HIT' bate (slam + rastro) e faz 'não' com a cabeça, esfarelando
    pedaços cinza; a figurinha GIF cai do topo quicando (squash a cada quique, balanço, poeirinha) e
    fica tremendo de tristeza. Sai: figurinha despenca girando, pílula achata."""
    c, _ = _canvas(canvas)
    if t < 0 or t > dur: return c
    ex = seg(t, dur - 0.3, dur)
    # --- figurinha (desenhada antes: a pílula fica por cima e sempre legível)
    if gif_frames:
        lt = t - 0.22
        if lt >= 0:
            q = gif_frames[int(t * 10) % len(gif_frames)]
            yb, sq2 = _drop(lt, -q.height / 2 - 20, cy_gif)
            rest = T_FALL + sum(d for _, d in HOPS)
            rot = -5 + 10 * math.cos(2 * math.pi * 1.3 * lt) * math.exp(-2.4 * lt) \
                + 1.5 * math.sin(2 * math.pi * 0.8 * t) * seg(lt, rest, rest + 0.4)
            yb += q.height * sq2 / 2  # squash ancorado embaixo
            yb += 1400 * ease_in_cubic(ex); rot -= 28 * ease_in_cubic(ex)
            put(c, q, W / 2 + 1.2 * math.sin(t * 47) * seg(lt, rest, rest + 0.2), yb, 1.0, 1 + sq2, 1 - sq2, rot)
            ti = lt - T_FALL  # primeiro impacto: farelos + poeirinha
            _draw_crumbs(c, _crumbs(seed + 1, 10, q.width * 0.45), W / 2, cy_gif + q.height / 2 - 30, ti, seed=seed + 1)
            if 0 <= ti < 0.45:
                uu = ti / 0.45
                for sgn in (-1, 1):
                    for j in range(3):
                        rr = int(12 + 30 * ease_out_cubic(uu) * (1 - 0.22 * j))
                        put(c, _puff(rr), W / 2 + sgn * (q.width / 2 - 30 + 60 * j * ease_out_cubic(uu)),
                            cy_gif + q.height / 2 - 14 - 34 * j * uu, 0.85 * (1 - uu))
    # --- pílula
    pl = pill('NEM TODO PACK É HIT', 54, RED, WHITE)
    pw = _pill_geom('NEM TODO PACK É HIT', 54, 900, (34, 18), -1)[4]
    k = seg(t, 0, 0.15); sc = 2.4 - 1.4 * ease_in_quad(k)
    sq = 0.18 * damp(t - 0.15, 5, 10) if k >= 1 else 0.0
    x = W / 2 + 26 * damp(t - 0.15, 6.5, 5.5) + 1.6 * math.sin(t * 53) * seg(t, 0.9, 1.1)
    y = cy_pill + 1.3 * math.sin(t * 41) * seg(t, 0.9, 1.1)
    rot = 3 - 5 * damp(t - 0.15, 6.5, 5.5)
    sxm = 1 + 0.35 * ease_in_back(ex, 2); sym = 1 - ease_in_back(ex, 2.4)
    a = seg(t, 0, 0.05)
    if k < 1: put(c, pl, x, y, a * 0.3, sc * 1.25, None, rot)
    put(c, pl, x, y, a, sc * (1 + sq) * sxm, sc * (1 - sq) * max(0.0, sym), rot)
    _draw_crumbs(c, _crumbs(seed, 14, pw * 0.42), W / 2, cy_pill + 44, t - 0.16, seed=seed)
    return c

@lru_cache(maxsize=64)
def _puff(r):
    s = (2 * r + 4) * SS; im = Image.new('RGBA', (s, s), (0, 0, 0, 0))
    ImageDraw.Draw(im).ellipse((2 * SS, 2 * SS, s - 2 * SS, s - 2 * SS), fill=(215, 218, 226, 230))
    return _down(im)


# ============================================================ 5. END CARD
_LOGO = None
def _logo():
    global _LOGO
    if _LOGO is None:
        p = os.path.join(AQUI, 'logo.png'); _LOGO = Image.open(p).convert('RGBA') if os.path.exists(p) else False
    return _LOGO or None

_EC = {}
def _end_static(cfg):
    key = (id(cfg.get('foto')), tuple(cfg['titulo']), cfg['linha'], cfg['cor_final'], cfg.get('botao'),
           cfg.get('foto_foco', 0.5), id(cfg.get('logo')))
    if key in _EC: return _EC[key]
    bg, ink = fit_fill(rgb(cfg['cor_final']))
    claro = ink == NAVY; mot = NAVY if claro else WHITE
    # fundo: cor cheia + meio-tom nos cantos + faixa no topo
    base = Image.new('RGB', (W * SS, H * SS), bg); d = ImageDraw.Draw(base, 'RGBA')
    for (ox, oy) in ((W, 0), (0, H)):
        for gy in range(0, 760, 30):
            for gx in range(0, 760, 30):
                x = ox - gx if ox else gx; y = oy + gy if not oy else oy - gy
                r = 11 * (1 - math.hypot(gx, gy) / 760)
                if r > 1.2: d.ellipse(((x - r) * SS, (y - r) * SS, (x + r) * SS, (y + r) * SS), fill=mot + (34,))
    base = base.resize((W, H), Image.LANCZOS)
    ImageDraw.Draw(base).rectangle((0, 0, W, 18), fill=NAVY if claro else YELLOW)
    # foto em moldura branca (cover no box)
    BW, BH = 700, 600; ft = cfg['foto'].convert('RGB'); sc = max(BW / ft.width, BH / ft.height)
    ft = ft.resize((int(ft.width * sc + 0.5), int(ft.height * sc + 0.5)), Image.LANCZOS)
    fy = cfg.get('foto_foco', 0.5); top = int((ft.height - BH) * fy); left = (ft.width - BW) // 2
    ft = ft.crop((left, top, left + BW, top + BH))
    m, b = M_PAD, 12
    fr = Image.new('RGBA', (BW + 2 * b + 2 * m + 14, BH + 2 * b + 2 * m + 18), (0, 0, 0, 0)); dm = ImageDraw.Draw(fr)
    dm.rounded_rectangle((m + 14, m + 18, m + BW + 2 * b + 14, m + BH + 2 * b + 18), 36, fill=(0, 0, 0, 150))
    dm.rounded_rectangle((m, m, m + BW + 2 * b, m + BH + 2 * b), 36, fill=WHITE)
    mk = Image.new('L', ft.size, 0); ImageDraw.Draw(mk).rounded_rectangle((0, 0, BW, BH), 26, fill=255)
    fr.paste(ft, (m + b, m + b), mk)
    # título linha 1: letras soltas (cascata) com sombra dura
    l1, l2 = cfg['titulo']; size = 150
    while text_w(l1, font(900, size), -4) > W - 2 * MARGIN and size > 70: size -= 6
    shadow1 = (0, 0, 0, 80) if claro else NAVY + (190,)
    f1 = font(900, size); x = W / 2 - text_w(l1, f1, -4) / 2; letters = []
    for i, chh in enumerate(l1):
        cw = f1.getlength(chh)
        if chh != ' ': letters.append((text_sprite(chh, size, ink, track=0, shadow=shadow1, off=(7, 9)), x + cw / 2, i))
        x += cw - 4
    l1_full = text_sprite(l1, size, ink, track=-4, shadow=shadow1, off=(7, 9))
    # título linha 2: adesivo (caixa + borda branca) — legível sobre qualquer cor de tipo
    if contrast(NAVY, bg) >= 1.6: bfill, bink = NAVY, YELLOW
    else: bfill, bink = YELLOW, NAVY
    s2 = 118
    while _pill_geom(l2, s2, 900, (36, 22), -3)[4] > W - 2 * MARGIN - 20 and s2 > 60: s2 -= 6
    l2_img = pill(l2, s2, bfill, bink, pad=(36, 22), border=True, track=-3, radius=34, bw=7)
    # linha e botão
    lfill = NAVY if claro else WHITE; lfill, link = fit_fill(lfill)
    linha = pill(cfg['linha'], 40, lfill, link, weight=800, pad=(30, 16))
    btxt = cfg.get('botao', 'ENTRA NO GRUPO: LINK NA BIO')
    btn_fill = YELLOW if contrast(YELLOW, bg) >= 1.8 else NAVY; btn_fill, btn_ink = fit_fill(btn_fill)
    if btn_fill == NAVY: btn_ink = YELLOW
    bs = 52
    while _pill_geom(btxt, bs, 900, (44, 26), -1)[4] > W - 2 * MARGIN - 30 and bs > 30: bs -= 2
    botao = pill(btxt, bs, btn_fill, btn_ink, pad=(44, 26), border=True, bw=6)
    bg_ = _pill_geom(btxt, bs, 900, (44, 26), -1)
    ring = Image.new('RGBA', ((bg_[4] + 2 * M_PAD) * SS, (bg_[5] + 2 * M_PAD) * SS), (0, 0, 0, 0))
    ImageDraw.Draw(ring).rounded_rectangle((M_PAD * SS, M_PAD * SS, (M_PAD + bg_[4]) * SS, (M_PAD + bg_[5]) * SS),
                                           bg_[5] / 2 * SS, outline=WHITE if not claro else NAVY, width=6 * SS)
    lg = cfg.get('logo', _logo())
    if lg is not None:
        lw = 220; lg = lg.resize((lw, int(lg.height * lw / lg.width)), Image.LANCZOS)
    rnd = random.Random(11)
    twinkles = [(x, y, r, rnd.uniform(0, 6.28)) for (x, y, r) in
                ((120, 640, 30), (965, 700, 36), (110, 1250, 24), (980, 1220, 28), (160, 1500, 20), (930, 1420, 22), (880, 300, 18))]
    st = dict(bg=base, bgc=bg, ink=ink, claro=claro, mot=mot, frame=fr, letters=letters, l1_full=l1_full,
              l1_y=440, l2=l2_img, l2_y=588, linha=linha, botao=botao, ring=_down(ring), logo=lg, twinkles=twinkles,
              bolts=[(bolt(mot, 30, 1.25), -170, 760, 0.0), (bolt(mot, 26, 0.9, True), 700, 1180, 1.7),
                     (bolt(mot, 22, 0.55), 790, 120, 3.1)],
              photo_cy=1005, rest_photo=None)
    st['rest_photo'] = _persp(fr, 0.0, -2.0)
    _EC[key] = st
    return st

def _persp(im, k, rot):
    """'Tilt 3D' falso: topo estreito/encurtado (rotateX) + rotação, num único transform de perspectiva."""
    if k <= 1e-3 and abs(rot) < 0.05: return im
    w, h = im.size; th = math.radians(rot); c, s = math.cos(th), math.sin(th)
    src = [(0, 0), (w, 0), (w, h), (0, h)]
    dst0 = [(-w / 2 * (1 - k), -h / 2 * (1 - 0.3 * k)), (w / 2 * (1 - k), -h / 2 * (1 - 0.3 * k)),
            (w / 2 * (1 + 0.05 * k), h / 2), (-w / 2 * (1 + 0.05 * k), h / 2)]
    dst = [(c * x + s * y, -s * x + c * y) for x, y in dst0]
    mnx = min(p[0] for p in dst); mny = min(p[1] for p in dst)
    Wo = int(math.ceil(max(p[0] for p in dst) - mnx)) + 2; Ho = int(math.ceil(max(p[1] for p in dst) - mny)) + 2
    dst = [(x - mnx + 1, y - mny + 1) for x, y in dst]
    A, B = [], []
    for (x, y), (u, v) in zip(dst, src):  # saída -> entrada
        A.append([x, y, 1, 0, 0, 0, -u * x, -u * y]); B.append(u)
        A.append([0, 0, 0, x, y, 1, -v * x, -v * y]); B.append(v)
    co = np.linalg.solve(np.array(A, float), np.array(B, float))
    return im.convert('RGBa').transform((Wo, Ho), Image.PERSPECTIVE, tuple(co), Image.BILINEAR).convert('RGBA')

def _glint(img, p):
    a = np.asarray(img).astype(np.float32); hh, ww = a.shape[:2]
    yy, xx = np.mgrid[0:hh, 0:ww].astype(np.float32)
    u = (xx + 0.6 * yy) / (ww + 0.6 * hh); pos = lerp(-0.15, 1.15, p)
    band = (np.exp(-((u - pos) / 0.05) ** 2) * 0.55 + np.exp(-((u - pos + 0.09) / 0.015) ** 2) * 0.35)
    band *= a[..., 3] / 255.0
    a[..., :3] += (255 - a[..., :3]) * band[..., None]
    return Image.fromarray(np.clip(a, 0, 255).astype(np.uint8), 'RGBA')

def end_card(cfg, t, iris=True):
    """Fechamento opaco em cor cheia do tipo. cfg: foto (PIL), titulo [l1, l2], linha, cor_final (hex);
    opcionais: botao, foto_foco (0..1 vertical do recorte), logo (PIL ou None).
    Anéis tracejados girando, órbita com brilho passando por trás/frente da foto, raios à deriva,
    brilhos piscando; título em cascata letra a letra, adesivo da linha 2, foto sobe com tilt 3D,
    reflexo na foto, linha e botão escalonados, botão pulsando. Abre em íris (alfa fora do círculo)."""
    st = _end_static(cfg); fr = st['bg'].copy(); d = ImageDraw.Draw(fr, 'RGBA'); mot = st['mot']
    pcy = st['photo_cy']
    # --- motivos de fundo
    for (r, n, w, sp, al) in ((415, 28, 6, 14, 70), (488, 40, 3, -9, 56), (560, 20, 8, 5, 40)):
        off = sp * t; step = 360 / n
        for i in range(n):
            a0 = off + i * step; d.arc((540 - r, pcy - r, 540 + r, pcy + r), a0, a0 + step * 0.55, fill=mot + (al,), width=w)
    for (im, bx, by, ph) in st['bolts']:
        _paste(fr, im, bx + 22 * math.sin(0.6 * t + ph), by - 26 * t + 14 * math.sin(0.9 * t + ph))
    ox, oy, orx, ory = 540, pcy + 250, 500, 120
    d.ellipse((ox - orx, oy - ory, ox + orx, oy + ory), outline=mot + (60,), width=4)
    oang = 1.9 * t + 0.4; osx, osy = ox + orx * math.cos(oang), oy + ory * math.sin(oang)
    front = math.sin(oang) > 0
    if not front: put(fr, sparkle(22, YELLOW if not st['claro'] else WHITE), osx, osy)
    for (x, y, r, ph) in st['twinkles']:
        k = 0.45 + 0.55 * (0.5 + 0.5 * math.sin(4.2 * t + ph)) ** 2
        put(fr, sparkle(int(r * k), WHITE), x, y, seg(t, 0.1, 0.4))
    # --- logo
    if st['logo'] is not None:
        put(fr, st['logo'], W / 2, 300, seg(t, 0.05, 0.12), max(0.01, ease_out_back(seg(t, 0.05, 0.4), 2.0)))
    # --- foto
    p = seg(t, 0.38, 1.0)
    if p > 0:
        yo = 640 * (1 - ease_out_back(p, 1.25)); fl = 5 * math.sin(1.7 * t) * seg(t, 1.0, 1.4)
        if p >= 1:
            img = st['rest_photo']
            if 1.05 <= t <= 1.55: img = _glint(img, seg(t, 1.05, 1.55))
        else:
            img = _persp(st['frame'], 0.32 * (1 - ease_out_cubic(p)), -2 - 9 * (1 - ease_out_cubic(p)))
        if p < 0.35: put(fr, img, W / 2, pcy + yo + 70, 0.25)
        put(fr, img, W / 2, pcy + yo + fl, seg(t, 0.38, 0.46))
    if front: put(fr, sparkle(26, YELLOW if not st['claro'] else WHITE), osx, osy)
    # --- título
    n1 = len(st['letters'])
    if t > 0.1 + n1 * 0.035 + 0.45:
        put(fr, st['l1_full'], W / 2, st['l1_y'])
    else:
        for (spr, x, i) in st['letters']:
            lt = t - 0.1 - i * 0.035
            if lt <= 0: continue
            q = seg(lt, 0, 0.4)
            put(fr, spr, x, st['l1_y'] - 150 * (1 - ease_out_back(q, 2.2)), seg(lt, 0, 0.07),
                lerp(1.4, 1.0, ease_out_cubic(q)), None, (18 if i % 2 else -18) * (1 - ease_out_cubic(q)))
    lt = t - (0.1 + n1 * 0.035 + 0.05)
    if lt > 0:
        q = seg(lt, 0, 0.42); s = max(0.01, ease_out_back(q, 2.4))
        x = W / 2 + 320 * (1 - ease_out_expo(q)); rot = lerp(-16, -3, ease_out_cubic(q))
        if q < 0.3: put(fr, st['l2'], x + 80, st['l2_y'], 0.3, s, None, rot)
        put(fr, st['l2'], x, st['l2_y'], seg(lt, 0, 0.05), s, None, rot)
    # --- linha + botão
    lt = t - 0.8
    if lt > 0:
        put(fr, st['linha'], W / 2, 1387, seg(lt, 0, 0.05), max(0.01, ease_out_back(seg(lt, 0, 0.35), 2.2)), None,
            lerp(6, 1.5, ease_out_cubic(seg(lt, 0, 0.35))))
    lt = t - 1.0
    if lt > 0:
        s = ease_out_elastic(seg(lt, 0, 0.7), 0.4); bp = 0.0
        if lt > 0.7:
            ph = ((lt - 0.7) * 1.1) % 1.0
            bp = 0.055 * math.sin(math.pi * ph / 0.22) if ph < 0.22 else 0.0
            if ph < 0.65: put(fr, st['ring'], W / 2, 1512, 0.85 * (1 - ph / 0.65) ** 1.4, 1 + 0.12 * ease_out_cubic(ph / 0.65),
                              1 + 0.55 * ease_out_cubic(ph / 0.65))
        put(fr, st['botao'], W / 2, 1512, seg(lt, 0, 0.05), max(0.01, s) * (1 + bp))
    out = fr.convert('RGBA')
    if iris and t < 0.3:
        u = ease_out_expo(seg(t, 0, 0.3)); rr = 1150 * u
        mk = Image.new('L', (W, H), 0); dm = ImageDraw.Draw(mk)
        dm.ellipse((540 - rr, 960 - rr, 540 + rr, 960 + rr), fill=255)
        out.putalpha(mk)
        if rr > 4:
            ring = ImageDraw.Draw(out); th = int(lerp(26, 6, u))
            ring.ellipse((540 - rr, 960 - rr, 540 + rr, 960 + rr), outline=WHITE + (255,), width=th)
    return out


# ============================================================ 6. EXTRAS
def transition_whip(t, dur=0.36, colors=None, angle=28, seed=5, canvas=None):
    """Wipe diagonal em 3 faixas (padrão navy/amarelo/vermelho) com riscos de velocidade. Entra acelerando,
    cobre a tela inteira exatamente em t = dur/2 (faça o corte aí) e sai desacelerando."""
    c, _ = _canvas(canvas)
    if t < 0 or t > dur: return c
    cols = [rgb(x) for x in (colors or (NAVY, YELLOW, RED))]
    a = math.radians(angle); dx, dy = math.cos(a), -math.sin(a); px, py = math.sin(a), math.cos(a)
    us = [x * dx + y * dy for x in (0, W) for y in (0, H)]; u0, u1 = min(us) - 40, max(us) + 40
    sstag = dur * 0.07; Tf = dur / 2 - 2 * sstag; d = ImageDraw.Draw(c); rnd = random.Random(seed)
    for i, col in enumerate(cols[:3]):
        f = lerp(u0, u1, ease_in_cubic(seg(t, i * sstag, i * sstag + Tf)))
        tb = dur / 2 + (2 - i) * sstag
        b = lerp(u0, u1, ease_out_cubic(seg(t, tb, tb + Tf)))
        if f - b < 1: continue
        L = 4000
        quad = [(f * dx + L * px, f * dy + L * py), (f * dx - L * px, f * dy - L * py),
                (b * dx - L * px, b * dy - L * py), (b * dx + L * px, b * dy + L * py)]
        d.polygon(quad, fill=col + (255,))
        lc = mix(col, WHITE, 0.45) + (255,)
        for j in range(7):  # riscos de velocidade perto da borda que avança
            off = rnd.uniform(-1300, 1300); ln = rnd.uniform(140, 420); th = rnd.randint(4, 10)
            ua, ub = max(b, f - ln - rnd.uniform(0, 200)), f - rnd.uniform(10, 60)
            if ub <= ua: continue
            d.line(((ua * dx + off * px, ua * dy + off * py), (ub * dx + off * px, ub * dy + off * py)), fill=lc, width=th)
    return c

@lru_cache(maxsize=8)
def _counter_static(n, label):
    f_lab = font(800, 40 * SS); f_num = font(900, 54 * SS)
    num_w = max(text_w(f'{k}/{n}', f_num, -SS) for k in range(1, n + 1))
    lab_w = text_w(label + ' ', f_lab, 0)
    t0, b0 = _cap(f_num); padx, pady = 30, 18
    w = int((lab_w + num_w) / SS + 2 * padx); h = int((b0 - t0) / SS + 2 * pady)
    m = M_PAD; im = Image.new('RGBA', ((w + 2 * m) * SS, (h + 2 * m) * SS), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    d.rounded_rectangle(((m + 6) * SS, (m + 8) * SS, (m + w + 6) * SS, (m + h + 8) * SS), h / 2 * SS, fill=SHADOW)
    d.rounded_rectangle((m * SS, m * SS, (m + w) * SS, (m + h) * SS), h / 2 * SS, fill=NAVY, outline=WHITE, width=5 * SS)
    tl, bl = _cap(f_lab)
    _draw_text(d, (m + padx) * SS, (m + h / 2) * SS - (tl + bl) / 2, label, f_lab, WHITE)
    return dict(bg=_down(im), w=w, h=h, num_x=m + padx + lab_w / SS, num_w=num_w / SS)

def counter_badge(i, n, t, x=MARGIN, y=SAFE_TOP + 12, label='PACK', canvas=None):
    """Selo 'PACK i/n' (canto sup. esquerdo). t = segundos desde que o pack i começou: o número novo cai
    com overshoot, o antigo sai por baixo, e o selo dá um pulo elástico."""
    c, _ = _canvas(canvas)
    st = _counter_static(n, label); im = st['bg'].copy(); m = M_PAD
    u = seg(t, 0, 0.28)
    for k, dy, al in ((i, -44 * (1 - ease_out_back(u, 2.2)), seg(t, 0, 0.08)), (i - 1, 44 * ease_in_cubic(u), 1 - u)):
        if k < 1 or al <= 0.01: continue
        spr = text_sprite(f'{k}/{n}', 54, YELLOW, track=-1, off=(0, 0))
        spr = _fade(spr, al) if al < 0.99 else spr
        layer = Image.new('RGBA', im.size, (0, 0, 0, 0))
        _paste(layer, spr, st['num_x'] - 14, m + st['h'] / 2 - spr.height / 2 + dy)
        clip = Image.new('L', im.size, 0)  # recorta dentro da pílula
        ImageDraw.Draw(clip).rounded_rectangle((m + 5, m + 5, m + st['w'] - 5, m + st['h'] - 5), st['h'] / 2, fill=255)
        layer.putalpha(ImageChops.multiply(layer.getchannel('A'), clip))
        im.alpha_composite(layer)
    s = 0.8 + 0.2 * ease_out_elastic(seg(t, 0, 0.6), 0.35) if t >= 0 else 1.0
    put(c, im, x + im.width / 2 - m, y + im.height / 2 - m, 1.0, s, None, 3 * damp(t, 3, 6))
    return c
