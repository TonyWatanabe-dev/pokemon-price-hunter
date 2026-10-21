#!/usr/bin/env python3
"""Temporário: smoke da página /entrar em produção."""
import json, urllib.request
H = {'User-Agent': 'Mozilla/5.0 tcgpricehunter-smoke'}
out = {}
for path in ['/entrar', '/assets/web/entrar-v2.js', '/assets/web/entrar-cartas-v1.webp', '/api/v1/produtos/c30-etb/estatisticas']:
    try:
        with urllib.request.urlopen(urllib.request.Request('https://tcgpricehunter.com.br' + path, headers=H), timeout=60) as r:
            b = r.read().decode('utf8', 'replace'); out[path] = {'status': r.status, 'tamanho': len(b), 'trecho': b[:300] if path != '/entrar' else [l.strip()[:160] for l in b.splitlines() if '<h1' in l or 'use href' in l or 'entrar-v2' in l][:6]}
    except Exception as e: out[path] = {'erro': str(e)}
json.dump(out, open('tmp-render/SMOKE.json', 'w'), ensure_ascii=False, indent=1)
