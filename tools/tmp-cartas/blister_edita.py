#!/usr/bin/env python3
"""Temporário: edita os brutos do Blister Duplo (18/10, Tony + Pedro) num Reel com jump cuts, legenda palavra a palavra,
placar no menor preço do site (2 × R$ 69,66), valor do Espeon ex (Liga), faixa de abertura e cartela final."""
import json, os, subprocess, shutil, urllib.request, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from render import badge, brl, anim_final, faixa_abertura, camada, F, VERDE, VERM, AMARELO, BRANCO, W, H, FPS_M, ease, pilula
from PIL import Image, ImageDraw

AQUI = os.path.dirname(os.path.abspath(__file__))
OUT = 'tmp-render'; os.makedirs(OUT, exist_ok=True)
SRC = json.load(open(os.path.join(AQUI, 'blister.json')))
FALA = json.load(open('tmp-blister/relatorio.json'))
T = '/tmp/bd'; os.makedirs(T, exist_ok=True)

# (fonte, início, fim, velocidade) — cortes escolhidos pela transcrição e pelos mosaicos; sem sorteio, sem código de resgate
EDL = [
    ('BD_5_163557', 83.9, 86.3, 1.0),    # gancho: "Gente, olha esse Espeon" com o Espeon ex na mão
    ('BD_1_162930', 10.5, 12.7, 1.0),    # "Eu tô aqui com Pedro, meu filhote."
    ('BD_1_162930', 13.85, 15.5, 1.0),   # "Ah, eu sou o Pedro."
    ('BD_1_162930', 32.6, 36.7, 1.05),   # "...ele tem mais sorte do que eu abrindo, né Pedrinho?" (blister na tela)
    ('BD_2_163118', 67.9, 71.3, 1.1),    # "três, quatro. Isso aí, vamos abrir, dá sorte."
    ('BD_3_163331', 12.5, 20.0, 1.5),    # pack 1: Seismitoad, Espeon, Vivillon (para antes do card de código, aos 24 s)
    ('BD_4_163408', 3.0, 5.2, 1.0),      # "Segundo packzinho, o Pedrinho vai abrir."
    ('BD_4_163408', 23.7, 33.0, 1.35),   # Illumise, Mew, "Oh, Pikachu! Legal."
    ('BD_5_163557', 0.9, 6.3, 1.05),     # "O último packzinho agora, por favor Pedro, tem que dar bom, hein?"
    ('BD_5_163557', 37.6, 40.5, 1.0),    # "Charizard? Então vai vir coisa boa."
    ('BD_5_163557', 64.9, 71.2, 1.2),    # "eu vou tirar as duas últimas. Uma, duas, sempre façam isso." (Exeggutor)
    ('BD_5_163557', 73.0, 82.7, 1.15),   # Minior, Espeon ex, "Espeon! ... um Pikachu que a gente não tem ... que uma Espeon"
    ('BD_5_163557', 95.1, 96.6, 1.0),    # "Valeu, galera. Até o próximo vídeo."
]
CORRIGE = {'Espion': 'Espeon', 'Espion.': 'Espeon.', 'Espion,': 'Espeon,', 'blisterzinhas': 'blisterzinhos'}
TIRA = {'Bordeco.', 'Um', 'mil.'}
ESPEON_SRC = ('BD_5_163557', 75.0)       # quando o Espeon ex aparece
CUSTO, ESPEON = 139.32, 16.53

def baixa(nome):
    arq = f'{T}/{nome}.mp4'
    if not os.path.exists(arq):
        req = urllib.request.Request(f'https://drive.usercontent.google.com/download?id={SRC[nome]}&export=download&confirm=t', headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req, timeout=900) as r, open(arq, 'wb') as f: shutil.copyfileobj(r, f, 1 << 22)
    return arq

