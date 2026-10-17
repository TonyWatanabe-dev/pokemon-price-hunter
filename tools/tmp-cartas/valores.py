#!/usr/bin/env python3
"""Temporário: quadros densos dos cortes 30 Anos para ler os selos de valor; testa acesso à Liga."""
import json, os, subprocess, urllib.request
OUT = 'tmp-valores'; os.makedirs(OUT, exist_ok=True)
lista = {k: v for k, v in json.load(open('tools/tmp-cartas/videos.json')).items() if k.startswith('30A_') and k not in ('30A_etb_abertura', '30A_hit_pikachu')}
for nome, fid in lista.items():
    arq = f'/tmp/{nome}.mp4'
    req = urllib.request.Request(f'https://drive.usercontent.google.com/download?id={fid}&export=download&confirm=t', headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req, timeout=300) as r, open(arq, 'wb') as f:
        f.write(r.read())
    d = f'{OUT}/{nome}'; os.makedirs(d, exist_ok=True)
    # 2 quadros por segundo, 360 px de largura, em mosaico 6 colunas
    subprocess.run(['ffmpeg', '-y', '-v', 'quiet', '-i', arq, '-vf', "fps=2,scale=360:-2,drawtext=text='%{pts\\:hms}':x=5:y=5:fontsize=18:fontcolor=white:box=1:boxcolor=black,tile=6x5", f'{d}/m%02d.jpg'])
    os.remove(arq)
# teste de acesso à Liga Pokémon a partir do runner
res = {}
for u in ['https://www.ligapokemon.com.br/?view=cards/card&card=Pikachu%20ex%20(150/128)&ed=30CP&num=150', 'https://www.ligapokemon.com.br/']:
    try:
        req = urllib.request.Request(u, headers={'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36', 'Accept-Language': 'pt-BR'})
        with urllib.request.urlopen(req, timeout=60) as r:
            b = r.read().decode('utf-8', 'replace'); res[u] = {'status': r.status, 'len': len(b), 'trecho': b[:1500]}
    except Exception as e:
        res[u] = {'erro': str(e)}
json.dump(res, open(f'{OUT}/liga.json', 'w'), indent=1, ensure_ascii=False)
