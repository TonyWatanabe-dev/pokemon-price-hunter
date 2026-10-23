#!/usr/bin/env python3
"""Prova visual + cronômetro do motion_fx: folhas de contato (quadros amostrados de cada efeito sobre um
fundo de exemplo) e tempo médio por quadro (300 quadros por efeito).

Uso: python3 tools/tmp-cartas/motion_preview.py [pasta_saida]   (padrão: $MOTION_OUT ou ./tmp-render)"""
import os, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import motion_fx as fx
from PIL import Image, ImageDraw

AQUI = os.path.dirname(os.path.abspath(__file__))
RAIZ = os.path.abspath(os.path.join(AQUI, '..', '..'))
OUT = sys.argv[1] if len(sys.argv) > 1 else os.environ.get('MOTION_OUT', 'tmp-render')
os.makedirs(OUT, exist_ok=True)
FOTO = os.path.join(RAIZ, 'tmp-dragonite', 'fotos', 'F2_134928.jpg')
GIF = os.path.join(AQUI, 'midia', 'pikachu_triste.gif')
W, H = fx.W, fx.H

def fundo():
    """'Still' de vídeo: a foto dos hits em cover 9:16, levemente escurecida (simula filmagem real)."""
    if os.path.exists(FOTO):
        f = Image.open(FOTO).convert('RGB'); s = max(W / f.width, H / f.height)
        f = f.resize((int(f.width * s + .5), int(f.height * s + .5)), Image.LANCZOS)
        l, t = (f.width - W) // 2, (f.height - H) // 2; f = f.crop((l, t, l + W, t + H))
        return Image.blend(f, Image.new('RGB', (W, H), (40, 40, 40)), 0.25).convert('RGBA')
    return Image.new('RGBA', (W, H), (128, 128, 128, 255))

BG = fundo()
FOTO_IMG = Image.open(FOTO).convert('RGB') if os.path.exists(FOTO) else Image.new('RGB', (900, 1200), (90, 90, 90))
GIFQ = fx.sticker_frames(GIF)
END_CFG = dict(foto=FOTO_IMG, titulo=['VALEU', 'A PENA!'], linha='PAGUEI R$ 240 · VALIA R$ 350', cor_final='#e2a500',
               foto_foco=0.62)
END_CFG_FIRE = dict(END_CFG, cor_final='#e0512b', titulo=['PACK', 'ABENÇOADO'])

EFEITOS = {
    'hook': (lambda t: fx.hook(['ABRI 6 PACKS DE 151', 'SERÁ QUE VEIO HIT?'], '#e2a500', t, 3.2), 3.2,
             [0.05, 0.12, 0.2, 0.3, 0.42, 0.5, 0.58, 0.7, 1.2, 2.92, 3.0, 3.1]),
    'price': (lambda t: fx.price_slam(240, 350, t, 5.0), 5.0,
              [0.08, 0.2, 0.4, 0.5, 0.66, 0.74, 0.8, 0.95, 1.2, 1.5, 1.8, 4.85]),
    'hit': (lambda t: fx.hit_reveal('PIKACHU ex', 'TIPO ELÉTRICO', '#e2a500', t, 2.8), 2.8,
            [0.0, 0.04, 0.08, 0.14, 0.22, 0.32, 0.5, 0.62, 0.9, 1.4, 1.75, 2.65]),
    'hit_fire': (lambda t: fx.hit_reveal('CHARIZARD ex', 'TIPO FOGO', '#e0512b', t, 2.8), 2.8,
                 [0.0, 0.05, 0.1, 0.2, 0.3, 0.45, 0.6, 0.8, 1.2, 1.8, 2.5, 2.7]),
    'brick': (lambda t: fx.brick(GIFQ, t, 2.0), 2.0,
              [0.04, 0.1, 0.2, 0.3, 0.42, 0.52, 0.62, 0.72, 0.85, 1.2, 1.8, 1.92]),
    'end': (lambda t: fx.end_card(END_CFG, t), 3.5,
            [0.05, 0.15, 0.3, 0.45, 0.6, 0.75, 0.9, 1.1, 1.3, 1.8, 2.6, 3.4]),
    'end_fire': (lambda t: fx.end_card(END_CFG_FIRE, t), 3.5,
                 [0.08, 0.2, 0.35, 0.5, 0.7, 0.9, 1.2, 1.6, 2.0, 2.4, 2.9, 3.4]),
    'whip': (lambda t: fx.transition_whip(t, 0.36), 0.36,
             [0.0, 0.03, 0.06, 0.09, 0.12, 0.15, 0.18, 0.21, 0.24, 0.27, 0.3, 0.34]),
    'counter': (lambda t: fx.counter_badge(3, 6, t), 1.0,
                [0.0, 0.03, 0.06, 0.1, 0.14, 0.2, 0.28, 0.36, 0.45, 0.6, 0.8, 1.0]),
}

