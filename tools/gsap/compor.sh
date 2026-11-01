#!/bin/bash
# Compõe um vídeo GSAP mudo: corte bruto (1080x1920) + camada GSAP renderizada quadro a quadro.
# Câmera: aproximação lenta de 3% no vídeo todo + "soco" de 6% no hit (decai em 0,7 s).
# uso: compor.sh <config.json> <corte.mp4> <início no corte, s> <saída.mp4>
set -e
AQUI=$(cd "$(dirname "$0")" && pwd); Q=$(mktemp -d)
read DUR H <<<"$(python3 -c "import json;c=json.load(open('$1'));print(c['dur'],c['hitT'])")"
node "$AQUI/render.cjs" "$1" "$Q" 30
Z="(1+0.03*t/$DUR+0.06*if(between(t\,$H\,$H+0.7)\,1-(t-$H)/0.7\,0))"
ffmpeg -v error -y -ss "$3" -i "$2" -framerate 30 -i "$Q/%05d.png" \
  -filter_complex "[0:v]fps=30,setsar=1,tpad=stop_mode=clone:stop_duration=$DUR,trim=0:$DUR,setpts=PTS-STARTPTS,scale=w='2*trunc(540*$Z)':h='2*trunc(960*$Z)':eval=frame:flags=bicubic,crop=1080:1920[b];[b][1:v]overlay=0:0:format=auto,format=yuv420p[v]" \
  -map "[v]" -an -c:v libx264 -crf 19 -preset medium -r 30 -t "$DUR" -movflags +faststart "$4"
rm -rf "$Q"; echo "ok $4"
