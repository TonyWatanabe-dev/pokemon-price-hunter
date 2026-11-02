#!/usr/bin/env python3
"""02/11, pedido do dono: versões novas dos vídeos que não performaram no TikTok, para repostar.
Abertura com 1 s do melhor momento (flash-forward) para virar capa e gancho; sem hit, o trecho entra desfocado.
Vídeos do site (sem fala): corta a tela azul vazia do começo e troca o áudio pela trilha única.
Uso: python3 repost.py (rodar na raiz do repo). Saída tmp-render/RP_<nome>.mp4."""
import os, subprocess
def run(*a): subprocess.run(a, check=True)
TEASER = {  # nome: (fonte, início do trecho, desfoca?)
  'miraidon': ('M_D_1aEcSNI1', 20.0, False), 'etb30': ('M_30A_etb_abertura_v2', 119.6, False), 'uxie': ('M_30A_hit_uxie', 11.0, True),
  'de8': ('M_DE_caixa_8packs', 18.0, True), 'dragonite_brick': ('M_U_brick_dragonite', 3.0, True)}
for nome, (src, t, blur) in TEASER.items():
    if os.path.exists(f'tmp-render/RP_{nome}.mp4') and os.path.getsize(f'tmp-render/RP_{nome}.mp4') > 1e6: continue
    vf = 'boxblur=24:2,' if blur else ''
    # duas entradas do mesmo arquivo (a 1ª com -ss/-t) para não segurar o vídeo inteiro na memória
    run('ffmpeg', '-v', 'error', '-y', '-ss', str(t), '-t', '1.0', '-i', f'tmp-render/{src}.mp4', '-i', f'tmp-render/{src}.mp4', '-filter_complex',
        f"[0:v]setpts=PTS-STARTPTS,{vf}format=yuv420p[tv];[0:a]asetpts=PTS-STARTPTS,afade=t=out:st=0.85:d=0.15[ta];"
        f"[1:v]format=yuv420p,setpts=PTS-STARTPTS[mv];[1:a]asetpts=PTS-STARTPTS,afade=t=in:d=0.1[ma];[tv][ta][mv][ma]concat=n=2:v=1:a=1[v][a]",
        '-map', '[v]', '-map', '[a]', '-c:v', 'libx264', '-crf', '20', '-preset', 'medium', '-c:a', 'aac', '-b:a', '192k', '-ar', '48000', '-movflags', '+faststart', f'tmp-render/RP_{nome}.mp4')
    print('ok', nome, flush=True)
SITE = {'lojas57': 'M_D_1zrk8sN9', 'naoprocure': 'M_D_1nhPa11D'}
for nome, src in SITE.items():
    dur = float(subprocess.run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f'tmp-render/{src}.mp4'], capture_output=True, text=True).stdout) - 0.6
    run('ffmpeg', '-v', 'error', '-y', '-ss', '0.6', '-i', f'tmp-render/{src}.mp4', '-i', 'tmp-render/G_E2_placar_box.mp4', '-filter_complex',
        f'[1:a]aloop=loop=-1:size=2e9,atrim=0:{dur:.2f},afade=t=in:d=0.2,afade=t=out:st={dur - 1.4:.2f}:d=1.4,loudnorm=I=-16:TP=-1.5[a]',
        '-map', '0:v', '-map', '[a]', '-t', f'{dur:.2f}', '-c:v', 'libx264', '-crf', '19', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-movflags', '+faststart', f'tmp-render/RP_{nome}.mp4')
    print('ok', nome, flush=True)
