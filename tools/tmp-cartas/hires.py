#!/usr/bin/env python3
"""Quadros nítidos (1 por segundo, largura total) dos vídeos-vitrine dos hits, para ler número e raridade. Saída tmp-inv/hires/."""
import os, shutil, subprocess, urllib.request
OUT = 'tmp-inv/hires'; os.makedirs(OUT, exist_ok=True)
for nome, fid, a, b in [('fogo_171235', '1lWnnC0punp3nKS9x_JKb4e1csZrEZu_i', 0, 52), ('esc_174158', '10L2pO4kZWKCc0yI6ctYBMOHXkHZHUucD', 0, 60)]:
    arq = f'/tmp/{nome}.mp4'
    with urllib.request.urlopen(urllib.request.Request(f'https://drive.usercontent.google.com/download?id={fid}&export=download&confirm=t', headers={'User-Agent': 'Mozilla/5.0'}), timeout=300) as r, open(arq, 'wb') as f: shutil.copyfileobj(r, f, 1 << 22)
    subprocess.run(['ffmpeg', '-v', 'error', '-ss', str(a), '-to', str(b), '-i', arq, '-vf', 'fps=1,scale=1080:-2', '-q:v', '3', f'{OUT}/{nome}_%03d.jpg'], check=True)
    os.remove(arq)
