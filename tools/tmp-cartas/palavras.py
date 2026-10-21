#!/usr/bin/env python3
"""Temporário: tempos por palavra (faster-whisper) dos áudios de voz em tmp-render/VOZ_*.mp3 e nas falas do comparativo."""
import glob, json, os, shutil, subprocess, urllib.request, wave
import numpy as np
from faster_whisper import WhisperModel
m = WhisperModel('small', device='cpu', compute_type='int8')
alvos = {os.path.basename(p)[4:-4]: p for p in glob.glob('tmp-render/VOZ_g*.mp3') + glob.glob('tmp-render/VOZ_cta*.mp3')}
for k, c in enumerate(json.load(open('tools/tmp-cartas/comp_fala.json'))['ia']):
    p = f'/tmp/ia{k}.mp3'
    with urllib.request.urlopen(urllib.request.Request(c['url'], headers={'User-Agent': 'Mozilla/5.0'}), timeout=300) as r, open(p, 'wb') as f: shutil.copyfileobj(r, f)
    alvos[f'ia{k}'] = p
res = {}
for n, p in sorted(alvos.items()):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', p, '-ac', '1', '-ar', '16000', '-af', 'silenceremove=start_periods=1:start_threshold=-45dB,areverse,silenceremove=start_periods=1:start_threshold=-45dB,areverse', '-f', 's16le', '-'], capture_output=True, check=True).stdout
    a = np.frombuffer(raw, np.int16).astype(np.float32) / 32768
    segs, _ = m.transcribe(a, language='pt', word_timestamps=True)
    res[n] = [[round(w.start, 2), round(w.end, 2), w.word.strip()] for s in segs for w in (s.words or [])]
json.dump(res, open('tmp-render/PALAVRAS.json', 'w'), ensure_ascii=False, indent=0)
