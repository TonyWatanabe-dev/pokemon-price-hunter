#!/bin/bash
# Compõe um vídeo GSAP mudo: corte bruto (1080x1920) + camada GSAP renderizada quadro a quadro.
# uso: compor.sh <config.json> <corte.mp4> <início no corte, s> <saída.mp4>
set -e
AQUI=$(cd "$(dirname "$0")" && pwd); Q=$(mktemp -d)
DUR=$(python3 -c "import json;print(json.load(open('$1'))['dur'])")
node "$AQUI/render.cjs" "$1" "$Q" 30
ffmpeg -v error -y -ss "$3" -i "$2" -framerate 30 -i "$Q/%05d.png" \
  -filter_complex "[0:v]fps=30,scale=1080:1920,setsar=1,tpad=stop_mode=clone:stop_duration=$DUR,trim=0:$DUR,setpts=PTS-STARTPTS[b];[b][1:v]overlay=0:0:format=auto,format=yuv420p[v]" \
  -map "[v]" -an -c:v libx264 -crf 18 -preset slow -r 30 -t "$DUR" -movflags +faststart "$4"
rm -rf "$Q"; echo "ok $4"
