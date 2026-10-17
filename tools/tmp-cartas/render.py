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
    x0, y0, x1, y1 = caixa
    tmp = tempfile.mkdtemp()
    subprocess.run(['ffmpeg', '-v', 'quiet', '-i', arq, '-vf', f'fps={FPS_OV},crop={x1-x0}:{y1-y0}:{x0}:{y0}', f'{tmp}/%05d.png'], check=True)
    fs = sorted(os.listdir(tmp)); tl = []; prev = None; last = None
    for i, f in enumerate(fs):
        a = np.asarray(Image.open(f'{tmp}/{f}').convert('RGB'))
        pres = presente(a) > 400
        if not pres: tl.append(None); prev = None; continue
        small = a[::2, ::2].astype(int)
        if prev is not None and np.abs(small - prev).mean() < 5 and last is not None:
            tl.append(last); continue
        prev = small
        v = valor(ocr(a), cor_txt(a), last if last is not None else -pago, -pago, hi)
        if v is not None: last = v
        tl.append(last if last is not None else 'x')
    shutil.rmtree(tmp)
    return tl

# ---------- cartão final ----------
def cartao_final(fundo, cfg, final):
    im = fundo.convert('RGB').filter(ImageFilter.GaussianBlur(28))
    im = Image.blend(im, Image.new('RGB', im.size, (0, 0, 0)), 0.55).convert('RGBA')
    d = ImageDraw.Draw(im)
    lucro = final > 0
    texto_c(d, 300, 'DEU LUCRO!' if lucro else 'PREJUÍZO...', F(900, 128), AMARELO if lucro else VERM)
    texto_c(d, 470, 'MENOR PREÇO JÁ VISTO NO SITE', F(800, 42), AMARELO)
    texto_c(d, 525, brl(cfg['site'], sinal=False), F(900, 80), BRANCO)
    texto_c(d, 622, cfg['produto'], F(700, 36), BRANCO)
    texto_c(d, 700, 'RESULTADO', F(800, 42), AMARELO)
    b = badge(brl(final), VERDE if final >= 0 else VERM, 760, 160, F(900, 104), borda=9)
    im.alpha_composite(b, ((W - 760) // 2, 752))
    texto_c(d, 975, 'NÃO RASGUE DINHEIRO', F(900, 70), AMARELO)
    texto_c(d, 1065, 'Entre no grupo e pague', F(700, 50), BRANCO)
    texto_c(d, 1125, 'sempre o menor preço', F(700, 50), BRANCO)
    texto_c(d, 1210, 'tcgpricehunter.com.br', F(900, 56), BRANCO)
    logo = Image.open(os.path.join(AQUI, 'logo.png')).convert('RGBA'); lw = 520
    logo = logo.resize((lw, int(logo.height * lw / logo.width)))
    im.alpha_composite(logo, ((W - lw) // 2, 1330))
    texto_c(d, 1330 + logo.height + 30, '@tcgpricehunter', F(700, 44), BRANCO)
    return im

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
            nv = round(v + delta, 2); rot = primeiro is not None and i - primeiro < 45
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
        c = Image.open(q0).convert('RGB').filter(ImageFilter.GaussianBlur(40))
        c = Image.blend(c, Image.new('RGB', c.size, (0, 0, 0)), 0.45).convert('RGBA'); d = ImageDraw.Draw(c)
        texto_c(d, 610, 'DEU LUCRO?', F(900, 150), AMARELO)
        c.alpha_composite(badge(brl(-cfg['site']), VERM, 920, 236, F(900, 150), borda=9), (80, 800))
        p = pilula('MENOR PREÇO JÁ VISTO NO SITE', F(700, 38)); c.alpha_composite(p, ((W - p.width) // 2, 1070))
        c.convert('RGB').save(f'{tmp}/ab.png')
        entradas += ['-loop', '1', '-i', f'{tmp}/ab.png']
    # cartão final sobre um quadro congelado e desfocado de antes da tela final
    q = f'{tmp}/q.png'
    subprocess.run(['ffmpeg', '-v', 'quiet', '-y', '-ss', f'{max(t_fim - 0.4, 0):.2f}', '-i', arq, '-frames:v', '1', q], check=True)
    cartao_final(Image.open(q), cfg, final).convert('RGB').save(f'{tmp}/fim.png')
    entradas += ['-loop', '1', '-i', f'{tmp}/fim.png']
    extra = 1.5
    g = f'[0:v]tpad=stop_mode=clone:stop_duration={extra}[v0];[v0][1:v]overlay={ox}:{oy}:eof_action=pass[v1]'
    n = 2; ult = 'v1'
    if grande:
        a0, a1 = cfg['abertura']
        g += f";[{ult}][{n}:v]overlay=0:0:enable='between(t,{a0},{a1})':shortest=0[v2]"; ult = 'v2'; n += 1
    g += f";[{ult}][{n}:v]overlay=0:0:enable='gte(t,{t_fim:.2f})':shortest=0[vf]"
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
