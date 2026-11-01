#!/usr/bin/env python3
"""Compõe um vídeo GSAP mudo a partir de vários trechos brutos + a camada GSAP renderizada quadro a quadro.
config: "segs": [[arquivo, início, fim], ...] em sequência (corte seco entre eles; a camada cobre a troca com um flash).
Câmera: aproximação lenta de 3% + "soco" de 6% no hit (decai em 0,7 s). Uso: compor.py <config.json> <saída.mp4>"""
import json, os, subprocess, sys, tempfile
AQUI = os.path.dirname(os.path.abspath(__file__))
cfg = json.load(open(sys.argv[1])); out = sys.argv[2]; D, H = cfg['dur'], cfg['hitT']
q = tempfile.mkdtemp()
subprocess.run(['node', os.path.join(AQUI, 'render.cjs'), sys.argv[1], q, '30'], check=True)
args, partes = [], []
for i, (arq, a, b) in enumerate(cfg['segs']):
    args += ['-ss', str(a), '-t', str(b - a), '-i', os.path.join(AQUI, arq)]
    partes.append(f'[{i}:v]fps=30,scale=1080:1920,setsar=1,setpts=PTS-STARTPTS[s{i}]')
n = len(cfg['segs'])
Z = f"(1+0.03*t/{D}+0.06*if(between(t\\,{H}\\,{H}+0.7)\\,1-(t-{H})/0.7\\,0))"
fc = ';'.join(partes) + ';' + ''.join(f'[s{i}]' for i in range(n)) + f'concat=n={n}:v=1:a=0[c];' \
     f"[c]tpad=stop_mode=clone:stop_duration={D},trim=0:{D},setpts=PTS-STARTPTS,scale=w='2*trunc(540*{Z})':h='2*trunc(960*{Z})':eval=frame:flags=bicubic,crop=1080:1920[b];" \
     f'[b][{n}:v]overlay=0:0:format=auto,format=yuv420p[v]'
subprocess.run(['ffmpeg', '-v', 'error', '-y', *args, '-framerate', '30', '-i', f'{q}/%05d.png', '-filter_complex', fc,
                '-map', '[v]', '-an', '-c:v', 'libx264', '-crf', '19', '-preset', 'medium', '-r', '30', '-t', str(D), '-movflags', '+faststart', out], check=True)
subprocess.run(['rm', '-rf', q]); print('ok', out)
