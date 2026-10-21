#!/usr/bin/env python3
"""Temporário: extrai o áudio bruto da gravação C2 (voz do Tony) para o teste de voz de IA (speech-to-speech)."""
import shutil, subprocess, urllib.request
req = urllib.request.Request('https://drive.usercontent.google.com/download?id=1dCaDIJuY4xmxehOrxg49xNbjSonPmIUr&export=download&confirm=t', headers={'User-Agent': 'Mozilla/5.0'})
with urllib.request.urlopen(req, timeout=900) as r, open('/tmp/C2.mp4', 'wb') as f: shutil.copyfileobj(r, f, 1 << 22)
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', '/tmp/C2.mp4', '-vn', '-ac', '1', '-ar', '44100', '-af', 'highpass=f=80,afftdn=nr=12:nf=-32', '-b:a', '192k', 'tmp-render/C2_voz.mp3'], check=True)