# 1) cortes em 1080x1920 com velocidade (vídeo e áudio)
clipes, inicio, t = [], [], 0.0
for i, (src, a, b, v) in enumerate(EDL):
    arq = baixa(src); c = f'{T}/c{i:02d}.mp4'
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', str(a), '-to', str(b), '-i', arq,
                    '-vf', f'scale=1080:1920:flags=lanczos,setsar=1,fps=30,setpts=PTS/{v}', '-af', f'atempo={v},aresample=48000',
                    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '18', '-c:a', 'aac', '-b:a', '192k', c], check=True)
    d = float(subprocess.run(['ffprobe', '-v', 'quiet', '-show_entries', 'format=duration', '-of', 'csv=p=0', c], capture_output=True, text=True).stdout)
    clipes.append(c); inicio.append(t); t += d
DUR = t
with open(f'{T}/lista.txt', 'w') as f: f.writelines(f"file '{c}'\n" for c in clipes)
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', f'{T}/lista.txt', '-c', 'copy', f'{T}/base.mp4'], check=True)

def mapa(src, ts):
    for i, (s, a, b, v) in enumerate(EDL):
        if s == src and a <= ts <= b: return inicio[i] + (ts - a) / v
    return None

# 2) legenda palavra a palavra (ASS): blocos de até 3 palavras, a palavra falada em amarelo
pal = []
for i, (src, a, b, v) in enumerate(EDL):
    for s in FALA[src]['fala']:
        for w0, w1, w in s['p']:
            if a <= w0 and w1 <= b + 0.05:
                w = w.strip()
                if w in TIRA: continue
                pal.append((inicio[i] + (w0 - a) / v, inicio[i] + (min(w1, b) - a) / v, CORRIGE.get(w, w), i))
blocos, cur = [], []
for p in pal:
    if cur and (len(cur) == 3 or p[3] != cur[-1][3] or p[0] - cur[-1][1] > 0.6 or cur[-1][2][-1:] in '.?!'):
        blocos.append(cur); cur = []
    cur.append(p)
if cur: blocos.append(cur)
def ts(x): x = max(x, 0); return f'{int(x // 3600)}:{int(x % 3600 // 60):02d}:{x % 60:05.2f}'
ass = ['[Script Info]', 'ScriptType: v4.00+', 'PlayResX: 1080', 'PlayResY: 1920', '', '[V4+ Styles]',
       'Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding',
       'Style: Leg,Rubik Light Black,78,&H00FFFFFF,&H00FFFFFF,&H00000000,&H80000000,0,0,0,0,100,100,0,0,1,7,3,2,60,60,560,1',
       '', '[Events]', 'Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text']
for bl in blocos:
    fim_bl = bl[-1][1] + 0.15
    for k, p in enumerate(bl):
        a = p[0]; b = bl[k + 1][0] if k + 1 < len(bl) else fim_bl
        txt = ' '.join(('{\\c&H33CFFF&}' + q[2].upper() + '{\\c&HFFFFFF&}') if j == k else q[2].upper() for j, q in enumerate(bl))
        ass.append(f'Dialogue: 0,{ts(a)},{ts(b)},Leg,,0,0,0,,{txt}')
open(f'{T}/leg.ass', 'w').write('\n'.join(ass))

