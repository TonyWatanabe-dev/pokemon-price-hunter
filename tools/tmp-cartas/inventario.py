#!/usr/bin/env python3
"""Inventário dos brutos novos (31/10): Fogo Fantasmagórico (48 packs) e Escuridão Absoluta (booster box).
Para cada vídeo: duração, folhas de quadros a cada 2 s (com o tempo) e transcrição (faster-whisper base, pt).
Fotos: cópia reduzida. Saída tmp-inv/<set>/. Uso: SET=fogo|esc python3 inventario.py"""
import os, sys, json, shutil, subprocess, urllib.request
from PIL import Image, ImageDraw, ImageFont
AQUI = os.path.dirname(os.path.abspath(__file__)); SET = os.environ['SET']
OUT = f'tmp-inv/{SET}'; os.makedirs(OUT, exist_ok=True); T = '/tmp/inv'; os.makedirs(T, exist_ok=True)
F = ImageFont.truetype(os.path.join(AQUI, 'rubik800.ttf'), 22) if os.path.exists(os.path.join(AQUI, 'rubik800.ttf')) else ImageFont.load_default()
def baixa(fid, arq):
    for t in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(f'https://drive.usercontent.google.com/download?id={fid}&export=download&confirm=t', headers={'User-Agent': 'Mozilla/5.0'}), timeout=300) as r, open(arq + '.part', 'wb') as f: shutil.copyfileobj(r, f, 1 << 22)
            os.replace(arq + '.part', arq); return arq
        except Exception as e: print('baixa', fid, t, repr(e), flush=True)
    raise RuntimeError('não baixou ' + fid)
from faster_whisper import WhisperModel
M = WhisperModel('base', device='cpu', compute_type='int8')
rel = json.load(open(f'{OUT}/inventario.json')) if os.path.exists(f'{OUT}/inventario.json') else {}
for linha in open(os.path.join(AQUI, 'inv_ids.txt')):
    if not linha.strip(): continue
    s, fid, nome = linha.split()
    if s != SET or nome in rel: continue
    try:
        if nome.endswith('.jpg'):
            im = Image.open(baixa(fid, f'{T}/x.jpg')); im = im.convert('RGB'); im.thumbnail((1440, 1440)); im.save(f'{OUT}/F_{nome}', quality=85)
            rel[nome] = {'foto': True}; continue
        arq = baixa(fid, f'{T}/{nome}.mp4')
        pr = json.loads(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration:stream=width,height,codec_type:stream_side_data=rotation', '-of', 'json', arq], capture_output=True, text=True).stdout)
        dur = float(pr['format']['duration'])
        fr = f'{T}/fr'; shutil.rmtree(fr, ignore_errors=True); os.makedirs(fr)
        subprocess.run(['ffmpeg', '-v', 'error', '-i', arq, '-vf', 'fps=0.5,scale=180:-2', f'{fr}/%04d.jpg'], check=True)
        fs = sorted(os.listdir(fr)); k = 0
        for a in range(0, len(fs), 60):
            bloco = fs[a:a + 60]; ims = [Image.open(f'{fr}/{x}') for x in bloco]; w, h = ims[0].size
            sh = Image.new('RGB', (10 * w, ((len(ims) + 9) // 10) * h), 'white'); d = ImageDraw.Draw(sh)
            for i, im in enumerate(ims):
                x, y = (i % 10) * w, (i // 10) * h; sh.paste(im, (x, y)); t = (a + i) * 2
                d.rectangle((x, y, x + 64, y + 26), fill='black'); d.text((x + 3, y + 1), f'{t // 60}:{t % 60:02d}', font=F, fill='yellow')
            sh.save(f'{OUT}/{nome}_s{k:02d}.jpg', quality=70); k += 1
        wav = f'{T}/a.wav'; subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', arq, '-vn', '-ac', '1', '-ar', '16000', wav], check=True)
        segs, _ = M.transcribe(wav, language='pt', vad_filter=True)
        fala = [[round(g.start, 1), round(g.end, 1), g.text.strip()] for g in segs]
        rel[nome] = {'id': fid, 'dur': round(dur, 1), 'stream': pr.get('streams'), 'folhas': k, 'fala': fala}
        os.remove(arq); os.remove(wav)
    except Exception as e:
        rel[nome] = {'erro': repr(e)[:300]}
    print(nome, json.dumps(rel[nome], ensure_ascii=False)[:200], flush=True)
    json.dump(rel, open(f'{OUT}/inventario.json', 'w'), ensure_ascii=False, indent=1)
