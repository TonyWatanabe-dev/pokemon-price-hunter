#!/usr/bin/env python3
"""Só as fotos dos brutos novos (31/10), reduzidas, para o levantamento de valor das cartas. Saída tmp-inv/fotos/<set>_<nome>."""
import os, shutil, urllib.request
from PIL import Image, ImageOps
AQUI = os.path.dirname(os.path.abspath(__file__)); OUT = 'tmp-inv/fotos'; os.makedirs(OUT, exist_ok=True)
for linha in open(os.path.join(AQUI, 'inv_ids.txt')):
    if not linha.strip(): continue
    s, fid, nome = linha.split()
    if not nome.endswith('.jpg'): continue
    with urllib.request.urlopen(urllib.request.Request(f'https://drive.usercontent.google.com/download?id={fid}&export=download&confirm=t', headers={'User-Agent': 'Mozilla/5.0'}), timeout=120) as r, open('/tmp/f.jpg', 'wb') as f: shutil.copyfileobj(r, f)
    im = ImageOps.exif_transpose(Image.open('/tmp/f.jpg')).convert('RGB'); im.thumbnail((1600, 1600)); im.save(f'{OUT}/{s}_{nome}', quality=85); print(s, nome)