# 3) camadas: título do gancho, placar, selo do Espeon ex, faixa de abertura
t_gancho = inicio[1]; t_placar = inicio[3]; t_esp = mapa(*ESPEON_SRC); t_fim = DUR
cam = f'{T}/cam'; os.makedirs(cam, exist_ok=True)
tit = camada(W, 260); p = pilula('OLHA O QUE SAIU NO ÚLTIMO PACK', F(900, 48), pad=(34, 18)); tit.alpha_composite(p, ((W - p.width) // 2, 120))
faixa = faixa_abertura()
def placar(v):
    c = camada(440, 110); c.alpha_composite(badge(brl(v), VERDE if v > 0 else VERM, 420, 100, F(900, 50), borda=5), (10, 0)); return c
pl_a, pl_b = placar(-CUSTO), placar(-CUSTO + ESPEON)
selo = camada(420, 110); d = ImageDraw.Draw(selo); d.rounded_rectangle((0, 0, 419, 109), 55, fill=(34, 197, 94)); f = F(900, 56)
tx = brl(ESPEON); d.text(((420 - d.textlength(tx, font=f)) / 2, 18), tx, font=f, fill=BRANCO)
n = int(t_fim * FPS_M) + 1
for i in range(n):
    tt = i / FPS_M; c = camada(W, H)
    if tt < t_gancho:
        e = ease(tt / 0.25); lay = tit.copy(); lay.putalpha(lay.getchannel('A').point(lambda x: int(x * e))); c.alpha_composite(lay, (0, 0))
    if tt >= t_placar: c.alpha_composite(pl_a if tt < t_esp else pl_b, (320, 92))
    if t_esp <= tt < t_esp + 2.6:
        e = ease((tt - t_esp) / 0.3); s = selo.copy(); s.putalpha(s.getchannel('A').point(lambda x: int(x * e))); c.alpha_composite(s, (330, 1560))
    fi, fo = t_placar + 0.2, t_placar + 3.4
    if fi <= tt < fo + 0.4:
        e = ease((tt - fi) / 0.4) if tt < fo else 1 - ease((tt - fo) / 0.4)
        if e > 0.01:
            lay = faixa.copy(); lay.putalpha(lay.getchannel('A').point(lambda x: int(x * e))); c.alpha_composite(lay, (40, int(230 + (1 - e) * 60)))
    c.save(f'{cam}/{i:05d}.png')

# 4) cartela final (design system) sobre o último quadro, 3,5 s
q = f'{T}/q.png'; subprocess.run(['ffmpeg', '-v', 'quiet', '-y', '-sseof', '-0.2', '-i', f'{T}/base.mp4', '-frames:v', '1', q], check=True)
fim = f'{T}/fim'; os.makedirs(fim, exist_ok=True)
anim_final(Image.open(q), {'site': CUSTO, 'produto': '2 Blisters Duplos', 'itens': [['Blister Duplo (cada)', 69.66], ['Espeon ex (Liga)', ESPEON]], 'serie': '30 Anos'}, round(-CUSTO + ESPEON, 2), fim)
EXTRA = 3.5
saida = f'{OUT}/BD_blister_duplo_pedro.mp4'
g = (f"[0:v]tpad=stop_mode=clone:stop_duration={EXTRA},subtitles={T}/leg.ass:fontsdir={AQUI}[v0];"
     f"[v0][1:v]overlay=0:0:eof_action=pass[v1];"
     f"[2:v]setpts=PTS-STARTPTS+{t_fim:.3f}/TB[fe];[v1][fe]overlay=0:0:eof_action=repeat[vf]")
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-i', f'{T}/base.mp4', '-framerate', str(FPS_M), '-i', f'{cam}/%05d.png', '-framerate', str(FPS_M), '-i', f'{fim}/f%04d.png',
                '-filter_complex', g, '-map', '[vf]', '-map', '0:a', '-af', f'apad=pad_dur={EXTRA},loudnorm=I=-14:TP=-1.5:LRA=11', '-c:a', 'aac', '-b:a', '192k',
                '-t', f'{DUR + EXTRA:.2f}', '-c:v', 'libx264', '-preset', 'medium', '-crf', '21', '-maxrate', '4M', '-bufsize', '8M', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', saida], check=True)
for tt in (1.0, t_gancho + 0.8, t_placar + 1.5, t_esp + 0.8, DUR + 2.5):
    subprocess.run(['ffmpeg', '-v', 'quiet', '-y', '-ss', f'{tt:.2f}', '-i', saida, '-frames:v', '1', '-vf', 'scale=540:-2', f'{OUT}/BD_prova_{tt:05.1f}.jpg'])
json.dump({'dur': round(DUR + EXTRA, 1), 'inicio_clipes': [round(x, 2) for x in inicio], 't_espeon': round(t_esp, 2), 'palavras': len(pal)}, open(f'{OUT}/BD_relatorio.json', 'w'), indent=1)
# log
