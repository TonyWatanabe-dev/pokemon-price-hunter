#!/usr/bin/env python3
"""Temporário: anúncio comparativo (voz do Tony + brutos + preços em motion). Saída tmp-render/COMP_anuncio.mp4"""
import json, math, os, shutil, subprocess, urllib.request, wave
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

A = 'tools/tmp-cartas/'; OUT = 'tmp-render'; os.makedirs(OUT, exist_ok=True)
W, H, FPS = 1080, 1920, 30
NAVY = (14, 19, 48); Y = (255, 207, 51); RED = (235, 64, 52); GREEN = (60, 200, 110); WHITE = (255, 255, 255); MUTED = (195, 204, 235)
F = {w: (lambda s, w=w: ImageFont.truetype(f'{A}rubik{w}.ttf', s)) for w in (500, 700, 800, 900)}
IDS = {'C1': '16o4fLi1rOoAwxA7XEUw10nFQWKpBySvt', 'C2': '1dCaDIJuY4xmxehOrxg49xNbjSonPmIUr', 'poster': '1ZLvLNMJE7gkbGAjM9au38B2pw8a4sJRl',
       'blister': '1twqA6SqDJtes42GemVuGTSjNU_-67omF', 'desafio': '1EPxLYY7N5duttTyN2tOhVfYZRQl8F1TD', 'alertas': '1gasvW_1k--cPMbVgzFdSVGIjeDw5XPhD'}
REL = json.load(open('tmp-comp/relatorio.json')) if os.path.exists('tmp-comp/relatorio.json') else {}
FALA = json.load(open(A + 'comp_fala.json'))  # palavras com tempo de C1 e C2

def baixa(n):
    arq = f'/tmp/{n}.mp4'
    if not os.path.exists(arq):
        req = urllib.request.Request(f'https://drive.usercontent.google.com/download?id={IDS[n]}&export=download&confirm=t', headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=900) as r, open(arq, 'wb') as f: shutil.copyfileobj(r, f, 1 << 22)
    return arq

def quadros(n, ini, dur, zoom=1.0):
    """Frames RGB 1080x1920 do trecho; zoom>1 corta o topo (esconde selos antigos)."""
    zh = int(H * zoom); zw = int(W * zoom)
    vf = f'scale={zw}:{zh}:force_original_aspect_ratio=increase,crop={W}:{H}:(iw-{W})/2:ih-{H},fps={FPS}'
    p = subprocess.run(['ffmpeg', '-v', 'error', '-ss', str(ini), '-i', baixa(n), '-t', str(dur), '-vf', vf, '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-'], capture_output=True, check=True)
    fr = np.frombuffer(p.stdout, np.uint8).reshape(-1, H, W, 3)
    k = int(round(dur * FPS))
    if len(fr) < k: fr = np.concatenate([fr, np.repeat(fr[-1:], k - len(fr), 0)])
    return fr[:k]

def voz(n, ini, fim):
    wav = f'/tmp/{n}_v.wav'
    if not os.path.exists(wav): subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', baixa(n), '-ac', '1', '-ar', '44100', wav], check=True)
    with wave.open(wav) as w:
        w.setpos(int(ini * 44100)); a = np.frombuffer(w.readframes(int((fim - ini) * 44100)), np.int16).astype(np.float32) / 32768
    f = np.minimum(1, np.minimum(np.arange(len(a)), np.arange(len(a))[::-1]) / 600)
    return a * f

