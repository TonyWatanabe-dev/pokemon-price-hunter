#!/usr/bin/env python3
"""Temporário: extrai o áudio da gravação extra (C4) para clonar a voz do Tony no Artlist."""
import shutil, subprocess, urllib.request
req = urllib.request.Request('https://drive.usercontent.google.com/download?id=1cF4IdwEn8BDURUePgsdEvfJZ2kOFqJaY&export=download&confirm=t', headers={'User-Agent': 'Mozilla/5.0'})
with urllib.request.urlopen(req, timeout=900) as r, open('/tmp/C4.mp4', 'wb') as f: shutil.copyfileobj(r, f, 1 << 22)
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', '/tmp/C4.mp4', '-vn', '-ac', '1', '-ar', '44100', '-af', 'highpass=f=80,afftdn=nr=12:nf=-32,loudnorm=I=-16', '-b:a', '192k', 'tmp-render/C4_voz.mp3'], check=True)
