#!/bin/bash
# compõe em sequência as peças passadas (nomes das configs sem .json)
cd "$(dirname "$0")"
for k in "$@"; do python3 compor.py $k.json /tmp/wt-coleta/tmp-gsap/${k^^}_mudo.mp4 2>&1 | tail -1; done
