#!/usr/bin/env python3
"""Estilo (áudio: som real da abertura em primeiro plano, trilha baixa por baixo, moedinha em cada hit) "só abertura" (referência @pokebrasil151, pedido do dono em 03/11): abertura em tempo real, sem gancho/estrela/faixa/tela final,
sem chamada do site. Só: logo redondo no 1º segundo, placar pequeno no topo e selo verde "+R$" curto no hit. Trilha única por baixo.
Uso: python3 limpo.py <config.json> <saida.mp4>   config: {"segs":[[arq,ini,fim],...], "pack":47.40, "hits":[{"t":16.8,"valor":41.83}], "fim":"logo"}"""
import json, os, subprocess, sys, tempfile
from PIL import Image, ImageDraw, ImageFont
AQUI = os.path.dirname(os.path.abspath(__file__)); RAIZ = os.path.abspath(os.path.join(AQUI, '../../..'))
F = ImageFont.truetype(os.path.join(AQUI, '../../carrossel/rubik900.ttf'), 62)
def brl(v): s = f'{abs(v):,.2f}'.replace(',', 'X').replace('.', ',').replace('X', '.'); return ('−' if v < 0 else '+') + 'R$ ' + s
def pilula(txt, cor, borda, arq):
    w = int(F.getlength(txt)) + 64; h = 96
    im = Image.new('RGBA', (w + 12, h + 12), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    d.rounded_rectangle((6, 6, w + 6, h + 6), 26, fill=(10, 12, 24, 225) if borda else cor, outline=borda, width=5 if borda else 0)
    d.text((6 + w / 2, 6 + h / 2 + 2), txt, font=F, fill=cor if borda else (255, 255, 255), anchor='mm'); im.save(arq); return im.size
C = json.load(open(sys.argv[1])); out = sys.argv[2]; T = tempfile.mkdtemp()
# 1. junta os trechos (tempo real)
lst = []
for i, (a, ini, fim) in enumerate(C['segs']):
    p = f'{T}/s{i}.mp4'; lst.append(p)
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-ss', str(ini), '-to', str(fim), '-i', os.path.join(RAIZ, a), '-vf', 'fps=30,scale=1080:1920,setsar=1', '-af', 'aresample=48000,aformat=channel_layouts=stereo',
                    '-c:v', 'libx264', '-crf', '18', '-preset', 'veryfast', '-c:a', 'aac', '-b:a', '192k', p], check=True)
open(f'{T}/l.txt', 'w').write(''.join(f"file '{p}'\n" for p in lst))
subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', f'{T}/l.txt', '-c', 'copy', f'{T}/base.mp4'], check=True)
dur = float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f'{T}/base.mp4'], capture_output=True, text=True).stdout)
# 2. placar: um PNG por estado; selo do hit
saldo, estados, t0 = -C['pack'], [], 0.0
for h in sorted(C.get('hits', []), key=lambda h: h['t']):
    estados.append((t0, h['t'], saldo)); saldo += h['valor']; t0 = h['t']
estados.append((t0, dur, saldo))
ins, filt, n = ['-i', f'{T}/base.mp4'], [], 1
cur = '[0:v]'
for k, (a, b, v) in enumerate(estados):
    cor = (255, 70, 70) if v < 0 else (46, 227, 107)
    w, h = pilula(brl(v), cor, cor, f'{T}/p{k}.png'); ins += ['-i', f'{T}/p{k}.png']
    filt.append(f"{cur}[{n}:v]overlay=x=(W-{w})/2:y=150:enable='between(t,{a:.2f},{b:.2f})'[v{n}]"); cur = f'[v{n}]'; n += 1
for k, h in enumerate(C.get('hits', [])):
    w, hh = pilula(brl(h['valor']), (24, 170, 80), None, f'{T}/h{k}.png'); ins += ['-i', f'{T}/h{k}.png']
    filt.append(f"{cur}[{n}:v]overlay=x=(W-{w})/2:y={C.get('seloY', 1480)}:enable='between(t,{h['t']:.2f},{h['t'] + 2.6:.2f})'[v{n}]"); cur = f'[v{n}]'; n += 1
# 3. logo redondo no começo (e no fim), entrando com escala
logo = os.path.join(AQUI, '../../carrossel/logo.png'); ins += ['-loop', '1', '-t', f'{dur:.2f}', '-i', logo]
filt.append(f"[{n}:v]scale=640:-1,format=rgba,fade=t=in:st=0.1:d=0.25:alpha=1,fade=t=out:st=1.4:d=0.3:alpha=1[lg]")
filt.append(f"{cur}[lg]overlay=x=(W-640)/2:y=620:enable='lt(t,1.8)'[vf]")
# 4. áudio: som real da abertura (ASMR do pacote) na frente, trilha única baixa por baixo, moedinha em cada hit
ins += ['-i', os.path.join(RAIZ, 'tmp-render/G_E2_placar_box.mp4')]; it = n + 1
# só nos trechos de abertura/cartas (C["asmr"] = [[ini,fim],...] no tempo final); gate corta respiração e ruído baixo entre os estalos
jan = '+'.join(f'between(t,{a},{b})' for a, b in C.get('asmr', [[0, dur]]))
filt.append(f"[0:a]highpass=f=700,agate=threshold=0.035:ratio=6:attack=2:release=120,acompressor=threshold=-26dB:ratio=3:makeup=5,volume='gt({jan},0)':eval=frame[asmr]")
filt.append(f"[{it}:a]aloop=loop=-1:size=2e9,atrim=0:{dur:.2f},volume=0.22,afade=t=in:d=0.3,afade=t=out:st={dur - 1.5:.2f}:d=1.5[tr]")
mix = ['[asmr]', '[tr]']
for k, h in enumerate(C.get('hits', [])):
    ins += ['-i', os.path.join(AQUI, 'moeda.wav')]; ms = int(h['t'] * 1000)
    filt.append(f"[{it + 1 + k}:a]adelay={ms}|{ms},volume=0.9[m{k}]"); mix.append(f'[m{k}]')
filt.append(f"{''.join(mix)}amix=inputs={len(mix)}:normalize=0:duration=first,loudnorm=I=-15:TP=-1.5[a]")
subprocess.run(['ffmpeg', '-v', 'error', '-y', *ins, '-filter_complex', ';'.join(filt), '-map', '[vf]', '-map', '[a]', '-t', f'{dur:.2f}',
                '-c:v', 'libx264', '-crf', '20', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', out], check=True)
print('ok', out, f'{dur:.1f}s')
