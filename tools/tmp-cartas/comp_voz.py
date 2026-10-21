#!/usr/bin/env python3
"""Temporário: baixa as vozes de IA (Artlist) para tmp-render/VOZ_*.mp3."""
import json, shutil, urllib.request
for n, u in json.load(open('tools/tmp-cartas/vozes.json')).items():
    with urllib.request.urlopen(urllib.request.Request(u, headers={'User-Agent': 'Mozilla/5.0'}), timeout=300) as r, open(f'tmp-render/VOZ_{n}.mp3', 'wb') as f: shutil.copyfileobj(r, f)
