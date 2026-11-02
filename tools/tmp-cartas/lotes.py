#!/usr/bin/env python3
"""Lotes de 31/10 (Fogo/Escuridão): folhas de quadros (a cada 2 s, com tempo) para achar aberturas e cortes em alta
dos trechos usados nos vídeos GSAP. Pedido em tools/tmp-cartas/lotes.json; saída tmp-lotes/."""
import os, json, shutil, subprocess, urllib.request
from PIL import Image, ImageDraw, ImageFont
AQUI = os.path.dirname(os.path.abspath(__file__)); OUT = 'tmp-lotes'; T = '/tmp/lotes'
os.makedirs(OUT, exist_ok=True); os.makedirs(T, exist_ok=True)
F = ImageFont.truetype(os.path.join(AQUI, 'rubik800.ttf'), 22)
IDS = {l.split()[2]: l.split()[1] for l in open(os.path.join(AQUI, 'inv_ids.txt')) if l.strip()}
P = json.load(open(os.path.join(AQUI, 'lotes.json')))
def baixa(nome):
    arq = f'{T}/{nome}.mp4'
    if os.path.exists(arq): return arq
    for t in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(f'https://drive.usercontent.google.com/download?id={IDS[nome]}&export=download&confirm=t', headers={'User-Agent': 'Mozilla/5.0'}), timeout=300) as r, open(arq + '.part', 'wb') as f: shutil.copyfileobj(r, f, 1 << 22)
            os.replace(arq + '.part', arq); return arq
        except Exception as e: print('baixa', nome, t, repr(e), flush=True)
    raise RuntimeError('não baixou ' + nome)
def folha(nome):
    arq = baixa(nome); fr = f'{T}/fr'; shutil.rmtree(fr, ignore_errors=True); os.makedirs(fr)
    subprocess.run(['ffmpeg', '-v', 'error', '-i', arq, '-vf', 'fps=0.5,scale=150:-2', f'{fr}/%04d.jpg'], check=True)
    fs = sorted(os.listdir(fr)); ims = [Image.open(f'{fr}/{x}').convert('RGB') for x in fs]; w, h = ims[0].size
    sh = Image.new('RGB', (12 * w, ((len(ims) + 11) // 12) * h), 'white'); d = ImageDraw.Draw(sh)
    for i, im in enumerate(ims):
        x, y = (i % 12) * w, (i // 12) * h; sh.paste(im, (x, y)); t = i * 2
        d.rectangle((x, y, x + 64, y + 26), fill='black'); d.text((x + 3, y + 1), f'{t // 60}:{t % 60:02d}', font=F, fill='yellow')
    sh.save(f'{OUT}/folha_{nome}.jpg', quality=65)
for nome in P.get('folhas', []):
    try: folha(nome); print('folha', nome, flush=True)
    except Exception as e: print('ERRO folha', nome, repr(e), flush=True)
    finally:
        if nome not in {c[1] for c in P.get('cortes', [])} and os.path.exists(f'{T}/{nome}.mp4'): os.remove(f'{T}/{nome}.mp4')
for saida, nome, a, b in P.get('cortes', []):
    try:
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', str(a), '-to', str(b), '-i', baixa(nome), '-vf', 'scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920,fps=30,setsar=1',
                        '-c:v', 'libx264', '-crf', '22', '-maxrate', '10M', '-bufsize', '20M', '-preset', 'slow', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '128k', f'{OUT}/{saida}.mp4'], check=True)
        print('corte', saida, flush=True)
    except Exception as e: print('ERRO corte', saida, repr(e), flush=True)
