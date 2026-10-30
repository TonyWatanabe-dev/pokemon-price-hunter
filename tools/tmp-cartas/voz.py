#!/usr/bin/env python3
"""Refaz o áudio dos vídeos agendados mantendo a VOZ do dono e tirando a música do áudio original (Content ID).
O remix de 24/10 trocou o áudio inteiro pela trilha e a fala sumiu (dono, 25/10). Aqui: separa a voz do áudio original
(Demucs, 2 stems), põe a trilha nossa (comp_fala.json) por baixo com ducking pela voz. Sem voz detectada = só trilha.
Fontes: remix.json (mesmos originais). Subconjunto opcional em voz_so.txt (um nome por linha). Saída tmp-render/M_<nome>.mp4."""
import json, os, shutil, subprocess, urllib.request, glob
AQUI = os.path.dirname(os.path.abspath(__file__)); T = '/tmp/voz'; os.makedirs(T, exist_ok=True)
FONTES = json.load(open(os.path.join(AQUI, 'remix.json')))
SO = [l.strip() for l in open(os.path.join(AQUI, 'voz_so.txt'))] if os.path.exists(os.path.join(AQUI, 'voz_so.txt')) else []
SO = [s for s in SO if s]
TRILHA = json.load(open(os.path.join(AQUI, 'comp_fala.json')))['trilha']
def baixa(url, arq):
    for t in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'}), timeout=180) as r, open(arq + '.part', 'wb') as f: shutil.copyfileobj(r, f, 1 << 22)
            os.replace(arq + '.part', arq); return arq
        except Exception as e: print('baixa', url[:60], t, repr(e), flush=True)
    raise RuntimeError('não baixou ' + url[:80])
def run(*a): return subprocess.run(list(a), capture_output=True, text=True, check=True)
def lufs(arq):
    e = subprocess.run(['ffmpeg', '-hide_banner', '-i', arq, '-af', 'ebur128', '-f', 'null', '-'], capture_output=True, text=True).stderr
    for l in reversed(e.splitlines()):
        if l.strip().startswith('I:'): return float(l.split()[1])
    return -99.0
tr = baixa(TRILHA, f'{T}/trilha.wav')
import thumb
VID = {v: k for k, v in json.load(open(os.path.join(AQUI, 'videos.json'))).items()}
REL = json.load(open('tmp-render/relatorio.json')) if os.path.exists('tmp-render/relatorio.json') else {}
def melhor(nome):
    # capa: maior salto do placar (>= R$ 20) = carta mais valiosa; motion do site não ganha capa
    base = VID.get(FONTES[nome].get('drive'), nome) if nome.startswith('D_') else nome
    if base.startswith(('SITE_', 'RD_')): return 'sem'
    if base == 'BD_blister_duplo_pedro' and os.path.exists('tmp-render/BD_relatorio.json'):
        return json.load(open('tmp-render/BD_relatorio.json'))['t_espeon'] + 0.4  # Espeon ex
    ls = [x for x in REL.get(base, {}).get('leituras', []) if x[1] is not None]
    saltos = [(b[1] - a[1], b[0]) for a, b in zip(ls, ls[1:])]
    s = max(saltos, default=(0, None))
    return max(s[1] - 0.3, 0) if s[0] >= 20 else None
log = []
for nome, f in FONTES.items():
    if SO and nome not in SO: continue
    try:
        asmr = f"tmp-render/{nome}_asmr.mp4"
        if nome.startswith('U_') and os.path.exists(asmr):  # gravação original já refeita em ASMR (unbox.py ASMR=1)
            shutil.copy(asmr, f'tmp-render/M_{nome}.mp4'); shutil.copy(f"tmp-render/{nome}_asmr_thumb.jpg", f'tmp-render/M_{nome}_thumb.jpg'); os.remove(asmr)
            log.append(f'ok {nome} asmr'); print(log[-1], flush=True); continue
        src = f.get('arquivo') or baixa(f'https://drive.usercontent.google.com/download?id={f["drive"]}&export=download&confirm=t', f'{T}/{nome}.mp4')
        dur = float(run('ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', src).stdout)
        tem_a = run('ffprobe', '-v', 'error', '-select_streams', 'a', '-show_entries', 'stream=index', '-of', 'csv=p=0', src).stdout.strip()
        voz, nivel = None, -99.0
        if tem_a:
            wav = f'{T}/{nome}.wav'; run('ffmpeg', '-v', 'error', '-y', '-i', src, '-vn', '-ac', '2', '-ar', '44100', wav)
            run('python3', '-m', 'demucs', '--two-stems=vocals', '-n', 'htdemucs', '-o', f'{T}/sep', wav)
            v = glob.glob(f'{T}/sep/htdemucs/{nome}/vocals.wav')[0]; nivel = lufs(v)
            if nivel > -38: voz = v
        out = f'tmp-render/M_{nome}.mp4'
        trf = f'aloop=loop=-1:size=2e9,atrim=0:{dur:.2f},afade=t=in:d=0.5,afade=t=out:st={max(dur - 1.5, 0):.2f}:d=1.5'
        if voz:
            af = (f'[2:a]highpass=f=90,equalizer=f=180:t=q:w=1:g=-3,equalizer=f=380:t=q:w=1:g=-6,equalizer=f=800:t=q:w=1:g=-2,equalizer=f=3000:t=q:w=1.2:g=6,equalizer=f=6000:t=q:w=1:g=3,afftdn=nf=-30,acompressor=threshold=-24dB:ratio=2.5:attack=8:release=150:makeup=5,apad,atrim=0:{dur:.2f},asplit=2[v][sc];'
                  f'[1:a]volume=0.18,{trf}[t];[t][sc]sidechaincompress=threshold=0.03:ratio=8:attack=15:release=350[td];'
                  f'[v][td]amix=inputs=2:duration=first:normalize=0,loudnorm=I=-14:TP=-1.5:LRA=11[a]')
            ins = ['-i', src, '-i', tr, '-i', voz]
        else:
            af = f'[1:a]{trf},loudnorm=I=-16:TP=-1.5[a]'; ins = ['-i', src, '-i', tr]
        subprocess.run(['ffmpeg', '-v', 'error', '-y', *ins, '-filter_complex', af, '-map', '0:v:0', '-map', '[a]', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '192k',
                        '-t', f'{dur:.2f}', '-movflags', '+faststart', out], check=True)
        tb = melhor(nome)
        if tb != 'sem': thumb.de_video(out, tb, f'tmp-render/M_{nome}_thumb.jpg')
        log.append(f'ok {nome} {dur:.1f}s capa={tb} voz={"sim" if voz else "não"} ({nivel:.1f} LUFS)')
    except Exception as e: log.append(f'FALHOU {nome}: {getattr(e, "stderr", "") or e}'[:400])
    print(log[-1], flush=True)
open('tmp-render/V_log.txt', 'a').write('\n'.join(log) + '\n')
