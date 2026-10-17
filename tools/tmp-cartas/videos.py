#!/usr/bin/env python3
"""Temporário: baixa os cortes do Drive (públicos) e extrai metadados + quadros para catalogação."""
import json, os, subprocess, urllib.request
OUT = 'tmp-videos'; os.makedirs(OUT, exist_ok=True)
lista = json.load(open('tools/tmp-cartas/videos.json'))
res = {}
for nome, fid in lista.items():
    arq = f'/tmp/{nome}.mp4'
    try:
        req = urllib.request.Request(f'https://drive.usercontent.google.com/download?id={fid}&export=download&confirm=t', headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=300) as r, open(arq, 'wb') as f:
            while True:
                b = r.read(1 << 20)
                if not b: break
                f.write(b)
        p = json.loads(subprocess.run(['ffprobe', '-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', arq], capture_output=True, text=True).stdout)
        v = [s for s in p['streams'] if s['codec_type'] == 'video'][0]
        a = [s for s in p['streams'] if s['codec_type'] == 'audio']
        dur = float(p['format']['duration'])
        info = {'id': fid, 'dur': round(dur, 1), 'w': v['width'], 'h': v['height'], 'fps': v.get('r_frame_rate'), 'audio': bool(a)}
        if a:
            vol = subprocess.run(['ffmpeg', '-i', arq, '-af', 'volumedetect', '-vn', '-f', 'null', '-'], capture_output=True, text=True).stderr
            info['volume'] = [l.split(':', 1)[1].strip() for l in vol.splitlines() if 'mean_volume' in l or 'max_volume' in l]
        # 12 quadros igualmente espaçados + primeiro segundo
        n = 12
        os.makedirs(f'{OUT}/{nome}', exist_ok=True)
        for i in range(n):
            t = 0.05 if i == 0 else dur * i / n
            subprocess.run(['ffmpeg', '-y', '-v', 'quiet', '-ss', f'{t:.2f}', '-i', arq, '-frames:v', '1', '-vf', 'scale=270:-2', f'{OUT}/{nome}/f{i:02d}_{t:05.1f}s.jpg'])
        subprocess.run(['ffmpeg', '-y', '-v', 'quiet', '-i', arq, '-frames:v', '1', '-vf', f'select=gte(t\\,{max(dur-0.3,0):.2f}),scale=270:-2', f'{OUT}/{nome}/f99_fim.jpg'])
        res[nome] = info
    except Exception as e:
        res[nome] = {'id': fid, 'erro': str(e)}
    finally:
        if os.path.exists(arq): os.remove(arq)
json.dump(res, open(f'{OUT}/catalogo.json', 'w'), indent=1, ensure_ascii=False)
