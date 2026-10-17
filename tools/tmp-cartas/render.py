#!/usr/bin/env python3
"""Temporário: refaz o placar dos vídeos com o MENOR PREÇO JÁ REGISTRADO NO SITE e põe o cartão final de grupo.

Para cada vídeo: lê o placar original (OCR a 10 qps), soma a diferença (valor pago - menor preço do site),
desenha um placar novo por cima (mesmo lugar e estilo), troca a tela final por um cartão com o resultado
refeito + chamada para o grupo, e estende 1,5 s para dar tempo de ler. Saída: tmp-render/<nome>.mp4.
"""
import json, os, re, subprocess, sys, shutil, tempfile, urllib.request
import numpy as np
from PIL import Image, ImageDraw, ImageFont, ImageFilter

AQUI = os.path.dirname(os.path.abspath(__file__))
OUT = 'tmp-render'; os.makedirs(OUT, exist_ok=True)
F = lambda w, s: ImageFont.truetype(os.path.join(AQUI, f'rubik{w}.ttf'), s)
AMARELO, VERM, VERDE, FUNDO, BRANCO = (253, 210, 33), (245, 58, 58), (60, 220, 88), (16, 16, 16), (255, 255, 255)
W, H, FPS_OV = 1080, 1920, 10

def brl(v, sinal=True):
    s = f'{abs(v):,.2f}'.replace(',', 'X').replace('.', ',').replace('X', '.')
    return (('+' if v > 0 else '-') if sinal and abs(v) >= 0.005 else '') + 'R$ ' + s

