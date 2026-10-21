#!/usr/bin/env python3
"""Temporário: baixa áudios gerados no Artlist (vozes/trilha) para tmp-render/VOZ_*."""
import json, shutil, urllib.request
for n, u in json.load(open('tools/tmp-cartas/vozes.json')).items():
    ext = 'wav' if '.wav' in u.split('?')[0] else 'mp3'
    with urllib.request.urlopen(urllib.request.Request(u, headers={'User-Agent': 'Mozilla/5.0'}), timeout=300) as r, open(f'tmp-render/VOZ_{n}.{ext}', 'wb') as f: shutil.copyfileobj(r, f)
