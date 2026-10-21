#!/usr/bin/env python3
"""Temporário: brutos do Blister Duplo (18/10) — metadados, transcrição (faster-whisper), silêncios e mosaicos."""
import json, os, subprocess, shutil, urllib.request
OUT = os.environ.get('SAIDA', 'tmp-blister'); os.makedirs(OUT, exist_ok=True)
V = json.load(open(os.environ.get('ENTRADA', 'tools/tmp-cartas/blister.json')))
from faster_whisper import WhisperModel
modelo = WhisperModel('small', device='cpu', compute_type='int8')
rel = {}
for nome, fid in V.items():
    arq = f'/tmp/{nome}.mp4'
    try:
        req = urllib.request.Request(f'https://drive.usercontent.google.com/download?id={fid}&export=download&confirm=t', headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=900) as r, open(arq, 'wb') as f: shutil.copyfileobj(r, f, 1 << 22)
        p = json.loads(subprocess.run(['ffprobe', '-v', 'quiet', '-print_format', 'json', '-show_format', '-show_streams', arq], capture_output=True, text=True).stdout)
        v = [s for s in p['streams'] if s['codec_type'] == 'video'][0]
        dur = float(p['format']['duration'])
        info = {'dur': round(dur, 1), 'w': v['width'], 'h': v['height'], 'rot': (v.get('side_data_list') or [{}])[0].get('rotation'), 'fps': v.get('r_frame_rate'), 'tamanho_mb': round(os.path.getsize(arq) / 1e6)}
        # áudio -> transcrição com tempos por palavra
        wav = f'/tmp/{nome}.wav'; subprocess.run(['ffmpeg', '-v', 'quiet', '-y', '-i', arq, '-ac', '1', '-ar', '16000', wav], check=True)
        import wave, numpy as np
        with wave.open(wav) as w: audio = np.frombuffer(w.readframes(w.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
        segs, _ = modelo.transcribe(audio, language='pt', word_timestamps=True, vad_filter=True)
        info['fala'] = [{'i': round(s.start, 2), 'f': round(s.end, 2), 't': s.text.strip(), 'p': [[round(w.start, 2), round(w.end, 2), w.word] for w in (s.words or [])]} for s in segs]
        sd = subprocess.run(['ffmpeg', '-i', wav, '-af', 'silencedetect=noise=-35dB:d=0.6', '-f', 'null', '-'], capture_output=True, text=True).stderr
        info['silencios'] = [l.split('silence_')[1].strip() for l in sd.splitlines() if 'silence_start' in l or 'silence_end' in l]
        # mosaico: 1 quadro a cada 2 s, 6 colunas
        d = f'{OUT}/{nome}'; os.makedirs(d, exist_ok=True)
        subprocess.run(['ffmpeg', '-v', 'quiet', '-i', arq, '-vf', "fps=0.5,scale=300:-2,drawtext=text='%{pts\\:hms}':x=4:y=4:fontsize=18:fontcolor=white:box=1:boxcolor=black,tile=6x4", f'{d}/m%02d.jpg'])
        rel[nome] = info
    except Exception as e:
        rel[nome] = {'erro': repr(e)}
    finally:
        for x in (arq, f'/tmp/{nome}.wav'):
            if os.path.exists(x): os.remove(x)
    json.dump(rel, open(f'{OUT}/relatorio.json', 'w'), indent=1, ensure_ascii=False)
