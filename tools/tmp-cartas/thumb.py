"""Capa (thumb) sem texto, pedido do dono em 30/10: a carta mais valiosa em destaque; sem carta boa, quadro desfocado.
Nada escrito em português: só a imagem, brilhos e o logo pequeno. Uso: thumb.gera(cfg, edl, baixa, saida)."""
import os, math, random, subprocess
from PIL import Image, ImageDraw, ImageFilter, ImageEnhance

AQUI = os.path.dirname(os.path.abspath(__file__))
W, H = 1080, 1920
MINIMO = 20.0  # abaixo disso a carta não "vende" a capa

def quadro(arq, t, saida):
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', f'{t:.2f}', '-i', arq, '-frames:v', '1',
                    '-vf', 'scale=1080:1920:flags=lanczos,setsar=1', saida], check=True)
    return Image.open(saida).convert('RGB')

def brilho4(r):
    s = int(r * 2 + 4); im = Image.new('RGBA', (s, s), (0, 0, 0, 0)); d = ImageDraw.Draw(im); c = s / 2; k = r * 0.22
    d.polygon([(c, c - r), (c + k, c - k), (c + r, c), (c + k, c + k), (c, c + r), (c - k, c + k), (c - r, c), (c - k, c - k)], fill=(255, 255, 255, 255))
    return im

def vinheta(im, forca=0.55):
    m = Image.new('L', (W, H), 0); d = ImageDraw.Draw(m)
    for i in range(40):
        f = i / 40; d.ellipse((-W * .25 + f * W * .25, -H * .15 + f * H * .15, W * 1.25 - f * W * .25, H * 1.15 - f * H * .15), fill=int(255 * f))
    m = m.filter(ImageFilter.GaussianBlur(80))
    escuro = Image.new('RGB', (W, H), (8, 10, 30))
    return Image.composite(im, Image.blend(im, escuro, forca), m)

def logo(fr, w=300, y=90):
    lg = Image.open(os.path.join(AQUI, 'logo.png')).convert('RGBA'); lg = lg.resize((w, int(lg.height * w / lg.width)), Image.LANCZOS)
    fr.alpha_composite(lg, ((W - w) // 2, y))

def gera(cfg, edl, baixa, saida):
    hits = sorted(cfg.get('hits', []), key=lambda h: -(h.get('valor') or 0))
    tmp = saida + '.raw.jpg'
    if hits and (hits[0].get('valor') or 0) >= MINIMO:
        h = hits[0]; base = quadro(baixa(h['src']), h['t'] + 0.3, tmp)
        # aproxima a carta (centro do quadro), cor e contraste mais vivos, borda luminosa e brilhos holo
        z = 1.12; cw, ch = int(W / z), int(H / z)
        base = base.crop(((W - cw) // 2, (H - ch) // 2 - 40, (W + cw) // 2, (H + ch) // 2 - 40)).resize((W, H), Image.LANCZOS)
        base = ImageEnhance.Color(base).enhance(1.35); base = ImageEnhance.Contrast(base).enhance(1.12); base = ImageEnhance.Sharpness(base).enhance(1.4)
        fr = vinheta(base, 0.5).convert('RGBA')
        glow = Image.new('RGBA', (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(glow)
        d.rounded_rectangle((26, 26, W - 26, H - 26), 60, outline=(255, 207, 51, 255), width=22)
        fr.alpha_composite(glow.filter(ImageFilter.GaussianBlur(14))); fr.alpha_composite(glow)
        random.seed(len(h.get('nome', '')))
        for _ in range(9):
            r = random.randint(22, 48); x = random.choice((random.randint(70, 300), random.randint(780, 1010))); y = random.randint(260, 1750)
            b = brilho4(r); fr.alpha_composite(b, (x - b.width // 2, y - b.height // 2))
    else:
        # sem carta boa: quadro desfocado, sem mostrar nada
        src, a, b, _ = edl[len(edl) // 2]
        base = quadro(baixa(src), (a + b) / 2, tmp).filter(ImageFilter.GaussianBlur(45))
        base = ImageEnhance.Color(base).enhance(1.3)
        fr = vinheta(base, 0.35).convert('RGBA')
        logo(fr, 560, 820)
        os.remove(tmp); fr.convert('RGB').save(saida, quality=92); return saida
    logo(fr)
    os.remove(tmp); fr.convert('RGB').save(saida, quality=92)
    return saida

def nitidez(im):
    c = im.crop((W // 4, H // 4, W * 3 // 4, H * 3 // 4)).convert('L').resize((270, 480))
    e = c.filter(ImageFilter.FIND_EDGES); px = list(e.getdata()); m = sum(px) / len(px)
    return sum((x - m) ** 2 for x in px) / len(px)

def mais_nitido(video, t, tmp, antes=1.0, depois=2.0, passo=0.2):
    """O instante do salto do placar costuma pegar a carta em movimento: procura o quadro mais nítido em volta."""
    melhor = None; k = t - antes
    while k <= t + depois:
        if k >= 0:
            try: im = quadro(video, k, tmp)
            except Exception: break
            n = nitidez(im)
            if melhor is None or n > melhor[0]: melhor = (n, im)
        k += passo
    return melhor[1]

def de_video(video, t, saida):
    """Capa de vídeo já editado (sem bruto): carta em t aproximada pelo centro (corta placar e legendas); t=None = desfocado."""
    tmp = saida + '.raw.jpg'
    if t is not None:
        base = mais_nitido(video, t, tmp)
        z = 1.45; cw, ch = int(W / z), int(H / z)
        base = base.crop(((W - cw) // 2, (H - ch) // 2, (W + cw) // 2, (H + ch) // 2)).resize((W, H), Image.LANCZOS)
        base = ImageEnhance.Color(base).enhance(1.3); base = ImageEnhance.Contrast(base).enhance(1.1); base = ImageEnhance.Sharpness(base).enhance(1.5)
        fr = vinheta(base, 0.45).convert('RGBA')
        glow = Image.new('RGBA', (W, H), (0, 0, 0, 0)); d = ImageDraw.Draw(glow)
        d.rounded_rectangle((26, 26, W - 26, H - 26), 60, outline=(255, 207, 51, 255), width=22)
        fr.alpha_composite(glow.filter(ImageFilter.GaussianBlur(14))); fr.alpha_composite(glow)
        random.seed(int(t * 10))
        for _ in range(9):
            r = random.randint(22, 48); x = random.choice((random.randint(70, 300), random.randint(780, 1010))); y = random.randint(260, 1750)
            b = brilho4(r); fr.alpha_composite(b, (x - b.width // 2, y - b.height // 2))
        logo(fr)
    else:
        dur = float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', video], capture_output=True, text=True).stdout)
        base = quadro(video, dur * 0.4, tmp).filter(ImageFilter.GaussianBlur(45))
        fr = vinheta(ImageEnhance.Color(base).enhance(1.3), 0.35).convert('RGBA'); logo(fr, 560, 820)
    os.remove(tmp); fr.convert('RGB').save(saida, quality=92)
    return saida
