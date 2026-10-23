"""Temporário: quadros em resolução cheia nos momentos das cartas boas (para ler o número da carta)."""
import json, os, subprocess, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
os.environ.setdefault('PECAS', '_nenhum_')
J = json.load(open('tools/tmp-cartas/quadros_hd.json'))
os.makedirs('tmp-dragonite/hd', exist_ok=True)
import importlib.util
spec = importlib.util.spec_from_file_location('ub', 'tools/tmp-cartas/unbox.py'); ub = importlib.util.module_from_spec(spec)
try: spec.loader.exec_module(ub)
except Exception as e: print('unbox import', e)
for nome, (src, ts) in J.items():
    arq = ub.baixa(src)
    for k, t in enumerate(ts):
        subprocess.run(['ffmpeg', '-v', 'quiet', '-y', '-ss', str(t), '-i', arq, '-frames:v', '1', '-q:v', '2', f'tmp-dragonite/hd/{nome}_{k}.jpg'])