def badge(texto, cor, w, h, fonte, borda=6, raio=None):
    im = Image.new('RGBA', (w, h), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    raio = raio or h // 4
    d.rounded_rectangle((0, 0, w - 1, h - 1), raio, fill=AMARELO)
    d.rounded_rectangle((borda, borda, w - 1 - borda, h - 1 - borda), max(raio - borda, 4), fill=FUNDO)
    tw = d.textlength(texto, font=fonte); bb = d.textbbox((0, 0), texto, font=fonte)
    d.text(((w - tw) / 2, (h - (bb[3] - bb[1])) / 2 - bb[1]), texto, font=fonte, fill=cor)
    return im

def pilula(texto, fonte, pad=(22, 10)):
    d0 = ImageDraw.Draw(Image.new('RGBA', (1, 1))); bb = d0.textbbox((0, 0), texto, font=fonte)
    w, h = int(bb[2] - bb[0] + 2 * pad[0]), int(bb[3] - bb[1] + 2 * pad[1])
    im = Image.new('RGBA', (w, h), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    d.rounded_rectangle((0, 0, w - 1, h - 1), h // 2, fill=(0, 0, 0, 215))
    d.text((pad[0] - bb[0], pad[1] - bb[1]), texto, font=fonte, fill=AMARELO)
    return im

def texto_c(d, y, s, fonte, cor, sombra=True):
    tw = d.textlength(s, font=fonte)
    if sombra: d.text(((W - tw) / 2 + 4, y + 4), s, font=fonte, fill=(0, 0, 0))
    d.text(((W - tw) / 2, y), s, font=fonte, fill=cor)

# ---------- leitura do placar original ----------
def ocr(a):
    m = np.maximum(a[..., 0], a[..., 1]).astype(int) - a[..., 2].astype(int)
    m = ((m > 90) * 255).astype(np.uint8)
    p = tempfile.mktemp(suffix='.png'); Image.fromarray(255 - m).resize((m.shape[1] * 2, m.shape[0] * 2)).save(p)
    t = subprocess.run(['tesseract', p, '-', '--psm', '7', '-c', 'tessedit_char_whitelist=+-R$0123456789,.'], capture_output=True, text=True).stdout
    os.remove(p); return t.strip()

def presente(a):
    r, g, b = a[..., 0].astype(int), a[..., 1].astype(int), a[..., 2].astype(int)
    return int(((r > 200) & (g > 165) & (b < 90)).sum())

def cor_txt(a):
    r, g = a[..., 0].astype(int), a[..., 1].astype(int)
    red = int(((r > 180) & (g < 110)).sum()); green = int(((g > 160) & (r < 140)).sum())
    return -1 if red > green else 1

def valor(txt, sinal, ref, lo, hi):
    """'$' às vezes vira um 5 à esquerda: entre o número lido e ele sem o 1º dígito, fica o plausível mais perto do anterior."""
    for m in re.finditer(r'(\d[\d.]*)[,](\d{2})', txt):
        n = m.group(1).replace('.', ''); cands = []
        for k in (n, n[1:]):
            if k:
                v = sinal * float(k + '.' + m.group(2))
                if lo - 0.5 <= v <= hi + 0.5: cands.append(v)
        if cands: return min(cands, key=lambda v: abs(v - ref))
    return None

def linha_do_tempo(arq, caixa, pago, hi):
    """Lê o placar em todos os quadros (10 qps) e suaviza pela moda numa janela de 0,5 s (erro isolado de OCR some)."""
    x0, y0, x1, y1 = caixa
    tmp = tempfile.mkdtemp()
    subprocess.run(['ffmpeg', '-v', 'quiet', '-i', arq, '-vf', f'fps={FPS_OV},crop={x1-x0}:{y1-y0}:{x0}:{y0}', f'{tmp}/%05d.png'], check=True)
    fs = sorted(os.listdir(tmp)); bruto = []; last = None
    for f in fs:
        a = np.asarray(Image.open(f'{tmp}/{f}').convert('RGB'))
        if presente(a) <= 400: bruto.append(None); continue
        v = valor(ocr(a), cor_txt(a), last if last is not None else -pago, -pago, hi)
        if v is not None: last = v
        bruto.append(v if v is not None else 'x')
    shutil.rmtree(tmp)
    tl = []
    for i, v in enumerate(bruto):
        if v is None: tl.append(None); continue
        jan = [w for w in bruto[max(0, i - 2): i + 3] if isinstance(w, float)]
        if jan:
            cont = {w: jan.count(w) for w in jan}; m = max(cont.values())
            v = v if isinstance(v, float) and cont.get(v) == m else max(cont, key=lambda w: (cont[w], -abs(jan.index(w) - len(jan) // 2)))
        tl.append(v)
    # placar presente mas ilegível: herda o valor anterior (ou o custo inicial, antes do 1º valor lido)
    ant = -pago
    for i, v in enumerate(tl):
        if v == 'x' or (v is not None and not isinstance(v, float)): tl[i] = ant
        elif isinstance(v, float): ant = v
    return tl

# ---------- motion: abertura e cartão final (design system dos posts) ----------
FPS_M = 30
ease = lambda x: 1 - (1 - max(0.0, min(1.0, x))) ** 3
NAVY, MUTED, Y, ESC = (14, 19, 48), (195, 204, 235), (255, 207, 51), (43, 34, 0)
COR_LUCRO, COR_PREJ = (47, 154, 85), (201, 61, 37)
VERDE_TXT, VERM_TXT = (88, 214, 120), (255, 92, 70)
M = 72   # margem lateral

def camada(w, h): return Image.new('RGBA', (w, h), (0, 0, 0, 0))

def tw_(d, s, f, track=0): return sum(d.textlength(ch, font=f) for ch in s) + track * max(len(s) - 1, 0)

def escreve(d, x, y, partes, f, track=0):
    """Texto com tracking (o h1 do DS usa -4) e trechos de cores diferentes: partes = [(texto, cor), ...]."""
    for s, cor in partes:
        for ch in s:
            d.text((x, y), ch, font=f, fill=cor); x += d.textlength(ch, font=f) + track
    return x

def eyebrow(c, y, cor, texto):
    d = ImageDraw.Draw(c); d.rounded_rectangle((M, y + 2, M + 26, y + 28), 7, fill=cor)
    escreve(d, M + 40, y, [(texto.upper(), BRANCO)], F(700, 26), track=3)

def logo_ds(c, y, lw=190):
    lg = Image.open(os.path.join(AQUI, 'logo.png')).convert('RGBA'); lg = lg.resize((lw, int(lg.height * lw / lg.width)))
    c.alpha_composite(lg, (W - M - lw, y))

def brilho(c, cor, cx, cy, r, op=.35):
    g = camada(W, H); d = ImageDraw.Draw(g)
    for k in range(40, 0, -1):
        rr = r * k / 40; a = int(255 * op * (1 - k / 40) ** 1.5)
        d.ellipse((cx - rr, cy - rr, cx + rr, cy + rr), fill=cor + (a,))
    c.alpha_composite(g.filter(ImageFilter.GaussianBlur(30)))

def cta(c, y, texto, f=None, x=None):
    f = f or F(800, 34); d = ImageDraw.Draw(c); w = d.textlength(texto, font=f) + 2 * 40; h = 92
    x = (W - w) / 2 if x == 'centro' else (M if x is None else x)
    d.rounded_rectangle((x, y, x + w, y + h), h // 2, fill=Y)
    bb = d.textbbox((0, 0), texto, font=f); d.text((x + 40, y + (h - (bb[3] - bb[1])) / 2 - bb[1]), texto, font=f, fill=ESC)

def fundo_ds(quadro, cor_barra, glow_cor):
    bg = quadro.convert('RGB').filter(ImageFilter.GaussianBlur(30)).convert('RGBA')
    bg.alpha_composite(Image.new('RGBA', (W, H), NAVY + (232,)))
    brilho(bg, glow_cor, W // 2, 760, 620, .30)
    ImageDraw.Draw(bg).rectangle((0, 0, W, 18), fill=cor_barra)
    return bg

def faixa_abertura():
    fw, fh = 1000, 300; c = camada(fw, fh); d = ImageDraw.Draw(c)
    d.rounded_rectangle((0, 0, fw - 1, fh - 1), 28, fill=NAVY + (242,))
    d.rounded_rectangle((0, 0, fw - 1, 40), 28, fill=Y); d.rectangle((0, 12, fw - 1, 40), fill=NAVY + (242,))
    d.rounded_rectangle((36, 50, 58, 72), 6, fill=Y); escreve(d, 70, 48, [('MENOR PREÇO DO BRASIL'.replace(' DO BRASIL', ''), BRANCO)], F(700, 24), track=3)
    escreve(d, 36, 92, [('Quer pagar ', BRANCO), ('menos', Y), (' no seu TCG?', BRANCO)], F(900, 60), track=-2)
    f = F(800, 30); txt = 'tcgpricehunter.com.br · grupo no link'; w = d.textlength(txt, font=f) + 64
    xp = (fw - w) / 2; d.rounded_rectangle((xp, 196, xp + w, 268), 36, fill=Y); d.text((xp + 32, 214), txt, font=f, fill=ESC)
    return c

def anim_abertura(pasta, t_in=0.3, t_out=3.6):
    """Faixa (30 qps): sobe com fade, segura, desce com fade."""
    base = faixa_abertura(); rw, rh = 1000, 420; n = int((t_out + 0.45) * FPS_M)
    for i in range(n):
        t = i / FPS_M; c = camada(rw, rh)
        if t >= t_in:
            e = ease((t - t_in) / 0.4) if t < t_out else 1 - ease((t - t_out) / 0.4)
            if e > 0.01:
                lay = base.copy(); lay.putalpha(lay.getchannel('A').point(lambda v: int(v * e)))
                c.alpha_composite(lay, (0, int(60 + (1 - e) * 110)))
        c.save(f'{pasta}/a{i:04d}.png')
    return (40, 1150)

def abertura_deulucro(quadro, cfg):
    c = fundo_ds(quadro, Y, (142, 75, 214)); d = ImageDraw.Draw(c)
    eyebrow(c, 254, Y, 'Deu lucro? · 30 Anos'); logo_ds(c, 238)
    escreve(d, M, 640, [('Deu lucro?', BRANCO)], F(900, 150), track=-5)
    escreve(d, M, 810, [(brl(-cfg['site']), VERM_TXT)], F(900, 150), track=-5)
    escreve(d, M, 1000, [('Menor preço já visto no site', MUTED)], F(700, 40))
    return c

def camadas_final(cfg, final):
    """Cartela final no design system: eyebrow + logo, h1 com o resultado, preços por produto, chamada e CTA."""
    out = []
    def lay(fn, t0, tipo='sobe'):
        c = camada(W, H); fn(c, ImageDraw.Draw(c)); out.append((c, t0, tipo))
    lucro = final > 0
    lay(lambda c, d: (eyebrow(c, 254, COR_LUCRO if lucro else COR_PREJ, 'Resultado · ' + cfg.get('serie', '30 Anos')), logo_ds(c, 238)), 0.1)
    lay(lambda c, d: escreve(d, M, 470, [('Deu lucro!' if lucro else 'Prejuízo...', BRANCO)], F(900, 120), track=-4), 0.18)
    lay(lambda c, d: escreve(d, M, 610, [(brl(final), VERDE_TXT if lucro else VERM_TXT)], F(900, 132), track=-4), 0.3, 'pop')
    lay(lambda c, d: escreve(d, M, 820, [('Menor preço já visto no site', MUTED)], F(700, 36)), 0.5)
    itens = cfg.get('itens') or [[cfg['produto'], cfg['site']]]
    for k, (nome, v) in enumerate(itens):
        def linha(c, d, k=k, nome=nome, v=v):
            y = 888 + k * 78; f = F(800, 42); pv = brl(v, sinal=False)
            d.text((M, y), nome, font=f, fill=BRANCO); d.text((W - M - d.textlength(pv, font=f), y), pv, font=f, fill=Y)
            d.line((M, y + 64, W - M, y + 64), fill=(255, 255, 255, 40), width=2)
        lay(linha, 0.58 + k * 0.07)
    y = 888 + len(itens) * 78 + 90
    lay(lambda c, d: escreve(d, M, y, [('Não rasgue ', BRANCO), ('dinheiro.', Y)], F(900, 84), track=-3), 0.95)
    lay(lambda c, d: escreve(d, M, y + 110, [('O grupo avisa quando o preço cai.', MUTED)], F(700, 36)), 1.05)
    lay(lambda c, d: cta(c, y + 190, 'Entra no grupo · tcgpricehunter.com.br', F(800, 32), x='centro'), 1.2, 'pop')
    return out

def quadro_final(fundo, pecas, t):
    im = fundo.copy()
    for c, t0, tipo in pecas:
        x = (t - t0) / 0.35
        if x <= 0: continue
        e = ease(x); lay = c
        if tipo == 'pop':
            esc = 1.25 - 0.25 * e
            if abs(esc - 1) > 0.002:
                bb = c.getbbox(); cx, cy = (bb[0] + bb[2]) / 2, (bb[1] + bb[3]) / 2
                lay = c.transform(c.size, Image.AFFINE, (1 / esc, 0, cx - cx / esc, 0, 1 / esc, cy - cy / esc), resample=Image.BILINEAR)
            dy = 0
        else: dy = int((1 - e) * 50)
        if e < 0.999: lay = lay.copy(); lay.putalpha(lay.getchannel('A').point(lambda v: int(v * e)))
        im.alpha_composite(lay, (0, dy))
    return im

def anim_final(quadro, cfg, final, pasta):
    """Cartão final animado (30 qps): fundo desfocado entra em fade, peças entram em sequência; o último quadro fica."""
    bg = fundo_ds(quadro, COR_LUCRO if final > 0 else COR_PREJ, (47, 154, 85) if final > 0 else (201, 61, 37))
    pecas = camadas_final(cfg, final); n = int(1.8 * FPS_M)
    for i in range(n):
        t = i / FPS_M; a = ease(t / 0.25)
        f = bg.copy(); f.putalpha(int(255 * a)); f = quadro_final(f, pecas, t) if a > 0.99 else f
        if a <= 0.99:
            base = camada(W, H); base.alpha_composite(f); f = quadro_final(base, pecas, t)
        f.save(f'{pasta}/f{i:04d}.png')

# ---------- um vídeo ----------
def processa(nome, cfg, fid):
    arq = f'/tmp/{nome}.mp4'
    if not os.path.exists(arq):
        req = urllib.request.Request(f'https://drive.usercontent.google.com/download?id={fid}&export=download&confirm=t', headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=300) as r, open(arq, 'wb') as f: shutil.copyfileobj(r, f)
    pr = json.loads(subprocess.run(['ffprobe', '-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', arq], capture_output=True, text=True).stdout)
    dur = float(pr['format']['duration']); tem_audio = any(s['codec_type'] == 'audio' for s in pr['streams'])
    grande = cfg.get('layout') == 'deulucro'
    cx = (300, 140, 780, 262) if grande else (340, 98, 740, 196)        # onde mora o placar de cima
    pago = cfg['pago']
    tl = linha_do_tempo(arq, cx, pago, cfg.get('teto', 1500))
    vals = [v for v in tl if isinstance(v, float)]
    delta = round(pago - cfg['site'], 2)
    # fim: o placar some de vez (tela final original) ou, se não sumir, 3 s antes do fim
    pres = [i for i, v in enumerate(tl) if v is not None]
    t_fim = (pres[-1] + 1) / FPS_OV if pres and (pres[-1] + 1) / FPS_OV < dur - 1.0 else dur - 3.0
    t_fim = max(min(t_fim, dur - 1.5), 0)
    final_orig = vals[-1] if vals else -pago
    final = round(final_orig + delta, 2)
    # camada do placar (quadros transparentes a 10 qps, só a região do placar)
    ow, oh, ox, oy = (500, 190, 290, 132) if grande else (440, 160, 320, 92)
    tmp = tempfile.mkdtemp(); vazio = Image.new('RGBA', (ow, oh), (0, 0, 0, 0)); cache = {}
    fb = F(900, 72 if grande else 50); fl = F(700, 26 if grande else 24)
    primeiro = next((i for i, v in enumerate(tl) if isinstance(v, float)), None)
    for i, v in enumerate(tl):
        if i / FPS_OV >= t_fim or not isinstance(v, float): img = vazio
        else:
            nv = round(v + delta, 2); rot = False   # placar só com o valor
            k = (nv, rot)
            if k not in cache:
                c = Image.new('RGBA', (ow, oh), (0, 0, 0, 0))
                bw, bh = (480, 116) if grande else (420, 100)
                c.alpha_composite(badge(brl(nv), VERDE if nv > 0 else VERM, bw, bh, fb, borda=6 if grande else 5), ((ow - bw) // 2, 0))
                if rot:
                    p = pilula('MENOR PREÇO JÁ VISTO NO SITE', fl); c.alpha_composite(p, ((ow - p.width) // 2, bh + 8))
                cache[k] = c
            img = cache[k]
        img.save(f'{tmp}/{i:05d}.png')
    # tela de abertura do "Deu lucro?" (placar grande no meio)
    filtros = []; entradas = ['-i', arq, '-framerate', str(FPS_OV), '-i', f'{tmp}/%05d.png']
    if grande:
        q0 = f'{tmp}/q0.png'
        subprocess.run(['ffmpeg', '-v', 'quiet', '-y', '-ss', f"{cfg['abertura'][0] + 0.4:.2f}", '-i', arq, '-frames:v', '1', q0], check=True)
        c = abertura_deulucro(Image.open(q0), cfg)
        c.convert('RGB').save(f'{tmp}/ab.png')
        entradas += ['-loop', '1', '-i', f'{tmp}/ab.png']
    # cartão final sobre um quadro congelado e desfocado de antes da tela final
    q = f'{tmp}/q.png'
    subprocess.run(['ffmpeg', '-v', 'quiet', '-y', '-ss', f'{max(t_fim - 0.4, 0):.2f}', '-i', arq, '-frames:v', '1', q], check=True)
    anim_final(Image.open(q), cfg, final, tmp)
    fx, fy = anim_abertura(tmp, t_in=cfg.get('faixa', [0.3, 3.6])[0], t_out=cfg.get('faixa', [0.3, 3.6])[1])
    entradas += ['-framerate', str(FPS_M), '-i', f'{tmp}/a%04d.png', '-framerate', str(FPS_M), '-i', f'{tmp}/f%04d.png']
    extra = 1.5
    g = f'[0:v]tpad=stop_mode=clone:stop_duration={extra}[v0];[v0][1:v]overlay={ox}:{oy}:eof_action=pass[v1]'
    n = 2; ult = 'v1'
    if grande:
        a0, a1 = cfg['abertura']
        g += f";[{ult}][{n}:v]overlay=0:0:enable='between(t,{a0},{a1})':shortest=0[v2]"; ult = 'v2'; n += 1
    g += f";[{ult}][{n}:v]overlay={fx}:{fy}:eof_action=pass[va]"; n += 1
    g += f";[{n}:v]setpts=PTS-STARTPTS+{t_fim:.3f}/TB[fe];[va][fe]overlay=0:0:eof_action=repeat[vf]"
    saida = f'{OUT}/{nome}.mp4'
    cmd = ['ffmpeg', '-v', 'error', '-y', *entradas, '-filter_complex', g, '-map', '[vf]']
    if tem_audio: cmd += ['-map', '0:a', '-af', f'apad=pad_dur={extra}', '-c:a', 'aac', '-b:a', '192k']
    cmd += ['-t', f'{dur + extra:.2f}', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', saida]
    subprocess.run(cmd, check=True)
    for t in cfg.get('provas', [1, t_fim - 1, t_fim + 1]):
        subprocess.run(['ffmpeg', '-v', 'quiet', '-y', '-ss', f'{t:.2f}', '-i', saida, '-frames:v', '1', '-vf', 'scale=540:-2', f'{OUT}/{nome}_prova_{t:05.1f}.jpg'])
    shutil.rmtree(tmp)
    leit = [(round(i / FPS_OV, 1), v) for i, v in enumerate(tl) if i == 0 or tl[i] != tl[i - 1]]
    return {'pago': pago, 'site': cfg['site'], 'delta': delta, 'final_original': final_orig, 'final_novo': final, 't_fim': t_fim, 'dur': dur, 'leituras': leit}

if __name__ == '__main__':
    V = json.load(open(os.path.join(AQUI, 'videos.json')))
    conf = json.load(open(os.path.join(AQUI, 'render.json')))
    so = sys.argv[1:] or list(conf)
    rel = {}
    if os.path.exists(f'{OUT}/relatorio.json'): rel = json.load(open(f'{OUT}/relatorio.json'))
    for nome in so:
        try: rel[nome] = processa(nome, conf[nome], V[nome])
        except Exception as e: rel[nome] = {'erro': repr(e)}
        json.dump(rel, open(f'{OUT}/relatorio.json', 'w'), indent=1, ensure_ascii=False)
