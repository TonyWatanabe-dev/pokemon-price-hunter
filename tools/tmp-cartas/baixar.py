import json,os,urllib.request
os.makedirs('tmp-dragonite/baixados',exist_ok=True)
for nome,urls in json.load(open('tools/tmp-cartas/baixar.json')).items():
    for u in urls:
        try:
            with urllib.request.urlopen(urllib.request.Request(u,headers={'User-Agent':'Mozilla/5.0'}),timeout=60) as r: b=r.read()
            if len(b)>20000: open(f'tmp-dragonite/baixados/{nome}.png','wb').write(b); print('ok',nome,u,len(b)); break
        except Exception as e: print('x',nome,u,e)