def guia(im):
    """Linhas da área segura (vermelho fino) para conferir clipping."""
    d = ImageDraw.Draw(im)
    for y in (fx.SAFE_TOP, fx.SAFE_BOTTOM): d.line((0, y, W, y), fill=(255, 0, 0), width=3)
    for x in (fx.MARGIN, W - fx.MARGIN): d.line((x, 0, x, H), fill=(255, 0, 0), width=2)
    return im

def folha(nome, fn, ts, cols=6, tw=300):
    th = int(tw * H / W); rows = (len(ts) + cols - 1) // cols
    sheet = Image.new('RGB', (cols * tw + (cols + 1) * 8, rows * (th + 30) + 8), (24, 24, 28)); d = ImageDraw.Draw(sheet)
    for k, t in enumerate(ts):
        ov = fn(t)
        fr = ov.convert('RGB') if nome.startswith('end') and ov.getextrema()[3][0] == 255 else Image.alpha_composite(BG, ov).convert('RGB')
        fr = guia(fr)
        x = 8 + (k % cols) * (tw + 8); y = 8 + (k // cols) * (th + 30)
        sheet.paste(fr.resize((tw, th), Image.LANCZOS), (x, y + 22))
        d.text((x, y + 4), f't={t:.2f}s', fill=(230, 230, 230), font=fx.font(500, 16))
    p = os.path.join(OUT, f'motion_{nome}.jpg'); sheet.save(p, quality=88); return p

def detalhe(nome, fn, t, crop=None):
    ov = fn(t); fr = Image.alpha_composite(BG, ov) if ov.getextrema()[3][0] < 255 else ov
    fr = guia(fr.convert('RGB'))
    if crop: fr = fr.crop(crop)
    else: fr = fr.resize((540, 960), Image.LANCZOS)
    p = os.path.join(OUT, f'motion_detail_{nome}_{t:.2f}.jpg'); fr.save(p, quality=90); return p

def cronometra(fn, dur, n=300):
    fn(0.5 * dur)  # aquece caches
    t0 = time.perf_counter()
    for i in range(n): fn((i / fx.FPS) % dur)
    return (time.perf_counter() - t0) / n * 1000

if __name__ == '__main__':
    so = os.environ.get('SO')
    sel = [k for k in EFEITOS if not so or k in so.split(',')]
    for k in sel:
        fn, dur, ts = EFEITOS[k]; print('folha', folha(k, fn, ts))
    for k, t, crop in (('hook', 1.2, (0, 200, 1080, 560)), ('price', 1.9, (0, 1050, 1080, 1600)),
                       ('hit', 0.5, None), ('hit', 0.62, (0, 200, 1080, 560)), ('brick', 1.2, None), ('end', 2.6, None),
                       ('end_fire', 2.6, None), ('whip', 0.18, None), ('counter', 1.0, (0, 220, 540, 380))):
        if k in sel: print('detalhe', detalhe(k, EFEITOS[k][0], t, crop))
    if os.environ.get('TEMPO', '1') == '1':
        print('\nms/quadro (média de 300 quadros, render do overlay sem salvar PNG):')
        for k in sel:
            fn, dur, _ = EFEITOS[k]; print(f'  {k:10s} {cronometra(fn, dur):6.1f} ms')
        ov = fx.hit_reveal('PIKACHU ex', 'TIPO ELÉTRICO', '#e2a500', 0.5)
        t0 = time.perf_counter()
        for i in range(10): ov.save('/tmp/_mfx.png', compress_level=1)
        print(f'  (salvar PNG RGBA 1080x1920 compress_level=1: {(time.perf_counter() - t0) / 10 * 1000:.1f} ms)')
