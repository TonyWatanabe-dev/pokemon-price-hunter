#!/usr/bin/env python3
"""Temporário: menor preço já registrado pelo site (estatísticas + histórico) dos produtos dos vídeos."""
import json, os, urllib.request
OUT = 'tmp-precos'; os.makedirs(OUT, exist_ok=True)
H = {'User-Agent': 'Mozilla/5.0 tcgpricehunter-social', 'Accept': 'application/json'}
def get(path):
    try:
        with urllib.request.urlopen(urllib.request.Request('https://tcgpricehunter.com.br' + path, headers=H), timeout=60) as r:
            return json.loads(r.read())
    except Exception as e: return {'erro': str(e)}
ids = ['c30-etb', 'c30-colecao_poster', 'c30-blister2', 'c30-blister3', 'c30-booster', 'c30-combo',
       'me01-desafio', 'me02-desafio', 'me03-desafio', 'me04-desafio', 'me05-desafio', 'sv8-deck-miraidon']
res = {}
for i in ids:
    res[i] = {'estatisticas': get(f'/api/v1/produtos/{i}/estatisticas'), 'site': get(f'/api/v1/site/produto/{i}'),
              'historico': get(f'/api/v1/produtos/{i}/historico?dias=365')}
json.dump(res, open(f'{OUT}/historico.json', 'w'), indent=1, ensure_ascii=False)
