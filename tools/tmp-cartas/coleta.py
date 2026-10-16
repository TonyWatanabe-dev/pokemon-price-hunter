#!/usr/bin/env python3
"""Temporário: baixa dados e imagens do TCGdex no runner (o sandbox de produção das artes não acessa o TCGdex)."""
import json, os, sys, urllib.request, urllib.parse, concurrent.futures as cf
OUT = 'tmp-cartas'
os.makedirs(OUT, exist_ok=True)
UA = {'User-Agent': 'TCGPriceHunterBot/1.0'}
def get(url, binary=False):
    req = urllib.request.Request(url, headers=UA)
    with urllib.request.urlopen(req, timeout=60) as r:
        b = r.read()
    return b if binary else json.loads(b)
def save(name, obj):
    with open(os.path.join(OUT, name), 'w', encoding='utf-8') as f:
        json.dump(obj, f, ensure_ascii=False, indent=1)
pedido = json.load(open('tools/tmp-cartas/pedido.json'))
for nome, url in pedido.get('json', {}).items():
    try: save(nome + '.json', get(url))
    except Exception as e: save(nome + '.erro.json', {'url': url, 'erro': str(e)})
# detalhes de todas as cartas de cada set pedido
for sid, lang in pedido.get('sets_detalhe', []):
    try:
        s = get(f'https://api.tcgdex.net/v2/{lang}/sets/{sid}')
        def det(c):
            try: return get(f'https://api.tcgdex.net/v2/{lang}/cards/{urllib.parse.quote(c["id"])}')
            except Exception as e: return {'id': c['id'], 'erro': str(e)}
        with cf.ThreadPoolExecutor(8) as ex: cards = list(ex.map(det, s.get('cards', [])))
        s['cards'] = [{k: c.get(k) for k in ('id','localId','name','illustrator','rarity','image','category','hp','types','stage')} for c in cards]
        save(f'set-{lang}-{sid}.json', s)
    except Exception as e: save(f'set-{lang}-{sid}.erro.json', {'erro': str(e)})
for nome, url in pedido.get('imagens', {}).items():
    try:
        b = get(url, binary=True)
        open(os.path.join(OUT, nome), 'wb').write(b)
    except Exception as e: save(nome + '.erro.json', {'url': url, 'erro': str(e)})
