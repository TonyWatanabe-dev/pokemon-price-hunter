#!/usr/bin/env python3
"""Põe a trilha (Artlist, trilhas.json) nos vídeos GSAP mudos de tmp-gsap/: só trilha, sem áudio original (pedido do dono, 31/10).
Pedido em tools/gsap/pecas.json: [{"mudo": "tmp-gsap/X.mp4", "saida": "tmp-render/G_X.mp4", "trilha": "hype_abertura", "ini": 0}]."""
import os, json, shutil, subprocess, urllib.request
AQUI = os.path.dirname(os.path.abspath(__file__))
TR = json.load(open(os.path.join(AQUI, 'trilhas.json'))); P = json.load(open('tools/gsap/pecas.json'))
for p in P:
    wav = f"/tmp/{p['trilha']}.wav"
    if not os.path.exists(wav):
        with urllib.request.urlopen(TR[p['trilha']]['url'], timeout=300) as r, open(wav, 'wb') as f: shutil.copyfileobj(r, f)
    dur = float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', p['mudo']], capture_output=True, text=True).stdout)
    af = f"atrim=start={p.get('ini', 0)},asetpts=PTS-STARTPTS,atrim=0:{dur:.2f},afade=t=in:d=0.4,afade=t=out:st={dur - 1.6:.2f}:d=1.6,volume=0.9"
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', p['mudo'], '-i', wav, '-filter_complex', f'[1:a]{af}[a]', '-map', '0:v', '-map', '[a]',
                    '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', p['saida']], check=True)
    print('ok', p['saida'], flush=True)
