#!/usr/bin/env python3
"""Temporário: edita brutos de abertura (unboxing natural) no estilo Social do design system.

Áudio original realçado (ASMR do pack + fala), trilha leve por baixo, legenda palavra a palavra só quando há fala,
gancho no topo, pílula de preço, ficha do hit na cor do tipo e fechamento em cor cheia com a foto dos hits.
Uso: PECAS=combo30,hit_pikachu python3 tools/tmp-cartas/unbox.py  (configs em unbox.json)."""
import json, os, subprocess, shutil, urllib.request, sys, math, random
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from render import F, W, H, ease, camada
from PIL import Image, ImageDraw, ImageFilter

AQUI = os.path.dirname(os.path.abspath(__file__))
OUT = 'tmp-render'; os.makedirs(OUT, exist_ok=True)
IDS = json.load(open(os.path.join(AQUI, 'ids.json')))
CFG = json.load(open(os.path.join(AQUI, 'unbox.json')))
FALA = json.load(open('tmp-dragonite/relatorio.json'))
TRILHA = json.load(open(os.path.join(AQUI, 'comp_fala.json')))['trilha']
T = '/tmp/ub'; os.makedirs(T, exist_ok=True)
FPS = 30
NAVY, BRANCO, Y = (19, 31, 73), (255, 255, 255), (255, 207, 51)
lum = lambda c: (0.2126*c[0]+0.7152*c[1]+0.0722*c[2])/255
hexc = lambda h: tuple(int(h.lstrip('#')[i:i + 2], 16) for i in (0, 2, 4))

def baixa(nome):
    arq = f'{T}/{nome}.mp4'
    if os.path.exists(arq) and os.path.getsize(arq) > 1e6: return arq
    for tent in range(4):
        try:
            req = urllib.request.Request(f'https://drive.usercontent.google.com/download?id={IDS[nome]}&export=download&confirm=t', headers={'User-Agent': 'Mozilla/5.0'})
            with urllib.request.urlopen(req, timeout=60) as r, open(arq + '.part', 'wb') as f: shutil.copyfileobj(r, f, 1 << 22)
            os.replace(arq + '.part', arq); return arq
        except Exception as e:
            print('baixa', nome, tent, repr(e), flush=True)
    raise RuntimeError('não baixou ' + nome)

def trilha():
    arq = f'{T}/trilha.wav'
    if not os.path.exists(arq):
        with urllib.request.urlopen(urllib.request.Request(TRILHA, headers={'User-Agent': 'Mozilla/5.0'}), timeout=300) as r, open(arq, 'wb') as f: shutil.copyfileobj(r, f)
    return arq

def foto(nome):
    p = f'tmp-dragonite/fotos/{nome}.jpg'
    return Image.open(p).convert('RGB')

# ---------- elementos gráficos ----------
def brilho4(r, cor=BRANCO):
    """Estrela de 4 pontas (brilho holo ✦), desenhada como polígono."""
    s = int(r * 2 + 4); im = camada(s, s); d = ImageDraw.Draw(im); c = s / 2; k = r * 0.22
    d.polygon([(c, c - r), (c + k, c - k), (c + r, c), (c + k, c + k), (c, c + r), (c - k, c + k), (c - r, c), (c - k, c - k)], fill=cor)
    return im

