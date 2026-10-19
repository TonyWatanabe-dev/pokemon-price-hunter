#!/usr/bin/env python3
"""Temporário: catálogo do site + menor preço registrado de produtos casados por nome (lata 30 anos, ETB ME, deck Lucario)."""
import json, os, re, urllib.request
OUT = 'tmp-precos'; os.makedirs(OUT, exist_ok=True)
H = {'User-Agent': 'Mozilla/5.0 tcgpricehunter-social', 'Accept': 'application/json'}
def get(path):
    try:
        with urllib.request.urlopen(urllib.request.Request('https://tcgpricehunter.com.br' + path, headers=H), timeout=60) as r:
            return json.loads(r.read())
    except Exception as e: return {'erro': str(e)}
cat = {}
for modo in ('abrir', 'guardar'):
    for semref in ('', '&semref=1'):
        for p in range(1, 15):
            d = get(f'/api/v1/site/produtos?modo={modo}&limite=60&pagina={p}{semref}')
            itens = next((v for v in (d.values() if isinstance(d, dict) else []) if isinstance(v, list)), d if isinstance(d, list) else [])
            if not itens: break
            for it in itens:
                pp, oo = it.get('p', {}), it.get('o', {}) or {}
                if pp.get('id'): cat[pp['id']] = {'col': pp.get('collectionName'), 'tipo': pp.get('typeLabel'), 'var': pp.get('variant'), 'msrp': pp.get('msrp') or pp.get('copagReference'), 'preco': oo.get('price'), 'loja': oo.get('storeName')}
json.dump(cat, open(f'{OUT}/catalogo.json', 'w'), indent=1, ensure_ascii=False)
alvo = re.compile(r'^c30-|lucario|me04-etb|baralho|deck|lata|tin', re.I)
res = {}
for pid, v in cat.items():
    if alvo.search(pid + ' ' + json.dumps(v, ensure_ascii=False)):
        res[pid] = {'catalogo': v, 'estatisticas': get(f'/api/v1/produtos/{pid}/estatisticas'), 'site': get(f'/api/v1/site/produto/{pid}')}
json.dump(res, open(f'{OUT}/alvos.json', 'w'), indent=1, ensure_ascii=False)
print(len(cat), 'produtos;', len(res), 'alvos')
