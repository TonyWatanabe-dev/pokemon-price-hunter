#!/usr/bin/env python3
"""Temporário: quadros em resolução cheia + faixa do placar a 10 qps para refazer o placar com preço do site."""
import json, os, subprocess, urllib.request
OUT = 'tmp-quadros'; os.makedirs(OUT, exist_ok=True)
V = json.load(open('tools/tmp-cartas/videos.json'))
pedidos = {'30A_deulucro': [2, 5, 35], '30A_etb_abertura_v2': [1, 80, 150], '30A_poster_abertura': [1, 70], '30A_blister_abertura': [1, 45],
           '30A_hit_pikachu_v2': [1, 14], 'DE_video01': [1, 44], 'DE_caixa_8packs': [1, 30], 'MIR_unboxing': [1, 30]}
info = {}
for nome, ts in pedidos.items():
    arq = f'/tmp/{nome}.mp4'
    req = urllib.request.Request(f'https://drive.usercontent.google.com/download?id={V[nome]}&export=download&confirm=t', headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=300) as r, open(arq, 'wb') as f: f.write(r.read())
    p = json.loads(subprocess.run(['ffprobe', '-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', arq], capture_output=True, text=True).stdout)
    v = [s for s in p['streams'] if s['codec_type'] == 'video'][0]
    info[nome] = {'w': v['width'], 'h': v['height'], 'fps': v['r_frame_rate'], 'dur': p['format']['duration'], 'vcodec': v['codec_name'], 'bitrate': p['format'].get('bit_rate')}
    for t in ts:
        subprocess.run(['ffmpeg', '-y', '-v', 'quiet', '-ss', str(t), '-i', arq, '-frames:v', '1', '-q:v', '3', f'{OUT}/{nome}_t{t}.jpg'])
    # faixa superior (0–18% da altura) a 10 qps, para achar os instantes de troca do placar
    d = f'{OUT}/{nome}_faixa'; os.makedirs(d, exist_ok=True)
    subprocess.run(['ffmpeg', '-y', '-v', 'quiet', '-i', arq, '-vf', "fps=10,crop=iw*0.6:ih*0.18:iw*0.2:0,scale=324:-2", '-q:v', '4', f'{d}/%05d.jpg'])
    os.remove(arq)
json.dump(info, open(f'{OUT}/info.json', 'w'), indent=1)