def pilula(txt, f, fundo, tinta, pad=(34, 16), borda=None):
    d0 = ImageDraw.Draw(Image.new('RGBA', (1, 1))); bb = d0.textbbox((0, 0), txt, font=f)
    w, h = int(bb[2] - bb[0] + 2 * pad[0]), int(bb[3] - bb[1] + 2 * pad[1])
    im = camada(w + 12, h + 12); d = ImageDraw.Draw(im)
    d.rounded_rectangle((8, 10, w + 8, h + 10), h // 2, fill=(0, 0, 0, 120))  # sombra dura
    d.rounded_rectangle((0, 0, w, h), h // 2, fill=fundo, outline=borda, width=5 if borda else 0)
    d.text((pad[0] - bb[0], pad[1] - bb[1]), txt, font=f, fill=tinta)
    return im

def cola(fr, im, cx, cy, a=1.0, s=1.0, rot=0):
    if a <= 0.01 or s <= 0.01: return
    if s != 1: im = im.resize((max(1, int(im.width * s)), max(1, int(im.height * s))), Image.LANCZOS)
    if rot: im = im.rotate(rot, resample=Image.BICUBIC, expand=True)
    if a < 1: im = im.copy(); im.putalpha(im.getchannel('A').point(lambda x: int(x * a)))
    fr.alpha_composite(im, (int(cx - im.width / 2), int(cy - im.height / 2)))

def back(x):
    x = max(0.0, min(1.0, x)); c1 = 1.70158; c3 = c1 + 1
    return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2

def gancho_img(linhas, cor):
    f = F(900, 66); pads = []
    for i, l in enumerate(linhas):
        pads.append(pilula(l, f, BRANCO if i == 0 else cor, NAVY if i == 0 else (NAVY if lum(cor) > 0.5 else BRANCO)))
    w = max(p.width for p in pads); h = sum(p.height - 10 for p in pads)
    im = camada(w, h); y = 0
    for p in pads: im.alpha_composite(p, ((w - p.width) // 2, y)); y += p.height - 10
    return im

def preco_img(pago, outras):
    f1, f2 = F(900, 54), F(800, 40)
    a = pilula(f'PAGUEI R$ {pago:,.0f}'.replace(',', '.'), f1, Y, NAVY)
    b = pilula(f'OUTRAS LOJAS R$ {outras:,.0f}'.replace(',', '.'), f2, BRANCO, (201, 61, 37))
    # risco no valor das outras lojas
    d = ImageDraw.Draw(b); d.line((34, b.height / 2 - 6, b.width - 46, b.height / 2 - 6), fill=(201, 61, 37), width=5)
    im = camada(max(a.width, b.width), a.height + b.height - 4)
    im.alpha_composite(a, ((im.width - a.width) // 2, 0)); im.alpha_composite(b, ((im.width - b.width) // 2, a.height - 4))
    return im

def ficha_img(nome, tipo, cor):
    cor = hexc(cor); claro = lum(cor) > 0.5
    tinta = NAVY if claro else BRANCO
    f1, f2 = F(900, 84), F(800, 34)
    d0 = ImageDraw.Draw(Image.new('RGBA', (1, 1)))
    w = int(max(d0.textlength(nome, font=f1), d0.textlength(tipo, font=f2)) + 120); h = 210
    im = camada(w + 16, h + 16); d = ImageDraw.Draw(im)
    d.rounded_rectangle((12, 14, w + 12, h + 14), 36, fill=(0, 0, 0, 140))
    d.rounded_rectangle((0, 0, w, h), 36, fill=cor, outline=BRANCO, width=8)
    d.text(((w - d.textlength(tipo, font=f2)) / 2, 30), tipo, font=f2, fill=tinta)
    d.text(((w - d.textlength(nome, font=f1)) / 2, 76), nome, font=f1, fill=tinta)
    return im

def raio_img(cor, a=40, esc=1.0):
    im = camada(int(520 * esc), int(900 * esc)); d = ImageDraw.Draw(im)
    pts = [(300, 0), (90, 470), (250, 470), (140, 900), (470, 330), (300, 330), (430, 0)]
    d.polygon([(x * esc, y * esc) for x, y in pts], fill=cor + (a,))
    return im

LOGO = Image.open(os.path.join(AQUI, 'logo.png')).convert('RGBA')

def gif_quadros():
    """GIF de reação (arquivo enviado pelo Tony) como figurinha: ampliado, borda branca, cantos redondos."""
    g = Image.open(os.path.join(AQUI, 'midia', 'pikachu_triste.gif')); out = []
    try:
        while True:
            q = g.convert('RGB').resize((528, 396), Image.LANCZOS)
            fig = camada(528 + 28, 396 + 32); d = ImageDraw.Draw(fig)
            d.rounded_rectangle((10, 14, 528 + 26, 396 + 30), 30, fill=(0, 0, 0, 140))
            d.rounded_rectangle((0, 0, 528 + 16, 396 + 16), 30, fill=BRANCO)
            mk = Image.new('L', q.size, 0); ImageDraw.Draw(mk).rounded_rectangle((0, 0, 528, 396), 22, fill=255)
            fig.paste(q, (8, 8), mk); out.append(fig); g.seek(g.tell() + 1)
    except EOFError: pass
    return out

def fundo_final(cfg):
    cor = hexc(cfg['cor_final']); claro = lum(cor) > 0.5
    bg = Image.new('RGBA', (W, H), cor + (255,)); d = ImageDraw.Draw(bg)
    # estampa: raios grandes saindo da borda + anéis
    mot = NAVY if claro else BRANCO
    bg.alpha_composite(raio_img(mot, 28, 1.5), (-180, 120)); bg.alpha_composite(raio_img(mot, 22, 1.2).transpose(Image.FLIP_LEFT_RIGHT), (W - 460, 980))
    for r in (300, 380, 460):
        d.ellipse((W / 2 - r, 1010 - r, W / 2 + r, 1010 + r), outline=mot + (40,), width=4)
    d.rectangle((0, 0, W, 18), fill=NAVY if claro else Y)
    return bg, claro

def camadas_final(cfg):
    """Peças do fechamento (fundo, foto, títulos, botão), cada uma com tempo de entrada."""
    bg, claro = fundo_final(cfg)
    tinta = NAVY if claro else BRANCO; dest = (201, 61, 37) if claro else Y
    ft = foto(cfg['foto']); fw = 760; ft = ft.resize((fw, int(ft.height * fw / ft.width)))
    if ft.height > 760: top = (ft.height - 760) // 2; ft = ft.crop((0, top, fw, top + 760))
    moldura = camada(fw + 40, ft.height + 40); dm = ImageDraw.Draw(moldura)
    dm.rounded_rectangle((14, 18, fw + 34, ft.height + 38), 34, fill=(0, 0, 0, 150))
    dm.rounded_rectangle((0, 0, fw + 20, ft.height + 20), 34, fill=BRANCO)
    mk = Image.new('L', ft.size, 0); ImageDraw.Draw(mk).rounded_rectangle((0, 0, fw, ft.height), 26, fill=255)
    moldura.paste(ft, (10, 10), mk)
    tit = camada(W, 360); dt = ImageDraw.Draw(tit); f = F(900, 150)
    l1, l2 = cfg['titulo']
    dt.text(((W - dt.textlength(l1, font=f)) / 2 + 8, 8), l1, font=f, fill=(0, 0, 0, 90)); dt.text(((W - dt.textlength(l1, font=f)) / 2, 0), l1, font=f, fill=tinta)
    dt.text(((W - dt.textlength(l2, font=f)) / 2 + 8, 168), l2, font=f, fill=(0, 0, 0, 90)); dt.text(((W - dt.textlength(l2, font=f)) / 2, 160), l2, font=f, fill=dest)
    linha = pilula(cfg['linha'], F(800, 40), NAVY if claro else BRANCO, BRANCO if claro else NAVY, pad=(30, 14))
    botao = pilula('ENTRA NO GRUPO: LINK NA BIO', F(900, 52), NAVY if claro else Y, Y if claro else NAVY, pad=(44, 24))
    lg = LOGO.copy(); lw = 230; lg = lg.resize((lw, int(lg.height * lw / lg.width)), Image.LANCZOS)
    return bg, [(lg, W - 72 - lw / 2, 90, 0.0), (tit, W / 2, 400, 0.12), (moldura, W / 2, 1010, 0.3), (linha, W / 2, 1460, 0.55), (botao, W / 2, 1580, 0.75)]

def desenha_final(bg, pecas, t, brilhos):
    fr = bg.copy()
    for im, cx, cy, t0 in pecas:
        lt = t - t0
        if lt <= 0: continue
        s = back(lt / 0.45); cola(fr, im, cx, cy + (1 - ease(min(lt / 0.35, 1))) * 50, min(1, lt / 0.2), max(0.01, 0.85 + 0.15 * s) if im.width < W else 1.0)
    for (x, y, r, fase) in brilhos:
        k = 0.6 + 0.4 * math.sin(t * 5 + fase); cola(fr, brilho4(r * k), x, y, min(1, t / 0.4))
    return fr


def brl2(v, sinal=True):
    s = f'{abs(v):,.2f}'.replace(',', 'X').replace('.', ',').replace('X', '.')
    return (('+' if v > 0 else '-') if sinal and abs(v) >= 0.005 else '') + 'R$ ' + s

def placar_img(v, flash=0.0):
    f = F(900, 58); txt = brl2(v)
    d0 = ImageDraw.Draw(Image.new('RGBA', (1, 1))); tw = d0.textlength(txt, font=f)
    w, h = int(tw + 70), 104
    im = camada(w + 14, h + 14); d = ImageDraw.Draw(im)
    d.rounded_rectangle((10, 12, w + 10, h + 12), 30, fill=(0, 0, 0, 150))
    d.rounded_rectangle((0, 0, w, h), 30, fill=NAVY, outline=Y, width=6)
    cor = (60, 220, 88) if v > 0 else (255, 92, 80)
    if flash > 0: cor = tuple(int(c + (255 - c) * flash) for c in cor)
    d.text((35, 18), txt, font=f, fill=cor)
    return im

def valor_img(v):
    f1, f2 = F(800, 30), F(900, 70)
    a = pilula('VALOR NA LIGA', f1, BRANCO, NAVY, pad=(24, 10))
    b = pilula(brl2(v), f2, (11, 113, 72), BRANCO, pad=(36, 14))
    im = camada(max(a.width, b.width), a.height + b.height - 8)
    im.alpha_composite(b, ((im.width - b.width) // 2, a.height - 18)); im.alpha_composite(a, ((im.width - a.width) // 2, 0))
    return im

# ---------- montagem ----------
def processa(nome, cfg):
    edl = cfg['edl']
    clipes, inicio, t = [], [], 0.0
    for i, (src, a, b, v) in enumerate(edl):
        arq = baixa(src); c = f'{T}/{nome}_c{i:02d}.mp4'
        af = (f'atempo={min(v, 2.0)},' + (f'atempo={v / 2.0},' if v > 2 else '')) if v != 1 else ''
        if v > 1.6: af += 'volume=0.35,'
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', str(a), '-to', str(b), '-i', arq,
                        '-vf', f'scale=1080:1920:flags=lanczos,setsar=1,fps={FPS},setpts=PTS/{v}', '-af', f'{af}aresample=48000',
                        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '17', '-c:a', 'aac', '-b:a', '192k', c], check=True)
        d = float(subprocess.run(['ffprobe', '-v', 'quiet', '-show_entries', 'format=duration', '-of', 'csv=p=0', c], capture_output=True, text=True).stdout)
        clipes.append(c); inicio.append(t); t += d
    DUR = t
    with open(f'{T}/{nome}_lista.txt', 'w') as f: f.writelines(f"file '{c}'\n" for c in clipes)
    base = f'{T}/{nome}_base.mp4'
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', f'{T}/{nome}_lista.txt', '-c', 'copy', base], check=True)

    def mapa(src, ts):
        for i, (s, a, b, v) in enumerate(edl):
            if s == src and a <= ts <= b: return inicio[i] + (ts - a) / v
        return None

    # legenda palavra a palavra (só onde há fala)
    corr = cfg.get('corrige', {})
    pal = []
    for i, (src, a, b, v) in enumerate(edl):
        for s in FALA.get(src, {}).get('fala', []):
            for w0, w1, w in s['p']:
                if a <= w0 and w1 <= b + 0.05:
                    w = corr.get(w.strip(), w.strip())
                    if w: pal.append((inicio[i] + (w0 - a) / v, inicio[i] + (min(w1, b) - a) / v, w, i))
    blocos, cur = [], []
    for p in pal:
        if cur and (len(cur) == 3 or p[3] != cur[-1][3] or p[0] - cur[-1][1] > 0.6 or cur[-1][2][-1:] in '.?!'):
            blocos.append(cur); cur = []
        cur.append(p)
    if cur: blocos.append(cur)
    ts_ = lambda x: f'{int(max(x,0) // 3600)}:{int(max(x,0) % 3600 // 60):02d}:{max(x,0) % 60:05.2f}'
    ass = ['[Script Info]', 'ScriptType: v4.00+', 'PlayResX: 1080', 'PlayResY: 1920', '', '[V4+ Styles]',
           'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
           'Style: Leg,Rubik Light Black,70,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,7,3,2,70,70,330,1', '', '[Events]',
           'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text']
    for bl in blocos:
        fim_bl = bl[-1][1] + 0.15
        for k, p in enumerate(bl):
            a = p[0]; b = bl[k + 1][0] if k + 1 < len(bl) else fim_bl
            txt = ' '.join(('{\\c&H33CFFF&}' + q[2].upper() + '{\\c&HFFFFFF&}') if j == k else q[2].upper() for j, q in enumerate(bl))
            ass.append(f'Dialogue: 0,{ts_(a)},{ts_(b)},Leg,,0,0,0,,{txt}')
    open(f'{T}/{nome}.ass', 'w').write('\n'.join(ass))

    # camadas sobre o vídeo (motion_fx)
    import motion_fx as mf
    tg = cfg.get('t_gancho', 3.2)
    pre = cfg.get('preco'); t_pre = mapa(pre['src'], pre['t']) if pre else None
    hits = [(mapa(h['src'], h['t']), h) for h in cfg.get('hits', [])]; hits = [x for x in hits if x[0] is not None]
    bricks = [(mapa(b['src'], b['t']), b) for b in cfg.get('bricks', [])]; bricks = [x for x in bricks if x[0] is not None]
    packs = [mapa(p[0], p[1]) for p in cfg.get('packs', [])]; packs = [p for p in packs if p is not None]
    whips = [inicio[k] for k in cfg.get('whips', []) if 0 < k < len(inicio)]
    gq = mf.sticker_frames() if bricks else []
    pl = cfg.get('placar'); t_pl = (mapa(*pl['desde']) if pl and pl.get('desde') else 0.0) if pl else None
    lg = LOGO.copy(); lw = 170; lg = lg.resize((lw, int(lg.height * lw / lg.width)), Image.LANCZOS)
    cam = f'{T}/{nome}_cam'; shutil.rmtree(cam, ignore_errors=True); os.makedirs(cam)
    for i in range(int(DUR * FPS) + 1):
        tt = i / FPS; c = camada(W, H)
        c.alpha_composite(lg, (W - 60 - lw, 1640))
        if packs:
            k = max([j for j, p in enumerate(packs) if p <= tt], default=None)
            if k is not None: mf.counter_badge(k + 1, len(packs), tt - packs[k], canvas=c)
        if tt < tg: mf.hook(cfg['gancho'], cfg['cor'], tt, dur=tg, canvas=c)
        if t_pre is not None: mf.price_slam(pre['pago'], pre['outras'], tt - t_pre, dur=pre.get('dur', 5.0), cy=pre.get('cy', 1120), canvas=c)
        if pl is not None and tt >= t_pl:
            tot = -pl['pago']; fl = 0.0
            for th, h in hits:
                if tt >= th:
                    k2 = min(1, (tt - th) / 0.6); tot += h['valor'] * ease(k2); fl = max(fl, 1 - min(1, (tt - th) / 0.5))
            sc = 1 + 0.12 * fl
            cola(c, placar_img(round(tot, 2), fl), W - 72 - 200, 330, 1, sc)
        for th, h in hits:
            lt = tt - th
            if 0 <= lt < 2.4:
                out = 1 - ease(max(0, (lt - 2.1) / 0.3))
                cola(c, valor_img(h['valor']), W / 2, 560, out, max(0.01, back(lt / 0.35)), -3)
                for kk in range(4):
                    ang = kk * 1.6 + 0.4; rr = 230
                    cola(c, brilho4(24 + 8 * (kk % 2)), W / 2 + math.cos(ang) * rr * 1.5, 560 + math.sin(ang) * rr * 0.5, out * min(1, lt / 0.2))
        for tb, b in bricks: mf.brick(gq, tt - tb, dur=b.get('dur', 2.2), canvas=c)
        for tw in whips: mf.transition_whip(tt - (tw - 0.18), canvas=c)
        c.save(f'{cam}/{i:05d}.png', compress_level=1)

    # fechamento em cor cheia (motion_fx.end_card, abre em íris sobre o último quadro)
    fim = dict(cfg['final']); fim['cor_final'] = fim.get('cor_final', cfg['cor']); fim['foto'] = foto(fim['foto'])
    EXTRA = fim.get('dur', 3.8)
    fimd = f'{T}/{nome}_fim'; shutil.rmtree(fimd, ignore_errors=True); os.makedirs(fimd)
    for i in range(int(EXTRA * FPS)):
        mf.end_card(fim, i / FPS).save(f'{fimd}/f{i:04d}.png', compress_level=1)
    # zoom-punch no vídeo nos hits
    Z = '+'.join(f'0.04*exp(-((t-{th + 0.1:.3f})*(t-{th + 0.1:.3f}))/0.05)' for th, _ in hits) or '0'
    zoom = f"scale=w='2*trunc(540*(1+{Z}))':h='2*trunc(960*(1+{Z}))':eval=frame,crop=1080:1920"

    # áudio: original realçado (ASMR) + trilha baixa com ducking pela fala; whoosh simples na troca para o final
    saida = f'{OUT}/{cfg["saida"]}.mp4'
    trl = trilha()
    g = (f"[0:v]{zoom},subtitles={T}/{nome}.ass:fontsdir={AQUI}[v0];[v0][1:v]overlay=0:0:eof_action=pass[v1];"
         f"[2:v]setpts=PTS-STARTPTS+{DUR:.3f}/TB[fe];[v1]tpad=stop_mode=clone:stop_duration={EXTRA}[v2];[v2][fe]overlay=0:0:eof_action=repeat[vf];"
         f"[0:a]highpass=f=70,acompressor=threshold=-24dB:ratio=3:attack=5:release=120:makeup=6,apad=pad_dur={EXTRA},asplit=2[orig][sc];"
         f"[3:a]volume={cfg.get('vol_trilha', 0.22)},aloop=loop=-1:size=2e9,atrim=0:{DUR + EXTRA:.2f},afade=t=in:d=0.6,afade=t=out:st={DUR + EXTRA - 1.2:.2f}:d=1.2[tr];"
         f"[tr][sc]sidechaincompress=threshold=0.04:ratio=6:attack=20:release=400[trd];"
         f"[orig][trd]amix=inputs=2:duration=first:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11[a]")
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', base, '-framerate', str(FPS), '-i', f'{cam}/%05d.png', '-framerate', str(FPS), '-i', f'{fimd}/f%04d.png', '-i', trl,
                    '-filter_complex', g, '-map', '[vf]', '-map', '[a]', '-c:a', 'aac', '-b:a', '192k', '-t', f'{DUR + EXTRA:.2f}',
                    '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-maxrate', '6M', '-bufsize', '12M', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', saida], check=True)
    provas = [1.2] + ([t_pre + 1.9] if t_pre is not None else []) + [x[0] + 0.5 for x in hits] + [x[0] + 1.0 for x in bricks] + [DUR + EXTRA - 0.5]
    for tt in provas:
        subprocess.run(['ffmpeg', '-v', 'quiet', '-y', '-ss', f'{tt:.2f}', '-i', saida, '-frames:v', '1', '-vf', 'scale=540:-2', f'{OUT}/{cfg["saida"]}_prova_{tt:05.1f}.jpg'])
    return {'dur': round(DUR + EXTRA, 1), 'inicio': [round(x, 2) for x in inicio], 'hits': [round(x[0], 2) for x in hits], 'bricks': [round(x[0], 2) for x in bricks], 'preco': t_pre}

rel = {}
_sel = os.environ.get('PECAS', '') or (open(os.path.join(AQUI, 'unbox_pecas.txt')).read().strip() if os.path.exists(os.path.join(AQUI, 'unbox_pecas.txt')) else '')
for nome in [p for p in _sel.replace('\n', ',').split(',') if p.strip()] or list(CFG):
    try: rel[nome] = processa(nome, CFG[nome])
    except Exception as e:
        import traceback; rel[nome] = {'erro': traceback.format_exc()[-1500:]}
    json.dump(rel, open(f'{OUT}/U_relatorio.json', 'w'), indent=1, ensure_ascii=False)
