#!/usr/bin/env python3
"""Temporário: copia a vitrine pública do site (menor preço por produto) para a curadoria dos vídeos."""
import json, os, urllib.request
OUT = 'tmp-precos'; os.makedirs(OUT, exist_ok=True)
H = {'User-Agent': 'Mozilla/5.0 tcgpricehunter-social', 'Accept': 'application/json'}
def get(path):
    with urllib.request.urlopen(urllib.request.Request('https://tcgpricehunter.com.br' + path, headers=H), timeout=60) as r:
        return json.loads(r.read())
res = {}
for modo in ('abrir', 'guardar'):
    itens, pag = [], 1
    while pag < 40:
        try: d = get(f'/api/v1/site/produtos?modo={modo}&limite=60&pagina={pag}')
        except Exception as e: res[f'erro_{modo}_{pag}'] = str(e); break
        res.setdefault(f'meta_{modo}', {k: v for k, v in d.items() if not isinstance(v, list)})
        lst = next((v for v in d.values() if isinstance(v, list) and v and isinstance(v[0], dict)), [])
        if not lst: break
        itens += lst; pag += 1
    res[modo] = itens
json.dump(res, open(f'{OUT}/vitrine.json', 'w'), indent=1, ensure_ascii=False)
# rodada 1792277371
