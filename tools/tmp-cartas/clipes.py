# Baixa os clipes Artlist (Veo 3.1, sem áudio) e gera uma folha de quadros (1s/3s/5s) de cada um para revisão.
import json, os, subprocess, urllib.request
base = os.path.dirname(__file__); out = 'tmp-render'; os.makedirs(out, exist_ok=True)
for nome, c in json.load(open(os.path.join(base, 'clipes.json'))).items():
    mp4 = f'{out}/C_{nome}.mp4'
    if not os.path.exists(mp4):
        urllib.request.urlretrieve(c['url'], mp4)
    subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', mp4, '-vf',
                    "select='eq(n\\,24)+eq(n\\,72)+eq(n\\,120)',scale=270:-1,tile=3x1", '-frames:v', '1', '-vsync', '0',
                    f'{out}/C_{nome}.jpg'], check=False)
    print(nome, os.path.getsize(mp4))
