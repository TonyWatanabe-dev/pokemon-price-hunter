#!/usr/bin/env python3
"""31/10, pedido do dono: daqui para frente só a trilha do Short mais visto (trilhas.json short_top).
Troca o áudio inteiro dos vídeos sem fala (slideshows, motion e vídeos do site) por ela. Saída tmp-render/T_<nome>.mp4."""
import json, os, shutil, subprocess, urllib.request
AQUI = os.path.dirname(os.path.abspath(__file__)); T = '/tmp/tu'; os.makedirs(T, exist_ok=True)
TR = json.load(open(os.path.join(AQUI, 'trilhas.json')))['short_top']['url']
L = json.load(open(os.path.join(AQUI, 'trilha_unica.json')))
def baixa(url, arq):
    for t in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'}), timeout=300) as r, open(arq + '.part', 'wb') as f: shutil.copyfileobj(r, f, 1 << 22)
            os.replace(arq + '.part', arq); return arq
        except Exception as e: print('baixa', t, repr(e), flush=True)
    raise RuntimeError('não baixou')
tr = baixa(TR, f'{T}/trilha.wav')
for nome, fonte in L.items():
    try:
        src = fonte if fonte.startswith('tmp-render/') else baixa(f'https://drive.usercontent.google.com/download?id={fonte}&export=download&confirm=t', f'{T}/{nome}.mp4')
        dur = float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', src], capture_output=True, text=True, check=True).stdout)
        af = f'[1:a]aloop=loop=-1:size=2e9,atrim=0:{dur:.2f},afade=t=in:d=0.5,afade=t=out:st={max(dur - 1.5, 0):.2f}:d=1.5,loudnorm=I=-16:TP=-1.5[a]'
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', src, '-i', tr, '-filter_complex', af, '-map', '0:v:0', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k',
                        '-t', f'{dur:.2f}', '-movflags', '+faststart', f'tmp-render/T_{nome}.mp4'], check=True)
        print('ok', nome, f'{dur:.1f}s', flush=True)
    except Exception as e: print('FALHOU', nome, repr(e), flush=True)
