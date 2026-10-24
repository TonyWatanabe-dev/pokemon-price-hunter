#!/usr/bin/env python3
"""Troca o áudio dos vídeos agendados por uma trilha só (a nossa, gerada no Artlist), sem refazer a imagem.
Pedido do dono em 24/10: Content ID bloqueou um Short pela música do áudio original ("Funky Sparks"). Saída tmp-render/M_<nome>.mp4."""
import json, os, shutil, subprocess, urllib.request
AQUI = os.path.dirname(os.path.abspath(__file__)); T = '/tmp/remix'; os.makedirs(T, exist_ok=True); os.makedirs('tmp-render', exist_ok=True)
FONTES = json.load(open(os.path.join(AQUI, 'remix.json')))
TRILHA = json.load(open(os.path.join(AQUI, 'comp_fala.json')))['trilha']
def baixa(url, arq):
    for t in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'}), timeout=120) as r, open(arq + '.part', 'wb') as f: shutil.copyfileobj(r, f, 1 << 22)
            os.replace(arq + '.part', arq); return arq
        except Exception as e: print('baixa', url[:60], t, repr(e), flush=True)
    raise RuntimeError('não baixou ' + url[:80])
tr = baixa(TRILHA, f'{T}/trilha.wav')
log = []
for nome, f in FONTES.items():
    try:
        src = f.get('arquivo') or baixa(f'https://drive.usercontent.google.com/download?id={f["drive"]}&export=download&confirm=t', f'{T}/{nome}.mp4')
        dur = float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', src], capture_output=True, text=True, check=True).stdout)
        out = f'tmp-render/M_{nome}.mp4'
        af = f'[1:a]aloop=loop=-1:size=2e9,atrim=0:{dur:.2f},afade=t=in:d=0.5,afade=t=out:st={max(dur - 1.5, 0):.2f}:d=1.5,loudnorm=I=-16:TP=-1.5[a]'
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', src, '-i', tr, '-filter_complex', af, '-map', '0:v:0', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '160k', '-t', f'{dur:.2f}', '-movflags', '+faststart', out], check=True)
        log.append(f'ok {nome} {dur:.1f}s')
    except Exception as e: log.append(f'FALHOU {nome}: {e}')
    print(log[-1], flush=True)
open('tmp-render/M_log.txt', 'w').write('\n'.join(log) + '\n')
