#!/usr/bin/env python3
"""Temporário: smoke da página /entrar em produção."""
import json, urllib.request
H = {'User-Agent': 'Mozilla/5.0 tcgpricehunter-smoke'}
out = {}
for path in ['/entrar/ig-comparativo', '/ir/whatsapp/ig-comparativo', '/assets/web/ir-v1.js', '/assets/web/entrar-v3.js']:
    try:
        with urllib.request.urlopen(urllib.request.Request('https://tcgpricehunter.com.br' + path, headers=H), timeout=60) as r:
            b = r.read().decode('utf8', 'replace'); out[path] = {'status': r.status, 'tamanho': len(b), 'trecho': b[:300] if not path.startswith(('/entrar/', '/ir/')) else [l.strip()[:160] for l in b.splitlines() if '<h1' in l or 'entrar-v3' in l or 'data-wa' in l or 'refresh' in l][:6]}
    except Exception as e: out[path] = {'erro': str(e)}
json.dump(out, open('tmp-render/SMOKE.json', 'w'), ensure_ascii=False, indent=1)