# ---------- texto
def texto(linhas, fonte, track=0, lh=None, borda=0):
    asc, desc = fonte.getmetrics(); lh = lh or asc + desc
    larg = [max(1, int(sum(fonte.getlength(c) + track for t, _ in ln for c in t) - track)) for ln in linhas]
    im = Image.new('RGBA', (max(larg) + 20 + 2 * borda, lh * len(linhas) + desc + 2 * borda), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    for i, ln in enumerate(linhas):
        x = 10 + borda + (max(larg) - larg[i]) / 2
        for t, c in ln:
            for ch in t:
                d.text((x, borda + i * lh), ch, font=fonte, fill=c, stroke_width=borda, stroke_fill=(0, 0, 0)); x += fonte.getlength(ch) + track
    return im
def pilula(txt, fonte, bg, fg, padx=40, pady=24):
    t = texto([[(txt, fg)]], fonte); w, h = t.width + 2 * padx, fonte.size + 2 * pady
    im = Image.new('RGBA', (w, h), (0, 0, 0, 0)); ImageDraw.Draw(im).rounded_rectangle((0, 0, w - 1, h - 1), h // 2, fill=bg)
    im.alpha_composite(t, (padx - 10, pady - int(fonte.size * .12))); return im
def alpha(im, a):
    if a >= 1: return im
    im = im.copy(); im.putalpha(im.split()[3].point(lambda v: int(v * a))); return im
def cola(fr, im, xy, a=1.0, s=1.0, rot=0):
    if a <= .01 or s <= .01: return
    if s != 1: im = im.resize((max(1, int(im.width * s)), max(1, int(im.height * s))), Image.BILINEAR)
    if rot: im = im.rotate(rot, Image.BICUBIC, expand=True)
    im = alpha(im, a); fr.alpha_composite(im, (int(xy[0] - im.width / 2), int(xy[1] - im.height / 2)))
ease = lambda x: 1 - (1 - min(max(x, 0), 1)) ** 3
def back(x):
    x = min(max(x, 0), 1); c = 1.7; return 1 + (c + 1) * (x - 1) ** 3 + c * (x - 1) ** 2
brl = lambda v: 'R$ ' + f'{v:,.2f}'.replace(',', 'X').replace('.', ',').replace('X', '.')
LOGO = Image.open(A + 'logo.png').convert('RGBA'); LOGO = LOGO.resize((170, round(LOGO.height * 170 / LOGO.width)), Image.LANCZOS)

def preco_card(rotulo, valor, cor, icone):
    t1 = texto([[(rotulo.upper(), WHITE)]], F[800](30), track=2)
    t2 = texto([[(brl(valor), WHITE)]], F[900](118), track=-3)
    w = max(t1.width, t2.width) + 150; h = 250
    im = Image.new('RGBA', (w, h), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    d.rounded_rectangle((0, 0, w - 1, h - 1), 44, fill=cor + (245,))
    im.alpha_composite(t1, ((w - t1.width) // 2, 26)); im.alpha_composite(t2, ((w - t2.width) // 2, 70))
    # ícone (X ou check) no canto
    s = 96; ic = Image.new('RGBA', (s, s), (0, 0, 0, 0)); di = ImageDraw.Draw(ic)
    di.ellipse((0, 0, s - 1, s - 1), fill=WHITE)
    if icone == 'x': di.line((28, 28, 68, 68), fill=cor, width=14); di.line((68, 28, 28, 68), fill=cor, width=14)
    else: di.line((24, 50, 42, 68), fill=cor, width=14); di.line((40, 68, 74, 30), fill=cor, width=14)
    out = Image.new('RGBA', (w + 50, h + 50), (0, 0, 0, 0)); out.alpha_composite(im, (0, 50)); out.alpha_composite(ic, (w + 50 - s, 0))
    return out

# ---------- legenda palavra a palavra (blocos de até 3 palavras; palavra falada em amarelo)
CHAVE = {'loja', 'cobrando', 'grupo', 'diferença', 'compara', 'brasil', 'baixa', 'hora', 'caro', 'link', 'graça', 'grupo.', 'graça.'}
def legenda(fr, palavras, t):
    blocos, cur = [], []
    for p in palavras:
        cur.append(p)
        if len(cur) == 3 or p[2].strip()[-1:] in '.,?': blocos.append(cur); cur = []
    if cur: blocos.append(cur)
    for i, b in enumerate(blocos):
        ini = b[0][0]; fim = blocos[i + 1][0][0] if i + 1 < len(blocos) else b[-1][1] + .3
        if ini - .05 <= t < fim:
            ln = []
            for (a, z, w) in b:
                pal = w.strip().upper()
                cor = Y if (a <= t < z + .05) else (Y if pal.lower().strip('.,?') in CHAVE else WHITE)
                ln.append((pal + ' ', cor))
            im = texto([ln], F[900](78), track=-1, borda=7)
            cola(fr, im, (540, 520), 1, .9 + .1 * ease((t - ini) / .12))
            return

# ---------- linha do tempo
P = FALA['precos']
SEG = []  # (fonte_voz, ini, fim, video, vini, zoom, tipo)
def seg(vf, vi, vfim, video, vini, zoom=1.0, tipo=None, info=None): SEG.append(dict(vf=vf, vi=vi, vfim=vfim, video=video, vini=vini, zoom=zoom, tipo=tipo, info=info))
seg('C2', 3.30, 7.00, 'C2', 3.30, 1.0, 'caro', P['etb'])
seg('C2', 8.90, 12.00, 'C2', 8.90, 1.0, 'barato', P['etb'])
seg('C2', 13.05, 14.60, 'C2', 13.05, 1.0, 'dif', P['etb'])
seg('C1', 0.70, 4.30, 'poster', 2.30, 1.14, 'caro', P['poster'])
seg('C1', 4.30, 7.40, 'poster', 6.00, 1.14, 'barato', P['poster'])
seg('C1', 7.40, 9.70, 'poster', 9.10, 1.14, 'dif', P['poster'])
seg('C2', 15.75, 19.25, 'blister', 3.00, 1.14, 'broll')
seg('C2', 19.25, 23.55, 'alertas', 3.60, 1.0, 'broll')
seg('C2', 24.30, 30.30, None, 0, 1.0, 'final')

def palavras_de(s):
    ws = [w for w in FALA[s['vf']] if s['vi'] - .05 <= w[0] < s['vfim']]
    return [[w[0] - s['vi'], w[1] - s['vi'], w[2]] for w in ws]

def fundo_final(t):
    fr = Image.new('RGBA', (W, H), NAVY + (255,)); d = ImageDraw.Draw(fr); d.rectangle((0, 0, W, 17), fill=Y)
    return fr
F1 = texto([[('Não rasgue', WHITE)], [('dinheiro.', Y)]], F[900](150), track=-5, lh=150)
F2 = texto([[('O grupo avisa quando o preço cai.', MUTED)]], F[700](44))
CTA = pilula('Entra no grupo · tcgpricehunter.com.br', F[800](38), Y, (43, 34, 0), 46, 30)
GRATIS = pilula('Grátis', F[900](40), GREEN, WHITE, 36, 20)

eventos = []  # (tempo, som)
video_out = subprocess.Popen(['ffmpeg', '-v', 'error', '-y', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-s', f'{W}x{H}', '-r', str(FPS), '-i', '-',
                              '-c:v', 'libx264', '-crf', '21', '-maxrate', '6M', '-bufsize', '12M', '-pix_fmt', 'yuv420p', '/tmp/comp_v.mp4'], stdin=subprocess.PIPE)
audio_voz = []; T = 0.0
for s in SEG:
    dur = s['vfim'] - s['vi']; n = int(round(dur * FPS)); pal = palavras_de(s)
    audio_voz.append(voz(s['vf'], s['vi'], s['vfim']))
    frs = quadros(s['video'], s['vini'], dur, s['zoom']) if s['video'] else None
    info = s['info']
    if s['tipo'] == 'caro': eventos.append((T + min(1.4, dur - .8), 'erro'))
    if s['tipo'] == 'barato': eventos.append((T + 1.0, 'ching'))
    if s['tipo'] in ('dif',): eventos.append((T + .2, 'pop'))
    if s['tipo'] == 'final': eventos.append((T, 'whoosh'))
    for i in range(n):
        t = i / FPS
        if frs is not None:
            fr = Image.fromarray(frs[i]).convert('RGBA')
            z = 1 + .04 * t / dur  # leve zoom contínuo
            if z > 1: fr = fr.resize((int(W * z), int(H * z)), Image.BILINEAR).crop((int(W * (z - 1) / 2), int(H * (z - 1) / 2), int(W * (z - 1) / 2) + W, int(H * (z - 1) / 2) + H))
            # vinheta suave em cima/baixo para leitura
            sh = Image.new('RGBA', (W, H), (0, 0, 0, 0)); ds = ImageDraw.Draw(sh)
            for y in range(0, 700, 10): ds.rectangle((0, y, W, y + 10), fill=(0, 0, 0, int(120 * (1 - y / 700))))
            fr.alpha_composite(sh)
            fr.alpha_composite(LOGO, (W - 60 - LOGO.width, 90))
        else:
            fr = fundo_final(t)
        tp = s['tipo']
        if tp == 'caro':
            t0 = min(1.4, dur - .8); e = back((t - t0) / .45)
            if t >= t0:
                lt = t - t0; sh = 16 * math.exp(-lt * 8) * math.sin(lt * 70)
                if lt < .1: fr.alpha_composite(Image.new('RGBA', (W, H), RED + (90,)))
                cola(fr, preco_card(info['rot_caro'], info['caro'], RED, 'x'), (540 + sh, 1380), min(1, ease(lt / .15)), max(.01, e))
        elif tp == 'barato':
            t0 = 1.0; e = back((t - t0) / .45)
            cola(fr, preco_card(info['rot_caro'], info['caro'], (120, 30, 30), 'x'), (540, 1380), 1 - ease((t - .2) / .4), .7)
            if t >= t0: cola(fr, preco_card(info['rot_barato'], info['barato'], (30, 150, 80), 'v'), (540, 1380), min(1, ease((t - t0) / .15)), max(.01, e))
        elif tp == 'dif':
            sel = pilula(f"{brl(info['caro'] - info['barato'])} a menos", F[900](74), Y, (43, 34, 0), 50, 34)
            cola(fr, sel, (540, 1380), min(1, ease(t / .15)), max(.01, back(t / .45)) * (1 + .03 * math.sin(max(0, t - .5) * 6)), -3)
        elif tp == 'final':
            e, dy = ease(t / .4), (1 - ease(t / .4)) * 60; cola(fr, F1, (540, 470 + dy + F1.height / 2), e)
            e, dy = ease((t - .3) / .4), (1 - ease((t - .3) / .4)) * 60; cola(fr, F2, (540, 830 + dy), e)
            e = back((t - 1.6) / .6); cola(fr, CTA, (540, 1000), min(1, ease((t - 1.6) / .3)), max(.01, e) * (1 + .03 * math.sin(max(0, t - 2.2) * 5)))
            e = back((t - 3.0) / .5); cola(fr, GRATIS, (540, 1150), min(1, ease((t - 3.0) / .2)), max(.01, e), -4)
            cola(fr, LOGO, (540, 1500), ease((t - .6) / .5), 1.6)
        if tp != 'final': legenda(fr, pal, t)
        video_out.stdin.write(fr.convert('RGB').tobytes())
    T += dur
video_out.stdin.close(); video_out.wait()

# ---------- áudio: voz + trilha baixa + efeitos
sr = 44100; vz = np.concatenate(audio_voz); vz = vz / (np.abs(vz).max() + 1e-6) * .9
n = len(vz); tt = np.arange(n) / sr; out = vz.copy(); rng = np.random.default_rng(5)
def at(t0, sig, g=1.0):
    i = int(t0 * sr); j = min(n, i + len(sig)); out[i:j] += g * sig[:j - i]
b = 60 / 118; kt = np.arange(int(.3 * sr)) / sr; kick = np.sin(2 * np.pi * (50 + 80 * np.exp(-kt * 30)) * kt) * np.exp(-kt * 10)
ht = np.arange(int(.05 * sr)) / sr; hat = np.diff(rng.standard_normal(len(ht)) * np.exp(-ht * 80), prepend=0)
for k in range(int(T / b)):
    at(k * b, kick, .16); at(k * b + b / 2, hat, .03)
for t0, som in eventos:
    if som == 'erro':
        o = 0
        for f0, d0 in [(233, .2), (220, .2), (196, .5)]:
            L = int(d0 * sr); x = np.arange(L) / sr
            at(t0 + o, np.sign(np.sin(2 * np.pi * f0 * x)) * .16 * np.minimum(1, (d0 - x) / .04)); o += d0
    if som == 'ching':
        L = int(.9 * sr); x = np.arange(L) / sr
        at(t0, sum(np.sin(2 * np.pi * f * x) * np.exp(-x * d) for f, d in [(2093, 4), (2637, 5), (3136, 6), (4186, 7)]) * .1)
    if som in ('pop', 'whoosh'):
        L = int(.35 * sr); x = np.arange(L) / sr
        at(t0, np.convolve(rng.standard_normal(L) * np.sin(np.pi * x / .35) ** 2, np.ones(8) / 8, 'same') * .12)
out = np.tanh(out * 1.1) * .95
with wave.open('/tmp/comp_a.wav', 'wb') as w:
    w.setnchannels(1); w.setsampwidth(2); w.setframerate(sr); w.writeframes((out * 32767).astype(np.int16).tobytes())
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', '/tmp/comp_v.mp4', '-i', '/tmp/comp_a.wav', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-shortest', '-movflags', '+faststart', f'{OUT}/COMP_anuncio.mp4'], check=True)
for s in (1.5, 4.5, 6.0, 12.0, 20.0, T - 2):
    subprocess.run(['ffmpeg', '-v', 'quiet', '-y', '-ss', str(s), '-i', f'{OUT}/COMP_anuncio.mp4', '-frames:v', '1', '-vf', 'scale=360:-2', f'{OUT}/COMP_q{s:05.1f}.jpg'])
print('ok', T)
